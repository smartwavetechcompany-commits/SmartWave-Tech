import React, { useState, useEffect, useMemo } from 'react';
import { 
  Tag, 
  Plus, 
  Search, 
  Filter, 
  Calendar, 
  Percent, 
  DollarSign, 
  Users, 
  TrendingUp, 
  AlertCircle, 
  CheckCircle2, 
  Pause, 
  Play, 
  Trash2, 
  Edit3, 
  Copy, 
  ExternalLink, 
  Sparkles, 
  ShieldAlert, 
  Clock, 
  Download, 
  FileSpreadsheet, 
  X, 
  Layers, 
  Bed, 
  Globe, 
  Check, 
  ArrowRight,
  Info,
  Building2,
  Briefcase
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { 
  Promotion, 
  PromotionRedemption, 
  PromotionStatus, 
  PromotionType, 
  PromotionTargetGuestType,
  RoomType,
  CorporateAccount
} from '../types';
import { 
  subscribePromotions, 
  createPromotion, 
  updatePromotion, 
  togglePromotionStatus, 
  deletePromotion, 
  canManagePromotions 
} from '../services/promotionService';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { formatCurrency, cn, exportToCSV } from '../utils';
import { format, parseISO, isAfter, isBefore } from 'date-fns';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { DEFAULT_BOOKING_SOURCES } from '../constants';

type TabFilter = 'all' | 'active' | 'corporate' | 'scheduled' | 'paused' | 'expired' | 'exhausted';

export function PromotionsManagement() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<TabFilter>('all');
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [editingPromo, setEditingPromo] = useState<Promotion | null>(null);
  const [selectedPromoForHistory, setSelectedPromoForHistory] = useState<Promotion | null>(null);
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isAuthorized = useMemo(() => canManagePromotions(profile), [profile]);

  // Form state
  const [formData, setFormData] = useState<{
    code: string;
    name: string;
    description: string;
    type: PromotionType;
    discountType: 'percentage' | 'fixed';
    value: number;
    currency: 'NGN' | 'USD';
    startDate: string;
    expiryDate: string;
    status: PromotionStatus;
    targetGuestType: PromotionTargetGuestType;
    eligibleCorporateIds: string[];
    allowStackOnNegotiatedRate: boolean;
    eligibleRoomTypes: string[];
    eligibleBookingSources: string[];
    minStayNights: number;
    minBookingAmount: number;
    maxUses: number;
    maxDiscountCap: number;
    appliesTo: 'room_only' | 'all_charges';
    combinable: boolean;
  }>({
    code: '',
    name: '',
    description: '',
    type: 'percentage',
    discountType: 'percentage',
    value: 10,
    currency: currency || 'NGN',
    startDate: format(new Date(), 'yyyy-MM-dd'),
    expiryDate: format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
    status: 'active',
    targetGuestType: 'all',
    eligibleCorporateIds: [],
    allowStackOnNegotiatedRate: false,
    eligibleRoomTypes: ['all'],
    eligibleBookingSources: ['all'],
    minStayNights: 0,
    minBookingAmount: 0,
    maxUses: 0,
    maxDiscountCap: 0,
    appliesTo: 'room_only',
    combinable: false
  });

  // Subscribe to real-time promotions
  useEffect(() => {
    if (!hotel?.id) return;
    setLoading(true);
    const unsub = subscribePromotions(hotel.id, (list) => {
      setPromotions(list);
      setLoading(false);
    });
    return () => unsub();
  }, [hotel?.id]);

  // Load hotel room types
  useEffect(() => {
    if (!hotel?.id) return;
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');
    const unsub = onSnapshot(typesRef, (snap) => {
      const types: RoomType[] = [];
      snap.forEach(d => types.push({ id: d.id, ...d.data() } as RoomType));
      setRoomTypes(types);
    });
    return () => unsub();
  }, [hotel?.id]);

  // Load corporate accounts
  useEffect(() => {
    if (!hotel?.id) return;
    const corpRef = collection(db, 'hotels', hotel.id, 'corporate_accounts');
    const unsub = onSnapshot(corpRef, (snap) => {
      const corps: CorporateAccount[] = [];
      snap.forEach(d => corps.push({ id: d.id, ...d.data() } as CorporateAccount));
      setCorporateAccounts(corps);
    }, (err) => {
      console.error('Failed to load corporate accounts:', err);
    });
    return () => unsub();
  }, [hotel?.id]);

  // Available booking sources from settings or defaults
  const availableBookingSources = useMemo(() => {
    const customSources = hotel?.settings?.reservations?.bookingSources?.filter(s => s.isActive).map(s => s.name) || [];
    if (customSources.length > 0) return customSources;
    return DEFAULT_BOOKING_SOURCES.map(s => s.name);
  }, [hotel]);

  // Filtered promotions based on search & tab
  const filteredPromotions = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    return promotions.filter(promo => {
      // Search match
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch = !query || 
        promo.code.toLowerCase().includes(query) || 
        promo.name.toLowerCase().includes(query) ||
        (promo.description && promo.description.toLowerCase().includes(query));

      if (!matchesSearch) return false;

      // Tab match
      const isExhausted = promo.maxUses && promo.maxUses > 0 && promo.usedCount >= promo.maxUses;
      const isExpired = promo.status === 'expired' || todayStr > promo.expiryDate;
      const isScheduled = todayStr < promo.startDate;
      const isPaused = promo.status === 'paused';
      const isActive = promo.status === 'active' && !isExpired && !isScheduled && !isExhausted;

      if (activeTab === 'active') return isActive;
      if (activeTab === 'corporate') return promo.targetGuestType === 'corporate_only' || promo.targetGuestType === 'selected_corporate';
      if (activeTab === 'scheduled') return isScheduled && !isPaused;
      if (activeTab === 'paused') return isPaused;
      if (activeTab === 'expired') return isExpired;
      if (activeTab === 'exhausted') return isExhausted;
      return true;
    });
  }, [promotions, searchQuery, activeTab]);

  // Overall Performance & Corporate Metrics
  const metrics = useMemo(() => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let activeCount = 0;
    let totalRedemptions = 0;
    let totalDiscountGranted = 0;
    let totalAttributedRevenue = 0;

    let totalCorporateRedemptions = 0;
    let totalCorporateDiscountGranted = 0;
    let totalCorporateAttributedRevenue = 0;
    const corporateBreakdown: { [corpKey: string]: { id?: string; name: string; redemptions: number; discount: number; revenue: number } } = {};

    promotions.forEach(p => {
      const isExhausted = p.maxUses && p.maxUses > 0 && p.usedCount >= p.maxUses;
      const isExpired = p.status === 'expired' || todayStr > p.expiryDate;
      if (p.status === 'active' && !isExpired && !isExhausted && todayStr >= p.startDate) {
        activeCount++;
      }
      totalRedemptions += (p.usedCount || 0);

      if (p.redemptions && p.redemptions.length > 0) {
        p.redemptions.forEach(r => {
          const discount = Number(r.discountAmount || 0);
          const revenue = Number(r.finalAmount || 0);

          totalDiscountGranted += discount;
          totalAttributedRevenue += revenue;

          if (r.corporateId || r.corporateName) {
            totalCorporateRedemptions++;
            totalCorporateDiscountGranted += discount;
            totalCorporateAttributedRevenue += revenue;

            const key = r.corporateId || r.corporateName || 'corporate';
            if (!corporateBreakdown[key]) {
              corporateBreakdown[key] = {
                id: r.corporateId,
                name: r.corporateName || 'Corporate Partner',
                redemptions: 0,
                discount: 0,
                revenue: 0
              };
            }
            corporateBreakdown[key].redemptions++;
            corporateBreakdown[key].discount += discount;
            corporateBreakdown[key].revenue += revenue;
          }
        });
      }
    });

    return {
      activeCount,
      totalRedemptions,
      totalDiscountGranted,
      totalAttributedRevenue,
      totalCorporateRedemptions,
      totalCorporateDiscountGranted,
      totalCorporateAttributedRevenue,
      corporateBreakdown: Object.values(corporateBreakdown)
    };
  }, [promotions]);

  // Open create modal
  const handleOpenCreateModal = () => {
    setEditingPromo(null);
    setFormData({
      code: '',
      name: '',
      description: '',
      type: 'percentage',
      discountType: 'percentage',
      value: 10,
      currency: currency || 'NGN',
      startDate: format(new Date(), 'yyyy-MM-dd'),
      expiryDate: format(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), 'yyyy-MM-dd'),
      status: 'active',
      targetGuestType: 'all',
      eligibleCorporateIds: [],
      allowStackOnNegotiatedRate: false,
      eligibleRoomTypes: ['all'],
      eligibleBookingSources: ['all'],
      minStayNights: 0,
      minBookingAmount: 0,
      maxUses: 0,
      maxDiscountCap: 0,
      appliesTo: 'room_only',
      combinable: false
    });
    setIsModalOpen(true);
  };

  // Open edit modal
  const handleOpenEditModal = (promo: Promotion) => {
    setEditingPromo(promo);
    setFormData({
      code: promo.code,
      name: promo.name,
      description: promo.description || '',
      type: promo.type || 'percentage',
      discountType: promo.discountType || 'percentage',
      value: promo.value,
      currency: promo.currency || currency || 'NGN',
      startDate: promo.startDate,
      expiryDate: promo.expiryDate,
      status: promo.status,
      targetGuestType: promo.targetGuestType || 'all',
      eligibleCorporateIds: promo.eligibleCorporateIds || [],
      allowStackOnNegotiatedRate: Boolean(promo.allowStackOnNegotiatedRate),
      eligibleRoomTypes: promo.eligibleRoomTypes || ['all'],
      eligibleBookingSources: promo.eligibleBookingSources || ['all'],
      minStayNights: promo.minStayNights || 0,
      minBookingAmount: promo.minBookingAmount || 0,
      maxUses: promo.maxUses || 0,
      maxDiscountCap: promo.maxDiscountCap || 0,
      appliesTo: promo.appliesTo || 'room_only',
      combinable: Boolean(promo.combinable)
    });
    setIsModalOpen(true);
  };

  // Handle Save
  const handleSavePromotion = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    if (!formData.code.trim()) {
      toast.error('Please enter a promotional code.');
      return;
    }
    if (!formData.name.trim()) {
      toast.error('Please enter a campaign title.');
      return;
    }
    if (formData.value <= 0) {
      toast.error('Discount value must be greater than zero.');
      return;
    }
    if (formData.discountType === 'percentage' && formData.value > 100) {
      toast.error('Percentage discount cannot exceed 100%.');
      return;
    }
    if (formData.startDate > formData.expiryDate) {
      toast.error('Start date cannot be after expiry date.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (editingPromo) {
        await updatePromotion(hotel.id, editingPromo.id, formData, profile);
        toast.success(`Promotional campaign "${formData.code}" updated successfully.`);
      } else {
        await createPromotion(hotel.id, formData, profile);
        toast.success(`Promotional campaign "${formData.code.toUpperCase()}" created successfully!`);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      console.error('Error saving promotion:', err);
      toast.error(err.message || 'Failed to save promotional campaign.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Toggle Status
  const handleToggleStatus = async (promo: Promotion) => {
    if (!hotel?.id || !profile) return;
    try {
      await togglePromotionStatus(hotel.id, promo.id, promo.status, profile);
      toast.success(`Promotion "${promo.code}" is now ${promo.status === 'active' ? 'paused' : 'active'}.`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update promotion status.');
    }
  };

  // Delete Promotion
  const handleDeletePromotion = async (promo: Promotion) => {
    if (!hotel?.id || !profile) return;
    try {
      await deletePromotion(hotel.id, promo.id, profile);
      toast.success(`Promotion "${promo.code}" deleted.`);
      setIsDeletingId(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete promotion.');
    }
  };

  // Copy code to clipboard
  const handleCopyCode = (code: string) => {
    navigator.clipboard.writeText(code);
    toast.success(`Copied code "${code}" to clipboard!`);
  };

  // Export full promotions report to CSV
  const handleExportPromotionsReport = () => {
    if (promotions.length === 0) {
      toast.error('No promotional data available to export.');
      return;
    }

    const rows = promotions.map(p => {
      let targetDesc = 'All Guests';
      if (p.targetGuestType === 'corporate_only') targetDesc = 'Corporate Only';
      else if (p.targetGuestType === 'selected_corporate') targetDesc = 'Selected Corporate';
      else if (p.targetGuestType === 'individual_only') targetDesc = 'Individual Only';

      const eligibleCorps = (p.eligibleCorporateIds && p.eligibleCorporateIds.length > 0)
        ? p.eligibleCorporateIds.map(id => corporateAccounts.find(c => c.id === id)?.name || id).join('; ')
        : (p.targetGuestType === 'corporate_only' ? 'All Corporate Accounts' : 'All / None');

      return {
        'Code': p.code,
        'Campaign Name': p.name,
        'Target Audience': targetDesc,
        'Eligible Corporate Accounts': eligibleCorps,
        'Stack With Negotiated Rates': p.allowStackOnNegotiatedRate ? 'Yes' : 'No',
        'Promotion Type': p.type,
        'Discount Type': p.discountType,
        'Discount Value': p.discountType === 'percentage' ? `${p.value}%` : `${p.currency || 'NGN'} ${p.value}`,
        'Applies To': p.appliesTo,
        'Start Date': p.startDate,
        'Expiry Date': p.expiryDate,
        'Status': p.status,
        'Max Uses Allowed': p.maxUses || 'Unlimited',
        'Total Redemptions': p.usedCount || 0,
        'Min Stay (Nights)': p.minStayNights || 'None',
        'Min Booking Amount': p.minBookingAmount || 'None',
        'Max Cap': p.maxDiscountCap || 'None',
        'Combinable': p.combinable ? 'Yes' : 'No',
        'Created At': p.createdAt,
        'Created By': p.createdByName || p.createdBy
      };
    });

    exportToCSV(rows, `promotions_report_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Promotions audit report downloaded.');
  };

  // If user lacks permission, show role guard screen
  if (!isAuthorized) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-3xl p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto text-amber-500">
            <ShieldAlert size={32} />
          </div>
          <h2 className="text-xl font-bold text-zinc-100">Hotel Admin Permission Required</h2>
          <p className="text-sm text-zinc-400 max-w-lg mx-auto">
            Discounts and Promotional Code configuration is restricted exclusively to Hotel Administrators. Front Desk and Staff members can apply eligible codes directly from the booking and folio workflows.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-zinc-800">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
              <Tag size={22} />
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 tracking-tight flex items-center gap-2">
                Discounts & Promotions
                <span className="text-xs font-mono font-medium px-2 py-0.5 bg-zinc-800 text-zinc-400 rounded-full border border-zinc-700">
                  {promotions.length} Campaigns
                </span>
              </h1>
              <p className="text-xs text-zinc-400 mt-0.5">
                Create promotional discount campaigns, set corporate eligibility rules, and audit code redemptions
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-start sm:self-auto">
          <button
            onClick={handleExportPromotionsReport}
            className="flex items-center gap-2 px-3.5 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl border border-zinc-800 transition-colors shadow-sm"
            title="Download CSV audit report"
          >
            <Download size={15} />
            Export Audit CSV
          </button>
          <button
            onClick={handleOpenCreateModal}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold rounded-xl transition-all shadow-lg shadow-emerald-500/20 active:scale-95"
          >
            <Plus size={16} />
            Create Promotion
          </button>
        </div>
      </div>

      {/* Metrics Banner */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <span>Active Campaigns</span>
            <CheckCircle2 size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-zinc-50 font-mono mt-1">
            {metrics.activeCount}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Ready for reservation booking
          </div>
        </div>

        <div className="p-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <span>Total Redemptions</span>
            <TrendingUp size={16} className="text-blue-400" />
          </div>
          <div className="text-2xl font-bold text-zinc-50 font-mono mt-1">
            {metrics.totalRedemptions}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Applied guest bookings
          </div>
        </div>

        <div className="p-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <span>Discounts Granted</span>
            <Tag size={16} className="text-amber-400" />
          </div>
          <div className="text-2xl font-bold text-amber-400 font-mono mt-1">
            {formatCurrency(metrics.totalDiscountGranted, currency, exchangeRate)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Total marketing concession
          </div>
        </div>

        <div className="p-4 bg-zinc-900/60 border border-zinc-800/80 rounded-2xl relative overflow-hidden">
          <div className="flex items-center justify-between text-zinc-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <span>Attributed Revenue</span>
            <DollarSign size={16} className="text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-emerald-400 font-mono mt-1">
            {formatCurrency(metrics.totalAttributedRevenue, currency, exchangeRate)}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            Net booking income generated
          </div>
        </div>
      </div>

      {/* Corporate Financial Impact & Partner Summary */}
      <div className="p-4 sm:p-5 bg-gradient-to-r from-cyan-950/20 via-zinc-900/40 to-indigo-950/20 border border-cyan-800/30 rounded-2xl space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="p-1.5 bg-cyan-500/10 rounded-lg text-cyan-400 border border-cyan-500/20">
              <Building2 size={16} />
            </div>
            <div>
              <h2 className="text-xs font-bold text-zinc-200 uppercase tracking-wider">
                Corporate Discounts Financial Impact
              </h2>
              <p className="text-[11px] text-zinc-400">
                Audited concession and net booking performance across linked corporate accounts
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 text-xs font-mono">
            <span className="text-zinc-400">
              Corporate Redemptions: <strong className="text-cyan-400">{metrics.totalCorporateRedemptions}</strong>
            </span>
            <span className="text-zinc-700">•</span>
            <span className="text-zinc-400">
              Corporate Discounts: <strong className="text-amber-400">{formatCurrency(metrics.totalCorporateDiscountGranted, currency, exchangeRate)}</strong>
            </span>
            <span className="text-zinc-700">•</span>
            <span className="text-zinc-400">
              Corporate Revenue: <strong className="text-emerald-400">{formatCurrency(metrics.totalCorporateAttributedRevenue, currency, exchangeRate)}</strong>
            </span>
          </div>
        </div>

        {metrics.corporateBreakdown.length > 0 && (
          <div className="pt-2 border-t border-zinc-800/60 overflow-x-auto">
            <div className="flex gap-2 min-w-max pb-1">
              {metrics.corporateBreakdown.map((corp, i) => (
                <div key={i} className="px-3 py-2 bg-zinc-950/70 border border-zinc-800 rounded-xl text-xs space-y-0.5">
                  <div className="font-semibold text-cyan-300 flex items-center gap-1">
                    <Building2 size={12} />
                    <span>{corp.name}</span>
                  </div>
                  <div className="text-[10px] text-zinc-400 flex items-center gap-2">
                    <span>{corp.redemptions} use{corp.redemptions > 1 ? 's' : ''}</span>
                    <span>•</span>
                    <span className="text-amber-400">-{formatCurrency(corp.discount, currency, exchangeRate)}</span>
                    <span>•</span>
                    <span className="text-emerald-400">{formatCurrency(corp.revenue, currency, exchangeRate)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-zinc-950 p-2 rounded-2xl border border-zinc-800/80">
        <div className="flex items-center gap-1 overflow-x-auto pb-1 sm:pb-0">
          {(['all', 'active', 'corporate', 'scheduled', 'paused', 'expired', 'exhausted'] as TabFilter[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={cn(
                "px-3.5 py-1.5 rounded-xl text-xs font-semibold capitalize whitespace-nowrap transition-all",
                activeTab === tab 
                  ? "bg-zinc-800 text-zinc-100 shadow-sm border border-zinc-700" 
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-900"
              )}
            >
              {tab === 'corporate' ? 'Corporate Only' : tab}
            </button>
          ))}
        </div>

        <div className="relative min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search code or name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Promotions List / Grid */}
      {loading ? (
        <div className="p-12 text-center text-zinc-500 text-sm">
          Loading promotional campaigns...
        </div>
      ) : filteredPromotions.length === 0 ? (
        <div className="bg-zinc-900/30 border border-dashed border-zinc-800 rounded-3xl p-12 text-center space-y-3">
          <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center mx-auto text-zinc-500">
            <Tag size={24} />
          </div>
          <h3 className="text-sm font-bold text-zinc-200">No Promotions Found</h3>
          <p className="text-xs text-zinc-500 max-w-sm mx-auto">
            {searchQuery 
              ? `No discount codes matched "${searchQuery}".` 
              : `No campaigns in "${activeTab}" status. Click "Create Promotion" to get started.`}
          </p>
          {searchQuery && (
            <button 
              onClick={() => setSearchQuery('')}
              className="text-xs text-emerald-400 hover:underline"
            >
              Clear search filter
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredPromotions.map((promo) => {
            const todayStr = format(new Date(), 'yyyy-MM-dd');
            const isExhausted = promo.maxUses && promo.maxUses > 0 && promo.usedCount >= promo.maxUses;
            const isExpired = promo.status === 'expired' || todayStr > promo.expiryDate;
            const isScheduled = todayStr < promo.startDate;
            const isPaused = promo.status === 'paused';

            // Effective status tag
            let statusBadge = (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <CheckCircle2 size={10} /> Active
              </span>
            );
            if (isPaused) {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  <Pause size={10} /> Paused
                </span>
              );
            } else if (isExhausted) {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-500/10 text-purple-400 border border-purple-500/20">
                  <Clock size={10} /> Exhausted
                </span>
              );
            } else if (isExpired) {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/10 text-red-400 border border-red-500/20">
                  <AlertCircle size={10} /> Expired
                </span>
              );
            } else if (isScheduled) {
              statusBadge = (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  <Calendar size={10} /> Scheduled
                </span>
              );
            }

            return (
              <div 
                key={promo.id}
                className="bg-zinc-900/60 border border-zinc-800/90 hover:border-zinc-700/80 rounded-2xl p-4 flex flex-col justify-between transition-all group"
              >
                <div className="space-y-3">
                  {/* Card Header: Code & Status */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => handleCopyCode(promo.code)}
                        className="flex items-center gap-1.5 px-2.5 py-1 bg-zinc-950 hover:bg-zinc-800 text-emerald-400 border border-zinc-800 rounded-lg font-mono font-bold text-xs tracking-wider transition-all"
                        title="Click to copy code"
                      >
                        <Tag size={12} />
                        {promo.code}
                        <Copy size={11} className="opacity-60 group-hover:opacity-100" />
                      </button>
                    </div>
                    {statusBadge}
                  </div>

                  {/* Campaign Name & Description */}
                  <div>
                    <h3 className="text-sm font-bold text-zinc-100 leading-snug">
                      {promo.name}
                    </h3>
                    {promo.description && (
                      <p className="text-xs text-zinc-400 line-clamp-2 mt-1">
                        {promo.description}
                      </p>
                    )}
                  </div>

                  {/* Discount Value Pill */}
                  <div className="p-3 bg-zinc-950/80 rounded-xl border border-zinc-800/80 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center font-bold text-xs">
                        {promo.discountType === 'percentage' ? '%' : (promo.currency === 'USD' ? '$' : '₦')}
                      </div>
                      <div>
                        <div className="text-sm font-black text-zinc-100 font-mono">
                          {promo.discountType === 'percentage' 
                            ? `${promo.value}% OFF` 
                            : formatCurrency(promo.value, promo.currency || 'NGN', exchangeRate)}
                        </div>
                        <div className="text-[10px] text-zinc-400 capitalize">
                          {promo.appliesTo === 'room_only' ? 'Room charges only' : 'All eligible charges'}
                        </div>
                      </div>
                    </div>

                    {promo.maxDiscountCap ? (
                      <span className="text-[10px] text-zinc-400 font-mono">
                        Cap: {formatCurrency(promo.maxDiscountCap, promo.currency || 'NGN', exchangeRate)}
                      </span>
                    ) : null}
                  </div>

                  {/* Rules & Scope summary badges */}
                  <div className="flex flex-wrap gap-1.5 text-[10px]">
                    <span className="px-2 py-0.5 bg-zinc-800/70 text-zinc-400 rounded-md">
                      {promo.type.replace('_', ' ').toUpperCase()}
                    </span>
                    {promo.targetGuestType === 'corporate_only' && (
                      <span className="px-2 py-0.5 bg-cyan-950/70 text-cyan-400 border border-cyan-800/40 rounded-md flex items-center gap-1 font-semibold">
                        <Building2 size={10} /> Corporate Only
                      </span>
                    )}
                    {promo.targetGuestType === 'selected_corporate' && (
                      <span className="px-2 py-0.5 bg-indigo-950/70 text-indigo-300 border border-indigo-800/40 rounded-md flex items-center gap-1 font-semibold">
                        <Building2 size={10} /> Selected Corporate ({promo.eligibleCorporateIds?.length || 0})
                      </span>
                    )}
                    {promo.targetGuestType === 'individual_only' && (
                      <span className="px-2 py-0.5 bg-zinc-800/70 text-zinc-300 rounded-md">
                        Individual Only
                      </span>
                    )}
                    {promo.allowStackOnNegotiatedRate && (
                      <span className="px-2 py-0.5 bg-cyan-950/60 text-cyan-400 border border-cyan-800/40 rounded-md">
                        Stacks w/ Negotiated Rate
                      </span>
                    )}
                    {promo.minStayNights && promo.minStayNights > 0 ? (
                      <span className="px-2 py-0.5 bg-zinc-800/70 text-zinc-300 rounded-md">
                        Min {promo.minStayNights} Nights
                      </span>
                    ) : null}
                    {promo.minBookingAmount && promo.minBookingAmount > 0 ? (
                      <span className="px-2 py-0.5 bg-zinc-800/70 text-zinc-300 rounded-md">
                        Min {formatCurrency(promo.minBookingAmount, promo.currency || 'NGN', exchangeRate)}
                      </span>
                    ) : null}
                    {promo.combinable ? (
                      <span className="px-2 py-0.5 bg-emerald-950/60 text-emerald-400 border border-emerald-900/40 rounded-md">
                        Combinable
                      </span>
                    ) : null}
                  </div>

                  {/* Redemptions Progress */}
                  <div className="space-y-1 pt-1">
                    <div className="flex justify-between text-[11px] text-zinc-400">
                      <span>Redemptions:</span>
                      <span className="font-mono font-semibold text-zinc-200">
                        {promo.usedCount || 0} {promo.maxUses && promo.maxUses > 0 ? `/ ${promo.maxUses}` : 'used (Unlimited)'}
                      </span>
                    </div>
                    {promo.maxUses && promo.maxUses > 0 && (
                      <div className="w-full bg-zinc-950 rounded-full h-1.5 overflow-hidden border border-zinc-800">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all",
                            (promo.usedCount || 0) >= promo.maxUses ? "bg-purple-500" : "bg-emerald-500"
                          )}
                          style={{ width: `${Math.min(100, ((promo.usedCount || 0) / promo.maxUses) * 100)}%` }}
                        />
                      </div>
                    )}
                  </div>

                  {/* Dates */}
                  <div className="text-[11px] text-zinc-400 flex items-center justify-between border-t border-zinc-800/80 pt-2">
                    <span className="flex items-center gap-1">
                      <Calendar size={12} className="text-zinc-400" />
                      {promo.startDate}
                    </span>
                    <span>→</span>
                    <span>{promo.expiryDate}</span>
                  </div>
                </div>

                {/* Card Actions Footer */}
                <div className="flex items-center justify-between gap-1.5 pt-4 mt-3 border-t border-zinc-800/80">
                  <button
                    onClick={() => setSelectedPromoForHistory(promo)}
                    className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80 rounded-lg transition-colors"
                    title="View booking redemptions history"
                  >
                    <ExternalLink size={13} />
                    History ({promo.usedCount || 0})
                  </button>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => handleToggleStatus(promo)}
                      className={cn(
                        "p-1.5 rounded-lg text-xs transition-colors",
                        promo.status === 'active' 
                          ? "text-amber-400 hover:bg-amber-500/10" 
                          : "text-emerald-400 hover:bg-emerald-500/10"
                      )}
                      title={promo.status === 'active' ? "Pause campaign" : "Activate campaign"}
                    >
                      {promo.status === 'active' ? <Pause size={15} /> : <Play size={15} />}
                    </button>
                    <button
                      onClick={() => handleOpenEditModal(promo)}
                      className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/80 rounded-lg transition-colors"
                      title="Edit promotion configuration"
                    >
                      <Edit3 size={15} />
                    </button>
                    {isDeletingId === promo.id ? (
                      <div className="flex items-center gap-1 bg-red-950/80 border border-red-800 rounded-lg p-1">
                        <button
                          onClick={() => handleDeletePromotion(promo)}
                          className="text-[10px] text-red-200 font-bold px-1.5 py-0.5 hover:bg-red-900 rounded"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setIsDeletingId(null)}
                          className="text-[10px] text-zinc-400 hover:text-zinc-200 px-1"
                        >
                          ✕
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setIsDeletingId(promo.id)}
                        className="p-1.5 text-zinc-400 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
                        title="Delete promotion"
                      >
                        <Trash2 size={15} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* CREATE & EDIT PROMOTION MODAL */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => !isSubmitting && setIsModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-2xl bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl z-10 max-h-[90vh] flex flex-col"
            >
              {/* Modal Header */}
              <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
                    <Tag size={18} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-zinc-50">
                      {editingPromo ? 'Edit Promotional Campaign' : 'Create New Promotional Campaign'}
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Configure parameters, eligibility restrictions, and validation limits
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  disabled={isSubmitting}
                  className="p-1 text-zinc-400 hover:text-zinc-200 rounded-lg"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Form Body */}
              <form onSubmit={handleSavePromotion} className="p-5 overflow-y-auto space-y-5 flex-1">
                {/* 1. Basic Info */}
                <div className="space-y-3">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles size={13} className="text-emerald-400" />
                    1. Campaign Identification
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Promotional Code *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. SUMMER25, VIPGUEST"
                        value={formData.code}
                        onChange={(e) => setFormData({ 
                          ...formData, 
                          code: e.target.value.toUpperCase().replace(/[^A-Z0-9_\-]/g, '') 
                        })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-emerald-400 font-mono font-bold focus:border-emerald-500 outline-none uppercase"
                      />
                      <p className="text-[10px] text-zinc-400 mt-1">Unique uppercase code guests & staff use.</p>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Campaign Title *
                      </label>
                      <input
                        type="text"
                        required
                        placeholder="e.g. Summer Beach Escape 2025"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                      Campaign Description (Optional)
                    </label>
                    <textarea
                      placeholder="Details about this promotion, marketing channel, or target audience..."
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none resize-none h-16"
                    />
                  </div>
                </div>

                {/* 2. Promotion Type & Discount Value */}
                <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Percent size={13} className="text-blue-400" />
                    2. Discount Specification
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Campaign Type
                      </label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value as PromotionType })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      >
                        <option value="percentage">Percentage Discount</option>
                        <option value="fixed">Fixed Cash Amount</option>
                        <option value="seasonal">Seasonal Promotion</option>
                        <option value="special_offer">Special Offer</option>
                        <option value="minimum_stay">Minimum Stay Promotion</option>
                        <option value="date_specific">Date-Specific Campaign</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Discount Unit
                      </label>
                      <select
                        value={formData.discountType}
                        onChange={(e) => setFormData({ ...formData, discountType: e.target.value as 'percentage' | 'fixed' })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      >
                        <option value="percentage">Percentage (%)</option>
                        <option value="fixed">Fixed Amount ({formData.currency})</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Discount Value *
                      </label>
                      <input
                        type="number"
                        min="0.01"
                        step="any"
                        required
                        value={formData.value || ''}
                        onChange={(e) => setFormData({ ...formData, value: parseFloat(e.target.value) || 0 })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-100 font-mono focus:border-emerald-500 outline-none"
                        placeholder={formData.discountType === 'percentage' ? '15 (for 15%)' : '5000'}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Applicable Charges Scope
                      </label>
                      <select
                        value={formData.appliesTo}
                        onChange={(e) => setFormData({ ...formData, appliesTo: e.target.value as 'room_only' | 'all_charges' })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      >
                        <option value="room_only">Room Charges Only (Excludes incidental add-ons)</option>
                        <option value="all_charges">All Charges (Total booking subtotal)</option>
                      </select>
                    </div>

                    {formData.discountType === 'percentage' && (
                      <div>
                        <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                          Max Discount Cap (Optional)
                        </label>
                        <input
                          type="number"
                          min="0"
                          value={formData.maxDiscountCap || ''}
                          onChange={(e) => setFormData({ ...formData, maxDiscountCap: parseFloat(e.target.value) || 0 })}
                          placeholder="e.g. 20000 (0 = no cap)"
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:border-emerald-500 outline-none"
                        />
                      </div>
                    )}
                  </div>
                </div>

                {/* 3. Validity Period */}
                <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Calendar size={13} className="text-amber-400" />
                    3. Validity Period & Status
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Start Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.startDate}
                        onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Expiry Date *
                      </label>
                      <input
                        type="date"
                        required
                        value={formData.expiryDate}
                        onChange={(e) => setFormData({ ...formData, expiryDate: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Initial Status
                      </label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as PromotionStatus })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 focus:border-emerald-500 outline-none"
                      >
                        <option value="active">Active (Ready to use)</option>
                        <option value="paused">Paused</option>
                      </select>
                    </div>
                  </div>
                </div>

                {/* 4. Eligibility & Restrictions */}
                <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Filter size={13} className="text-purple-400" />
                    4. Eligibility Rules & Usage Constraints
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Min Stay (Nights)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.minStayNights || ''}
                        onChange={(e) => setFormData({ ...formData, minStayNights: parseInt(e.target.value) || 0 })}
                        placeholder="0 = No minimum"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:border-emerald-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Min Booking Amount
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.minBookingAmount || ''}
                        onChange={(e) => setFormData({ ...formData, minBookingAmount: parseFloat(e.target.value) || 0 })}
                        placeholder="0 = No minimum"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:border-emerald-500 outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                        Max Usage Limit (Cap)
                      </label>
                      <input
                        type="number"
                        min="0"
                        value={formData.maxUses || ''}
                        onChange={(e) => setFormData({ ...formData, maxUses: parseInt(e.target.value) || 0 })}
                        placeholder="0 = Unlimited"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-100 font-mono focus:border-emerald-500 outline-none"
                      />
                    </div>
                  </div>

                  {/* Room Types selection */}
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                      Eligible Room Types
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-900 rounded-xl border border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, eligibleRoomTypes: ['all'] })}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                          formData.eligibleRoomTypes.includes('all') 
                            ? "bg-emerald-500 text-black font-bold" 
                            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        )}
                      >
                        All Room Types
                      </button>
                      {roomTypes.map(rt => {
                        const isSelected = formData.eligibleRoomTypes.includes(rt.name) || formData.eligibleRoomTypes.includes(rt.id);
                        return (
                          <button
                            key={rt.id}
                            type="button"
                            onClick={() => {
                              let next = formData.eligibleRoomTypes.filter(x => x !== 'all');
                              if (isSelected) {
                                next = next.filter(x => x !== rt.name && x !== rt.id);
                                if (next.length === 0) next = ['all'];
                              } else {
                                next.push(rt.name);
                              }
                              setFormData({ ...formData, eligibleRoomTypes: next });
                            }}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                              !formData.eligibleRoomTypes.includes('all') && isSelected
                                ? "bg-emerald-500 text-black font-bold" 
                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                            )}
                          >
                            {rt.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Booking Sources selection */}
                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1">
                      Eligible Booking Channels / Sources
                    </label>
                    <div className="flex flex-wrap gap-1.5 p-2 bg-zinc-900 rounded-xl border border-zinc-800">
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, eligibleBookingSources: ['all'] })}
                        className={cn(
                          "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                          formData.eligibleBookingSources.includes('all') 
                            ? "bg-emerald-500 text-black font-bold" 
                            : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                        )}
                      >
                        All Channels
                      </button>
                      {availableBookingSources.map(source => {
                        const isSelected = formData.eligibleBookingSources.includes(source);
                        return (
                          <button
                            key={source}
                            type="button"
                            onClick={() => {
                              let next = formData.eligibleBookingSources.filter(x => x !== 'all');
                              if (isSelected) {
                                next = next.filter(x => x !== source);
                                if (next.length === 0) next = ['all'];
                              } else {
                                next.push(source);
                              }
                              setFormData({ ...formData, eligibleBookingSources: next });
                            }}
                            className={cn(
                              "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all",
                              !formData.eligibleBookingSources.includes('all') && isSelected
                                ? "bg-emerald-500 text-black font-bold" 
                                : "bg-zinc-800 text-zinc-400 hover:text-zinc-200"
                            )}
                          >
                            {source}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Combinable Toggle */}
                  <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                    <div>
                      <div className="text-xs font-bold text-zinc-100">Combinable with other discounts</div>
                      <div className="text-[10px] text-zinc-400">Allow this code to be stacked alongside other promos or ad-hoc adjustments</div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer">
                      <input 
                        type="checkbox"
                        checked={formData.combinable}
                        onChange={(e) => setFormData({ ...formData, combinable: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                    </label>
                  </div>
                </div>

                {/* 5. Target Audience & Corporate Eligibility */}
                <div className="space-y-3 pt-3 border-t border-zinc-800/80">
                  <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Building2 size={13} className="text-cyan-400" />
                    5. Target Audience & Corporate Eligibility
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-zinc-300 uppercase mb-1.5">
                      Audience Scope *
                    </label>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      {[
                        { id: 'all', label: 'All Guests', desc: 'Individual & Corporate' },
                        { id: 'corporate_only', label: 'Corporate Only', desc: 'All corporate accounts' },
                        { id: 'selected_corporate', label: 'Selected Companies', desc: 'Specific partner companies' },
                        { id: 'individual_only', label: 'Individual Only', desc: 'Excludes corporate' }
                      ].map(tgt => {
                        const isSelected = formData.targetGuestType === tgt.id;
                        return (
                          <button
                            key={tgt.id}
                            type="button"
                            onClick={() => setFormData({ ...formData, targetGuestType: tgt.id as PromotionTargetGuestType })}
                            className={cn(
                              "p-2.5 rounded-xl border text-left transition-all",
                              isSelected 
                                ? "bg-cyan-950/50 border-cyan-500 text-cyan-200 shadow-sm" 
                                : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                            )}
                          >
                            <div className="text-xs font-bold">{tgt.label}</div>
                            <div className="text-[10px] opacity-70 mt-0.5">{tgt.desc}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {formData.targetGuestType === 'selected_corporate' && (
                    <div className="space-y-2 p-3 bg-zinc-900/80 rounded-xl border border-zinc-800">
                      <div className="flex items-center justify-between">
                        <label className="text-[11px] font-semibold text-zinc-300 uppercase">
                          Eligible Corporate Accounts ({formData.eligibleCorporateIds.length} selected)
                        </label>
                        {formData.eligibleCorporateIds.length > 0 && (
                          <button
                            type="button"
                            onClick={() => setFormData({ ...formData, eligibleCorporateIds: [] })}
                            className="text-[10px] text-zinc-400 hover:text-zinc-200"
                          >
                            Clear all
                          </button>
                        )}
                      </div>

                      {corporateAccounts.length === 0 ? (
                        <p className="text-xs text-zinc-500 py-2">No corporate accounts registered in this hotel yet.</p>
                      ) : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                          {corporateAccounts.map(corp => {
                            const isChecked = formData.eligibleCorporateIds.includes(corp.id);
                            const isSuspended = corp.status === 'suspended';
                            return (
                              <button
                                key={corp.id}
                                type="button"
                                onClick={() => {
                                  let next = [...formData.eligibleCorporateIds];
                                  if (isChecked) {
                                    next = next.filter(id => id !== corp.id);
                                  } else {
                                    next.push(corp.id);
                                  }
                                  setFormData({ ...formData, eligibleCorporateIds: next });
                                }}
                                className={cn(
                                  "flex items-center justify-between p-2 rounded-lg border text-xs text-left transition-all",
                                  isChecked 
                                    ? "bg-cyan-950/50 border-cyan-600 text-cyan-200 font-semibold" 
                                    : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                                )}
                              >
                                <div className="truncate pr-2">
                                  <div className="truncate">{corp.name}</div>
                                  <div className="text-[10px] text-zinc-500 font-mono">
                                    {corp.contactPerson ? `Contact: ${corp.contactPerson}` : `ID: ${corp.id.slice(-6).toUpperCase()}`}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  {isSuspended && (
                                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-950/80 text-red-400 border border-red-900/50">
                                      Suspended
                                    </span>
                                  )}
                                  <div className={cn(
                                    "w-4 h-4 rounded flex items-center justify-center border",
                                    isChecked ? "bg-cyan-500 border-cyan-400 text-black" : "border-zinc-700 bg-zinc-900"
                                  )}>
                                    {isChecked && <Check size={11} strokeWidth={3} />}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Stacking with Negotiated Rates */}
                  <div className="flex items-center justify-between p-3 bg-zinc-900 rounded-xl border border-zinc-800">
                    <div className="pr-4">
                      <div className="text-xs font-bold text-zinc-100 flex items-center gap-1.5">
                        <span>Allow Stacking with Negotiated Corporate Rates</span>
                      </div>
                      <div className="text-[10px] text-zinc-400 mt-0.5">
                        When enabled, authorized staff can apply this discount even if the reservation has a negotiated corporate room contract rate. When disabled, the discount will be rejected.
                      </div>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input 
                        type="checkbox"
                        checked={formData.allowStackOnNegotiatedRate}
                        onChange={(e) => setFormData({ ...formData, allowStackOnNegotiatedRate: e.target.checked })}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-cyan-500"></div>
                    </label>
                  </div>
                </div>

                {/* Modal Actions */}
                <div className="pt-3 border-t border-zinc-800 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    disabled={isSubmitting}
                    className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 text-xs font-semibold rounded-xl border border-zinc-800"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2 bg-emerald-500 hover:bg-emerald-600 text-black text-xs font-bold rounded-xl transition-all shadow-md shadow-emerald-500/20 disabled:opacity-50"
                  >
                    {isSubmitting ? 'Saving...' : (editingPromo ? 'Save Changes' : 'Create Promotion')}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* REDEMPTION HISTORY MODAL */}
      <AnimatePresence>
        {selectedPromoForHistory && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setSelectedPromoForHistory(null)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="relative w-full max-w-3xl bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-2xl z-10 max-h-[85vh] flex flex-col"
            >
              {/* Header */}
              <div className="p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/60">
                <div className="flex items-center gap-3">
                  <div className="p-2.5 bg-emerald-500/10 rounded-xl text-emerald-400 border border-emerald-500/20">
                    <Tag size={18} />
                  </div>
                  <div>
                    <h2 className="text-base font-bold text-zinc-50 flex items-center gap-2">
                      Redemptions: {selectedPromoForHistory.code}
                      <span className="text-xs font-normal text-zinc-400">
                        ({selectedPromoForHistory.name})
                      </span>
                    </h2>
                    <p className="text-xs text-zinc-400">
                      Total redemptions logged: {selectedPromoForHistory.usedCount || 0}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {selectedPromoForHistory.redemptions && selectedPromoForHistory.redemptions.length > 0 && (
                    <button
                      onClick={() => {
                        const rows = (selectedPromoForHistory.redemptions || []).map(r => ({
                          'Guest Name': r.guestName,
                          'Account Type': (r.corporateId || r.corporateName) ? 'Corporate' : 'Individual',
                          'Corporate Account': r.corporateName || (r.corporateId ? (corporateAccounts.find(c => c.id === r.corporateId)?.name || r.corporateId) : 'N/A'),
                          'Reservation ID': r.reservationId,
                          'Room Number': r.roomNumber || 'N/A',
                          'Booking Source': r.bookingSource || 'N/A',
                          'Original Charge': r.originalAmount,
                          'Discount Applied': r.discountAmount,
                          'Final Charge': r.finalAmount,
                          'Applied At': r.timestamp,
                          'Applied By': r.appliedByName || r.appliedBy
                        }));
                        exportToCSV(rows, `promo_${selectedPromoForHistory.code}_redemptions.csv`);
                        toast.success('Redemption history exported to CSV.');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 text-xs text-zinc-300 rounded-xl border border-zinc-800"
                    >
                      <Download size={13} />
                      Export
                    </button>
                  )}
                  <button
                    onClick={() => setSelectedPromoForHistory(null)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-200 rounded-lg"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Table Body */}
              <div className="p-5 overflow-y-auto flex-1">
                {(!selectedPromoForHistory.redemptions || selectedPromoForHistory.redemptions.length === 0) ? (
                  <div className="p-12 text-center text-zinc-500 text-xs">
                    No bookings have redeemed this promotion code yet.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead>
                        <tr className="border-b border-zinc-800 text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                          <th className="pb-2.5">Guest & Booking</th>
                          <th className="pb-2.5">Account / Entity</th>
                          <th className="pb-2.5">Room</th>
                          <th className="pb-2.5">Channel</th>
                          <th className="pb-2.5 text-right">Original</th>
                          <th className="pb-2.5 text-right">Discount</th>
                          <th className="pb-2.5 text-right">Final Amount</th>
                          <th className="pb-2.5">Applied Timestamp</th>
                          <th className="pb-2.5">Staff</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-900">
                        {selectedPromoForHistory.redemptions.map((redemption, idx) => (
                          <tr key={idx} className="hover:bg-zinc-900/40">
                            <td className="py-2.5 font-semibold text-zinc-100">
                              {redemption.guestName}
                              <div className="text-[10px] text-zinc-400 font-mono">
                                Ref: {redemption.reservationId.slice(-6).toUpperCase()}
                              </div>
                            </td>
                            <td className="py-2.5">
                              {redemption.corporateName || redemption.corporateId ? (
                                <div className="flex items-center gap-1 text-cyan-400 font-medium">
                                  <Building2 size={11} className="shrink-0" />
                                  <span className="truncate max-w-[130px]">{redemption.corporateName || 'Corporate'}</span>
                                </div>
                              ) : (
                                <span className="text-zinc-500">Individual</span>
                              )}
                            </td>
                            <td className="py-2.5 text-zinc-300">
                              {redemption.roomNumber || '—'}
                            </td>
                            <td className="py-2.5 text-zinc-400">
                              {redemption.bookingSource || 'Direct'}
                            </td>
                            <td className="py-2.5 text-right font-mono text-zinc-400">
                              {formatCurrency(redemption.originalAmount, currency, exchangeRate)}
                            </td>
                            <td className="py-2.5 text-right font-mono text-emerald-400 font-bold">
                              -{formatCurrency(redemption.discountAmount, currency, exchangeRate)}
                            </td>
                            <td className="py-2.5 text-right font-mono text-zinc-100 font-bold">
                              {formatCurrency(redemption.finalAmount, currency, exchangeRate)}
                            </td>
                            <td className="py-2.5 text-zinc-400 text-[11px]">
                              {redemption.timestamp ? format(parseISO(redemption.timestamp), 'MMM dd, yyyy HH:mm') : '—'}
                            </td>
                            <td className="py-2.5 text-zinc-400">
                              {redemption.appliedByName || 'Staff'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
