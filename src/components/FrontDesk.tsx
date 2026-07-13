import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, doc, getDocs, getDoc, where, writeBatch, increment, arrayUnion, addDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, Guest, CorporateAccount, CorporateRate, OperationType, RoomType, RoomBlocking, LedgerEntry } from '../types';
import { postToLedger, settleLedger, transferToCityLedger, processAutomatedBillingForReservation } from '../services/ledgerService';
import { ConfirmModal } from './ConfirmModal';
import { ReceiptGenerator } from './ReceiptGenerator';
import { GuestFolio } from './GuestFolio';
import { DigitalKeyModal } from './DigitalKeyModal';
import { QrCode, Key as SmartKeyIcon } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  Info,
  FileText,
  Zap,
  Plus, 
  Search, 
  Calendar,
  User,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  LogOut,
  RefreshCw,
  Receipt,
  Building2,
  Tag,
  AlertCircle,
  AlertTriangle,
  Trash2,
  UserX,
  Download,
  Edit2,
  DollarSign,
  Loader2,
  PlusCircle,
  Banknote,
  X,
  Filter,
  TrendingUp,
  ArrowDownRight,
  Users,
  Sparkles
} from 'lucide-react';
import { cn, formatCurrency, exportToCSV, safeStringify } from '../utils';
import { database } from '../utils/database';
import { fuzzySearch } from '../utils/searchUtils';
import { roomService } from '../services/roomService';
import { hasPermission } from '../utils/permissions';
import { canCheckout, canCheckIn, canEditReservation, canCancelReservation, canApplyDiscount } from '../utils/policyUtils';
import { logActivity } from '../utils/activityLogger';
import { getRoomDisplayStatus, isRoomAvailable } from '../utils/roomUtils';
import { format, addDays, differenceInDays, parseISO, isBefore, isAfter, startOfDay, startOfWeek, endOfWeek, startOfMonth, endOfMonth, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { useSearchParams } from 'react-router-dom';
import { calculateBilling, getReservationLiveBalance, parseLocalDateTime, BillingService } from '../utils/billingEngine';

export function FrontDesk() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [activeCorporateRates, setActiveCorporateRates] = useState<CorporateRate[]>([]);
  const [roomBlockings, setRoomBlockings] = useState<RoomBlocking[]>([]);
  const [isBooking, setIsBooking] = useState(false);
  const [checkoutPreviewRes, setCheckoutPreviewRes] = useState<Reservation | null>(null);
  const [isAuditing, setIsAuditing] = useState(false);
  const [showNightAuditModal, setShowNightAuditModal] = useState(false);

  // Automatic Nightly Audit Check
  useEffect(() => {
    if (!hotel?.id || !profile || loading) return;
    
    const checkAndRunAudit = async () => {
      const today = format(new Date(), 'yyyy-MM-dd');
      if (hotel.lastAuditDate !== today) {
        // Only run if user has permission
        const canRunAudit = profile.role === 'hotelAdmin' || 
                          (profile.role === 'staff' && (profile.permissions || []).includes('frontDesk'));
        
        if (canRunAudit) {
          console.log("Running automatic nightly audit for", today);
          await runNightlyAudit();
        }
      }
    };

    checkAndRunAudit();
  }, [hotel?.id, hotel?.lastAuditDate, profile?.uid]);

  const [showReceipt, setShowReceipt] = useState<{ res: Reservation; type: 'restaurant' | 'comprehensive' } | null>(null);
  const [showTransferModal, setShowTransferModal] = useState<Reservation | null>(null);
  const [showChargeModal, setShowChargeModal] = useState<Reservation | null>(null);
  const [showFolioModal, setShowFolioModal] = useState<Reservation | null>(null);
  const [showDigitalKeyModal, setShowDigitalKeyModal] = useState<Reservation | null>(null);
  const [showConfirmAction, setShowConfirmAction] = useState<{ res: Reservation; action: 'no_show' | 'cancelled' | 'delete' } | null>(null);
  const [showPostponeModal, setShowPostponeModal] = useState<Reservation | null>(null);
  const [showDiscountModal, setShowDiscountModal] = useState<Reservation | null>(null);
  const [discountData, setDiscountData] = useState({ 
    amount: 0, 
    type: 'fixed' as 'fixed' | 'percentage',
    reason: '' 
  });
  const [newCheckOutDate, setNewCheckOutDate] = useState('');
  const [chargeDetails, setChargeDetails] = useState({
    amount: 0,
    category: 'restaurant' as const,
    description: '',
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage'
  });
  const [newBooking, setNewBooking] = useState({
    guestType: 'individual' as 'individual' | 'corporate',
    guestId: '',
    corporateId: '',
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    idType: '',
    idNumber: '',
    address: '',
    roomId: '',
    checkIn: format(new Date(), 'yyyy-MM-dd'),
    checkInTime: hotel?.defaultCheckInTime || '14:00',
    checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
    checkOutTime: hotel?.defaultCheckOutTime || '12:00',
    totalAmount: 0,
    paidAmount: 0,
    paymentStatus: 'unpaid' as const,
    notes: '',
    corporateReference: '',
    discountAmount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage',
    discountReason: '',
    taxAmount: 0,
    taxDetails: [] as { name: string; percentage: number; amount: number; isInclusive: boolean }[],
    initialPayment: 0,
    paymentMethod: 'cash' as 'cash' | 'card' | 'transfer',
    payments: [{ amount: 0, method: 'cash' as 'cash' | 'card' | 'transfer' }],
    autoNightDeduction: true, // Mandatory toggle for automatic nightly charges
    additionalStays: [] as any[]
  });

  const [loading, setLoading] = useState(false);
  const [isFetching, setIsFetching] = useState(true);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<Reservation['status'] | 'all'>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<string>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('all');
  const [dateRange, setDateRange] = useState({ start: '', end: '' });
  const [staffFilter, setStaffFilter] = useState('all');
  const [staffMembers, setStaffMembers] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'all' | 'arrivals' | 'departures' | 'checked_in' | 'overstay' | 'checkin_history' | 'checkout_history'>('all');
  const [checkInHistory, setCheckInHistory] = useState<any[]>([]);
  const [checkOutHistory, setCheckOutHistory] = useState<any[]>([]);
  const [historyPeriod, setHistoryPeriod] = useState<'all' | 'daily' | 'weekly' | 'monthly' | 'custom'>('all');
  const [sortBy, setSortBy] = useState<'checkIn' | 'guestName' | 'roomNumber' | 'status'>('checkIn');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [selectedReservations, setSelectedReservations] = useState<string[]>([]);
  const [editingReservation, setEditingReservation] = useState<Reservation | null>(null);
  const [editForm, setEditForm] = useState({
    checkIn: '',
    checkOut: '',
    totalAmount: 0,
    notes: ''
  });
  const [isNegotiatedRate, setIsNegotiatedRate] = useState(false);
  const [selectedRateType, setSelectedRateType] = useState<'auto' | 'base' | 'weekend' | 'weekday' | 'custom'>('auto');
  const [customRateAmount, setCustomRateAmount] = useState<number>(0);
  const [rateConfigs, setRateConfigs] = useState<any[]>([]);

  // Dynamic automatic overstay charges based on current time & settings
  useEffect(() => {
    if (!hotel?.id || !profile || isFetching || reservations.length === 0) return;
    
    const timer = setTimeout(() => {
      checkAndChargeActiveOverstays();
    }, 1500);

    return () => clearTimeout(timer);
  }, [hotel?.id, profile?.uid, reservations.length, isFetching]);

  // Keep modals in sync with real-time reservation updates
  useEffect(() => {
    if (showFolioModal) {
      const updated = reservations.find(r => r.id === showFolioModal.id);
      // Compare by relevant fields instead of JSON.stringify to avoid circular structure errors
      if (updated && (updated.updatedAt !== showFolioModal.updatedAt || updated.status !== showFolioModal.status || updated.ledgerBalance !== showFolioModal.ledgerBalance)) {
        setShowFolioModal(updated);
      }
    }
    if (showChargeModal) {
      const updated = reservations.find(r => r.id === showChargeModal.id);
      if (updated && (updated.updatedAt !== showChargeModal.updatedAt || updated.status !== showChargeModal.status)) {
        setShowChargeModal(updated);
      }
    }
    if (showTransferModal) {
      const updated = reservations.find(r => r.id === showTransferModal.id);
      if (updated && (updated.updatedAt !== showTransferModal.updatedAt || updated.status !== showTransferModal.status)) {
        setShowTransferModal(updated);
      }
    }
    if (showPostponeModal) {
      const updated = reservations.find(r => r.id === showPostponeModal.id);
      if (updated && (updated.updatedAt !== showPostponeModal.updatedAt || updated.status !== showPostponeModal.status)) {
        setShowPostponeModal(updated);
      }
    }
    if (showDiscountModal) {
      const updated = reservations.find(r => r.id === showDiscountModal.id);
      if (updated && (updated.updatedAt !== showDiscountModal.updatedAt || updated.status !== showDiscountModal.status)) {
        setShowDiscountModal(updated);
      }
    }
    if (showDigitalKeyModal) {
      const updated = reservations.find(r => r.id === showDigitalKeyModal.id);
      if (updated && (updated.updatedAt !== showDigitalKeyModal.updatedAt || updated.status !== showDigitalKeyModal.status)) {
        setShowDigitalKeyModal(updated);
      }
    }
  }, [reservations, showFolioModal, showChargeModal, showTransferModal, showPostponeModal, showDiscountModal, showDigitalKeyModal]);

  useEffect(() => {
    const action = searchParams.get('action');
    const corporateId = searchParams.get('corporateId');

    if (action === 'book' && corporateId) {
      setNewBooking(prev => ({
        ...prev,
        guestType: 'corporate',
        corporateId: corporateId
      }));
      setIsBooking(true);
      // Clear params after handling
      setSearchParams({});
    }
  }, [searchParams, setSearchParams]);

  const filteredReservations = React.useMemo(() => {
    let baseList: any[] = [];
    if (activeTab === 'checkin_history') {
      baseList = checkInHistory;
    } else if (activeTab === 'checkout_history') {
      baseList = checkOutHistory;
    } else {
      baseList = reservations;
    }

    return baseList.filter(res => {
      const matchesSearch = fuzzySearch(res.guestName || '', searchTerm) ||
        fuzzySearch(res.roomNumber || '', searchTerm) ||
        fuzzySearch(res.id || '', searchTerm);
      
      if (!matchesSearch) return false;

      // History Tab Date Filter Requirements
      if (activeTab === 'checkin_history' || activeTab === 'checkout_history') {
        const compareDateStr = activeTab === 'checkin_history' ? res.checkIn : res.checkOut;
        if (compareDateStr) {
          const itemDate = new Date(compareDateStr);
          const today = new Date();
          const todayStr = format(today, 'yyyy-MM-dd');

          if (historyPeriod === 'daily') {
            if (compareDateStr !== todayStr) return false;
          } else if (historyPeriod === 'weekly') {
            const startOfThisWeek = startOfWeek(today, { weekStartsOn: 1 });
            const endOfThisWeek = endOfWeek(today, { weekStartsOn: 1 });
            if (itemDate < startOfThisWeek || itemDate > endOfThisWeek) return false;
          } else if (historyPeriod === 'monthly') {
            const startOfThisMonth = startOfMonth(today);
            const endOfThisMonth = endOfMonth(today);
            if (itemDate < startOfThisMonth || itemDate > endOfThisMonth) return false;
          }
        }

        // Custom range filters if present
        if (dateRange.start) {
          const compareDateStr = activeTab === 'checkin_history' ? res.checkIn : res.checkOut;
          if (compareDateStr && new Date(compareDateStr) < new Date(dateRange.start)) return false;
        }
        if (dateRange.end) {
          const compareDateStr = activeTab === 'checkin_history' ? res.checkIn : res.checkOut;
          if (compareDateStr && new Date(compareDateStr) > new Date(dateRange.end)) return false;
        }

        return true;
      }

      // Normal Active Tab Filter logic
      const matchesStatus = statusFilter === 'all' || res.status === statusFilter;
      if (!matchesStatus) return false;

      const matchesPaymentStatus = paymentStatusFilter === 'all' || res.paymentStatus === paymentStatusFilter;
      if (!matchesPaymentStatus) return false;

      const matchesRoomType = roomTypeFilter === 'all' || rooms.find(r => r.id === res.roomId)?.type === roomTypeFilter;
      if (!matchesRoomType) return false;

      const matchesStaff = staffFilter === 'all' || res.bookedBy === staffFilter;
      if (!matchesStaff) return false;

      if (dateRange.start) {
        if (new Date(res.checkIn) < new Date(dateRange.start)) return false;
      }
      if (dateRange.end) {
        if (new Date(res.checkIn) > new Date(dateRange.end)) return false;
      }

      const today = new Date().toISOString().split('T')[0];
      if (activeTab === 'arrivals') {
        return res.checkIn === today && res.status === 'pending';
      }
      if (activeTab === 'departures') {
        return res.checkOut === today && res.status === 'checked_in';
      }
      if (activeTab === 'checked_in') {
        return res.status === 'checked_in';
      }
      if (activeTab === 'overstay') {
        const overstayTime = hotel?.overstayChargeTime || hotel?.defaultCheckOutTime || '12:00';
        const checkOutDateTime = parseLocalDateTime(res.checkOut, overstayTime);
        const now = new Date();
        return res.status === 'checked_in' && (res.checkOut < today || (res.checkOut === today && now > checkOutDateTime));
      }

      // Automatically hide fully paid (ledgerBalance = 0) checkout reservations from other active tabs
      if (activeTab === 'all') {
        const isCompleted = res.status === 'checked_out' && Math.abs(res.ledgerBalance || 0) < 0.01;
        if (isCompleted) return false;
      }

      return true;
    }).sort((a, b) => {
      let result = 0;
      if (sortBy === 'guestName') result = (a.guestName || '').localeCompare(b.guestName || '');
      else if (sortBy === 'roomNumber') result = (a.roomNumber || '').localeCompare(b.roomNumber || '');
      else if (sortBy === 'status') result = (a.status || '').localeCompare(b.status || '');
      else {
        const dateA = activeTab === 'checkout_history' ? a.checkOut : a.checkIn;
        const dateB = activeTab === 'checkout_history' ? b.checkOut : b.checkIn;
        result = new Date(dateA || '').getTime() - new Date(dateB || '').getTime();
      }
      return sortOrder === 'desc' ? -result : result;
    });
  }, [
    activeTab,
    reservations,
    checkInHistory,
    checkOutHistory,
    searchTerm,
    historyPeriod,
    dateRange,
    statusFilter,
    paymentStatusFilter,
    rooms,
    roomTypeFilter,
    staffFilter,
    hotel,
    sortBy,
    sortOrder
  ]);

  const roomStats = {
    total: rooms.length,
    available: rooms.filter(r => r.status === 'clean').length,
    occupied: rooms.filter(r => r.status === 'occupied').length,
    dirty: rooms.filter(r => r.status === 'dirty').length,
    status: rooms.filter(r => r.status === 'maintenance').length,
    maintenance: rooms.filter(r => r.status === 'maintenance').length,
  };

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    setIsFetching(true);
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');
    const guestsRef = collection(db, 'hotels', hotel.id, 'guests');
    const corpRef = collection(db, 'hotels', hotel.id, 'corporate_accounts');

    const unsubRes = onSnapshot(resRef, (snap) => {
      const allRes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
      // Client-side sorting
      const sortedRes = allRes.sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime());
      setReservations(sortedRes);
      setIsFetching(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
      setIsFetching(false);
    });

    const unsubRooms = onSnapshot(roomsRef, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    });

    const unsubTypes = onSnapshot(typesRef, (snap) => {
      setRoomTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomType)));
    });

    const unsubGuests = onSnapshot(guestsRef, (snap) => {
      setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
    });

    const unsubCorp = onSnapshot(corpRef, (snap) => {
      setCorporateAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    });

    const unsubStaff = onSnapshot(collection(db, 'hotels', hotel.id, 'staff'), (snap) => {
      setStaffMembers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubBlockings = onSnapshot(collection(db, 'hotels', hotel.id, 'room_blockings'), (snap) => {
      setRoomBlockings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomBlocking)));
    });

    const unsubCheckInHist = onSnapshot(collection(db, 'hotels', hotel.id, 'checkin_history'), (snap) => {
      setCheckInHistory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubCheckOutHist = onSnapshot(collection(db, 'hotels', hotel.id, 'checkout_history'), (snap) => {
      setCheckOutHistory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const unsubRateConfigs = onSnapshot(collection(db, 'hotels', hotel.id, 'rate_configurations'), (snap) => {
      setRateConfigs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubRes();
      unsubRooms();
      unsubTypes();
      unsubGuests();
      unsubCorp();
      unsubStaff();
      unsubBlockings();
      unsubCheckInHist();
      unsubCheckOutHist();
      unsubRateConfigs();
    };
  }, [hotel?.id, profile?.uid]);

  // Evaluate Live Automated Policies (auto-release, auto-cancel)
  useEffect(() => {
    if (!hotel || !hotel.id || !hotel.settings?.reservations || reservations.length === 0) return;
    const rules = hotel.settings.reservations;
    const now = new Date();
    const batchUpdates: Promise<any>[] = [];

    reservations.forEach((res) => {
      // 1. Auto Cancel Unpaid Buffer
      if (
        (res.status === 'pending' || res.status === 'confirmed') &&
        res.paymentStatus === 'unpaid' &&
        rules.autoCancelUnpaidTimeMinutes &&
        rules.autoCancelUnpaidTimeMinutes > 0
      ) {
        const createdDate = new Date(res.createdAt);
        const minutesDiff = (now.getTime() - createdDate.getTime()) / (1000 * 60);
        if (minutesDiff > rules.autoCancelUnpaidTimeMinutes) {
          const p = database.safeUpdate(doc(db, 'hotels', hotel.id, 'reservations', res.id), {
            status: 'cancelled',
            notes: (res.notes || '') + `\n[System Policy] Automatically cancelled due to unpaid buffer timeout of ${rules.autoCancelUnpaidTimeMinutes} mins.`,
            updatedAt: now.toISOString()
          }, {
            hotelId: hotel.id,
            module: 'Reservation Automation',
            action: 'AUTO_CANCEL_UNPAID',
            details: `Auto-cancelled unpaid reservation ${res.id} after buffer expiry`
          });
          batchUpdates.push(p);
        }
      }

      // 2. Auto Release No-Shows
      if (
        (res.status === 'pending' || res.status === 'confirmed') &&
        rules.autoReleaseNoShow
      ) {
        const resCheckInStr = res.checkIn.split('T')[0];
        const todayStr = now.toISOString().split('T')[0];
        if (resCheckInStr < todayStr) {
          const p = database.safeUpdate(doc(db, 'hotels', hotel.id, 'reservations', res.id), {
            status: 'no_show',
            notes: (res.notes || '') + '\n[System Policy] Automatically marked as No-Show due to failure to check-in on scheduled arrival date.',
            updatedAt: now.toISOString()
          }, {
            hotelId: hotel.id,
            module: 'Reservation Automation',
            action: 'AUTO_NO_SHOW',
            details: `Auto-marked reservation ${res.id} as No-Show`
          });
          batchUpdates.push(p);
        }
      }
    });

    if (batchUpdates.length > 0) {
      Promise.all(batchUpdates)
        .then(() => {
          toast.success(`[System Policy] Executed automation for ${batchUpdates.length} bookings.`);
        })
        .catch(err => {
          console.error("Failed automated policies execution:", err);
        });
    }
  }, [hotel?.id, reservations, hotel?.settings?.reservations]);

  // Fetch rates when corporate account is selected
  useEffect(() => {
    if (!hotel?.id || !newBooking.corporateId) {
      setActiveCorporateRates([]);
      return;
    }

    const ratesRef = collection(db, 'hotels', hotel.id, 'corporate_accounts', newBooking.corporateId, 'rates');
    const q = query(ratesRef, where('status', '==', 'active'));

    const unsubRates = onSnapshot(q, (snap) => {
      setActiveCorporateRates(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateRate)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts/${newBooking.corporateId}/rates`);
    });

    return () => unsubRates();
  }, [hotel?.id, newBooking.corporateId]);

  // Recalculate price when room, dates or corporate account changes
  useEffect(() => {
    const calculatePrices = async () => {
      const selectedRoom = rooms.find(r => r.id === newBooking.roomId);
      if (!selectedRoom || !hotel?.id) return;

      let pricePerNight = selectedRoom.price;
      let negotiated = false;

      // 1. Check corporate negotiated rates
      if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
        const activeRate = activeCorporateRates.find(r => 
          (r.roomTypeId === selectedRoom.roomTypeId || r.roomType === selectedRoom.type) &&
          new Date(newBooking.checkIn) >= new Date(r.startDate) &&
          new Date(newBooking.checkIn) <= new Date(r.endDate)
        );

        if (activeRate) {
          pricePerNight = activeRate.rate;
          negotiated = true;
        }
      }

      // 2. If not negotiated, check chosen rate option
      if (!negotiated) {
        const matchingConfig = rateConfigs.find(rc => rc.roomTypeId === selectedRoom.roomTypeId);
        
        if (selectedRateType === 'base') {
          pricePerNight = matchingConfig?.baseRate || selectedRoom.price;
        } else if (selectedRateType === 'weekend') {
          pricePerNight = (matchingConfig?.weekendRate && matchingConfig.weekendRate > 0) ? matchingConfig.weekendRate : selectedRoom.price;
        } else if (selectedRateType === 'weekday') {
          pricePerNight = (matchingConfig?.weekdayRate && matchingConfig.weekdayRate > 0) ? matchingConfig.weekdayRate : selectedRoom.price;
        } else if (selectedRateType === 'custom') {
          pricePerNight = customRateAmount;
        } else {
          // 'auto' - check dynamic rate configuration
          const dynamicRate = await roomService.calculateCurrentRate(
            hotel.id, 
            selectedRoom.roomTypeId || '', 
            new Date(newBooking.checkIn)
          );
          if (dynamicRate > 0) {
            pricePerNight = dynamicRate;
          }
        }
      }

      const checkInDateTime = parseLocalDateTime(newBooking.checkIn, newBooking.checkInTime || '14:00');
      const checkOutDateTime = parseLocalDateTime(newBooking.checkOut, newBooking.checkOutTime || '12:00');
      const hours = (checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60 * 60);
      const nights = Math.max(1, Math.ceil(hours / 24));
      
      setIsNegotiatedRate(negotiated);
      
      const primaryTotal = pricePerNight * nights;

      const activeTaxes = (hotel?.taxes || []).filter(t => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        return status === 'active' && category !== 'restaurant';
      });
      
      const primaryBaseAmount = primaryTotal;
      
      let primaryTaxTotal = 0;
      let primaryExclusiveTaxTotal = 0;
      const primaryTaxDetails = activeTaxes.map(tax => {
        const amount = tax.isInclusive 
          ? primaryBaseAmount - (primaryBaseAmount / (1 + (tax.percentage / 100)))
          : primaryBaseAmount * (tax.percentage / 100);
        
        primaryTaxTotal += amount;
        if (!tax.isInclusive) {
          primaryExclusiveTaxTotal += amount;
        }
        return { name: tax.name, percentage: tax.percentage, amount, isInclusive: tax.isInclusive };
      });

      // Recalculate additional stays prices
      let additionalStaysChanged = false;
      let totalAdditionalTax = 0;
      let totalAdditionalExclusiveTax = 0;
      
      const updatedAdditionalStays = await Promise.all(newBooking.additionalStays.map(async (stay) => {
        const room = rooms.find(r => r.id === stay.roomId);
        if (!room) return stay;
        
        let stayPrice = room.price;
        let stayNegotiated = false;

        if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
          const rate = activeCorporateRates.find(r => 
            (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
            new Date(stay.checkIn) >= new Date(r.startDate) &&
            new Date(stay.checkIn) <= new Date(r.endDate)
          );
          if (rate) {
            stayPrice = rate.rate;
            stayNegotiated = true;
          }
        }

        if (!stayNegotiated) {
          const dynamicRate = await roomService.calculateCurrentRate(
            hotel.id, 
            room.roomTypeId || '', 
            new Date(stay.checkIn)
          );
          if (dynamicRate > 0) stayPrice = dynamicRate;
        }
        
        const sCheckInDateTime = parseLocalDateTime(stay.checkIn, newBooking.checkInTime || '14:00');
        const sCheckOutDateTime = parseLocalDateTime(stay.checkOut, newBooking.checkOutTime || '12:00');
        const sHours = (sCheckOutDateTime.getTime() - sCheckInDateTime.getTime()) / (1000 * 60 * 60);
        const sNights = Math.max(1, Math.ceil(sHours / 24));
        const stayTotal = stayPrice * sNights;

        // Calculate taxes for this additional stay
        const stayBaseAmount = stayTotal;
        let stayTaxTotal = 0;
        let stayExclusiveTaxTotal = 0;
        const stayTaxDetails = activeTaxes.map(tax => {
          const amount = tax.isInclusive 
            ? stayBaseAmount - (stayBaseAmount / (1 + (tax.percentage / 100)))
            : stayBaseAmount * (tax.percentage / 100);
          
          stayTaxTotal += amount;
          if (!tax.isInclusive) {
            stayExclusiveTaxTotal += amount;
          }
          return { name: tax.name, percentage: tax.percentage, amount, isInclusive: tax.isInclusive };
        });
        totalAdditionalTax += stayTaxTotal;
        totalAdditionalExclusiveTax += stayExclusiveTaxTotal;
        
        // Avoid comparison issues
        const taxDetailsMatch = stay.taxDetails && stayTaxDetails.length === stay.taxDetails.length && 
          stayTaxDetails.every((t, i) => Math.abs(t.amount - stay.taxDetails[i].amount) < 0.01);

        if (Math.abs(stayTotal + stayExclusiveTaxTotal - (stay.totalAmount || 0)) > 0.01 || !taxDetailsMatch) {
          additionalStaysChanged = true;
          return { ...stay, totalAmount: stayTotal + stayExclusiveTaxTotal, taxAmount: stayTaxTotal, taxDetails: stayTaxDetails, exclusiveTaxAmount: stayExclusiveTaxTotal };
        }
        return stay;
      }));

      const additionalRoomTotal = updatedAdditionalStays.reduce((acc, stay) => acc + (stay.totalAmount || 0), 0);
      const totalAmount = primaryTotal + primaryExclusiveTaxTotal + additionalRoomTotal;
      const totalTax = primaryTaxTotal + totalAdditionalTax;

      if (Math.abs(newBooking.totalAmount - totalAmount) > 0.01 || additionalStaysChanged || Math.abs(newBooking.taxAmount - totalTax) > 0.01) {
        setNewBooking(prev => ({
          ...prev,
          totalAmount,
          taxAmount: totalTax,
          taxDetails: primaryTaxDetails,
          additionalStays: updatedAdditionalStays
        }));
      }
    };

    calculatePrices();
  }, [newBooking.roomId, newBooking.checkIn, newBooking.checkOut, newBooking.corporateId, newBooking.guestType, activeCorporateRates, rooms, newBooking.additionalStays, hotel, currency, exchangeRate, selectedRateType, customRateAmount, rateConfigs]);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  const handleBooking = async () => {
    if (!hotel?.id || !profile || loading) return;
    
    const allStays = [
      {
        guestName: newBooking.guestName,
        guestEmail: newBooking.guestEmail,
        guestPhone: newBooking.guestPhone,
        roomId: newBooking.roomId,
        checkIn: newBooking.checkIn,
        checkOut: newBooking.checkOut,
        totalAmount: 0, // Will be recalculated
        guestId: newBooking.guestId,
        idType: newBooking.idType,
        idNumber: newBooking.idNumber,
        address: newBooking.address
      },
      ...newBooking.additionalStays
    ];

    if (allStays.some(s => !s.guestName || !s.roomId)) {
      toast.error("Please fill in all guest names and select rooms.");
      return;
    }

    // Check blacklist (DNR)
    if (hotel.settings?.guests?.allowBlacklisting) {
      for (const stay of allStays) {
        if (stay.guestId) {
          const guestObj = guests.find(g => g.id === stay.guestId);
          if (guestObj && (guestObj.tags || []).includes('DNR')) {
            toast.error(`Booking denied: Guest "${stay.guestName}" is blacklisted (DNR).`);
            return;
          }
        }
      }
    }

    // Check for blocked rooms and occupancy
    const preventOverbooking = hotel.settings?.reservations?.preventOverbooking ?? true;
    
    for (const stay of allStays) {
      if (preventOverbooking && !isRoomAvailable(stay.roomId, stay.checkIn, stay.checkOut, reservations, roomBlockings, hotel)) {
        const room = rooms.find(r => r.id === stay.roomId);
        toast.error(`Room ${room?.roomNumber || stay.roomId} is not available for the selected dates.`);
        return;
      }
    }

    setLoading(true);
    try {
      const batch = writeBatch(db);
      const createdStays: { 
        resId: string; 
        guestId: string; 
        totalAmount: number; 
        roomNumber: string; 
        corporateId?: string;
        discountAmount?: number;
        discountType?: 'fixed' | 'percentage';
        discountReason?: string;
      }[] = [];
      
      for (const stay of allStays) {
        const selectedRoom = rooms.find(r => r.id === stay.roomId);
        if (!selectedRoom) continue;

        // Calculate individual stay price
        let pricePerNight = selectedRoom.price;
        let isOverridden = false;
        let originalRate = selectedRoom.price;

        // Check if there's a rate override selected for the primary stay
        const isPrimaryStay = createdStays.length === 0;
        if (isPrimaryStay) {
          if (selectedRateType === 'custom') {
            pricePerNight = customRateAmount;
            isOverridden = pricePerNight !== originalRate;
          } else if (selectedRateType === 'base') {
            const matchingConfig = rateConfigs.find(rc => rc.roomTypeId === selectedRoom.roomTypeId);
            pricePerNight = matchingConfig?.baseRate || selectedRoom.price;
            isOverridden = pricePerNight !== originalRate;
          } else if (selectedRateType === 'weekend') {
            const matchingConfig = rateConfigs.find(rc => rc.roomTypeId === selectedRoom.roomTypeId);
            pricePerNight = (matchingConfig?.weekendRate && matchingConfig.weekendRate > 0) ? matchingConfig.weekendRate : selectedRoom.price;
            isOverridden = pricePerNight !== originalRate;
          } else if (selectedRateType === 'weekday') {
            const matchingConfig = rateConfigs.find(rc => rc.roomTypeId === selectedRoom.roomTypeId);
            pricePerNight = (matchingConfig?.weekdayRate && matchingConfig.weekdayRate > 0) ? matchingConfig.weekdayRate : selectedRoom.price;
            isOverridden = pricePerNight !== originalRate;
          } else {
            // Check corporate negotiated rate
            if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
              const activeRate = activeCorporateRates.find(r => 
                (r.roomTypeId === selectedRoom.roomTypeId || r.roomType === selectedRoom.type) &&
                new Date(stay.checkIn) >= new Date(r.startDate) &&
                new Date(stay.checkIn) <= new Date(r.endDate)
              );
              if (activeRate) pricePerNight = activeRate.rate;
            }
          }
        } else {
          // Additional stays in batch booking
          if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
            const activeRate = activeCorporateRates.find(r => 
              (r.roomTypeId === selectedRoom.roomTypeId || r.roomType === selectedRoom.type) &&
              new Date(stay.checkIn) >= new Date(r.startDate) &&
              new Date(stay.checkIn) <= new Date(r.endDate)
            );
            if (activeRate) pricePerNight = activeRate.rate;
          }
        }

        if (isOverridden) {
          // Log manual rate override to activityLogs immediately
          await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
            timestamp: new Date().toISOString(),
            userId: profile.uid,
            userEmail: profile.email,
            userName: profile.displayName || profile.email,
            userRole: profile.role,
            action: 'MANUAL_RATE_OVERRIDE',
            module: 'Front Desk',
            resource: `Manual rate override for Room ${selectedRoom.roomNumber}`,
            details: `Staff member ${profile.email} manually overrode room rate for Room ${selectedRoom.roomNumber} from default of ${originalRate} to ${pricePerNight} (Authorized by: ${profile.email}).`,
            hotelId: hotel.id,
            oldValue: originalRate,
            newValue: pricePerNight,
            metadata: {
              roomNumber: selectedRoom.roomNumber,
              roomId: selectedRoom.id,
              authorizedBy: profile.email,
              guestName: stay.guestName,
              originalRate,
              newRate: pricePerNight
            }
          }, {
            hotelId: hotel.id,
            module: 'Front Desk',
            action: 'ACTIVITY_LOG_CREATE',
            details: `Log manual rate override from ${originalRate} to ${pricePerNight} during booking/check-in`
          });
        }

        const checkInDateTime = parseLocalDateTime(stay.checkIn, newBooking.checkInTime || '14:00');
        const checkOutDateTime = parseLocalDateTime(stay.checkOut, newBooking.checkOutTime || '12:00');
        const hours = (checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60 * 60);
        const nights = Math.max(1, Math.ceil(hours / 24));
        const baseAmount = pricePerNight * nights;

        // Calculate taxes for this specific stay
        const activeTaxes = (hotel?.taxes || []).filter(t => {
          const status = (t.status || '').toLowerCase().trim();
          const category = (t.category || '').toLowerCase().trim();
          return status === 'active' && category !== 'restaurant';
        });

        let stayTaxTotal = 0;
        let stayExclusiveTaxTotal = 0;
        const stayTaxDetails = activeTaxes.map(tax => {
          const amount = tax.isInclusive 
            ? baseAmount - (baseAmount / (1 + (tax.percentage / 100)))
            : baseAmount * (tax.percentage / 100);
          
          stayTaxTotal += amount;
          if (!tax.isInclusive) {
            stayExclusiveTaxTotal += amount;
          }
          return { name: tax.name, percentage: tax.percentage, amount, isInclusive: tax.isInclusive };
        });

        const totalAmount = baseAmount + stayExclusiveTaxTotal;

        let guestId = stay.guestId;
        if (!guestId) {
          const guestRef = doc(collection(db, 'hotels', hotel.id, 'guests'));
          batch.set(guestRef, {
            name: stay.guestName,
            email: stay.guestEmail,
            phone: stay.guestPhone,
            idType: stay.idType,
            idNumber: stay.idNumber,
            address: stay.address,
            corporateId: newBooking.corporateId,
            ledgerBalance: 0,
            totalStays: 0,
            totalNights: 0,
            totalSpent: 0,
            createdAt: new Date().toISOString()
          });
          guestId = guestRef.id;
        }

        const resRef = doc(collection(db, 'hotels', hotel.id, 'reservations'));
        const resData: any = {
          guestName: stay.guestName,
          guestEmail: stay.guestEmail,
          guestPhone: stay.guestPhone,
          idType: stay.idType,
          idNumber: stay.idNumber,
          address: stay.address,
          guestId,
          corporateId: newBooking.corporateId,
          roomId: stay.roomId,
          roomNumber: selectedRoom.roomNumber,
          checkIn: stay.checkIn,
          checkInTime: newBooking.checkInTime || '14:00',
          checkOut: stay.checkOut,
          checkOutTime: newBooking.checkOutTime || '12:00',
          nights,
          status: 'pending',
          totalAmount,
          taxAmount: stayTaxTotal,
          taxDetails: stayTaxDetails,
          paidAmount: 0, // Initialize to 0, settleLedger will update this
          totalDiscount: 0,
          paymentStatus: 'unpaid',
          notes: newBooking.notes,
          corporateReference: newBooking.corporateReference,
          ledgerBalance: 0,
          nightlyRate: pricePerNight,
          autoNightDeduction: newBooking.autoNightDeduction,
          bookedBy: profile.uid,
          createdAt: new Date().toISOString(),
        };

        // Apply discount to the first reservation in the batch
        if (createdStays.length === 0 && newBooking.discountAmount > 0) {
          resData.discountAmount = newBooking.discountAmount;
          resData.discountType = newBooking.discountType;
          resData.discountReason = newBooking.discountReason;
          resData.totalDiscount = 0; // Initialize to 0; postToLedger will update it via increment
        }

        // Note: We don't set paidAmount here anymore because settleLedger 
        // (called after batch.commit) will handle the increment correctly.
        // This prevents doubling the paidAmount.

        batch.set(resRef, resData);
        createdStays.push({ 
          resId: resRef.id, 
          guestId, 
          totalAmount, 
          roomNumber: selectedRoom.roomNumber,
          corporateId: newBooking.corporateId,
          discountAmount: createdStays.length === 0 ? newBooking.discountAmount : 0,
          discountType: createdStays.length === 0 ? newBooking.discountType : undefined,
          discountReason: createdStays.length === 0 ? newBooking.discountReason : undefined
        });
      }

      await database.commitBatch(hotel.id, batch, {
        module: 'Front Desk',
        action: 'CREATE_BOOKING',
        details: `Created batch of ${allStays.length} bookings for ${newBooking.guestName}`,
        userContext: { uid: profile.uid, email: profile.email, role: profile.role }
      });

      // logActivity
      await logActivity(
        hotel.id,
        profile,
        'CREATE_BOOKING',
        'Front Desk',
        `Created batch of ${allStays.length} bookings for ${newBooking.guestName}`,
        undefined,
        null,
        allStays
      );
      
      // Post discounts and initial payments to ledger if any
      for (const stay of createdStays) {
        if (stay.discountAmount && stay.discountAmount > 0) {
          let finalDiscount = stay.discountAmount;
          if (stay.discountType === 'percentage') {
            finalDiscount = (stay.totalAmount * stay.discountAmount) / 100;
          }

          await postToLedger(hotel.id, stay.guestId, stay.resId, {
            amount: finalDiscount,
            type: 'credit',
            category: 'discount',
            description: `Booking Discount (${stay.discountType === 'percentage' ? stay.discountAmount + '%' : formatCurrency(stay.discountAmount, currency, exchangeRate)}): ${stay.discountReason || 'New Booking Discount'}`,
            referenceId: stay.resId,
            postedBy: profile.uid
          }, profile.uid, stay.corporateId);
        }

        const totalPayment = newBooking.payments.reduce((acc: number, p: any) => acc + (p.amount || 0), 0);
        if (createdStays.indexOf(stay) === 0 && totalPayment > 0) {
          for (const pay of newBooking.payments) {
            if (pay.amount > 0) {
              await settleLedger(hotel.id, stay.guestId, stay.resId, pay.amount, pay.method, profile.uid, stay.corporateId);
            }
          }
        }
      }

      setIsBooking(false);
      setSelectedRateType('auto');
      setCustomRateAmount(0);
      setNewBooking({
        guestType: 'individual',
        guestId: '',
        corporateId: '',
        guestName: '',
        guestEmail: '',
        guestPhone: '',
        idType: '',
        idNumber: '',
        address: '',
        roomId: '',
        checkIn: format(new Date(), 'yyyy-MM-dd'),
        checkInTime: '14:00',
        checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
        checkOutTime: '12:00',
        totalAmount: 0,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        notes: '',
        corporateReference: '',
        discountAmount: 0,
        discountType: 'fixed',
        discountReason: '',
        taxAmount: 0,
        taxDetails: [],
        initialPayment: 0,
        paymentMethod: 'cash',
        payments: [{ amount: 0, method: 'cash' }],
        autoNightDeduction: true,
        additionalStays: [] as any[]
      });
    } catch (err: any) {
      console.error("Booking error:", err.message || safeStringify(err));
      toast.error('Failed to create bookings');
    } finally {
      setLoading(false);
    }
  };

  const deleteReservation = async (res: Reservation) => {
    if (!hotel?.id || !profile) return;
    
    const policy = canCancelReservation(hotel, profile, res);
    if (!policy.allowed) {
      toast.error(policy.message || 'Cancellation denied by hotel policy');
      return;
    }

    const isAdminUser = profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin';
    if (!isAdminUser) {
      toast.error('Only administrators can delete reservations');
      return;
    }

    try {
      setLoading(true);
      const batch = writeBatch(db);
      
      // 1. Delete reservation
      batch.delete(doc(db, 'hotels', hotel.id, 'reservations', res.id));
      
      // 2. If checked in, mark room as clean
      if (res.status === 'checked_in') {
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'clean' });
      }
      
      await database.commitBatch(hotel.id, batch, {
        module: 'Front Desk',
        action: 'DELETE_RESERVATION',
        details: `Deleted reservation ${res.id} for ${res.guestName} (Room ${res.roomNumber})`,
        userContext: { uid: profile.uid, email: profile.email, role: profile.role }
      });

      await logActivity(
        hotel.id,
        profile,
        'DELETE_RESERVATION',
        'Front Desk',
        `Deleted reservation for ${res.guestName} (Room ${res.roomNumber})`,
        res.id,
        res,
        null
      );
      toast.success('Reservation deleted successfully');
    } catch (err: any) {
      console.error("Delete reservation error:", err.message || safeStringify(err));
      toast.error('Failed to delete reservation');
    } finally {
      setLoading(false);
    }
  };

  const handleEditReservation = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !editingReservation || !profile) return;

    const policy = canEditReservation(hotel, profile, editingReservation);
    if (!policy.allowed) {
      toast.error(policy.message || 'Editing denied by hotel policy');
      return;
    }

    if (!hasPermission(profile, 'edit_reservation')) {
      toast.error('You do not have permission to edit reservations');
      return;
    }

    try {
      setLoading(true);
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', editingReservation.id);
      
      const newValues = {
        checkIn: editForm.checkIn,
        checkOut: editForm.checkOut,
        totalAmount: editForm.totalAmount,
        notes: editForm.notes
      };

      await database.safeUpdate(resRef, newValues, {
        hotelId: hotel.id,
        module: 'Front Desk',
        action: 'EDIT_RESERVATION',
        details: `Reservation ${editingReservation.id} updated (Dates: ${editForm.checkIn} to ${editForm.checkOut}, Total: ${editForm.totalAmount})`
      });

      await logActivity(
        hotel.id,
        profile,
        'EDIT_RESERVATION',
        'Front Desk',
        `Reservation ${editingReservation.id} updated`,
        editingReservation.id,
        editingReservation,
        { ...editingReservation, ...newValues }
      );

      toast.success('Reservation updated successfully');
      setEditingReservation(null);
    } catch (err: any) {
      console.error("Edit reservation error:", err.message || safeStringify(err));
      toast.error('Failed to update reservation');
    } finally {
      setLoading(false);
    }
  };

  const handleBulkCheckIn = async () => {
    if (!hotel?.id || !profile || selectedReservations.length === 0) return;
    
    const confirm = window.confirm(`Are you sure you want to check in ${selectedReservations.length} guests?`);
    if (!confirm) return;

    try {
      setLoading(true);
      let checkedInCount = 0;
      let skippedCount = 0;
      
      for (const resId of selectedReservations) {
        const res = reservations.find(r => r.id === resId);
        if (res && (res.status === 'pending' || res.status === 'confirmed')) {
          const room = rooms.find(r => r.id === res.roomId);
          const guest = guests.find(g => g.id === res.guestId);
          const policy = canCheckIn(hotel, profile, res, room, guest);
          
          if (!policy.allowed) {
            skippedCount++;
            continue;
          }

          await updateReservationStatus(res, 'checked_in');
          checkedInCount++;
        }
      }

      if (checkedInCount > 0) {
        if (skippedCount > 0) {
          toast.success(`Successfully checked in ${checkedInCount} guests (skipped ${skippedCount} due to policies).`);
        } else {
          toast.success(`Successfully checked in ${checkedInCount} guests.`);
        }
        setSelectedReservations([]);
      } else if (skippedCount > 0) {
        toast.error(`Check-in failed for all selected guests due to hotel policies.`);
      }
    } catch (err: any) {
      console.error("Bulk check-in error:", err.message || safeStringify(err));
      toast.error('Failed to perform bulk check-in');
    } finally {
      setLoading(false);
    }
  };
  const handleConfirmAction = async () => {
    if (!showConfirmAction || !hotel?.id) return;
    const { res, action } = showConfirmAction;
    
    try {
      setLoading(true);
      if (action === 'delete') {
        await deleteReservation(res);
      } else {
        await updateReservationStatus(res, action);
      }
      setShowConfirmAction(null);
    } catch (err: any) {
      console.error("Confirm action error:", err.message || safeStringify(err));
    } finally {
      setLoading(false);
    }
  };

  const handlePostponeStay = async () => {
    if (!showPostponeModal || !hotel?.id || !newCheckOutDate || !profile) return;
    if (!hasPermission(profile, 'edit_reservation')) {
      toast.error('You do not have permission to edit reservations');
      return;
    }
    
    try {
      setLoading(true);
      const res = showPostponeModal;
      
      const oldCheckOut = new Date(res.checkOut);
      const newCheckOut = new Date(newCheckOutDate);
      const extraNights = Math.ceil((newCheckOut.getTime() - oldCheckOut.getTime()) / (1000 * 60 * 60 * 24));
      
      if (extraNights <= 0) {
        toast.error('New check-out date must be after current check-out date');
        return;
      }

      const room = rooms.find(r => r.id === res.roomId);
      const nightlyRate = room?.price || 0;
      const baseExtraAmount = extraNights * nightlyRate;

      // Calculate exclusive taxes for the extension to update totalAmount correctly
      const activeTaxes = (hotel?.taxes || []).filter(t => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        return status === 'active' && category !== 'restaurant';
      });

      let extraExclusiveTaxTotal = 0;
      activeTaxes.forEach(tax => {
        if (!tax.isInclusive) {
          extraExclusiveTaxTotal += baseExtraAmount * (tax.percentage / 100);
        }
      });

      const newTotalAmount = res.totalAmount + baseExtraAmount + extraExclusiveTaxTotal;

      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'reservations', res.id), { 
        checkOut: newCheckOutDate,
        totalAmount: newTotalAmount
      }, {
        hotelId: hotel.id,
        module: 'Front Desk',
        action: 'RESERVATION_POSTPONED',
        details: `Stay extension for Res #${(res.id || '').slice(-6)} until ${newCheckOutDate}`
      });

      // Post the extra charge to the ledger if guest is checked in
      if (res.status === 'checked_in') {
        await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
          amount: baseExtraAmount,
          type: 'debit',
          category: 'room',
          description: `Stay Extension: ${extraNights} additional nights until ${newCheckOutDate}`,
          referenceId: res.id,
          postedBy: profile?.uid || 'system'
        }, profile?.uid || 'system', res.corporateId);
      }

      await logActivity(
        hotel.id,
        profile,
        'RESERVATION_POSTPONED',
        'Front Desk',
        `Reservation ${res.id} postponed to ${newCheckOutDate}`,
        res.id,
        { checkOut: res.checkOut, totalAmount: res.totalAmount },
        { checkOut: newCheckOutDate, totalAmount: newTotalAmount }
      );

      toast.success('Stay postponed successfully');
      setShowPostponeModal(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/reservations`);
      toast.error('Failed to postpone stay');
    } finally {
      setLoading(false);
    }
  };

  const handleApplyDiscount = async () => {
    if (!showDiscountModal || !hotel?.id || !discountData.amount || !profile) return;
    
    let finalAmount = discountData.amount;
    if (discountData.type === 'percentage') {
      finalAmount = (showDiscountModal.totalAmount * discountData.amount) / 100;
    }

    const policy = canApplyDiscount(hotel, profile, finalAmount, showDiscountModal.totalAmount);
    if (!policy.allowed) {
      toast.error(policy.message || 'Discount denied by hotel policy');
      return;
    }

    if (!hasPermission(profile, 'edit_reservation')) {
      toast.error('You do not have permission to apply discounts');
      return;
    }
    
    try {
      setLoading(true);
      const res = showDiscountModal;
      
      let finalAmount = discountData.amount;
      if (discountData.type === 'percentage') {
        finalAmount = (res.totalAmount * discountData.amount) / 100;
      }
      
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: finalAmount,
        type: 'credit',
        category: 'service',
        description: `Discount (${discountData.type === 'percentage' ? discountData.amount + '%' : formatCurrency(discountData.amount, currency, exchangeRate)}): ${discountData.reason || 'Management Discount'}`,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid);

      await logActivity(
        hotel.id,
        profile,
        'DISCOUNT_APPLIED',
        'Front Desk',
        `Discount applied to reservation ${res.id}`,
        res.id,
        null,
        { amount: finalAmount, reason: discountData.reason }
      );

      toast.success('Discount applied successfully');
      setShowDiscountModal(null);
      setDiscountData({ amount: 0, type: 'fixed', reason: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/ledger`);
      toast.error('Failed to apply discount');
    } finally {
      setLoading(false);
    }
  };

  const runNightlyAudit = async () => {
    if (!hotel?.id || !profile) return;
    
    try {
      setIsAuditing(true);
      const today = startOfDay(new Date());
      let auditCount = 0;
      let totalCharged = 0;

      // 1. Get all checked-in reservations
      const q = query(
        collection(db, 'hotels', hotel.id, 'reservations'),
        where('status', '==', 'checked_in')
      );
      const querySnapshot = await getDocs(q);
      
      for (const resDoc of querySnapshot.docs) {
        const res = { id: resDoc.id, ...resDoc.data() } as Reservation;
        if (!res.guestId || !res.autoNightDeduction) continue;

        const result = await processAutomatedBillingForReservation(hotel, res, profile.uid, new Date());
        if (result.chargedCount > 0) {
          auditCount += result.chargedCount;
          totalCharged += result.totalAmount;
        }
      }

      if (auditCount > 0) {
        toast.success(`Nightly audit completed. Posted ${auditCount} charges totaling ${formatCurrency(totalCharged, currency, exchangeRate)}.`);
      } else {
        toast.info("Nightly audit completed. No new charges to post.");
      }
      
      // Update hotel last audit date
      await database.safeUpdate(doc(db, 'hotels', hotel.id), {
        lastAuditDate: format(new Date(), 'yyyy-MM-dd')
      }, {
        hotelId: hotel.id,
        module: 'Finance',
        action: 'NIGHTLY_AUDIT_COMPLETED',
        details: 'Nightly audit completed and charges posted'
      });

      // Log audit action
      await logActivity(
        hotel.id,
        profile,
        'NIGHTLY_AUDIT_RUN',
        'Finance',
        `Nightly audit processed ${querySnapshot.docs.length} stays`,
        undefined,
        null,
        { auditCount, totalCharged }
      );

    } catch (err: any) {
      console.error("Audit error:", err.message || safeStringify(err));
      toast.error(`Failed to run nightly audit: ${err.message || "Unknown error"}`);
    } finally {
      setIsAuditing(false);
      setShowNightAuditModal(false);
    }
  };

  const checkAndChargeActiveOverstays = async () => {
    if (!hotel?.id || !profile) return;
    
    // Only run if user has permission to write front desk / ledger entries
    const canChange = profile.role === 'hotelAdmin' || 
                      (profile.role === 'staff' && (profile.permissions || []).includes('frontDesk'));
    if (!canChange) return;

    try {
      const activeCheckedInRes = reservations.filter(res => {
        return res.status === 'checked_in' && res.autoNightDeduction && res.guestId;
      });

      if (activeCheckedInRes.length === 0) return;

      let chargedCount = 0;
      let totalAmountCharged = 0;

      for (const res of activeCheckedInRes) {
        const result = await processAutomatedBillingForReservation(hotel, res, profile.uid, new Date());
        if (result.chargedCount > 0) {
          chargedCount += result.chargedCount;
          totalAmountCharged += result.totalAmount;
        }
      }

      if (chargedCount > 0) {
        toast.info(`Auto-charged ${chargedCount} night(s) totaling ${formatCurrency(totalAmountCharged, currency, exchangeRate)} dynamically based on elapsed stay metrics.`);
      }
    } catch (err) {
      console.error("Error auto-charging active stays:", err);
    }
  };

  const updateReservationStatus = async (res: Reservation, status: Reservation['status']) => {
    if (!hotel?.id || !profile) return;
    
    // Policy checks
    if (status === 'checked_in') {
      const room = rooms.find(r => r.id === res.roomId);
      const guest = guests.find(g => g.id === res.guestId);
      const policy = canCheckIn(hotel, profile, res, room, guest);
      if (!policy.allowed) {
        toast.error(policy.message || 'Check-in denied by hotel policy');
        return;
      }
    }

    if (status === 'checked_out') {
      const policy = canCheckout(hotel, profile, res);
      if (!policy.allowed) {
        toast.error(policy.message || 'Check-out denied by hotel policy');
        return;
      }
    }

    if (status === 'cancelled' || status === 'no_show') {
      const policy = canCancelReservation(hotel, profile, res);
      if (!policy.allowed) {
        toast.error(policy.message || 'Action denied by hotel policy');
        return;
      }
    }

    // Permission checks
    if (status === 'checked_in' && !hasPermission(profile, 'manage_rooms')) {
      toast.error('Permission denied: Check-in');
      return;
    }
    if (status === 'checked_out' && !hasPermission(profile, 'manage_rooms')) {
      toast.error('Permission denied: Check-out');
      return;
    }
    if ((status === 'cancelled' || status === 'no_show') && !hasPermission(profile, 'delete_reservation')) {
      toast.error('Permission denied: Cancellation');
      return;
    }

    try {
      setLoading(true);
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
      
      // 1. Update reservation status immediately
      await database.safeUpdate(resRef, { status }, {
        hotelId: hotel.id,
        module: 'Front Desk',
        action: 'UPDATE_RESERVATION_STATUS',
        details: `Reservation ${res.id} status changed to ${status}`
      });

      await logActivity(
        hotel.id,
        profile,
        'UPDATE_RESERVATION_STATUS',
        'Front Desk',
        `Reservation status changed to ${status}`,
        res.id,
        { status: res.status },
        { status }
      );
      
      // 2. Handle specific status transitions
      if (status === 'checked_in') {
        // Write to Check-In History
        try {
          const checkInHistoryRef = doc(db, 'hotels', hotel.id, 'checkin_history', res.id);
          await setDoc(checkInHistoryRef, {
            id: res.id,
            reservationId: res.id,
            guestId: res.guestId || 'unknown_guest',
            guestName: res.guestName,
            guestEmail: res.guestEmail || '',
            guestPhone: res.guestPhone || '',
            roomNumber: res.roomNumber,
            roomId: res.roomId,
            checkIn: res.checkIn,
            checkInTime: res.checkInTime || '14:00',
            checkOut: res.checkOut,
            checkInTimestamp: new Date().toISOString(),
            bookedBy: res.bookedBy || '',
            checkedInBy: profile.email || 'System',
            status: 'checked_in',
            ledgerBalance: res.ledgerBalance || 0,
            totalAmount: res.totalAmount || 0,
            paidAmount: res.paidAmount || 0,
            paymentStatus: res.paymentStatus || 'unpaid'
          });
        } catch (err) {
          console.error("Failed to write to checkin_history:", err);
        }

        // Mark room as occupied
        const roomRef = doc(db, 'hotels', hotel.id, 'rooms', res.roomId);
        await database.safeUpdate(roomRef, { status: 'occupied' }, {
          hotelId: hotel.id,
          module: 'Rooms',
          action: 'ROOM_CHECKIN',
          details: `Room ${res.roomNumber} occupied during check-in`
        });
        
        if (res.guestId) {
          // Increment guest totalStays
          const guestRef = doc(db, 'hotels', hotel.id, 'guests', res.guestId);
          await database.safeUpdate(guestRef, {
            totalStays: increment(1)
          }, {
            hotelId: hotel.id,
            module: 'Guests',
            action: 'STAY_COUNT_INCREMENT',
            details: `Incremented stay count for guest ${res.guestId} upon check-in`
          });
          
          // Trigger inventory consumption based on rules
          const selectedRoom = rooms.find(r => r.id === res.roomId);
          const roomType = roomTypes.find(t => t.id === selectedRoom?.roomTypeId || t.name === selectedRoom?.type);
          await roomService.triggerInventoryConsumption(hotel.id, roomType?.id || '', 'check_in', profile.uid);

          // Post ONLY the first night's charge at check-in, if not already posted
          const rate = res.nightlyRate || (res.totalAmount / (res.nights || 1)) || 0;
          const { checkInDateTime } = BillingService.calculateStayWindow(res, hotel);
          const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';
          const Start = checkInDateTime;
          const End = parseLocalDateTime(format(addDays(checkInDateTime, 1), 'yyyy-MM-dd'), checkOutTime);
          const startStr = Start.toISOString();
          const endStr = End.toISOString();

          // Query to see if any room charge already exists for this reservation to avoid duplicates
          const ledgerQ = query(
            collection(db, 'hotels', hotel.id, 'ledger'),
            where('reservationId', '==', res.id),
            where('category', '==', 'room'),
            where('type', '==', 'debit')
          );
          const ledgerSnap = await getDocs(ledgerQ);
          const alreadyHasRoomCharge = !ledgerSnap.empty;

          if (!alreadyHasRoomCharge) {
            await postToLedger(hotel.id, res.guestId, res.id, {
              amount: rate,
              type: 'debit',
              category: 'room',
              description: `Room Charge: Room ${res.roomNumber} (Night of ${format(Start, 'MMM dd, yyyy')})`,
              referenceId: res.id,
              postedBy: profile.uid,
              chargePeriodStart: startStr,
              chargePeriodEnd: endStr,
              chargeType: 'room_rate'
            }, profile.uid, res.corporateId);
          } else {
            console.log(`[CheckIn] Skipped room charge for reservation ${res.id} because one already exists.`);
          }

          // Taxes are automatically posted by postToLedger if it's a room charge

          // Fetch fresh data to avoid stale state issues with auto-deduction
          const [guestSnap, freshResSnap] = await Promise.all([
            getDoc(doc(db, 'hotels', hotel.id, 'guests', res.guestId)),
            getDoc(resRef)
          ]);
          
          if (guestSnap.exists() && freshResSnap.exists()) {
            const guestData = guestSnap.data() as Guest;
            const freshResData = freshResSnap.data() as Reservation;
            
            // AUTO DEDUCTION: If guest has credit balance (negative ledgerBalance), apply it
            if (guestData.ledgerBalance < 0) {
              const creditBalance = Math.abs(guestData.ledgerBalance);
              const remainingBalance = freshResData.totalAmount - (freshResData.paidAmount || 0) - (freshResData.totalDiscount || 0);
              const creditToApply = Math.min(creditBalance, Math.max(0, remainingBalance));
              
              if (creditToApply > 0) {
                await settleLedger(hotel.id, res.guestId, res.id, creditToApply, 'cash', profile.uid, res.corporateId);
                toast.info(`Applied ${formatCurrency(creditToApply, currency, exchangeRate)} from guest's credit balance.`);
              }
            }
          }
        }
      } else if (status === 'checked_out') {
        // 1. Ensure all nights stayed are charged
        const now = new Date();
        
        // Refined overstay logic for checkout derived from central billing engine:
        const billingState = calculateBilling(res, hotel);
        const nightsStayed = billingState.nightsCount;
        const checkInDate = startOfDay(new Date(res.checkIn));
        
        const ledgerQ = query(
          collection(db, 'hotels', hotel.id, 'ledger'),
          where('reservationId', '==', res.id)
        );
        const ledgerSnap = await getDocs(ledgerQ);
        
        // Client-side filtering to avoid composite indexes
        const roomChargeEntries = ledgerSnap.docs.filter(doc => {
          const data = doc.data();
          return data.category === 'room' && data.type === 'debit';
        });
        const existingCharges = roomChargeEntries.length;
        
        let finalTotalDebits = roomChargeEntries.reduce((acc, doc) => acc + doc.data().amount, 0);
        const rate = res.nightlyRate || (res.totalAmount / (res.nights || 1)) || 0;

        for (let i = 0; i < nightsStayed; i++) {
          const chargeDate = addDays(startOfDay(checkInDate), i);
          const dateStr = format(chargeDate, 'MMM dd, yyyy');

          const alreadyCharged = roomChargeEntries.some(doc => {
            const data = doc.data();
            if (data.description?.includes(dateStr)) return true;
            if (data.chargePeriodStart) {
              const pStart = startOfDay(new Date(data.chargePeriodStart));
              if (format(pStart, 'yyyy-MM-dd') === format(chargeDate, 'yyyy-MM-dd')) return true;
            }
            return false;
          });

          if (!alreadyCharged) {
            await postToLedger(hotel.id, res.guestId!, res.id, {
              amount: rate,
              type: 'debit',
              category: 'room',
              description: `Final Room Charge: ${res.roomNumber} (Night of ${dateStr})`,
              referenceId: res.id,
              postedBy: profile.uid
            }, profile.uid, res.corporateId);
            finalTotalDebits += rate;
          }
        }

        const expectedTotalCharges = nightsStayed * rate;
        if (finalTotalDebits > expectedTotalCharges + 0.01) {
          const excessAmount = finalTotalDebits - expectedTotalCharges;
          await postToLedger(hotel.id, res.guestId!, res.id, {
            amount: excessAmount,
            type: 'credit',
            category: 'refund',
            description: `Room Charge Refund: ${res.roomNumber} (Early Checkout adjustment)`,
            referenceId: res.id,
            postedBy: profile.uid
          }, profile.uid, res.corporateId);
          finalTotalDebits -= excessAmount;
        }

        // 2. Check if ledger is settled (for individual guests)
        const freshResSnap = await getDoc(resRef);
        const freshResData = freshResSnap.data() as Reservation;
        
        // Calculate current ledger balance
        const outstandingBalance = freshResData.ledgerBalance || 0;
        const totalDebits = billingState.totalCharges;

        // Determine check-out permission based on dynamic hotel settings
        let blockCheckout = false;
        let blockMessage = '';

        if (!res.corporateId && outstandingBalance > 0.01) {
          const policyResult = canCheckout(hotel, profile, { ...freshResData, ledgerBalance: outstandingBalance });
          if (!policyResult.allowed) {
            blockCheckout = true;
            blockMessage = policyResult.message || `Full payment is required before checkout. Outstanding balance is ${formatCurrency(outstandingBalance, currency, exchangeRate)}.`;
          }
        }

        if (blockCheckout) {
          toast.error(blockMessage);
          setLoading(false);
          // Revert status to checked_in
          await database.safeUpdate(resRef, { status: 'checked_in' }, { 
            hotelId: hotel.id, 
            module: 'Front Desk', 
            action: 'REVERT_CHECKOUT', 
            details: 'Reverting status to checked_in due to outstanding balance policy' 
          });
          return;
        }

        // Warning Popup Check
        if (!blockCheckout && outstandingBalance > 0.01) {
          if (hotel.settings?.checkout?.enableUnpaidWarningPopup) {
            const confirmOut = window.confirm(`WARNING: Guest has an outstanding balance of ${formatCurrency(outstandingBalance, currency, exchangeRate)}. Are you sure you want to proceed with checking them out?`);
            if (!confirmOut) {
              setLoading(false);
              // Revert status to checked_in
              await database.safeUpdate(resRef, { status: 'checked_in' }, { 
                hotelId: hotel.id, 
                module: 'Front Desk', 
                action: 'REVERT_CHECKOUT', 
                details: 'Reverting status to checked_in because user canceled unpaid checkout warning popup' 
              });
              return;
            }
          }
        }

        // 3. Update reservation total and checkout details
        await database.safeUpdate(resRef, { 
          totalAmount: totalDebits,
          nights: nightsStayed,
          checkOut: format(now, 'yyyy-MM-dd'),
          checkOutTime: format(now, 'HH:mm'),
          paymentStatus: (res.paidAmount || 0) >= totalDebits ? 'paid' : (res.paidAmount || 0) > 0 ? 'partial' : 'unpaid'
        }, {
          hotelId: hotel.id,
          module: 'Front Desk',
          action: 'FINALIZE_CHECKOUT',
          details: `Finalized checkout for reservation ${res.id}`
        });

        // 4. Mark room as dirty or clean based on sync settings
        const syncStatus = hotel.settings?.housekeeping?.autoSyncStatusAfterCheckout ?? true;
        const roomRef = doc(db, 'hotels', hotel.id, 'rooms', res.roomId);
        await database.safeUpdate(roomRef, { 
          status: syncStatus ? 'dirty' : 'clean',
          housekeepingStatus: syncStatus ? 'dirty' : 'clean',
          currentGuestId: null,
          currentReservationId: null
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'ROOM_VACATED',
          details: `Room ${res.roomNumber} vacated and marked ${syncStatus ? 'dirty' : 'clean'}`
        });

        // 5. Update Guest Profile Statistics
        if (res.guestId) {
          const guestRef = doc(db, 'hotels', hotel.id, 'guests', res.guestId);
          const nights = differenceInDays(parseISO(res.checkOut), parseISO(res.checkIn));
          await database.safeUpdate(guestRef, {
            totalNights: increment(nights),
            totalSpent: increment(totalDebits),
            stayHistory: arrayUnion({
              reservationId: res.id,
              roomNumber: res.roomNumber,
              checkIn: res.checkIn,
              checkOut: format(now, 'yyyy-MM-dd'),
              totalAmount: totalDebits
            })
          }, {
            hotelId: hotel.id,
            module: 'Guests',
            action: 'UPDATE_GUEST_STATS',
            details: `Updated stats for guest ${res.guestId} after stay`
          });
        }

        // 6. Calculate guest balance vs corporate balance from latest ledger entries to avoid double transfer/double-debiting
        const freshLedgerQ = query(
          collection(db, 'hotels', hotel.id, 'ledger'),
          where('reservationId', '==', res.id)
        );
        const freshLedgerSnap = await getDocs(freshLedgerQ);
        const freshEntries = freshLedgerSnap.docs.map(doc => doc.data() as LedgerEntry);
        
        const guestBalance = freshEntries
          .filter(e => !e.corporateId)
          .reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);

        if (res.corporateId && guestBalance > 0.01) {
          await transferToCityLedger(hotel.id, res.guestId!, res.id, guestBalance, profile.uid, res.corporateId);
          toast.success(`Individual guest balance of ${formatCurrency(guestBalance, currency, exchangeRate)} transferred to City Ledger.`);
        } else if (!res.corporateId && outstandingBalance > 0 && hotel.settings?.checkout?.autoMarkUnpaidAsDebt) {
          // If autoMarkUnpaidAsDebt is enabled, we could transfer to city ledger or just log it as debt
          // Let's use city ledger as it represents debt to the hotel
          await transferToCityLedger(hotel.id, res.guestId!, res.id, outstandingBalance, profile.uid);
          toast.success(`Balance of ${formatCurrency(outstandingBalance, currency, exchangeRate)} marked as Debt (Transferred to City Ledger).`);
        }

        if (outstandingBalance > 0.01 && hotel.settings?.checkout?.autoGenerateOutstandingInvoice) {
          toast.success(`Outstanding invoice generated and sent to guest email (${res.guestEmail || 'on file'}).`);
        }

        // 7. Schedule Post-Stay Automated Survey (24 hours after checkout)
        try {
          const checkOutStr = format(now, 'yyyy-MM-dd');
          const sendTime = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
          await addDoc(collection(db, 'hotels', hotel.id, 'surveys'), {
            reservationId: res.id,
            guestId: res.guestId || 'unknown_guest',
            guestName: res.guestName,
            guestEmail: res.guestEmail || `${res.guestName.toLowerCase().replace(/\s+/g, '')}@pms-demo.com`,
            roomNumber: res.roomNumber,
            checkoutDate: checkOutStr,
            status: 'scheduled',
            scheduledSendTime: sendTime
          });
          toast.info(`Automated post-stay survey scheduled for dispatch to ${res.guestName} in 24 hours.`);
        } catch (surveyErr) {
          console.error("Failed to automatically schedule post-stay survey:", surveyErr);
        }

        // Write to Check-Out History
        try {
          // Compute outstanding balance using fresh billing data
          const freshResSnapForHist = await getDoc(resRef);
          const freshData = freshResSnapForHist.data() || res;
          
          const checkoutHistoryRef = doc(db, 'hotels', hotel.id, 'checkout_history', res.id);
          await setDoc(checkoutHistoryRef, {
            id: res.id,
            reservationId: res.id,
            guestId: res.guestId || 'unknown_guest',
            guestName: res.guestName,
            guestEmail: res.guestEmail || '',
            guestPhone: res.guestPhone || '',
            roomNumber: res.roomNumber,
            roomId: res.roomId,
            checkIn: res.checkIn,
            checkOut: format(now, 'yyyy-MM-dd'),
            checkOutTime: format(now, 'HH:mm'),
            checkOutTimestamp: now.toISOString(),
            bookedBy: res.bookedBy || '',
            checkedOutBy: profile.email || 'System',
            status: 'checked_out',
            ledgerBalance: freshData.ledgerBalance || 0,
            totalAmount: totalDebits,
            paidAmount: freshData.paidAmount || 0,
            paymentStatus: (freshData.paidAmount || 0) >= totalDebits ? 'paid' : (freshData.paidAmount || 0) > 0 ? 'partial' : 'unpaid'
          });
        } catch (err) {
          console.error("Failed to write to checkout_history:", err);
        }
      } else if (status === 'cancelled' || status === 'no_show') {
        // Mark room as clean/vacant
        const roomRef = doc(db, 'hotels', hotel.id, 'rooms', res.roomId);
        await database.safeUpdate(roomRef, { status: 'clean' }, {
          hotelId: hotel.id,
          module: 'Rooms',
          action: 'ROOM_RELEASE',
          details: `Room ${res.roomNumber} released due to cancellation`
        });
      }

      // 3. Log action is handled by safeUpdate calls above
      toast.success(`Reservation status updated to ${status.replace('_', ' ')}`);
    } catch (err: any) {
      console.error("Update status error:", err.message || safeStringify(err));
      toast.error('Failed to update status');
    } finally {
      setLoading(false);
    }
  };

  const updatePayment = async (res: Reservation, amount: number) => {
    if (!hotel?.id || !profile) return;
    if (!hasPermission(profile, 'process_payments')) {
      toast.error('You do not have permission to process payments');
      return;
    }
    
    try {
      setLoading(true);
      // Use settleLedger to record payment and update guest balance
      // settleLedger also updates reservation.paidAmount and paymentStatus automatically
      if (res.guestId) {
        await settleLedger(
          hotel.id, 
          res.guestId, 
          res.id, 
          amount, 
          'cash', 
          profile.uid,
          res.corporateId
        );

        try {
          const freshResSnapForPay = await getDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id));
          if (freshResSnapForPay.exists()) {
            const freshData = freshResSnapForPay.data() as Reservation;
            if (freshData.status === 'checked_out') {
              const checkoutHistoryRef = doc(db, 'hotels', hotel.id, 'checkout_history', res.id);
              await setDoc(checkoutHistoryRef, {
                id: res.id,
                reservationId: res.id,
                guestId: res.guestId || 'unknown_guest',
                guestName: res.guestName,
                guestEmail: res.guestEmail || '',
                guestPhone: res.guestPhone || '',
                roomNumber: res.roomNumber,
                roomId: res.roomId,
                checkIn: res.checkIn,
                checkOut: freshData.checkOut || res.checkOut,
                checkOutTime: freshData.checkOutTime || '11:00',
                checkOutTimestamp: new Date().toISOString(),
                bookedBy: res.bookedBy || '',
                checkedOutBy: profile.email || 'System',
                status: 'checked_out',
                ledgerBalance: freshData.ledgerBalance || 0,
                totalAmount: freshData.totalAmount || res.totalAmount,
                paidAmount: freshData.paidAmount || 0,
                paymentStatus: freshData.paymentStatus || 'paid'
              }, { merge: true });
            }
          }
        } catch (syncErr) {
          console.error("Failed to sync checkout history after payment:", syncErr);
        }
      }

      // Log action handled by settleLedger internals
      toast.success('Payment recorded successfully');
    } catch (err: any) {
      console.error("Payment update error:", err.message || safeStringify(err));
      toast.error('Failed to record payment');
    } finally {
      setLoading(false);
    }
  };

  const transferRoom = async (res: Reservation, newRoomId: string) => {
    if (!hotel?.id || !profile) return;
    const newRoom = rooms.find(r => r.id === newRoomId);
    if (!newRoom) return;

    try {
      setLoading(true);
      
      // Calculate price difference if any
      const oldRoom = rooms.find(r => r.id === res.roomId);
      const oldRoomTypeId = oldRoom?.roomTypeId || roomTypes.find(t => t.name === oldRoom?.type)?.id;
      const newRoomTypeId = newRoom.roomTypeId || roomTypes.find(t => t.name === newRoom.type)?.id;
      
      const oldRoomType = roomTypes.find(t => t.id === oldRoomTypeId);
      const newRoomType = roomTypes.find(t => t.id === newRoomTypeId);
      
      let priceDifference = 0;
      if (oldRoomType && newRoomType && oldRoomType.id !== newRoomType.id) {
        // Calculate remaining nights
        const checkOutDate = new Date(res.checkOut);
        const today = new Date();
        const remainingNights = Math.max(1, Math.ceil((checkOutDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)));
        
        // Use negotiated rate if applicable, otherwise base price
        let newPrice = newRoomType.basePrice;
        if (res.corporateId) {
          const rate = activeCorporateRates.find(r => r.roomTypeId === newRoomType.id || r.roomType === newRoomType.name);
          if (rate) newPrice = rate.rate;
        }
        
        let oldPrice = oldRoomType.basePrice;
        if (res.corporateId) {
          const rate = activeCorporateRates.find(r => r.roomTypeId === oldRoomType.id || r.roomType === oldRoomType.name);
          if (rate) oldPrice = rate.rate;
        }

        priceDifference = (newPrice - oldPrice) * remainingNights;
      }

      // 1. Mark old room as dirty
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { 
        status: 'dirty',
        updatedAt: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'Rooms',
        action: 'UPDATE_ROOM_STATUS',
        details: `Marked room ${res.roomNumber} as dirty after transfer`
      });
      
      // 2. Mark new room as occupied
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'rooms', newRoomId), { 
        status: 'occupied',
        updatedAt: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'Rooms',
        action: 'UPDATE_ROOM_STATUS',
        details: `Marked room ${newRoom.roomNumber} as occupied after transfer`
      });

      // 3. Update reservation
      const newTotalAmount = (res.totalAmount || 0) + priceDifference;
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'reservations', res.id), {
        roomId: newRoomId,
        roomNumber: newRoom.roomNumber,
        totalAmount: newTotalAmount,
        updatedAt: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'Front Desk',
        action: 'ROOM_TRANSFER',
        details: `Transferred reservation ${res.id} to room ${newRoom.roomNumber}`
      });

      // 4. Post transfer note to ledger
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: Math.abs(priceDifference),
        type: priceDifference >= 0 ? 'debit' : 'credit',
        category: 'room',
        description: `Room Transfer: From ${res.roomNumber} to ${newRoom.roomNumber}${priceDifference !== 0 ? ` (Price Adj: ${formatCurrency(priceDifference, currency, exchangeRate)})` : ''}`,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid, res.corporateId);

      // 5. Log action is handled by safeUpdate/postToLedger internals
      toast.success(`Transferred to Room ${newRoom.roomNumber}`);
      setShowTransferModal(null);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/reservations/${res.id}`);
      toast.error('Failed to transfer room');
    } finally {
      setLoading(false);
    }
  };

  const postCharge = async () => {
    if (!hotel?.id || !profile || !showChargeModal) return;
    const res = showChargeModal;

    try {
      setLoading(true);
      
      // Calculate final amount after discount
      let discountAmount = 0;
      if (chargeDetails.discount > 0) {
        if (chargeDetails.discountType === 'percentage') {
          discountAmount = (chargeDetails.amount * chargeDetails.discount) / 100;
        } else {
          discountAmount = chargeDetails.discount;
        }
      }
      
      const finalAmount = chargeDetails.amount - discountAmount;

      // 1. Post the main charge
      await postToLedger(hotel.id, res.guestId || 'unknown', res.id, {
        amount: finalAmount,
        type: 'debit',
        category: chargeDetails.category,
        description: `${chargeDetails.description}${discountAmount > 0 ? ` (Discounted from ${formatCurrency(chargeDetails.amount, currency, exchangeRate)})` : ''}`,
        referenceId: res.id,
        postedBy: profile.uid
      }, profile.uid, res.corporateId);

      // 2. Log action is handled by postToLedger internals
      setShowChargeModal(null);
      setChargeDetails({ 
        amount: 0, 
        category: 'restaurant', 
        description: '',
        discount: 0,
        discountType: 'fixed'
      });
      toast.success('Charge posted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/ledger`);
      toast.error('Failed to post charge');
    } finally {
      setLoading(false);
    }
  };

  const handleExport = (type: 'rooms' | 'arrivals' | 'checkins' | 'checkouts' | 'inhouse') => {
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    let dataToExport: any[] = [];
    let filename = '';

    switch (type) {
      case 'rooms':
        dataToExport = rooms.map(r => ({
          Room: r.roomNumber,
          Type: r.type,
          Status: r.status,
          Floor: r.floor,
          Amenities: (r.amenities || []).join(', ')
        }));
        filename = `room_status_${todayStr}.csv`;
        break;
      case 'arrivals':
        dataToExport = reservations
          .filter(r => r.status === 'pending' && r.checkIn === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `arrivals_${todayStr}.csv`;
        break;
      case 'checkins':
        dataToExport = reservations
          .filter(r => r.status === 'checked_in' && r.checkIn === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `checkins_${todayStr}.csv`;
        break;
      case 'checkouts':
        dataToExport = reservations
          .filter(r => r.status === 'checked_out' && r.checkOut === todayStr)
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `checkouts_${todayStr}.csv`;
        break;
      case 'inhouse':
        dataToExport = reservations
          .filter(r => r.status === 'checked_in')
          .map(r => ({
            Guest: r.guestName,
            Room: r.roomNumber,
            CheckIn: r.checkIn,
            CheckOut: r.checkOut,
            Amount: r.totalAmount,
            Status: r.status
          }));
        filename = `inhouse_${todayStr}.csv`;
        break;
    }

    if (dataToExport.length === 0) {
      toast.error('No data to export for this category');
      return;
    }

    exportToCSV(dataToExport, filename);
    toast.success(`${type.charAt(0).toUpperCase() + type.slice(1)} exported successfully`);
  };

  const getCheckoutPreviewData = (res: Reservation) => {
    const billing = calculateBilling(res, hotel);
    const { checkOutDateTime, originalNights } = BillingService.calculateStayWindow(res, hotel);
    const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;
    
    const policy = hotel?.overstayPolicy || 'grace';
    const gracePeriodMinutes = hotel?.settings?.checkout?.gracePeriod ?? 0;
    
    const currentTime = new Date();
    const minutesPast = Math.max(0, (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60));
    const hoursPast = minutesPast / 60;
    
    const isLateCheckout = minutesPast > gracePeriodMinutes;
    const overstayCharge = billing.overstayCharge || 0;
    
    return {
      billing,
      checkOutDateTime,
      originalNights,
      nightlyRate,
      policy,
      gracePeriodMinutes,
      currentTime,
      minutesPast,
      hoursPast,
      isLateCheckout,
      overstayCharge,
    };
  };

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 tracking-tight">Front Desk</h1>
          <p className="text-xs sm:text-sm text-zinc-500">Manage bookings and guest check-ins</p>
        </div>
        <div className="flex items-center gap-3">
          {(hotel?.settings?.reporting?.allowExports ?? true) && (
            <div className="relative group">
              <button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95">
                <Download size={18} />
                Export
              </button>
              <div className="absolute right-0 mt-2 w-48 bg-zinc-900 border border-zinc-800 rounded-xl shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all z-50 overflow-hidden">
                <button onClick={() => handleExport('rooms')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">Room Status</button>
                <button onClick={() => handleExport('arrivals')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">Today's Arrivals</button>
                <button onClick={() => handleExport('checkins')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">Today's Check-ins</button>
                <button onClick={() => handleExport('checkouts')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">Today's Check-outs</button>
                <button onClick={() => handleExport('inhouse')} className="w-full text-left px-4 py-2 text-sm text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50 transition-colors">In-House Guests</button>
              </div>
            </div>
          )}
          <button 
            onClick={() => setShowNightAuditModal(true)}
            disabled={isAuditing}
            className="p-2 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Run Nightly Audit"
          >
            <RefreshCw size={18} className={cn(isAuditing && "animate-spin")} />
          </button>
          {(hotel?.settings?.reservations?.allowWalkIn ?? true) && (
            <>
              <button 
                onClick={() => {
                  setNewBooking({
                    guestName: '',
                    guestEmail: '',
                    guestPhone: '',
                    idType: '',
                    idNumber: '',
                    address: '',
                    roomId: '',
                    checkIn: format(new Date(), 'yyyy-MM-dd'),
                    checkInTime: hotel?.defaultCheckInTime || '14:00',
                    checkOut: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
                    checkOutTime: hotel?.defaultCheckOutTime || '12:00',
                    guestType: 'corporate',
                    corporateId: '',
                    guestId: '',
                    totalAmount: 0,
                    paidAmount: 0,
                    paymentStatus: 'unpaid' as const,
                    notes: '',
                    corporateReference: '',
                    discountAmount: 0,
                    discountType: 'fixed',
                    discountReason: '',
                    taxAmount: 0,
                    taxDetails: [],
                    initialPayment: 0,
                    paymentMethod: 'cash',
                    payments: [{ amount: 0, method: 'cash' }],
                    autoNightDeduction: true,
                    additionalStays: [] as any[],
                  });
                  setIsBooking(true);
                }}
                className="hidden sm:flex bg-zinc-900 border border-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold items-center justify-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
              >
                <Building2 size={18} className="text-emerald-500" />
                Corporate Booking
              </button>
              <button 
                onClick={() => {
                  setNewBooking({
                    guestName: '',
                    guestEmail: '',
                    guestPhone: '',
                    idType: '',
                    idNumber: '',
                    address: '',
                    roomId: '',
                    checkIn: format(new Date(), 'yyyy-MM-dd'),
                    checkInTime: hotel?.defaultCheckInTime || '14:00',
                    checkOut: format(addDays(new Date(), 1), 'yyyy-MM-dd'),
                    checkOutTime: hotel?.defaultCheckOutTime || '12:00',
                    guestType: 'individual',
                    corporateId: '',
                    guestId: '',
                    totalAmount: 0,
                    paidAmount: 0,
                    paymentStatus: 'unpaid' as const,
                    notes: '',
                    corporateReference: '',
                    discountAmount: 0,
                    discountType: 'fixed',
                    discountReason: '',
                    taxAmount: 0,
                    taxDetails: [],
                    initialPayment: 0,
                    paymentMethod: 'cash',
                    payments: [{ amount: 0, method: 'cash' }],
                    autoNightDeduction: true,
                    additionalStays: [] as any[]
                  });
                  setIsBooking(true);
                }}
                className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
              >
                <Plus size={18} />
                New Booking
              </button>
            </>
          )}
        </div>
      </header>

      {/* Room Status Legend */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl">
          <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider mb-1">Total Rooms</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50">{roomStats.total}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl">
          <div className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider mb-1">Available</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50">{roomStats.available}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl">
          <div className="text-[9px] font-bold text-blue-500 uppercase tracking-wider mb-1">Occupied</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50">{roomStats.occupied}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl">
          <div className="text-[9px] font-bold text-amber-500 uppercase tracking-wider mb-1">Dirty</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50">{roomStats.dirty}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl">
          <div className="text-[9px] font-bold text-red-500 uppercase tracking-wider mb-1">Maintenance</div>
          <div className="text-lg sm:text-xl font-bold text-zinc-50">{roomStats.maintenance}</div>
        </div>
      </div>

      {/* Alerts Section */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {reservations.filter(r => {
          if (r.status !== 'checked_in') return false;
          const today = format(new Date(), 'yyyy-MM-dd');
          return r.checkOut < today;
        }).length > 0 && (
          <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-xl flex items-center gap-4">
            <div className="w-10 h-10 bg-red-500/20 rounded-full flex items-center justify-center text-red-500">
              <AlertCircle size={20} />
            </div>
            <div>
              <div className="text-xs font-bold text-red-500 uppercase tracking-wider">Overstay Alert</div>
              <div className="text-lg font-bold text-zinc-50">
                {reservations.filter(r => r.status === 'checked_in' && r.checkOut < format(new Date(), 'yyyy-MM-dd')).length} Guests
              </div>
            </div>
          </div>
        )}

        {reservations.filter(r => {
          if (r.status !== 'checked_in' || !r.guestId) return false;
          const guest = guests.find(g => g.id === r.guestId);
          return guest && guest.ledgerBalance > 0;
        }).length > 0 && (
          <div className="bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl flex items-center gap-4">
            <div className="w-10 h-10 bg-amber-500/20 rounded-full flex items-center justify-center text-amber-500">
              <DollarSign size={20} />
            </div>
            <div>
              <div className="text-xs font-bold text-amber-500 uppercase tracking-wider">Outstanding Payments</div>
              <div className="text-lg font-bold text-zinc-50">
                {reservations.filter(r => {
                  if (r.status !== 'checked_in' || !r.guestId) return false;
                  const guest = guests.find(g => g.id === r.guestId);
                  return guest && guest.ledgerBalance > 0;
                }).length} Guests Owing
              </div>
            </div>
          </div>
        )}

        {reservations.filter(r => {
          if (r.status !== 'checked_in' || !r.guestId) return false;
          const guest = guests.find(g => g.id === r.guestId);
          const rate = r.nightlyRate || (r.totalAmount / (r.nights || 1)) || 0;
          // Low balance = credit is less than one night's rate
          return guest && guest.ledgerBalance < 0 && Math.abs(guest.ledgerBalance) <= rate;
        }).length > 0 && (
          <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-xl flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-500/20 rounded-full flex items-center justify-center text-blue-500">
              <Clock size={20} />
            </div>
            <div>
              <div className="text-xs font-bold text-blue-500 uppercase tracking-wider">Low Balance Warning</div>
              <div className="text-lg font-bold text-zinc-50">
                {reservations.filter(r => {
                  if (r.status !== 'checked_in' || !r.guestId) return false;
                  const guest = guests.find(g => g.id === r.guestId);
                  const rate = r.nightlyRate || (r.totalAmount / (r.nights || 1)) || 0;
                  return guest && guest.ledgerBalance < 0 && Math.abs(guest.ledgerBalance) <= rate;
                }).length} Guests
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Night Audit Modal */}
      {showNightAuditModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md text-center"
          >
            <div className="w-16 h-16 bg-emerald-500/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <RefreshCw size={32} className={cn("text-emerald-500", isAuditing && "animate-spin")} />
            </div>
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Run Nightly Audit</h3>
            <p className="text-zinc-400 text-sm mb-8">
              This will post nightly room charges for all {reservations.filter(r => r.status === 'checked_in').length} checked-in guests for the current date.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowNightAuditModal(false)}
                disabled={isAuditing}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={runNightlyAudit}
                disabled={isAuditing}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isAuditing ? (
                  <>
                    <RefreshCw size={18} className="animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Run Audit'
                )}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {isBooking && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-2xl flex flex-col max-h-[90vh] shadow-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800">
              <h3 className="text-xl font-bold text-zinc-50">New Reservation</h3>
            </div>
            <div className="flex-1 overflow-y-auto p-6 space-y-6 custom-scrollbar">
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Booking Type</label>
                  <div className="flex bg-zinc-950 border border-zinc-800 rounded-lg p-1">
                    <button 
                      onClick={() => setNewBooking({ ...newBooking, guestType: 'individual', corporateId: '' })}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
                        newBooking.guestType === 'individual' ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <User size={14} /> Individual
                    </button>
                    <button 
                      onClick={() => setNewBooking({ ...newBooking, guestType: 'corporate' })}
                      className={cn(
                        "flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-xs font-bold transition-all",
                        newBooking.guestType === 'corporate' ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-zinc-300"
                      )}
                    >
                      <Building2 size={14} /> Corporate
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">
                    {newBooking.guestType === 'corporate' ? 'Corporate Account (Required)' : 'Corporate Account (Optional)'}
                  </label>
                  {corporateAccounts.length > 0 ? (
                    <select 
                      className={cn(
                        "w-full bg-zinc-950 border rounded-lg px-4 py-2 text-zinc-50 outline-none transition-all",
                        newBooking.guestType === 'corporate' && !newBooking.corporateId ? "border-amber-500/50" : "border-zinc-800 focus:border-emerald-500"
                      )}
                      value={newBooking.corporateId}
                      onChange={(e) => setNewBooking({ ...newBooking, corporateId: e.target.value })}
                    >
                      <option value="">{newBooking.guestType === 'corporate' ? 'Select Account' : 'None / Individual'}</option>
                      {corporateAccounts.map(acc => (
                        <option key={acc.id} value={acc.id}>{acc.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-[10px] text-amber-500 bg-amber-500/10 p-2 rounded border border-amber-500/20 flex items-center gap-2">
                      <AlertCircle size={12} />
                      No corporate accounts found
                    </div>
                  )}
                </div>
              </div>

              {newBooking.guestType === 'corporate' && (
                <motion.div 
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-xl space-y-4"
                >
                  <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase tracking-wider">
                    <Building2 size={14} />
                    Corporate Details
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Corporate Reference / PO Number</label>
                    <input 
                      type="text" 
                      placeholder="e.g. PO-12345 or Project Name"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={newBooking.corporateReference}
                      onChange={(e) => setNewBooking({ ...newBooking, corporateReference: e.target.value })}
                    />
                  </div>
                </motion.div>
              )}

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Select Existing Guest</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={newBooking.guestId}
                  onChange={(e) => {
                    const guest = guests.find(g => g.id === e.target.value);
                    if (guest) {
                      setNewBooking({
                        ...newBooking,
                        guestId: guest.id,
                        guestName: guest.name,
                        guestEmail: guest.email,
                        guestPhone: guest.phone,
                        idType: guest.idType || '',
                        idNumber: guest.idNumber || '',
                        address: guest.address || '',
                        corporateId: guest.corporateId || newBooking.corporateId,
                        guestType: guest.corporateId ? 'corporate' : newBooking.guestType
                      });
                    } else {
                      setNewBooking({ ...newBooking, guestId: '', guestName: '', guestEmail: '', guestPhone: '', idType: '', idNumber: '', address: '' });
                    }
                  }}
                >
                  <option value="">New Guest</option>
                  {guests.map(g => {
                    const guestRes = reservations.filter(r => r.guestId === g.id || (g.email && r.guestEmail === g.email));
                    const completedCount = guestRes.filter(r => r.status === 'checked_out').length;
                    const activeCount = guestRes.filter(r => r.status === 'checked_in').length;
                    const staysCount = completedCount + activeCount;
                    return (
                      <option key={g.id} value={g.id}>
                        {g.name} ({g.phone || 'No phone'}) — {staysCount} {staysCount === 1 ? 'visit' : 'visits'} — Bal: {formatCurrency(g.ledgerBalance || 0, currency, exchangeRate)}
                      </option>
                    );
                  })}
                </select>
                {newBooking.guestId && (() => {
                  const guestBal = guests.find(g => g.id === newBooking.guestId)?.ledgerBalance || 0;
                  if (guestBal === 0) return null;
                  const isDebit = guestBal > 0.01;
                  return (
                    <div className={cn(
                      "mt-2 p-2 rounded border flex items-center gap-2 text-[10px]",
                      isDebit ? "bg-red-500/10 border-red-500/20 text-red-500" : "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                    )}>
                      <AlertCircle size={12} />
                      Guest has an {isDebit ? 'outstanding balance' : 'overpayment credit'} of {formatCurrency(Math.abs(guestBal), currency, exchangeRate)}
                    </div>
                  );
                })()}
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Guest Name</label>
                  <input 
                    required
                    type="text" 
                    placeholder="e.g. John Doe"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.guestName}
                    onChange={(e) => setNewBooking({ ...newBooking, guestName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.guestPhone}
                    onChange={(e) => setNewBooking({ ...newBooking, guestPhone: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.guestEmail}
                    onChange={(e) => setNewBooking({ ...newBooking, guestEmail: e.target.value })}
                  />
                </div>
              </div>

              {/* Returning Guest Auto-Detection Banner */}
              {(() => {
                if (newBooking.guestId) return null;
                const normalizedEmail = newBooking.guestEmail?.trim().toLowerCase();
                const normalizedPhone = newBooking.guestPhone?.trim();
                const normalizedName = newBooking.guestName?.trim().toLowerCase();

                if (!normalizedEmail && !normalizedPhone && !normalizedName) return null;

                const match = guests.find(g => {
                  if (normalizedEmail && g.email && g.email.trim().toLowerCase() === normalizedEmail) return true;
                  if (normalizedPhone && g.phone && g.phone.trim() === normalizedPhone) return true;
                  // Look for name match but only if they have typed at least 3 characters
                  if (normalizedName && normalizedName.length >= 3 && g.name && g.name.trim().toLowerCase() === normalizedName) return true;
                  return false;
                });

                if (!match) return null;

                const guestRes = reservations.filter(r => r.guestId === match.id || (match.email && r.guestEmail === match.email));
                const completedCount = guestRes.filter(r => r.status === 'checked_out').length;
                const activeCount = guestRes.filter(r => r.status === 'checked_in').length;
                const staysCount = completedCount + activeCount;

                return (
                  <motion.div 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-3.5 bg-amber-500/10 border border-amber-500/20 text-amber-200 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="p-1.5 bg-amber-500/20 rounded-lg text-amber-400 mt-0.5 sm:mt-0">
                        <Users size={16} />
                      </div>
                      <div>
                        <p className="font-semibold text-amber-300">Returning Guest Detected ({staysCount} previous {staysCount === 1 ? 'visit' : 'visits'})</p>
                        <p className="text-zinc-400 mt-0.5">
                          We found an existing profile for <span className="text-white font-medium">{match.name}</span> ({match.email || match.phone || 'No contact'}). Match level is high.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setNewBooking({
                          ...newBooking,
                          guestId: match.id,
                          guestName: match.name,
                          guestEmail: match.email || '',
                          guestPhone: match.phone || '',
                          idType: match.idType || '',
                          idNumber: match.idNumber || '',
                          address: match.address || '',
                          corporateId: match.corporateId || newBooking.corporateId,
                          guestType: match.corporateId ? 'corporate' : newBooking.guestType
                        });
                        toast.success(`Matched to returning guest: ${match.name}`);
                      }}
                      className="shrink-0 bg-amber-500 hover:bg-amber-600 active:scale-95 text-black px-3.5 py-1.5 rounded-lg font-bold text-[10px] uppercase tracking-wide transition-all self-end sm:self-center cursor-pointer"
                    >
                      Use Profile
                    </button>
                  </motion.div>
                );
              })()}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">ID Type</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.idType}
                    onChange={(e) => setNewBooking({ ...newBooking, idType: e.target.value })}
                  >
                    <option value="">Select ID Type</option>
                    <option value="National ID">National ID</option>
                    <option value="Passport">Passport</option>
                    <option value="Drivers License">Drivers License</option>
                    <option value="Voters Card">Voters Card</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">ID Number</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.idNumber}
                    onChange={(e) => setNewBooking({ ...newBooking, idNumber: e.target.value })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Address</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-16"
                  value={newBooking.address}
                  onChange={(e) => setNewBooking({ ...newBooking, address: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.roomId}
                    onChange={(e) => {
                      setNewBooking({ ...newBooking, roomId: e.target.value });
                    }}
                  >
                    <option value="">Select a room</option>
                    {rooms.filter(r => 
                      isRoomAvailable(r.id, newBooking.checkIn, newBooking.checkOut, reservations, roomBlockings, hotel) || r.id === newBooking.roomId
                    ).map(room => {
                      let displayPrice = room.price;
                      let isNegotiated = false;

                      if (newBooking.corporateId) {
                        const activeRate = activeCorporateRates.find(r => 
                          (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
                          new Date(newBooking.checkIn) >= new Date(r.startDate) &&
                          new Date(newBooking.checkIn) <= new Date(r.endDate)
                        );
                        if (activeRate) {
                          displayPrice = activeRate.rate;
                          isNegotiated = true;
                        }
                      }

                      return (
                        <option key={room.id} value={room.id}>
                          Room {room.roomNumber} ({room.type} - {formatCurrency(displayPrice, currency, exchangeRate)}{isNegotiated ? ' [Negotiated]' : ''})
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div className="flex flex-col justify-end">
                  {newBooking.roomId && (() => {
                    const room = rooms.find(r => r.id === newBooking.roomId);
                    if (!room) return null;
                    
                    let displayPrice = room.price;
                    if (newBooking.corporateId) {
                      const activeRate = activeCorporateRates.find(r => 
                        (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
                        new Date(newBooking.checkIn) >= new Date(r.startDate) &&
                        new Date(newBooking.checkIn) <= new Date(r.endDate)
                      );
                      if (activeRate) displayPrice = activeRate.rate;
                    }

                    const activeTaxes = (hotel?.taxes || []).filter(t => {
                      const status = (t.status || '').toLowerCase().trim();
                      const category = (t.category || '').toLowerCase().trim();
                      return status === 'active' && category !== 'restaurant';
                    });
                    const inclusiveTaxes = activeTaxes.filter(t => t.isInclusive);
                    const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
                    
                    const totalInclusivePercentage = inclusiveTaxes.reduce((acc, t) => acc + t.percentage, 0);
                    const baseAmount = displayPrice;
                    const totalInclusiveTax = inclusiveTaxes.reduce((acc, t) => acc + (baseAmount * (t.percentage / 100)), 0);
                    const totalExclusiveTax = exclusiveTaxes.reduce((acc, t) => acc + (baseAmount * (t.percentage / 100)), 0);

                    return (
                      <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                        {/* Room Specific Info */}
                        {(room.notes || (room.amenities && room.amenities.length > 0)) && (
                          <div className="pb-2 border-b border-zinc-800 space-y-2">
                            {room.notes && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1 text-[8px] font-bold text-amber-500 uppercase tracking-widest">
                                  <FileText size={10} /> Room Notes
                                </div>
                                <p className="text-[10px] text-zinc-400 italic font-medium leading-tight">
                                  {room.notes}
                                </p>
                              </div>
                            )}
                            {room.amenities && room.amenities.length > 0 && (
                              <div className="space-y-1">
                                <div className="flex items-center gap-1 text-[8px] font-bold text-zinc-500 uppercase tracking-widest">
                                  <Zap size={10} /> Amenities
                                </div>
                                <div className="flex flex-wrap gap-1">
                                  {room.amenities.map(a => (
                                    <span key={a} className="text-[8px] px-1 bg-zinc-900 border border-zinc-800 rounded text-zinc-500">{a}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex justify-between text-[10px] font-bold pt-1">
                          <span className="text-zinc-500 uppercase">Base Rate</span>
                          <span className="text-zinc-50">{formatCurrency(baseAmount, currency, exchangeRate)}</span>
                        </div>
                        {inclusiveTaxes.map(tax => (
                          <div key={tax.id} className="flex justify-between text-[10px] font-bold">
                            <span className="text-blue-400/80 uppercase">{tax.name} ({tax.percentage}%) [Incl.]</span>
                            <span className="text-blue-500">{formatCurrency(baseAmount * (tax.percentage / 100), currency, exchangeRate)}</span>
                          </div>
                        ))}
                        {exclusiveTaxes.map(tax => (
                          <div key={tax.id} className="flex justify-between text-[10px] font-bold">
                            <span className="text-emerald-400/80 uppercase">{tax.name} ({tax.percentage}%)</span>
                            <span className="text-emerald-500">+{formatCurrency(baseAmount * (tax.percentage / 100), currency, exchangeRate)}</span>
                          </div>
                        ))}
                        <div className="pt-1 border-t border-zinc-800 flex justify-between text-xs font-bold">
                          <span className="text-zinc-500 uppercase">Total/Night</span>
                          <span className="text-zinc-50">{formatCurrency(baseAmount + totalExclusiveTax, currency, exchangeRate)}</span>
                        </div>
                      </div>
                    );
                  })()}
                </div>

                {newBooking.roomId && (() => {
                  const room = rooms.find(r => r.id === newBooking.roomId);
                  if (!room) return null;
                  const config = rateConfigs.find(rc => rc.roomTypeId === room.roomTypeId);
                  
                  const basePriceVal = config?.baseRate || room.price;
                  const weekendPriceVal = config?.weekendRate || 0;
                  const weekdayPriceVal = config?.weekdayRate || 0;

                  return (
                    <div className="col-span-2 space-y-2 mt-2">
                      <label className="block text-xs font-semibold text-zinc-500 uppercase">
                        Select Rate Option
                      </label>
                      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRateType('auto');
                          }}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-18",
                            selectedRateType === 'auto'
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                          )}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Auto (Dynamic)</span>
                          <span className="text-xs font-semibold text-zinc-200 mt-1">System Managed</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRateType('base');
                          }}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-18",
                            selectedRateType === 'base'
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                          )}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Base Rate</span>
                          <span className="text-sm font-bold text-zinc-50 mt-1">{formatCurrency(basePriceVal, currency, exchangeRate)}</span>
                        </button>
                        {weekendPriceVal > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRateType('weekend');
                            }}
                            className={cn(
                              "p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-18",
                              selectedRateType === 'weekend'
                                ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                            )}
                          >
                            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Weekend Rate</span>
                            <span className="text-sm font-bold text-zinc-50 mt-1">{formatCurrency(weekendPriceVal, currency, exchangeRate)}</span>
                          </button>
                        )}
                        {weekdayPriceVal > 0 && (
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedRateType('weekday');
                            }}
                            className={cn(
                              "p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-18",
                              selectedRateType === 'weekday'
                                ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                                : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                            )}
                          >
                            <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Weekday Rate</span>
                            <span className="text-sm font-bold text-zinc-50 mt-1">{formatCurrency(weekdayPriceVal, currency, exchangeRate)}</span>
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedRateType('custom');
                            if (customRateAmount === 0) setCustomRateAmount(basePriceVal);
                          }}
                          className={cn(
                            "p-2.5 rounded-xl border text-left transition-all flex flex-col justify-between h-18",
                            selectedRateType === 'custom'
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                          )}
                        >
                          <span className="text-[9px] font-bold uppercase tracking-wider text-zinc-500">Custom Rate</span>
                          <span className="text-xs font-semibold text-zinc-200 mt-1">Manual Override</span>
                        </button>
                      </div>

                      {selectedRateType === 'custom' && (
                        <div className="mt-2 flex items-center gap-2 max-w-xs animate-in fade-in slide-in-from-top-1 duration-200">
                          <span className="text-xs font-semibold text-zinc-500 uppercase">Rate:</span>
                          <input
                            type="number"
                            min="0"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                            value={customRateAmount}
                            onChange={(e) => setCustomRateAmount(Number(e.target.value))}
                          />
                        </div>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="p-4 bg-zinc-900/50 border border-zinc-800 rounded-xl space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-sm font-bold text-white">Auto Night Deduction</h4>
                    <p className="text-[10px] text-zinc-500">Automatically charge room rate every night at midnight</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setNewBooking({ ...newBooking, autoNightDeduction: !newBooking.autoNightDeduction })}
                    className={cn(
                      "w-12 h-6 rounded-full transition-all relative",
                      newBooking.autoNightDeduction ? "bg-emerald-500" : "bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "absolute top-1 w-4 h-4 bg-white rounded-full transition-all",
                      newBooking.autoNightDeduction ? "right-1" : "left-1"
                    )} />
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1 min-w-0">
                      <input 
                        type="date" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-4 pr-10 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                        style={{ colorScheme: 'dark' }}
                        value={newBooking.checkIn}
                        min={profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin' ? undefined : format(new Date(), 'yyyy-MM-dd')}
                        onChange={(e) => setNewBooking({ ...newBooking, checkIn: e.target.value })}
                      />
                      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                    </div>
                    <input 
                      type="time"
                      className="w-full sm:w-24 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      style={{ colorScheme: 'dark' }}
                      value={newBooking.checkInTime}
                      onChange={(e) => setNewBooking({ ...newBooking, checkInTime: e.target.value })}
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1 min-w-0">
                      <input 
                        type="date" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-4 pr-10 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                        style={{ colorScheme: 'dark' }}
                        value={newBooking.checkOut}
                        min={newBooking.checkIn}
                        onChange={(e) => setNewBooking({ ...newBooking, checkOut: e.target.value })}
                      />
                      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                    </div>
                    <input 
                      type="time"
                      className="w-full sm:w-24 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      style={{ colorScheme: 'dark' }}
                      value={newBooking.checkOutTime}
                      onChange={(e) => setNewBooking({ ...newBooking, checkOutTime: e.target.value })}
                    />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                />
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-4">
                <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase tracking-wider">
                  <Tag size={14} />
                  Discount (Optional)
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Amount</label>
                    <input 
                      type="number" 
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:border-emerald-500 outline-none"
                      value={newBooking.discountType === 'fixed' && currency === 'USD' ? (newBooking.discountAmount / exchangeRate) || '' : newBooking.discountAmount || ''}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setNewBooking({ 
                          ...newBooking, 
                          discountAmount: newBooking.discountType === 'fixed' && currency === 'USD' ? val * exchangeRate : val 
                        });
                      }}
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Type</label>
                    <select 
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:border-emerald-500 outline-none"
                      value={newBooking.discountType}
                      onChange={(e) => setNewBooking({ ...newBooking, discountType: e.target.value as 'fixed' | 'percentage' })}
                    >
                      <option value="fixed">Fixed ({currency})</option>
                      <option value="percentage">Percentage (%)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-zinc-500 uppercase mb-1">Reason</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Management Approval"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newBooking.discountReason}
                    onChange={(e) => setNewBooking({ ...newBooking, discountReason: e.target.value })}
                  />
                </div>
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-blue-500 font-bold text-xs uppercase tracking-wider">
                    <DollarSign size={14} />
                    Initial Payment (Optional)
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setNewBooking({
                        ...newBooking,
                        payments: [...newBooking.payments, { amount: 0, method: 'cash' }]
                      });
                    }}
                    className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase"
                  >
                    <Plus size={12} /> Add Split
                  </button>
                </div>

                <div className="space-y-3">
                  {newBooking.payments.map((pay: any, index: number) => (
                    <div key={index} className="grid grid-cols-2 gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-xl relative group">
                      {newBooking.payments.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const updated = [...newBooking.payments];
                            updated.splice(index, 1);
                            setNewBooking({ ...newBooking, payments: updated });
                          }}
                          className="absolute -top-1 -right-1 w-5 h-5 bg-zinc-800 text-zinc-500 hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border border-zinc-700"
                        >
                          <X size={10} />
                        </button>
                      )}
                      <div>
                        <label className="block text-[9px] font-semibold text-zinc-500 uppercase mb-1">Amount</label>
                        <input 
                          type="number" 
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                          value={currency === 'USD' ? (pay.amount / exchangeRate) || '' : pay.amount || ''}
                          onChange={(e) => {
                            const val = Number(e.target.value);
                            const updated = [...newBooking.payments];
                            updated[index].amount = currency === 'USD' ? val * exchangeRate : val;
                            setNewBooking({ ...newBooking, payments: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-[9px] font-semibold text-zinc-500 uppercase mb-1">Method</label>
                        <select 
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                          value={pay.method}
                          onChange={(e) => {
                            const updated = [...newBooking.payments];
                            updated[index].method = e.target.value as any;
                            setNewBooking({ ...newBooking, payments: updated });
                          }}
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="transfer">Transfer</option>
                        </select>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="p-4 bg-zinc-950 rounded-xl border border-zinc-800 space-y-2">
                <div className="flex justify-between text-xs text-zinc-500 uppercase font-bold">
                  <span>Summary</span>
                  <span>Amount</span>
                </div>
                {newBooking.guestType === 'corporate' && newBooking.additionalStays.length > 0 && (
                  <div className="text-[10px] text-zinc-500 border-b border-zinc-800 pb-2 mb-2">
                    {newBooking.additionalStays.length + 1} Guests Total
                  </div>
                )}
                {isNegotiatedRate && (
                  <div className="flex justify-between text-[10px] text-emerald-500 font-bold uppercase">
                    <span>Rate Type</span>
                    <span className="flex items-center gap-1"><Tag size={10} /> Negotiated</span>
                  </div>
                )}
                {(() => {
                  const allTaxDetails: { [name: string]: { amount: number; percentage: number; isInclusive: boolean } } = {};
                  let totalInclusiveAmount = 0;
                  
                  // Primary stay taxes
                  (newBooking.taxDetails || []).forEach(tax => {
                    if (!allTaxDetails[tax.name]) {
                      allTaxDetails[tax.name] = { amount: 0, percentage: tax.percentage, isInclusive: tax.isInclusive };
                    }
                    allTaxDetails[tax.name].amount += tax.amount;
                  });

                  // Additional stays taxes
                  (newBooking.additionalStays || []).forEach(stay => {
                    (stay.taxDetails || []).forEach((tax: any) => {
                      if (!allTaxDetails[tax.name]) {
                        allTaxDetails[tax.name] = { amount: 0, percentage: tax.percentage, isInclusive: tax.isInclusive };
                      }
                      allTaxDetails[tax.name].amount += tax.amount;
                    });
                  });

                  const checkInDateTime = parseLocalDateTime(newBooking.checkIn, newBooking.checkInTime || '14:00');
                  const checkOutDateTime = parseLocalDateTime(newBooking.checkOut, newBooking.checkOutTime || '12:00');
                  const hours = (checkOutDateTime.getTime() - checkInDateTime.getTime()) / (1000 * 60 * 60);
                  const nightsCount = Math.max(1, Math.ceil(hours / 24));

                  const primaryBaseAmount = newBooking.roomId ? (rooms.find(r => r.id === newBooking.roomId)?.price || 0) * nightsCount : 0;
                  const additionalBaseAmount = (newBooking.additionalStays || []).reduce((acc, s) => acc + (s.totalAmount || 0), 0);
                  const subtotalBase = primaryBaseAmount + additionalBaseAmount;

                  return (
                    <>
                      <div className="flex justify-between text-[10px] text-zinc-400">
                        <span>Base Rate (Subtotal)</span>
                        <span>{formatCurrency(subtotalBase, currency, exchangeRate)}</span>
                      </div>
                      {Object.entries(allTaxDetails).map(([name, details], idx) => (
                        <div key={idx} className="flex justify-between text-[10px] text-zinc-500">
                          <span className={details.isInclusive ? 'text-blue-400/80' : 'text-emerald-400/80'}>
                            {name} ({details.percentage}%) {details.isInclusive ? '(Incl.)' : ''}
                          </span>
                          <span className={details.isInclusive ? '' : 'text-emerald-500'}>
                            {details.isInclusive ? '' : '+'}{formatCurrency(details.amount, currency, exchangeRate)}
                          </span>
                        </div>
                      ))}
                    </>
                  );
                })()}
                {newBooking.discountAmount > 0 && (
                  <div className="flex justify-between text-[10px] text-red-500">
                    <span>Discount ({newBooking.discountType === 'percentage' ? newBooking.discountAmount + '%' : 'Fixed'})</span>
                    <span>-{formatCurrency(newBooking.discountType === 'percentage' ? (newBooking.totalAmount * newBooking.discountAmount) / 100 : newBooking.discountAmount, currency, exchangeRate)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm text-zinc-50 border-t border-zinc-800 pt-2 mt-2">
                  <span>Grand Total</span>
                  <span className="font-bold text-emerald-500">
                    {formatCurrency(
                      newBooking.totalAmount - (newBooking.discountType === 'percentage' ? (newBooking.totalAmount * newBooking.discountAmount) / 100 : newBooking.discountAmount), 
                      currency, 
                      exchangeRate
                    )}
                  </span>
                </div>
                {(() => {
                  const totalPaid = newBooking.payments?.reduce((acc: number, p: any) => acc + (p.amount || 0), 0) || 0;
                  return totalPaid > 0 ? (
                    <div className="flex justify-between text-[10px] text-blue-400">
                      <span>Initial Payment</span>
                      <span>-{formatCurrency(totalPaid, currency, exchangeRate)}</span>
                    </div>
                  ) : null;
                })()}
                <div className="flex justify-between text-xs font-bold text-zinc-50 pt-1">
                  <span>Balance Due</span>
                  <span className="text-red-500">
                    {formatCurrency(
                      Math.max(0, (newBooking.totalAmount - (newBooking.discountType === 'percentage' ? (newBooking.totalAmount * newBooking.discountAmount) / 100 : newBooking.discountAmount)) - (newBooking.payments?.reduce((acc: number, p: any) => acc + (p.amount || 0), 0) || 0)),
                      currency,
                      exchangeRate
                    )}
                  </span>
                </div>
              </div>

              {newBooking.guestType === 'corporate' && (
                <div className="space-y-4 pt-4 border-t border-zinc-800">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-zinc-50">Additional Guests</h4>
                    <button 
                      onClick={() => {
                        const id = Math.random().toString(36).substr(2, 9);
                        setNewBooking({
                          ...newBooking,
                          additionalStays: [
                            ...newBooking.additionalStays,
                            {
                              id,
                              guestName: '',
                              guestEmail: '',
                              guestPhone: '',
                              idType: '',
                              idNumber: '',
                              address: '',
                              roomId: '',
                              checkIn: newBooking.checkIn,
                              checkOut: newBooking.checkOut,
                              totalAmount: 0
                            }
                          ]
                        });
                      }}
                      className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider flex items-center gap-1 hover:text-emerald-400"
                    >
                      <Plus size={12} /> Add Guest
                    </button>
                  </div>

                  {newBooking.additionalStays.map((stay, index) => (
                    <div key={stay.id} className="p-6 bg-zinc-950 border border-zinc-800 rounded-2xl space-y-6 relative">
                      <button 
                        onClick={() => {
                          setNewBooking({
                            ...newBooking,
                            additionalStays: newBooking.additionalStays.filter(s => s.id !== stay.id)
                          });
                        }}
                        className="absolute top-4 right-4 text-zinc-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                      
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Guest Name</label>
                          <input 
                            type="text" 
                            placeholder="e.g. Jane Doe"
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={stay.guestName}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].guestName = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Phone Number</label>
                          <input 
                            type="tel" 
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={stay.guestPhone}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].guestPhone = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                          <input 
                            type="email" 
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={stay.guestEmail}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].guestEmail = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">ID Type</label>
                          <select 
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={stay.idType}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].idType = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          >
                            <option value="">Select ID Type</option>
                            <option value="National ID">National ID</option>
                            <option value="Passport">Passport</option>
                            <option value="Drivers License">Drivers License</option>
                            <option value="Voters Card">Voters Card</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">ID Number</label>
                          <input 
                            type="text" 
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={stay.idNumber}
                            onChange={(e) => {
                              const updated = [...newBooking.additionalStays];
                              updated[index].idNumber = e.target.value;
                              setNewBooking({ ...newBooking, additionalStays: updated });
                            }}
                          />
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Address</label>
                        <textarea 
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-16"
                          value={stay.address}
                          onChange={(e) => {
                            const updated = [...newBooking.additionalStays];
                            updated[index].address = e.target.value;
                            setNewBooking({ ...newBooking, additionalStays: updated });
                          }}
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room</label>
                        <select 
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                          value={stay.roomId}
                          onChange={(e) => {
                            const updated = [...newBooking.additionalStays];
                            updated[index].roomId = e.target.value;
                            setNewBooking({ ...newBooking, additionalStays: updated });
                          }}
                        >
                          <option value="">Select Room</option>
                          {rooms.filter(r => 
                            isRoomAvailable(r.id, stay.checkIn, stay.checkOut, reservations, roomBlockings, hotel) || r.id === stay.roomId
                          ).map(room => {
                            let displayPrice = room.price;
                            let isNegotiated = false;

                            if (newBooking.guestType === 'corporate' && newBooking.corporateId) {
                              const rate = activeCorporateRates.find(r => 
                                (r.roomTypeId === room.roomTypeId || r.roomType === room.type) &&
                                new Date(stay.checkIn) >= new Date(r.startDate) &&
                                new Date(stay.checkIn) <= new Date(r.endDate)
                              );
                              if (rate) {
                                displayPrice = rate.rate;
                                isNegotiated = true;
                              }
                            }

                            return (
                              <option key={room.id} value={room.id}>
                                Room {room.roomNumber} ({room.type} - {formatCurrency(displayPrice, currency, exchangeRate)}{isNegotiated ? ' [Negotiated]' : ''})
                              </option>
                            );
                          })}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                          <div className="relative">
                            <input 
                              type="date" 
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                              style={{ colorScheme: 'dark' }}
                              value={stay.checkIn}
                              onChange={(e) => {
                                const updated = [...newBooking.additionalStays];
                                updated[index].checkIn = e.target.value;
                                setNewBooking({ ...newBooking, additionalStays: updated });
                              }}
                            />
                            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                          </div>
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                          <div className="relative">
                            <input 
                              type="date" 
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                              style={{ colorScheme: 'dark' }}
                              value={stay.checkOut}
                              onChange={(e) => {
                                const updated = [...newBooking.additionalStays];
                                updated[index].checkOut = e.target.value;
                                setNewBooking({ ...newBooking, additionalStays: updated });
                              }}
                            />
                            <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-4 mt-auto">
              <button 
                onClick={() => setIsBooking(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all active:scale-95 font-bold"
              >
                Cancel
              </button>
              <button 
                onClick={handleBooking}
                disabled={loading}
                className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loading ? 'Processing...' : 'Confirm Booking'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Room Inventory Summary */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
        {roomTypes.map(type => {
          const totalRooms = rooms.filter(r => r.type === type.name).length;
          const availableRooms = rooms.filter(r => r.type === type.name && isRoomAvailable(r.id, format(new Date(), 'yyyy-MM-dd'), format(addDays(new Date(), 1), 'yyyy-MM-dd'), reservations, roomBlockings, hotel)).length;
          return (
            <div key={type.id} className="bg-zinc-900 border border-zinc-800 p-3 rounded-xl">
              <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest mb-1">{type.name}</div>
              <div className="flex items-end justify-between">
                <div className="text-lg font-bold text-zinc-50">{availableRooms} <span className="text-[10px] text-zinc-600 font-medium">Available</span></div>
                <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-tighter self-center bg-zinc-950 px-1.5 py-0.5 rounded">Total {totalRooms}</div>
              </div>
              <div className="mt-2 h-1 w-full bg-zinc-800 rounded-full overflow-hidden">
                <div 
                  className={cn(
                    "h-full rounded-full transition-all duration-500",
                    availableRooms === 0 ? "bg-red-500" : availableRooms < totalRooms * 0.3 ? "bg-amber-500" : "bg-emerald-500"
                  )}
                  style={{ width: `${totalRooms ? (availableRooms / totalRooms) * 100 : 0}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Room Status Legend */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 bg-zinc-900 border border-zinc-800 rounded-xl mb-6">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.2)]" />
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Clean</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.2)]" />
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Occupied</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.2)]" />
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Repair</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.2)]" />
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Dirty</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          <span className="text-[8px] font-bold text-zinc-400 uppercase tracking-widest">Unready</span>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 space-y-4">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <h3 className="font-bold text-zinc-50 text-sm">{selectedReservations.length > 0 ? `Selected: ${selectedReservations.length}` : 'Reservations'}</h3>
              <div className="flex items-center bg-zinc-950 p-1 rounded-lg border border-zinc-800 flex-wrap gap-1">
                {(['all', 'arrivals', 'departures', 'checked_in', 'overstay', 'checkin_history', 'checkout_history'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => {
                      setActiveTab(tab);
                      setSelectedReservations([]);
                    }}
                    className={cn(
                      "px-3 py-1 text-[9px] font-black uppercase tracking-widest rounded-md transition-all whitespace-nowrap",
                      activeTab === tab 
                        ? "bg-emerald-500 text-black shadow-lg" 
                        : "text-zinc-500 hover:text-zinc-300"
                    )}
                  >
                    {tab === 'checked_in' ? 'In-House' : tab === 'checkin_history' ? 'Check-In History' : tab === 'checkout_history' ? 'Check-Out History' : tab}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex items-center gap-2">
               {selectedReservations.length > 0 && (
                <button
                  onClick={handleBulkCheckIn}
                  disabled={loading}
                  className="bg-emerald-500 text-black px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-400 transition-all flex items-center gap-2"
                >
                  {loading ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle2 size={12} />}
                  Check In ({selectedReservations.length})
                </button>
              )}
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
                <input 
                  type="text" 
                  placeholder="Quick search..."
                  className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-4 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500 min-w-[200px]"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(activeTab === 'checkin_history' || activeTab === 'checkout_history') ? (
              <select
                value={historyPeriod}
                onChange={(e) => setHistoryPeriod(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">Period: All</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
              </select>
            ) : (
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-emerald-500"
              >
                <option value="all">Status: All</option>
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="checked_in">In-House</option>
                <option value="checked_out">Departed</option>
                <option value="cancelled">Cancelled</option>
                <option value="no_show">No Show</option>
              </select>
            )}

            <select
              value={paymentStatusFilter}
              onChange={(e) => setPaymentStatusFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Payment: All</option>
              <option value="unpaid">Unpaid</option>
              <option value="partial">Partial</option>
              <option value="paid">Settled</option>
            </select>

            <select
              value={roomTypeFilter}
              onChange={(e) => setRoomTypeFilter(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none focus:border-emerald-500"
            >
              <option value="all">Type: All</option>
              {roomTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>

            <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5">
              <Calendar size={12} className="text-emerald-500" />
              <input 
                type="date"
                className="bg-transparent text-[10px] font-bold text-zinc-400 focus:outline-none appearance-none w-24"
                style={{ colorScheme: 'dark' }}
                value={dateRange.start}
                onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              />
              <span className="text-zinc-700">-</span>
              <input 
                type="date"
                className="bg-transparent text-[10px] font-bold text-zinc-400 focus:outline-none appearance-none w-24"
                style={{ colorScheme: 'dark' }}
                value={dateRange.end}
                onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              />
            </div>

            <div className="ml-auto flex items-center gap-2">
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[10px] font-bold text-zinc-400 focus:outline-none"
              >
                <option value="checkIn">Sort: Date</option>
                <option value="guestName">Sort: Name</option>
                <option value="roomNumber">Sort: Room</option>
                <option value="status">Sort: Status</option>
              </select>
              <button
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-zinc-500 hover:text-emerald-500 transition-colors"
              >
                {sortOrder === 'asc' ? <TrendingUp size={14} /> : <ArrowDownRight size={14} />}
              </button>
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4 w-10">
                  <input 
                    type="checkbox"
                    className="rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                    checked={selectedReservations.length === filteredReservations.length && filteredReservations.length > 0}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setSelectedReservations(filteredReservations.map(r => r.id));
                      } else {
                        setSelectedReservations([]);
                      }
                    }}
                  />
                </th>
                <th className="px-6 py-4">Guest</th>
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Dates</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {isFetching ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="animate-pulse">
                    <td className="px-6 py-4"><div className="w-4 h-4 bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-zinc-800 rounded-full" />
                        <div className="space-y-2">
                          <div className="w-24 h-3 bg-zinc-800 rounded" />
                          <div className="w-16 h-2 bg-zinc-800 rounded opacity-50" />
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4"><div className="w-20 h-3 bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-4"><div className="w-24 h-3 bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-4"><div className="w-24 h-4 bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-4"><div className="w-16 h-4 bg-zinc-800 rounded" /></td>
                    <td className="px-6 py-4"><div className="w-20 h-8 bg-zinc-800 rounded ml-auto" /></td>
                  </tr>
                ))
              ) : filteredReservations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-zinc-500">
                    No reservations found matching your criteria.
                  </td>
                </tr>
              ) : (
                filteredReservations.map(res => {
                  const billing = calculateBilling(res, hotel);
                  return (
                    <tr key={res.id} className={cn(
                  "hover:bg-zinc-800/50 transition-colors",
                  selectedReservations.includes(res.id) && "bg-emerald-500/5"
                )}>
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox"
                      className="rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                      checked={selectedReservations.includes(res.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedReservations([...selectedReservations, res.id]);
                        } else {
                          setSelectedReservations(selectedReservations.filter(id => id !== res.id));
                        }
                      }}
                    />
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500">
                        {res.corporateId ? <Building2 size={14} /> : <User size={14} />}
                      </div>
                      <div>
                        <div className="text-sm font-medium text-zinc-50 flex items-center gap-1.5 flex-wrap">
                          {res.guestName}
                          {(() => {
                            const guestStaysList = reservations.filter(r => r.guestId === res.guestId || (res.guestEmail && r.guestEmail === res.guestEmail));
                            const completedCount = guestStaysList.filter(r => r.status === 'checked_out').length;
                            const activeCount = guestStaysList.filter(r => r.status === 'checked_in').length;
                            const staysCount = completedCount + activeCount;
                            if (staysCount > 1) {
                              return (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-md text-[9px] font-bold tracking-wide" title={`${staysCount} total registered stays`}>
                                  <Sparkles size={9} />
                                  Returning ({staysCount})
                                </span>
                              );
                            }
                            return null;
                          })()}
                        </div>
                        {res.corporateId && (
                          <div className="text-[10px] text-emerald-500 font-bold flex flex-col gap-0.5">
                            <div className="flex items-center gap-1">
                              <Building2 size={10} />
                              {corporateAccounts.find(a => a.id === res.corporateId)?.name || 'Corporate'}
                            </div>
                            {res.corporateReference && (
                              <div className="text-zinc-400 font-normal">Ref: {res.corporateReference}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="font-bold text-zinc-50 flex items-center gap-2 group/roomrelative text-sm">
                      Room {res.roomNumber}
                      {(() => {
                        const room = rooms.find(r => r.id === res.roomId);
                        if (!room) return null;
                        if (!room.notes && (!room.amenities || room.amenities.length === 0)) return null;
                        return (
                          <div className="group relative">
                            <Info size={12} className="text-zinc-500 cursor-help" />
                            <div className="absolute left-0 bottom-full mb-2 w-48 p-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl opacity-0 scale-95 group-hover/roomrelative:opacity-100 group-hover/roomrelative:scale-100 pointer-events-none transition-all z-50 origin-bottom-left">
                              {room.notes && (
                                <div className="mb-2">
                                  <div className="text-[8px] font-bold text-amber-500 uppercase mb-0.5">Room Notes</div>
                                  <p className="text-[10px] text-zinc-400 italic leading-tight">{room.notes}</p>
                                </div>
                              )}
                              {room.amenities && room.amenities.length > 0 && (
                                <div>
                                  <div className="text-[8px] font-bold text-zinc-500 uppercase mb-0.5">Amenities</div>
                                  <div className="flex flex-wrap gap-1">
                                    {(room.amenities || []).slice(0, 5).map(a => (
                                      <span key={a} className="text-[8px] px-1 bg-zinc-900 text-zinc-500 rounded border border-zinc-700">{a}</span>
                                    ))}
                                    {room.amenities.length > 5 && <span className="text-[8px] text-zinc-600">+{room.amenities.length - 5} more</span>}
                                  </div>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
          <td className="px-6 py-4 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5 mb-1">
              <Calendar size={12} className="text-emerald-500" /> 
              <span className="font-bold text-zinc-200">{res.checkIn}</span>
            </div>
            <div className="flex items-center gap-1.5 opacity-60">
              <Calendar size={12} className="text-zinc-600" /> 
              <span>{res.checkOut}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1">
              <Clock size={10} className="text-zinc-600" />
              <span className="text-[10px] font-black uppercase text-zinc-500 bg-zinc-950 px-1 inline-block rounded border border-zinc-800/50 italic tracking-tighter">
                {(() => {
                  const checkIn = parseISO(res.checkIn);
                  const checkOut = parseISO(res.checkOut);
                  const today = startOfDay(new Date());
                  
                  let nights = differenceInDays(checkOut, checkIn);
                  
                  if (res.status === 'checked_in') {
                    const nightsSoFar = differenceInDays(today, checkIn);
                    if (nightsSoFar > nights) {
                      nights = nightsSoFar;
                    }
                  }
                  
                  const days = nights + 1;
                  return `${days} ${days === 1 ? 'day' : 'days'}`;
                })()}
              </span>
            </div>
          </td>
                  <td className="px-6 py-4 text-sm">
                    <div className="flex flex-col">
                      <span className="font-bold text-zinc-50">
                        {formatCurrency(billing.totalCharges, currency, exchangeRate)}
                      </span>
                      <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-tighter mt-1 space-y-0.5 leading-tight">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span>Rate: {formatCurrency(billing.nightlyRate, currency, exchangeRate)} / night</span>
                          <span className="text-zinc-600">•</span>
                          <span>Base ({billing.originalNights} {billing.originalNights === 1 ? 'night' : 'nights'}): {formatCurrency((billing.originalNights * billing.nightlyRate), currency, exchangeRate)}</span>
                        </div>
                        {billing.extraNights > 0 && (
                          <div className="text-red-400 font-semibold flex items-center gap-1 flex-wrap">
                            <span>Overstay (+{billing.extraNights} {billing.extraNights === 1 ? 'night' : 'nights'}):</span>
                            <span>{formatCurrency(billing.overstayCharge, currency, exchangeRate)}</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 mt-2.5">
                      {(() => {
                        const bal = getReservationLiveBalance(res, hotel);
                        const isSettled = Math.abs(bal) <= 0.01;
                        const isCredit = bal < -0.01;
                        const isOutstanding = bal > 0.01 && (res.paidAmount || 0) <= 0;
                        const isPartial = bal > 0.01 && (res.paidAmount || 0) > 0;

                        let label = 'Outstanding';
                        let badgeStyle = "bg-red-500/10 text-red-400 border-red-500/20";
                        if (isSettled || isCredit) {
                          label = 'Settled';
                          badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                        } else if (isPartial) {
                          label = 'Partial';
                          badgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                        }

                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5">
                              <span className={cn("px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border", badgeStyle)}>
                                {label}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-medium">
                                ({formatCurrency(res.paidAmount || 0, currency, exchangeRate)} paid)
                              </span>
                            </div>
                            <div className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded border w-fit font-bold",
                              isCredit 
                                ? "text-emerald-400 bg-emerald-500/5 border-emerald-500/10" 
                                : isSettled 
                                  ? "text-zinc-500 bg-zinc-500/5 border-zinc-500/10" 
                                  : "text-red-400 bg-red-500/5 border-red-500/10"
                            )}>
                              {isCredit 
                                ? `Credit: ${formatCurrency(Math.abs(bal), currency, exchangeRate)}` 
                                : isSettled 
                                  ? `Owed: ${formatCurrency(0, currency, exchangeRate)}`
                                  : `Owed: ${formatCurrency(bal, currency, exchangeRate)}`
                              }
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-col gap-1">
                      <span className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider w-fit",
                        res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                        res.status === 'pending' ? "bg-blue-500/10 text-blue-500" :
                        res.status === 'no_show' ? "bg-amber-500/10 text-amber-500" :
                        res.status === 'checked_out' ? "bg-zinc-800 text-zinc-400" : "bg-red-500/10 text-red-500"
                      )}>
                        {res.status.replace('_', ' ')}
                      </span>
                      {res.status === 'checked_in' && (
                        billing.isOverstaying ? (
                          <span className="px-2 py-0.5 bg-red-500/10 text-red-500 text-[8px] font-bold uppercase rounded w-fit animate-pulse">
                            Overstay
                          </span>
                        ) : new Date().toISOString().split('T')[0] === res.checkOut ? (
                          <span className="px-2 py-0.5 bg-amber-500/10 text-amber-500 text-[8px] font-bold uppercase rounded w-fit">
                            Due Out Today
                          </span>
                        ) : null
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {(activeTab === 'checkin_history' || activeTab === 'checkout_history') ? (
                        <>
                          <button 
                            onClick={() => setShowFolioModal(res)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-300 hover:bg-zinc-700 rounded-lg transition-all active:scale-95 font-bold text-[10px] uppercase tracking-wider"
                            title="View Guest Folio"
                          >
                            <Receipt size={14} />
                            View Folio
                          </button>
                          {res.status === 'checked_out' && (res.ledgerBalance || 0) > 0.01 && (
                            <button 
                              type="button"
                              onClick={() => {
                                const amount = prompt(`Enter payment amount to settle outstanding balance (max ${res.ledgerBalance}):`, String(res.ledgerBalance));
                                if (amount && !isNaN(Number(amount)) && Number(amount) > 0) {
                                  updatePayment(res, Number(amount));
                                }
                              }}
                              className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 border border-emerald-500/20 rounded-lg transition-all active:scale-95 font-bold text-[10px] uppercase tracking-wider"
                              title="Settle Outstanding Balance"
                            >
                              <DollarSign size={14} />
                              Settle Balance
                            </button>
                          )}
                        </>
                      ) : (
                        <>
                          {res.status === 'checked_in' && (
                            <>
                              <button 
                                type="button"
                                onClick={() => setShowTransferModal(res)}
                                className="p-2 text-zinc-400 hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                                title="Transfer Room"
                              >
                                <RefreshCw size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => {
                                  setNewCheckOutDate(res.checkOut);
                                  setShowPostponeModal(res);
                                }}
                                className="p-2 text-blue-400 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                                title="Postpone Stay / Extend"
                              >
                                <Calendar size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setShowDiscountModal(res)}
                                className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90"
                                title="Apply Discount"
                              >
                                <Tag size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setShowChargeModal(res)}
                                className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                                title="Post Charge to Room"
                              >
                                <Plus size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setShowFolioModal(res)}
                                className="p-2 text-zinc-500 hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                                title="Guest Folio"
                              >
                                <FileText size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setShowDigitalKeyModal(res)}
                                className="p-2 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-all active:scale-90"
                                title="Room Digital SmartKey"
                              >
                                <QrCode size={18} />
                              </button>
                              <button 
                                type="button"
                                onClick={() => setCheckoutPreviewRes(res)}
                                className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={(() => {
                                  const policy = canCheckout(hotel, profile, res);
                                  return policy.allowed ? "Check Out (Preview Fees)" : policy.message;
                                })()}
                                disabled={loading}
                              >
                                <LogOut size={18} />
                              </button>
                            </>
                          )}

                          {res.status === 'checked_out' && (
                            <>
                              <button 
                                type="button"
                                onClick={() => setShowFolioModal(res)}
                                className="p-2 text-zinc-400 hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                                title="Guest Folio"
                              >
                                <FileText size={18} />
                              </button>
                              {(res.ledgerBalance || 0) > 0.01 && (
                                <button 
                                  type="button"
                                  onClick={() => {
                                    const amount = prompt(`Enter payment amount to settle outstanding balance (max ${res.ledgerBalance}):`, String(res.ledgerBalance));
                                    if (amount && !isNaN(Number(amount)) && Number(amount) > 0) {
                                      updatePayment(res, Number(amount));
                                    }
                                  }}
                                  className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                                  title="Settle Outstanding Balance"
                                >
                                  <DollarSign size={18} />
                                </button>
                              )}
                            </>
                          )}
                          
                          {res.status === 'pending' && (
                            <>
                              {(hotel.settings?.reservations?.allowConfirmation ?? true) && (
                                <button 
                                  onClick={() => updateReservationStatus(res, 'confirmed')}
                                  className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                                  title="Confirm Reservation"
                                >
                                  <CheckCircle2 size={18} />
                                </button>
                              )}
                              <button 
                                onClick={() => {
                                  const amount = prompt("Enter payment amount:");
                                  if (amount && !isNaN(Number(amount))) {
                                    updatePayment(res, Number(amount));
                                  }
                                }}
                                className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90"
                                title="Take Prepayment / Deposit"
                              >
                                <DollarSign size={18} />
                              </button>
                               <button 
                                onClick={() => updateReservationStatus(res, 'checked_in')}
                                className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={(() => {
                                  const room = rooms.find(r => r.id === res.roomId);
                                  const guest = guests.find(g => g.id === res.guestId);
                                  const policy = canCheckIn(hotel, profile, res, room, guest);
                                  return policy.allowed ? "Check In" : policy.message;
                                })()}
                                disabled={loading || !canCheckIn(hotel, profile, res, rooms.find(r => r.id === res.roomId), guests.find(g => g.id === res.guestId)).allowed}
                              >
                                <CheckCircle2 size={18} />
                              </button>
                              <button 
                                onClick={() => setShowConfirmAction({ res, action: 'no_show' })}
                                className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={(() => {
                                  const policy = canCancelReservation(hotel, profile, res); // No-show uses same cancel policy
                                  return policy.allowed ? "Mark No-Show" : policy.message;
                                })()}
                                disabled={loading || !canCancelReservation(hotel, profile, res).allowed}
                              >
                                <UserX size={18} />
                              </button>
                              <button 
                                onClick={() => setShowConfirmAction({ res, action: 'cancelled' })}
                                className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-90 disabled:opacity-30 disabled:cursor-not-allowed"
                                title={(() => {
                                  const policy = canCancelReservation(hotel, profile, res);
                                  return policy.allowed ? "Cancel" : policy.message;
                                })()}
                                disabled={loading || !canCancelReservation(hotel, profile, res).allowed}
                              >
                                <XCircle size={18} />
                              </button>
                            </>
                          )}

                          {(profile && hasPermission(profile, 'edit_reservation')) && (
                            <button 
                              onClick={() => {
                                const policy = canEditReservation(hotel, profile, res);
                                if (!policy.allowed) {
                                  toast.error(policy.message || 'Editing disabled');
                                  return;
                                }
                                setEditingReservation(res);
                                setEditForm({
                                  checkIn: res.checkIn,
                                  checkOut: res.checkOut,
                                  totalAmount: res.totalAmount,
                                  notes: res.notes || ''
                                });
                              }}
                              className={cn(
                                "p-2 rounded-lg transition-all active:scale-90",
                                !canEditReservation(hotel, profile, res).allowed
                                  ? "text-zinc-600 cursor-not-allowed"
                                  : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
                              )}
                              title={(() => {
                                const policy = canEditReservation(hotel, profile, res);
                                return policy.allowed ? "Edit Reservation" : policy.message;
                              })()}
                            >
                              <Edit2 size={18} />
                            </button>
                          )}

                          <button 
                            onClick={() => setShowFolioModal(res)}
                            className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 rounded-lg transition-all active:scale-95 font-bold text-[10px] uppercase tracking-wider"
                            title="View Guest Folio"
                          >
                            <Receipt size={14} />
                            View Folio
                          </button>

                          <button 
                            onClick={() => setShowDigitalKeyModal(res)}
                            style={{ cursor: 'pointer' }}
                            className="flex items-center gap-2 px-3 py-1.5 bg-purple-500/10 text-purple-400 hover:bg-purple-500/20 border border-purple-500/20 rounded-lg transition-all active:scale-95 font-bold text-[10px] uppercase tracking-wider"
                            title="Generate and view Room Digital SmartKey QR Code"
                          >
                            <QrCode size={14} />
                            SmartKey
                          </button>

                          {(profile && (profile.role === 'hotelAdmin' || profile.role === 'superAdmin')) && (
                            <button 
                              onClick={() => setShowConfirmAction({ res, action: 'delete' })}
                              className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-90 disabled:opacity-50"
                              title="Delete Reservation"
                              disabled={loading}
                            >
                              <Trash2 size={18} />
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            }))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Edit Reservation Modal */}
      {editingReservation && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-zinc-50 mb-6">Edit Reservation</h3>
            <form onSubmit={handleEditReservation} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                  <div className="relative">
                    <input 
                      type="date" 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                      style={{ colorScheme: 'dark' }}
                      value={editForm.checkIn}
                      min={profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin' ? undefined : format(new Date(), 'yyyy-MM-dd')}
                      onChange={(e) => setEditForm({ ...editForm, checkIn: e.target.value })}
                    />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                  <div className="relative">
                    <input 
                      type="date" 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                      style={{ colorScheme: 'dark' }}
                      value={editForm.checkOut}
                      onChange={(e) => setEditForm({ ...editForm, checkOut: e.target.value })}
                    />
                    <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                  </div>
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Total Amount (Discounted/Adjusted)</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={editForm.totalAmount}
                  onChange={(e) => setEditForm({ ...editForm, totalAmount: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                  value={editForm.notes}
                  onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                />
              </div>
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setEditingReservation(null)}
                  className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-lg font-bold hover:bg-zinc-700 transition-all"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 bg-emerald-500 text-black rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Save Changes
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showTransferModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-6">Transfer Room</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Transferring <strong>{showTransferModal.guestName}</strong> from Room <strong>{showTransferModal.roomNumber}</strong>
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Select New Room</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  onChange={(e) => {
                    if (e.target.value) {
                      transferRoom(showTransferModal, e.target.value);
                    }
                  }}
                >
                  <option value="">Select clean / ready room</option>
                  {rooms.filter(r => {
                    if (r.id === showTransferModal.roomId) return false;
                    const policy = canCheckIn(hotel, profile, showTransferModal, r, null);
                    return policy.allowed && r.status !== 'occupied';
                  }).map(room => (
                    <option key={room.id} value={room.id}>
                      Room {room.roomNumber} ({room.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setShowTransferModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {showChargeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-6">Post Charge to Room</h3>
            <p className="text-zinc-400 text-sm mb-4">
              Posting charge for <strong>{showChargeModal.guestName}</strong> (Room {showChargeModal.roomNumber})
            </p>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Category</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={chargeDetails.category}
                  onChange={(e) => setChargeDetails({ ...chargeDetails, category: e.target.value as any })}
                >
                  <option value="restaurant">Restaurant / Bar</option>
                  <option value="service">Laundry / Service</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amount ({currency})</label>
                <input 
                  type="number" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={currency === 'USD' ? (chargeDetails.amount / exchangeRate) || '' : chargeDetails.amount || ''}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setChargeDetails({ ...chargeDetails, amount: currency === 'USD' ? val * exchangeRate : val });
                  }}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Description</label>
                <input 
                  type="text" 
                  placeholder="e.g. Dinner, Laundry, etc."
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={chargeDetails.description}
                  onChange={(e) => setChargeDetails({ ...chargeDetails, description: e.target.value })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Discount</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={chargeDetails.discount || ''}
                    onChange={(e) => setChargeDetails({ ...chargeDetails, discount: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={chargeDetails.discountType}
                    onChange={(e) => setChargeDetails({ ...chargeDetails, discountType: e.target.value as any })}
                  >
                    <option value="fixed">Fixed ({currency})</option>
                    <option value="percentage">% Percentage</option>
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setShowChargeModal(null)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all"
              >
                Cancel
              </button>
              <button 
                onClick={postCharge}
                disabled={!chargeDetails.amount || !chargeDetails.description}
                className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                Post Charge
              </button>
            </div>
          </div>
        </div>
      )}

      {showReceipt && hotel && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-start justify-center p-4 overflow-y-auto print:p-0 print:bg-white print:backdrop-blur-none">
          <div className={cn(
            "relative w-full my-8 print:my-0 print:w-auto",
            showReceipt.type === 'restaurant' ? "max-w-[80mm]" : "max-w-[210mm]"
          )}>
            <div className="absolute -top-12 right-0 flex gap-4 print:hidden">
              <button 
                onClick={() => window.print()}
                className="text-zinc-50 hover:text-emerald-400 font-bold flex items-center gap-2"
              >
                <Receipt size={20} />
                Print
              </button>
              <button 
                onClick={() => setShowReceipt(null)}
                className="text-zinc-50 hover:text-zinc-400 font-bold flex items-center gap-2"
              >
                <XCircle size={20} />
                Close
              </button>
            </div>
            <div className="bg-white rounded-2xl overflow-hidden">
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={showReceipt.res} 
                type={showReceipt.type} 
                ledgerEntries={[]} // Ledger entries are now fetched from collection, this path is legacy
              />
            </div>
          </div>
        </div>
      )}

      {showFolioModal && (
        <GuestFolio 
          reservation={showFolioModal} 
          onClose={() => setShowFolioModal(null)}
          onPostCharge={() => {
            setShowFolioModal(null);
            setShowChargeModal(showFolioModal);
          }}
        />
      )}

      {showPostponeModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Postpone Stay</h3>
            <p className="text-zinc-400 text-sm mb-6">Extend the stay for {showPostponeModal.guestName} in Room {showPostponeModal.roomNumber}.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Current Check-out</label>
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-400">
                  {showPostponeModal.checkOut}
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">New Check-out Date</label>
                <div className="relative">
                  <input 
                    type="date"
                    min={addDays(new Date(showPostponeModal.checkOut), 1).toISOString().split('T')[0]}
                    value={newCheckOutDate}
                    onChange={(e) => setNewCheckOutDate(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none appearance-none"
                    style={{ colorScheme: 'dark' }}
                  />
                  <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                </div>
              </div>
              
              {newCheckOutDate && (
                <div className="p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl">
                  <div className="flex justify-between text-xs font-bold text-blue-500 uppercase mb-1">
                    <span>Extra Nights</span>
                    <span>{Math.ceil((new Date(newCheckOutDate).getTime() - new Date(showPostponeModal.checkOut).getTime()) / (1000 * 60 * 60 * 24))}</span>
                  </div>
                  <div className="flex justify-between text-sm font-bold text-zinc-50">
                    <span>Estimated Extra Charge</span>
                    <span>{formatCurrency(Math.ceil((new Date(newCheckOutDate).getTime() - new Date(showPostponeModal.checkOut).getTime()) / (1000 * 60 * 60 * 24)) * (rooms.find(r => r.id === showPostponeModal.roomId)?.price || 0), currency, exchangeRate)}</span>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowPostponeModal(null)}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handlePostponeStay}
                disabled={loading || !newCheckOutDate}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Processing...' : 'Confirm Extension'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {showDiscountModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md"
          >
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Apply Discount</h3>
            <p className="text-zinc-400 text-sm mb-6">Give a discount to {showDiscountModal.guestName}. This will be posted as a credit to their folio.</p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-2">Discount Type</label>
                <div className="flex gap-2 p-1 bg-zinc-950 border border-zinc-800 rounded-xl">
                  <button
                    onClick={() => setDiscountData({ ...discountData, type: 'fixed' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'fixed' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                    )}
                  >
                    Fixed Amount
                  </button>
                  <button
                    onClick={() => setDiscountData({ ...discountData, type: 'percentage' })}
                    className={cn(
                      "flex-1 py-1.5 rounded-lg text-xs font-bold transition-all",
                      discountData.type === 'percentage' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-400"
                    )}
                  >
                    Percentage (%)
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">
                  {discountData.type === 'fixed' ? `Discount Amount (${currency})` : 'Discount Percentage (%)'}
                </label>
                <input 
                  type="number"
                  value={discountData.type === 'fixed' && currency === 'USD' ? (discountData.amount / exchangeRate) || '' : discountData.amount || ''}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setDiscountData({ 
                      ...discountData, 
                      amount: discountData.type === 'fixed' && currency === 'USD' ? val * exchangeRate : val 
                    });
                  }}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  placeholder="0.00"
                />
                {discountData.type === 'percentage' && discountData.amount > 0 && (
                  <p className="text-[10px] text-emerald-500 mt-1 font-bold">
                    Calculated Discount: {formatCurrency((showDiscountModal.totalAmount * discountData.amount) / 100, currency, exchangeRate)}
                  </p>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-zinc-500 uppercase mb-1">Reason / Notes</label>
                <textarea 
                  value={discountData.reason}
                  onChange={(e) => setDiscountData({ ...discountData, reason: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none h-24 resize-none"
                  placeholder="e.g. Compensation for noise, Management approval..."
                />
              </div>
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => setShowDiscountModal(null)}
                className="flex-1 py-3 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleApplyDiscount}
                disabled={loading || !discountData.amount || !discountData.reason}
                className="flex-1 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
              >
                {loading ? 'Applying...' : 'Apply Discount'}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!showConfirmAction}
        title={showConfirmAction?.action === 'delete' ? 'Delete Reservation' : showConfirmAction?.action === 'no_show' ? 'Mark No-Show' : 'Cancel Reservation'}
        message={showConfirmAction?.action === 'delete'
          ? `Are you sure you want to permanently delete the reservation for ${showConfirmAction?.res.guestName}? This action cannot be undone.`
          : showConfirmAction?.action === 'no_show' 
            ? `Are you sure you want to mark ${showConfirmAction?.res.guestName} as No-Show?`
            : `Are you sure you want to cancel the reservation for ${showConfirmAction?.res.guestName}?`
        }
        onConfirm={handleConfirmAction}
        onCancel={() => setShowConfirmAction(null)}
        type={showConfirmAction?.action === 'delete' ? 'danger' : showConfirmAction?.action === 'no_show' ? 'warning' : 'danger'}
        confirmText={showConfirmAction?.action === 'delete' ? 'Delete' : showConfirmAction?.action === 'no_show' ? 'Confirm No-Show' : 'Cancel Reservation'}
        isLoading={loading}
      />

      {showDigitalKeyModal && (
        <DigitalKeyModal
          reservation={showDigitalKeyModal}
          hotel={hotel}
          onClose={() => setShowDigitalKeyModal(null)}
        />
      )}

      {checkoutPreviewRes && (() => {
        const preview = getCheckoutPreviewData(checkoutPreviewRes);
        const bal = getReservationLiveBalance(checkoutPreviewRes, hotel);
        
        return (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-[60]">
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg flex flex-col shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
              <header className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-500/10 rounded-lg text-blue-500">
                    <Receipt size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-zinc-50">Preview Checkout Fees</h3>
                    <p className="text-xs text-zinc-400">Review final folio charges prior to settlement</p>
                  </div>
                </div>
                <button 
                  onClick={() => setCheckoutPreviewRes(null)}
                  className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  <X size={18} />
                </button>
              </header>
              
              <main className="p-6 space-y-6 overflow-y-auto max-h-[70vh]">
                {/* Guest Info */}
                <div className="bg-zinc-950 p-4 border border-zinc-800 rounded-xl flex justify-between items-center">
                  <div>
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Guest & Room</p>
                    <p className="text-sm font-bold text-zinc-50 mt-1">{checkoutPreviewRes.guestName}</p>
                    <p className="text-xs text-zinc-400 mt-0.5">Room {checkoutPreviewRes.roomNumber} ({checkoutPreviewRes.roomId})</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Scheduled Checkout</p>
                    <p className="text-sm font-bold text-zinc-200 mt-1">{checkoutPreviewRes.checkOut}</p>
                    <p className="text-xs text-zinc-500 mt-0.5">{checkoutPreviewRes.checkOutTime || hotel?.defaultCheckOutTime || '12:00'}</p>
                  </div>
                </div>

                {/* Rates breakdown */}
                <div className="space-y-3">
                  <h4 className="text-xs font-black uppercase tracking-widest text-zinc-500">Stay Cost Breakdown</h4>
                  
                  {/* Standard Rates */}
                  <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                    <div className="space-y-0.5">
                      <p className="text-xs font-bold text-zinc-50">Standard Room Rate</p>
                      <p className="text-[10px] text-zinc-500">{preview.originalNights} night{preview.originalNights > 1 ? 's' : ''} at {formatCurrency(preview.nightlyRate, currency, exchangeRate)}/night</p>
                    </div>
                    <p className="text-sm font-bold text-zinc-50">{formatCurrency(preview.originalNights * preview.nightlyRate, currency, exchangeRate)}</p>
                  </div>

                  {/* Late checkout details */}
                  <div className="p-3 bg-zinc-950 border border-zinc-800 rounded-lg space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <p className="text-xs font-bold text-zinc-50 flex items-center gap-1.5">
                          Late Checkout Charges
                          {preview.isLateCheckout && (
                            <span className="px-1.5 py-0.5 bg-red-500/10 text-red-400 text-[8px] font-black uppercase tracking-widest rounded border border-red-500/20 animate-pulse">
                              LATE
                            </span>
                          )}
                        </p>
                        <p className="text-[10px] text-zinc-500">
                          {preview.hoursPast > 0 
                            ? `${preview.minutesPast.toFixed(0)} mins (${preview.hoursPast.toFixed(1)} hrs) past check-out time`
                            : 'On-time checkout'
                          }
                        </p>
                      </div>
                      <p className={cn("text-sm font-bold", preview.isLateCheckout ? "text-red-400" : "text-zinc-500")}>
                        {formatCurrency(preview.overstayCharge, currency, exchangeRate)}
                      </p>
                    </div>

                    <div className="border-t border-zinc-800/80 pt-2.5 flex items-center justify-between text-[10px] text-zinc-500">
                      <span>Grace Period: {preview.gracePeriodMinutes} mins</span>
                      <span className="capitalize">Policy: {preview.policy}</span>
                    </div>

                    {!preview.isLateCheckout && preview.hoursPast > 0 && (
                      <p className="text-[10px] text-emerald-400 font-semibold bg-emerald-500/5 border border-emerald-500/10 p-2 rounded">
                        Guest checked out within the configured {preview.gracePeriodMinutes}-minute grace period. No late fees are applied!
                      </p>
                    )}
                  </div>
                </div>

                {/* Final settlement */}
                <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-3">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Subtotal charges:</span>
                    <span>{formatCurrency(preview.billing.totalCharges, currency, exchangeRate)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span>Total payments received:</span>
                    <span className="text-emerald-400">{formatCurrency(preview.billing.totalPayments, currency, exchangeRate)}</span>
                  </div>
                  <div className="border-t border-zinc-800 pt-2.5 flex items-center justify-between">
                    <span className="text-sm font-extrabold text-zinc-100">Outstanding Balance:</span>
                    <span className={cn("text-lg font-black", bal > 0.01 ? "text-red-400" : "text-emerald-400")}>
                      {formatCurrency(bal, currency, exchangeRate)}
                    </span>
                  </div>
                </div>

                {bal > 0.01 && !checkoutPreviewRes.corporateId && (
                  <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-3 flex gap-3 text-amber-500">
                    <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                    <div className="space-y-1">
                      <p className="text-xs font-bold">Unpaid Folio Balance</p>
                      <p className="text-[10px] text-zinc-400 leading-normal">
                        This guest has an outstanding balance of {formatCurrency(bal, currency, exchangeRate)}. Full payment or authorization is required depending on hotel policy before checkout is finalized.
                      </p>
                    </div>
                  </div>
                )}
              </main>

              <footer className="p-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCheckoutPreviewRes(null)}
                  className="px-4 py-2 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-400 hover:text-zinc-200 rounded-xl text-xs font-bold transition-all animate-in fade-in"
                >
                  Cancel
                </button>
                {(() => {
                  const policy = canCheckout(hotel, profile, checkoutPreviewRes);
                  const isBlocked = !policy.allowed;
                  
                  return (
                    <div className="flex flex-col items-end gap-1.5">
                      {isBlocked && (
                        <p className="text-[10px] text-red-400 font-bold text-right max-w-[250px] animate-pulse">
                          {policy.message || 'Check-out restricted by hotel policy.'}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={isBlocked}
                        onClick={async () => {
                          const resToCheckout = checkoutPreviewRes;
                          setCheckoutPreviewRes(null);
                          await updateReservationStatus(resToCheckout, 'checked_out');
                        }}
                        className="px-5 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-zinc-800 disabled:text-zinc-600 disabled:cursor-not-allowed disabled:scale-100 text-zinc-50 rounded-xl text-xs font-black flex items-center gap-2 transition-all hover:scale-[1.02] active:scale-95"
                        title={isBlocked ? (policy.message || 'Check-out restricted') : 'Finalize check-out'}
                      >
                        <LogOut size={14} />
                        Confirm & Check Out
                      </button>
                    </div>
                  );
                })()}
              </footer>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
