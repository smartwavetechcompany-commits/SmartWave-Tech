import React, { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { collection, collectionGroup, onSnapshot, query, where, limit, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Room, Reservation, FinanceRecord, Hotel, OperationType, RoomBlocking, OutstandingDebt, LedgerEntry } from '../types';
import { formatCurrency, cn } from '../utils';
import { isModuleEnabled } from '../utils/plans';
import { calculateBilling, getReservationLiveBalance } from '../utils/billingEngine';
import { getRoomDisplayStatus } from '../utils/roomUtils';
import { hasFinancialVisibility } from '../utils/permissions';
import {
  reconcileFinanceRecords,
  reconcileLedgerEntries,
  isActualPaymentLedgerEntry,
  calculateGuestFinancialPosition
} from '../services/financialService';
import { 
  Users, 
  BedDouble, 
  TrendingUp, 
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  DollarSign,
  Activity,
  Download,
  Receipt,
  AlertTriangle
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { exportToCSV } from '../utils';
import { format, isToday, isValid } from 'date-fns';
import { toast } from 'sonner';
import { GlobalErrorBoundary } from './GlobalErrorBoundary';

const getRecordDateString = (ts: any): string => {
  if (!ts) return '';
  if (typeof ts === 'string') return ts;
  if (typeof ts.toDate === 'function') {
    try { return ts.toDate().toISOString(); } catch { return ''; }
  }
  if (typeof ts.seconds === 'number') {
    try { return new Date(ts.seconds * 1000).toISOString(); } catch { return ''; }
  }
  if (ts instanceof Date) {
    try { return ts.toISOString(); } catch { return ''; }
  }
  return '';
};

const safeFormatTimestamp = (ts: any, formatStr: string = 'MMM d, HH:mm'): string => {
  if (!ts) return 'N/A';
  let d: Date;
  if (typeof ts.toDate === 'function') {
    d = ts.toDate();
  } else if (typeof ts.seconds === 'number') {
    d = new Date(ts.seconds * 1000);
  } else if (ts instanceof Date) {
    d = ts;
  } else {
    d = new Date(ts);
  }
  return isValid(d) ? format(d, formatStr) : 'N/A';
};

// Lightweight Action Stream mini-feed: loads only the 5 most recent activities with minimal footprint
function ActionStreamMini({ hotelId, profileRole }: { hotelId?: string; profileRole?: string }) {
  const [activities, setActivities] = useState<any[]>([]);
  const [streamLoading, setStreamLoading] = useState(false);

  useEffect(() => {
    if (!hotelId && profileRole !== 'superAdmin') return;

    let unsub = () => {};
    try {
      if (profileRole === 'superAdmin' && !hotelId) {
        const q = query(collectionGroup(db, 'activityLogs'), limit(6));
        unsub = onSnapshot(q, (snap) => {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a: any, b: any) => {
            const tA = new Date(getRecordDateString(a.timestamp || a.createdAt) || 0).getTime();
            const tB = new Date(getRecordDateString(b.timestamp || b.createdAt) || 0).getTime();
            return tB - tA;
          });
          setActivities(list.slice(0, 5));
          setStreamLoading(false);
        }, () => setStreamLoading(false));
      } else if (hotelId) {
        const q = query(collection(db, 'hotels', hotelId, 'activityLogs'), limit(8));
        unsub = onSnapshot(q, (snap) => {
          const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
          list.sort((a: any, b: any) => {
            const tA = new Date(getRecordDateString(a.timestamp || a.createdAt) || 0).getTime();
            const tB = new Date(getRecordDateString(b.timestamp || b.createdAt) || 0).getTime();
            return tB - tA;
          });
          setActivities(list.slice(0, 5));
          setStreamLoading(false);
        }, () => setStreamLoading(false));
      }
    } catch {
      setStreamLoading(false);
    }

    return () => unsub();
  }, [hotelId, profileRole]);

  if (streamLoading && activities.length === 0) {
    return (
      <div className="p-4 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 animate-pulse">
            <div className="w-7 h-7 bg-zinc-800 rounded-full" />
            <div className="flex-1 space-y-1">
              <div className="w-24 h-2.5 bg-zinc-800 rounded" />
              <div className="w-40 h-2 bg-zinc-800 rounded opacity-60" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (activities.length === 0) {
    return (
      <div className="p-8 text-center text-zinc-500 text-xs italic">
        Awaiting live activity...
      </div>
    );
  }

  return (
    <div className="divide-y divide-zinc-800/40">
      {activities.map((act) => {
        const actorName = act.actor || act.user || act.userName || act.userEmail || 'Staff';
        const actionText = act.action || act.details || act.description || 'System operation';
        const moduleName = act.module || act.target || 'General';
        const timeStr = safeFormatTimestamp(act.timestamp || act.createdAt, 'MMM d, HH:mm');

        return (
          <div key={act.id} className="p-3.5 flex items-center justify-between hover:bg-zinc-800/30 transition-colors">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-7 h-7 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center justify-center font-bold text-xs shrink-0">
                {String(actorName).charAt(0).toUpperCase()}
              </div>
              <div className="min-w-0">
                <div className="text-xs font-semibold text-zinc-100 truncate">
                  {actorName} <span className="font-normal text-zinc-400">• {actionText}</span>
                </div>
                <div className="text-[10px] text-zinc-500 flex items-center gap-2 mt-0.5">
                  <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-medium text-[9px] uppercase tracking-wider">{moduleName}</span>
                  <span>{timeStr}</span>
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

const getInitialDashboardData = (hotelId?: string) => {
  if (!hotelId) return null;
  try {
    const raw = sessionStorage.getItem(`pms_dashboard_cache_${hotelId}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return null;
};

export function Dashboard() {
  const { hotel, profile, isSubscriptionActive, currency, exchangeRate, customRoles } = useAuth();

  // Instant hydration from session cache to eliminate any loading skeleton freeze
  const cachedData = useMemo(() => getInitialDashboardData(hotel?.id), [hotel?.id]);

  const [rooms, setRooms] = useState<Room[]>(() => cachedData?.rooms || []);
  const [reservations, setReservations] = useState<Reservation[]>(() => cachedData?.reservations || []);
  const [activeReservations, setActiveReservations] = useState<Reservation[]>(() => {
    if (cachedData?.reservations) {
      return cachedData.reservations.filter((r: Reservation) => ['confirmed', 'checked_in'].includes(r.status));
    }
    return [];
  });
  const [blockings, setBlockings] = useState<RoomBlocking[]>(() => cachedData?.blockings || []);
  const [debts, setDebts] = useState<OutstandingDebt[]>(() => cachedData?.debts || []);
  const [finance, setFinance] = useState<FinanceRecord[]>(() => cachedData?.finance || []);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>(() => cachedData?.ledgerEntries || []);
  const [resLoaded, setResLoaded] = useState(false);
  const [ledgerLoaded, setLedgerLoaded] = useState(false);
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);

  const [loading, setLoading] = useState(() => !cachedData);
  const [refreshing, setRefreshing] = useState(false);

  const validLedgerEntries = useMemo(() => {
    return reconcileLedgerEntries(ledgerEntries, reservations, resLoaded);
  }, [ledgerEntries, reservations, resLoaded]);

  const validFinance = useMemo(() => {
    return reconcileFinanceRecords(finance, ledgerEntries, reservations, {
      ledgerLoaded,
      reservationsLoaded: resLoaded
    });
  }, [finance, ledgerEntries, reservations, ledgerLoaded, resLoaded]);

  const validDebts = useMemo(() => {
    if (!resLoaded) return debts;
    const resMap = new Map(reservations.map(r => [r.id, r]));
    return debts.filter(d => {
      if (!d.reservationId) return true;
      const res = resMap.get(d.reservationId);
      return Boolean(res && res.status !== 'cancelled');
    });
  }, [debts, reservations, resLoaded]);

  // RBAC: Determine if current user has Finance or Hotel Admin permissions
  const canViewFinances = hasFinancialVisibility(profile, customRoles);

  // Proactive safety timeout so UI never hangs in loading state
  useEffect(() => {
    const timer = setTimeout(() => {
      setLoading(false);
    }, 350);
    return () => clearTimeout(timer);
  }, []);

  // Update session cache when fresh data arrives
  useEffect(() => {
    if (!hotel?.id) return;
    if (rooms.length > 0 || reservations.length > 0 || finance.length > 0 || ledgerEntries.length > 0) {
      try {
        sessionStorage.setItem(`pms_dashboard_cache_${hotel.id}`, JSON.stringify({
          rooms,
          reservations,
          blockings,
          debts,
          finance,
          ledgerEntries,
          savedAt: Date.now()
        }));
      } catch {}
    }
  }, [hotel?.id, rooms, reservations, blockings, debts, finance, ledgerEntries]);

  useEffect(() => {
    if (!profile) return;

    let unsubHotels = () => {};
    let unsubRooms = () => {};
    let unsubRes = () => {};
    let unsubBlockings = () => {};
    let unsubDebts = () => {};
    let unsubFinance = () => {};
    let unsubLedger = () => {};

    if (profile.role === 'superAdmin' && !hotel?.id) {
      unsubHotels = onSnapshot(collection(db, 'hotels'), (snap) => {
        setAllHotels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hotel)));
        setLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, 'hotels');
        setLoading(false);
      });
    } else if (hotel?.id) {
      // Live listener for rooms
      unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
        setLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
        setLoading(false);
      });

      // Live listener for reservations (client-side sorted)
      unsubRes = onSnapshot(collection(db, 'hotels', hotel.id, 'reservations'), (snap) => {
        const allRes = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
        allRes.sort((a, b) => {
          const tA = new Date(a.checkIn || a.createdAt || 0).getTime();
          const tB = new Date(b.checkIn || b.createdAt || 0).getTime();
          return tB - tA;
        });
        setReservations(allRes);
        const active = allRes.filter(r => ['confirmed', 'checked_in'].includes(r.status));
        setActiveReservations(active);
        setResLoaded(true);
        setLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
        setResLoaded(true);
      });

      // Live listener for room blockings
      unsubBlockings = onSnapshot(collection(db, 'hotels', hotel.id, 'room_blockings'), (snap) => {
        setBlockings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomBlocking)));
      }, () => {});

      // Live listener for outstanding debts across the property (AR / Guest Debtors)
      unsubDebts = onSnapshot(collection(db, 'hotels', hotel.id, 'outstanding_debt_ledger'), (snap) => {
        setDebts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as OutstandingDebt)));
      }, () => {});

      // Live listener for finance records (income, expenses, etc.)
      unsubFinance = onSnapshot(collection(db, 'hotels', hotel.id, 'finance'), (snap) => {
        const records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord));
        records.sort((a, b) => {
          const tA = new Date(getRecordDateString(a.timestamp || (a as any).createdAt) || 0).getTime();
          const tB = new Date(getRecordDateString(b.timestamp || (b as any).createdAt) || 0).getTime();
          return tB - tA;
        });
        setFinance(records);
        setLoading(false);
      }, (err) => {
        handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/finance`);
      });

      // Live listener for ledger entries (Front Desk payments, room charges, F&B settlements)
      unsubLedger = onSnapshot(collection(db, 'hotels', hotel.id, 'ledger'), (snap) => {
        const entries = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry));
        entries.sort((a, b) => {
          const tA = new Date(getRecordDateString(a.timestamp || (a as any).createdAt) || 0).getTime();
          const tB = new Date(getRecordDateString(b.timestamp || (b as any).createdAt) || 0).getTime();
          return tB - tA;
        });
        setLedgerEntries(entries);
        setLedgerLoaded(true);
        setLoading(false);
      }, () => {
        setLedgerLoaded(true);
      });
    }

    return () => {
      unsubHotels();
      unsubRooms();
      unsubRes();
      unsubBlockings();
      unsubDebts();
      unsubFinance();
      unsubLedger();
    };
  }, [profile?.role, profile?.uid, hotel?.id]);

  const handleRefresh = () => {
    setRefreshing(true);
    setTimeout(() => {
      setRefreshing(false);
      toast.success('Dashboard live data synchronized', { duration: 1500 });
    }, 400);
  };

  // Robust helper to determine if a timestamp or record corresponds to today
  const isRecordToday = (ts: any): boolean => {
    if (!ts) return false;
    let d: Date | null = null;
    if (typeof ts?.toDate === 'function') {
      try { d = ts.toDate(); } catch {}
    } else if (typeof ts?.seconds === 'number') {
      d = new Date(ts.seconds * 1000);
    } else if (typeof (ts as any)?._seconds === 'number') {
      d = new Date((ts as any)._seconds * 1000);
    } else if (ts instanceof Date) {
      d = ts;
    } else if (typeof ts === 'string') {
      d = new Date(ts);
    }
    if (!d || !isValid(d)) return false;

    const todayLocal = format(new Date(), 'yyyy-MM-dd');
    const todayUTC = new Date().toISOString().slice(0, 10);
    const dLocal = format(d, 'yyyy-MM-dd');
    const dUTC = d.toISOString().slice(0, 10);

    return isToday(d) || dLocal === todayLocal || dUTC === todayUTC || dLocal === todayUTC || dUTC === todayLocal;
  };

  // Active in-house reservations (actual guests checked in)
  const inHouseReservations = useMemo(() => {
    return activeReservations.filter(r => r.status === 'checked_in');
  }, [activeReservations]);

  // Exact Active Guests count: 1 guest checked in = 1 active guest
  const activeGuestsCount = inHouseReservations.length;

  // Actual occupied rooms: rooms that currently hold an in-house checked-in guest
  const occupiedRoomsCount = useMemo(() => {
    return rooms.filter(r => inHouseReservations.some(res => res.roomId === r.id)).length;
  }, [rooms, inHouseReservations]);

  const occupancyRate = rooms.length > 0 ? Math.round((occupiedRoomsCount / rooms.length) * 100) : 0;

  // Dirty rooms: vacant rooms that need cleaning
  const dirtyRoomsCount = useMemo(() => {
    return rooms.filter(r => {
      if (inHouseReservations.some(res => res.roomId === r.id)) return false;
      return getRoomDisplayStatus(r, activeReservations, blockings) === 'dirty' || r.status === 'dirty';
    }).length;
  }, [rooms, inHouseReservations, activeReservations, blockings]);

  // LIVE CALCULATION: Overall outstanding amount owing across the hotel
  const inHouseOutstanding = inHouseReservations.reduce((acc, res) => {
    const balance = getReservationLiveBalance(res, hotel, validLedgerEntries);
    return acc + Math.max(0, balance);
  }, 0);

  const debtorReservationIds = new Set(validDebts.map(d => d.reservationId).filter(Boolean));
  const departedReservationsOwing = reservations
    .filter(r => r.status === 'checked_out' && !r.corporateId && !debtorReservationIds.has(r.id) && r.financialStatus !== 'SETTLED' && r.paymentStatus !== 'paid')
    .reduce((acc, r) => {
      const bal = getReservationLiveBalance(r, hotel, validLedgerEntries);
      if (bal <= 0.01) return acc;
      if (r.guestId) {
        const guestPersonalRes = reservations.filter(x => !x.corporateId && x.status !== 'cancelled' && x.guestId === r.guestId);
        const guestPos = calculateGuestFinancialPosition({ id: r.guestId, email: r.guestEmail }, guestPersonalRes, hotel, validLedgerEntries);
        if (guestPos.netAmountDue <= 0.01) return acc;
      }
      return acc + bal;
    }, 0);

  const debtorOutstanding = validDebts
    .filter(d => d.status === 'outstanding' || d.status === 'partially_paid')
    .reduce((acc, d) => acc + Math.max(0, d.outstandingAmount || 0), 0) + departedReservationsOwing;

  const totalOutstandingOwing = inHouseOutstanding + debtorOutstanding;

  // Identify actual payment ledger entries that do NOT already have a mirrored record in validFinance
  const unlinkedPaymentLedgerEntries = useMemo(() => {
    const financeIncome = validFinance.filter(f => f.type === 'income');
    const financeRefIds = new Set(financeIncome.map(f => f.referenceId).filter(Boolean));
    const financeInvoiceIds = new Set(financeIncome.map(f => (f as any).invoiceId).filter(Boolean));

    return validLedgerEntries.filter(e => {
      if (!isActualPaymentLedgerEntry(e)) return false;
      if (e.id && financeRefIds.has(e.id)) return false;
      if (e.referenceId && (financeInvoiceIds.has(e.referenceId) || financeRefIds.has(e.referenceId))) return false;

      const eDate = getRecordDateString(e.timestamp || (e as any).createdAt);
      const eTs = new Date(eDate || 0).getTime();
      const eAmt = Number(e.amount) || 0;

      const hasMirroredFinance = financeIncome.some(f => {
        const fTs = new Date(getRecordDateString(f.timestamp || (f as any).createdAt) || 0).getTime();
        if (f.referenceId && e.referenceId && e.referenceId.startsWith(`${f.referenceId}_`)) {
          if (Math.abs((Number(f.amount) || 0) - eAmt) < 0.01) return true;
          if (fTs && eTs && Math.abs(fTs - eTs) <= 120000) return true;
        }
        const fAmt = Number(f.amount) || 0;
        if (Math.abs(fAmt - eAmt) >= 0.01) return false;
        if (e.corporateId && f.referenceId === e.corporateId) return true;
        if (e.reservationId && (f as any).reservationId === e.reservationId) return true;
        if (fTs && eTs && Math.abs(fTs - eTs) <= 120000) return true;
        return false;
      });

      return !hasMirroredFinance;
    });
  }, [validFinance, validLedgerEntries]);

  // Total Collected: Authoritative verified money collected matching Finance -> Overview
  const totalRevenue = useMemo(() => {
    if (!canViewFinances) return 0;

    const financeIncomeTotal = validFinance
      .filter(f => f.type === 'income')
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    const unlinkedLedgerTotal = unlinkedPaymentLedgerEntries
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    return Number((financeIncomeTotal + unlinkedLedgerTotal).toFixed(2));
  }, [canViewFinances, validFinance, unlinkedPaymentLedgerEntries]);

  const todayRevenue = useMemo(() => {
    if (!canViewFinances) return 0;
    const finToday = validFinance
      .filter(f => f.type === 'income' && isRecordToday(f.timestamp || (f as any).createdAt))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const ledgToday = unlinkedPaymentLedgerEntries
      .filter(e => isRecordToday(e.timestamp || (e as any).createdAt))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return Number((finToday + ledgToday).toFixed(2));
  }, [canViewFinances, validFinance, unlinkedPaymentLedgerEntries]);

  // Total actual financial transactions (matching Finance -> Transactions / Overview, excluding internal debit postings)
  const totalTransactionsCount = useMemo(() => {
    return validFinance.length + unlinkedPaymentLedgerEntries.length;
  }, [validFinance, unlinkedPaymentLedgerEntries]);

  // Count of actual financial transactions that occurred today across all departments
  const todayTransactionsCount = useMemo(() => {
    const todayFinanceCount = validFinance.filter(f => isRecordToday(f.timestamp || (f as any).createdAt)).length;
    const todayUnlinkedCount = unlinkedPaymentLedgerEntries.filter(e => isRecordToday(e.timestamp || (e as any).createdAt)).length;
    return todayFinanceCount + todayUnlinkedCount;
  }, [validFinance, unlinkedPaymentLedgerEntries]);

  // Staff individual collections for today
  const myCollectionsToday = useMemo(() => {
    if (!profile?.uid) return 0;
    const finMy = validFinance
      .filter(f => {
        const isMine = (f as any).postedBy === profile.uid || (f as any).userId === profile.uid;
        return isMine && f.type === 'income' && isRecordToday(f.timestamp || (f as any).createdAt);
      })
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    const ledgMy = unlinkedPaymentLedgerEntries
      .filter(e => {
        const isMine = e.postedBy === profile.uid || (e as any).userId === profile.uid;
        return isMine && isRecordToday(e.timestamp || (e as any).createdAt);
      })
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);

    return Number((finMy + ledgMy).toFixed(2));
  }, [profile?.uid, unlinkedPaymentLedgerEntries, validFinance]);

  // Process revenue chart data for last 7 days
  const revenueChartData = useMemo(() => {
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - i);
      return d.toISOString().split('T')[0];
    }).reverse();

    return last7Days.map(date => {
      const finDay = validFinance
        .filter(r => r.type === 'income' && getRecordDateString(r.timestamp || (r as any).createdAt).startsWith(date))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      const ledgDay = unlinkedPaymentLedgerEntries
        .filter(e => getRecordDateString(e.timestamp || (e as any).createdAt).startsWith(date))
        .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
      return {
        name: new Date(date).toLocaleDateString([], { weekday: 'short' }),
        amount: Number((finDay + ledgDay).toFixed(2))
      };
    });
  }, [validFinance, unlinkedPaymentLedgerEntries]);

  const previousRevenue = useMemo(() => {
    if (!canViewFinances) return 0;
    const todayStr = new Date().toISOString().split('T')[0];
    const finPrev = validFinance
      .filter(f => f.type === 'income' && !getRecordDateString(f.timestamp || (f as any).createdAt).startsWith(todayStr))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    const ledgPrev = unlinkedPaymentLedgerEntries
      .filter(e => !getRecordDateString(e.timestamp || (e as any).createdAt).startsWith(todayStr))
      .reduce((acc, curr) => acc + (Number(curr.amount) || 0), 0);
    return Number((finPrev + ledgPrev).toFixed(2));
  }, [canViewFinances, validFinance, unlinkedPaymentLedgerEntries]);

  const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  // Combined recent transactions for dashboard feed
  const recentTransactionsFeed = useMemo(() => {
    if (validFinance.length > 0) return validFinance.slice(0, 5);
    return validLedgerEntries
      .filter(e => isActualPaymentLedgerEntry(e))
      .slice(0, 5)
      .map(e => ({
        id: e.id,
        description: e.description || 'Guest Payment',
        category: e.category === 'payment' ? 'Room Revenue' : (e.category || 'Payment'),
        type: 'income' as const,
        amount: e.amount,
        timestamp: e.timestamp
      }));
  }, [validFinance, validLedgerEntries]);

  // Role-Based Dashboard Stats Card Definition
  const stats = (profile?.role === 'superAdmin' && !hotel?.id)
    ? [
        { label: 'Total Hotels', value: allHotels.length, icon: BedDouble, color: 'text-blue-500' },
        { label: 'Active Subscriptions', value: allHotels.filter(h => h.subscriptionStatus === 'active').length, icon: CheckCircle2, color: 'text-emerald-500' },
        { label: 'Suspended', value: allHotels.filter(h => h.subscriptionStatus === 'suspended').length, icon: AlertCircle, color: 'text-red-500' },
        { label: 'Expired', value: allHotels.filter(h => h.subscriptionStatus === 'expired').length, icon: Clock, color: 'text-amber-500' },
      ]
    : canViewFinances
      ? [
          // Finance & Hotel Admin Visibility: Complete Financial Summary
          { 
            label: 'Occupancy', 
            value: `${occupancyRate}%`, 
            icon: BedDouble, 
            color: 'text-blue-500' 
          },
          { 
            label: 'Active Guests', 
            value: activeGuestsCount, 
            icon: Users, 
            color: 'text-emerald-500' 
          },
          { 
            label: 'Today Revenue', 
            value: formatCurrency(todayRevenue, currency, exchangeRate), 
            icon: TrendingUp, 
            color: 'text-amber-500',
            module: 'finance'
          },
          { 
            label: 'Total Collected', 
            value: formatCurrency(totalRevenue, currency, exchangeRate), 
            icon: DollarSign, 
            color: 'text-emerald-400',
            module: 'finance'
          },
          { 
            label: 'Total Transactions', 
            value: totalTransactionsCount, 
            icon: Receipt, 
            color: 'text-cyan-400',
            module: 'frontDesk'
          },
          { 
            label: 'Overall Outstanding', 
            value: formatCurrency(totalOutstandingOwing, currency, exchangeRate), 
            icon: AlertCircle, 
            color: 'text-red-500',
            module: 'frontDesk'
          },
          { 
            label: 'Dirty Rooms', 
            value: dirtyRoomsCount, 
            icon: AlertCircle, 
            color: 'text-amber-500' 
          },
        ].filter(s => !s.module || isModuleEnabled(hotel, s.module))
      : [
          // General Staff Visibility
          { 
            label: 'My Collections Today', 
            value: formatCurrency(myCollectionsToday, currency, exchangeRate), 
            icon: DollarSign, 
            color: 'text-emerald-400' 
          },
          { 
            label: 'Occupancy', 
            value: `${occupancyRate}%`, 
            icon: BedDouble, 
            color: 'text-blue-500' 
          },
          { 
            label: 'Active Guests', 
            value: activeGuestsCount, 
            icon: Users, 
            color: 'text-emerald-500' 
          },
          { 
            label: 'Total Transactions', 
            value: totalTransactionsCount, 
            icon: Receipt, 
            color: 'text-cyan-400' 
          },
          { 
            label: 'Overall Outstanding', 
            value: formatCurrency(totalOutstandingOwing, currency, exchangeRate), 
            icon: AlertCircle, 
            color: 'text-red-500' 
          },
          { 
            label: 'Dirty Rooms', 
            value: dirtyRoomsCount, 
            icon: AlertCircle, 
            color: 'text-amber-500' 
          },
        ];

  // Proactive Daily Revenue Threshold & Notification System
  const dailyRevenueThreshold = Number(
    hotel?.settings?.notifications?.dailyRevenueThreshold ??
    (hotel?.settings?.financial as any)?.dailyRevenueAlertThreshold ??
    0
  );

  const isDailyRevenueAlertEnabled = 
    hotel?.settings?.notifications?.enableDailyRevenueAlert ??
    (dailyRevenueThreshold > 0);

  const hasRevenueShortfall = 
    canViewFinances &&
    isDailyRevenueAlertEnabled &&
    dailyRevenueThreshold > 0 &&
    todayRevenue < dailyRevenueThreshold;

  const revenueShortfall = Math.max(0, dailyRevenueThreshold - todayRevenue);
  const revenuePercentAchieved = dailyRevenueThreshold > 0 
    ? Math.min(100, Math.round((todayRevenue / dailyRevenueThreshold) * 100))
    : 100;

  // Proactive alert notification trigger
  useEffect(() => {
    if (hasRevenueShortfall) {
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const alertKey = `daily_rev_shortfall_${hotel?.id}_${todayStr}`;
      const alerted = sessionStorage.getItem(alertKey);
      if (!alerted) {
        toast.warning(
          `Daily Revenue Alert: Today's revenue (${formatCurrency(todayRevenue, currency, exchangeRate)}) is below your set target of ${formatCurrency(dailyRevenueThreshold, currency, exchangeRate)}. Deficit: ${formatCurrency(revenueShortfall, currency, exchangeRate)}.`,
          { duration: 8000, id: 'daily-revenue-alert-toast' }
        );
        sessionStorage.setItem(alertKey, 'true');
      }
    }
  }, [hasRevenueShortfall, todayRevenue, dailyRevenueThreshold, revenueShortfall, hotel?.id, currency, exchangeRate]);

  const handleExportTransactions = () => {
    if (!canViewFinances) {
      toast.error('Permission denied: Financial records are restricted to Finance and Hotel Admin users.');
      return;
    }
    const dataToExport = (validFinance || []).slice(0, 100).map(f => ({
      Date: safeFormatTimestamp(f.timestamp, 'MMM d, yyyy HH:mm'),
      Type: f.type.toUpperCase(),
      Category: f.category,
      Description: f.description,
      Amount: f.amount,
      Method: f.paymentMethod
    }));
    exportToCSV(dataToExport, `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Transactions exported successfully');
  };

  if (!isSubscriptionActive && profile?.role !== 'superAdmin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-center">
        <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-2xl font-bold text-zinc-50 mb-2">Subscription Expired</h2>
        <p className="text-zinc-400 mb-6 max-w-md">
          Your hotel's subscription has expired or been suspended. Please contact the system owner to extend your access.
        </p>
        <button className="w-full sm:w-auto bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95">
          Extend Access
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-zinc-50 tracking-tight">Overview</h1>
          <p className="text-sm text-zinc-400">
            {profile?.role === 'superAdmin' && !hotel?.id ? 'System-wide analytics and control' : `Welcome back to ${hotel?.name || 'Hotel'}`}
          </p>
        </div>
        <button 
          onClick={handleRefresh}
          disabled={refreshing}
          className="p-1.5 sm:p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50 self-start sm:self-center"
          title="Refresh Data"
        >
          <RefreshCw size={18} className={refreshing ? "animate-spin text-emerald-500" : ""} />
        </button>
      </header>

      {/* Proactive Daily Revenue Threshold Deficit Alert */}
      {hasRevenueShortfall && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-lg backdrop-blur-sm">
          <div className="flex items-start gap-3.5">
            <div className="p-2.5 bg-amber-500/20 text-amber-400 rounded-xl shrink-0 mt-0.5">
              <AlertTriangle size={22} className="animate-pulse" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h4 className="text-sm font-bold text-amber-300">
                  Daily Revenue Alert • Target Shortfall Detected
                </h4>
                <span className="text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                  {revenuePercentAchieved}% of Target
                </span>
              </div>
              <p className="text-xs text-zinc-300 mt-1">
                Today's revenue is currently <span className="font-bold text-emerald-400">{formatCurrency(todayRevenue, currency, exchangeRate)}</span>, which is <span className="font-bold text-red-400">-{formatCurrency(revenueShortfall, currency, exchangeRate)}</span> below the admin threshold benchmark of <span className="font-bold text-zinc-100">{formatCurrency(dailyRevenueThreshold, currency, exchangeRate)}</span>.
              </p>
              {/* Progress Bar */}
              <div className="w-full bg-zinc-800/80 rounded-full h-1.5 mt-2.5 overflow-hidden max-w-md">
                <div 
                  className="bg-amber-400 h-full rounded-full transition-all duration-500" 
                  style={{ width: `${revenuePercentAchieved}%` }}
                />
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 self-end md:self-center shrink-0">
            <Link 
              to="/admin-settings" 
              className="text-xs font-bold text-amber-400 hover:text-amber-300 hover:underline px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 transition-colors"
            >
              Adjust Threshold
            </Link>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-3 sm:gap-4 md:gap-6">
        {loading && stats.length === 0 ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl md:rounded-2xl animate-pulse">
              <div className="w-6 h-6 bg-zinc-800 rounded-lg mb-3" />
              <div className="w-16 h-4 bg-zinc-800 rounded mb-2" />
              <div className="w-10 h-2 bg-zinc-800 rounded opacity-50" />
            </div>
          ))
        ) : (
          stats.map((stat) => (
            <div
              key={stat.label}
              className="bg-zinc-900 border border-zinc-800 p-3 sm:p-4 rounded-xl md:rounded-2xl hover:border-zinc-700 transition-colors cursor-default"
            >
              <div className="flex items-center justify-between mb-2">
                <div className={cn("p-1 sm:p-1.5 rounded-lg bg-zinc-950", stat.color)}>
                  <stat.icon size={16} />
                </div>
              </div>
              <div className="text-base sm:text-xl font-bold text-zinc-50 mb-0.5 truncate">{stat.value}</div>
              <div className="text-[7px] sm:text-[9px] font-bold text-zinc-500 uppercase tracking-wider">{stat.label}</div>
            </div>
          ))
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        <div className="lg:col-span-2 space-y-6 sm:space-y-8">
          {/* Revenue Chart - Strictly restricted to Finance and Hotel Admin */}
          {(profile?.role === 'superAdmin' || (canViewFinances && isModuleEnabled(hotel, 'finance'))) && (
            <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl">
              <div className="flex items-center justify-between mb-4 sm:mb-6">
                <div>
                  <h3 className="font-bold text-zinc-50 text-sm sm:text-base">Revenue Overview</h3>
                  <p className="text-[10px] text-zinc-500">Last 7 days performance</p>
                </div>
                <div className="flex items-center gap-1.5 text-emerald-500 text-xs sm:text-sm font-bold">
                  {revenueGrowth >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {Math.abs(Math.round(revenueGrowth))}%
                </div>
              </div>
              <div className="h-[200px] sm:h-[240px] w-full min-w-0 relative" style={{ minHeight: 200, width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={200} debounce={50} initialDimension={{ width: 500, height: 200 }}>
                  <AreaChart data={revenueChartData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={9} tickLine={false} axisLine={false} tickFormatter={(value) => currency === 'USD' ? `$${(value/exchangeRate).toFixed(0)}` : `₦${value.toLocaleString()}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px', fontSize: '10px' }}
                      itemStyle={{ color: '#10b981' }}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Recent Reservations */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-zinc-50 text-sm sm:text-base">Recent Reservations</h3>
              <Link to="/front-desk" target="_self" className="text-emerald-500 text-xs sm:text-sm font-medium hover:underline active:opacity-70 transition-opacity">View All</Link>
            </div>
            <div className="divide-y divide-zinc-800">
              {loading && reservations.length === 0 ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="p-3 sm:p-4 flex items-center justify-between animate-pulse">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-zinc-800 rounded-full" />
                      <div className="space-y-1.5">
                        <div className="w-20 h-2.5 bg-zinc-800 rounded" />
                        <div className="w-28 h-2 bg-zinc-800 rounded opacity-50" />
                      </div>
                    </div>
                    <div className="w-12 h-3 bg-zinc-800 rounded" />
                  </div>
                ))
              ) : reservations.length === 0 ? (
                <div className="p-6 sm:p-8 text-center text-zinc-500 text-xs">No recent reservations</div>
              ) : (
                reservations.slice(0, 5).map(res => (
                  <div key={res.id} className="p-3 sm:p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-3 sm:gap-4">
                      <div className="w-8 h-8 sm:w-10 sm:h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                        <Users size={16} />
                      </div>
                      <div>
                        <div className="text-xs sm:text-sm font-medium text-zinc-50">{res.guestName}</div>
                        <div className="text-[10px] sm:text-xs text-zinc-500">Room {res.roomNumber} • {res.checkIn}</div>
                      </div>
                    </div>
                    <div className={cn(
                      "px-1.5 py-0.5 rounded text-[8px] sm:text-[10px] font-bold uppercase tracking-wider",
                      res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                      res.status === 'pending' ? "bg-blue-500/10 text-blue-500" : "bg-zinc-800 text-zinc-400"
                    )}>
                      {res.status.replace('_', ' ')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Recent Transactions - Strictly restricted to Finance and Hotel Admin */}
          {(profile?.role === 'superAdmin' || (canViewFinances && isModuleEnabled(hotel, 'finance'))) && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="px-4 sm:px-6 py-3 sm:py-4 border-b border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <DollarSign size={16} className="text-emerald-500" />
                  <h3 className="font-bold text-zinc-50 text-sm sm:text-base">Recent Transactions</h3>
                </div>
                <div className="flex items-center gap-3 sm:gap-4">
                  <button 
                    type="button"
                    onClick={handleExportTransactions}
                    className="text-zinc-400 hover:text-zinc-50 transition-colors"
                    title="Download Transactions"
                  >
                    <Download size={16} />
                  </button>
                  <Link to="/finance" target="_self" className="text-emerald-500 text-xs sm:text-sm font-medium hover:underline active:opacity-70 transition-opacity">View All</Link>
                </div>
              </div>
              <div className="divide-y divide-zinc-800">
                {loading && recentTransactionsFeed.length === 0 ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="p-3 sm:p-4 flex items-center justify-between animate-pulse">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className="w-8 h-8 sm:w-10 sm:h-10 bg-zinc-800 rounded-full" />
                        <div className="space-y-1.5">
                          <div className="w-20 h-2.5 bg-zinc-800 rounded" />
                          <div className="w-28 h-2 bg-zinc-800 rounded opacity-50" />
                        </div>
                      </div>
                      <div className="w-12 h-3 bg-zinc-800 rounded" />
                    </div>
                  ))
                ) : recentTransactionsFeed.length === 0 ? (
                  <div className="p-6 sm:p-8 text-center text-zinc-500 text-xs">No recent transactions</div>
                ) : (
                  (recentTransactionsFeed || []).slice(0, 5).map(record => (
                    <div key={record.id} className="p-3 sm:p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                      <div className="flex items-center gap-3 sm:gap-4">
                        <div className={cn(
                          "w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center",
                          record.type === 'income' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                        )}>
                          {record.type === 'income' ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                        </div>
                        <div>
                          <div className="text-xs sm:text-sm font-medium text-zinc-50">{record.description}</div>
                          <div className="text-[10px] text-zinc-500">{record.category} • {safeFormatTimestamp(record.timestamp, 'MMM d, HH:mm')}</div>
                        </div>
                      </div>
                      <div className={cn(
                        "text-xs sm:text-sm font-bold",
                        record.type === 'income' ? "text-emerald-500" : "text-red-500"
                      )}>
                        {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount, currency, exchangeRate)}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Action Stream Section */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col">
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-emerald-500" />
                <h3 className="font-bold text-zinc-50 text-sm">Action Stream</h3>
              </div>
              <Link to="/activity-logs" className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest hover:underline">View Audit logs</Link>
            </div>
            <div className="max-h-[500px] overflow-y-auto bg-zinc-950/20">
              <GlobalErrorBoundary fallback={<div className="p-6 text-center text-xs text-zinc-500">Activity stream temporarily unavailable</div>}>
                <ActionStreamMini hotelId={hotel?.id} profileRole={profile?.role} />
              </GlobalErrorBoundary>
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Room Status Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <h3 className="font-bold text-zinc-50 mb-6">Room Status</h3>
            <div className="space-y-4">
              {[
                { label: 'Vacant Clean', count: rooms.filter(r => getRoomDisplayStatus(r, activeReservations, blockings) === 'clean').length, color: 'bg-emerald-500' },
                { label: 'Occupied', count: rooms.filter(r => getRoomDisplayStatus(r, activeReservations, blockings) === 'occupied').length, color: 'bg-blue-500' },
                { label: 'Dirty', count: rooms.filter(r => getRoomDisplayStatus(r, activeReservations, blockings) === 'dirty').length, color: 'bg-red-500' },
                { label: 'Maintenance', count: rooms.filter(r => getRoomDisplayStatus(r, activeReservations, blockings) === 'maintenance').length, color: 'bg-amber-500' },
              ].map(item => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{item.label}</span>
                    <span className="text-zinc-50 font-medium">{item.count}</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full rounded-full transition-all duration-500", item.color)} 
                      style={{ width: `${rooms.length ? (item.count / rooms.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          {profile?.role !== 'superAdmin' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-zinc-50 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/front-desk" target="_self" className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl hover:border-emerald-500/50 transition-colors text-center">
                  <Calendar size={20} className="mx-auto mb-2 text-emerald-500" />
                  <span className="text-xs font-medium text-zinc-400">New Booking</span>
                </Link>
                <Link to="/rooms" target="_self" className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl hover:border-blue-500/50 transition-colors text-center">
                  <BedDouble size={20} className="mx-auto mb-2 text-blue-500" />
                  <span className="text-xs font-medium text-zinc-400">Room Status</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
</div>
  );
}
