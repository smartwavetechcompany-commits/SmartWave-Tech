import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, AuditLog } from '../types';
import { 
  History, 
  Calendar, 
  Clock, 
  User, 
  Shield, 
  Tag, 
  CreditCard, 
  DollarSign, 
  PlusCircle, 
  ArrowLeftRight, 
  Utensils, 
  Coffee, 
  LogOut, 
  LogIn, 
  Bed, 
  Sparkles, 
  CheckCircle2, 
  AlertTriangle, 
  Building, 
  Building2, 
  RotateCcw, 
  Trash2, 
  Sliders, 
  Search, 
  Filter, 
  ArrowDownUp, 
  Printer, 
  ChevronDown, 
  ChevronUp, 
  Radio,
  FileSpreadsheet
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format, parseISO, isValid } from 'date-fns';

interface GuestActivityTimelineProps {
  reservation: Reservation;
  className?: string;
}

export const GuestActivityTimeline: React.FC<GuestActivityTimelineProps> = ({
  reservation,
  className
}) => {
  const { hotel, currency, exchangeRate } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'stay' | 'financial' | 'service'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());

  // Real-time listener on hotel's activityLogs (same audit records used by AuditLog)
  useEffect(() => {
    if (!hotel?.id || !reservation?.id) return;

    setLoading(true);
    const activityLogsRef = collection(db, 'hotels', hotel.id, 'activityLogs');
    
    // Subscribe to real-time updates
    const unsubscribe = onSnapshot(
      activityLogsRef,
      (snapshot) => {
        const fetchedLogs: AuditLog[] = [];
        const resId = reservation.id;
        const shortResId = resId.slice(-6).toUpperCase();
        const guestId = reservation.guestId;

        snapshot.forEach((doc) => {
          const data = doc.data() as any;
          
          // Match criteria to ensure every action linked to this guest reservation is included:
          const matchesReservation = 
            data.reservationId === resId ||
            data.targetId === resId ||
            data.metadata?.reservationId === resId ||
            (data.details && (data.details.includes(resId) || data.details.includes(shortResId))) ||
            (data.after?.reservationId === resId || data.before?.reservationId === resId);

          const matchesGuest = 
            guestId && (
              data.guestId === guestId ||
              data.metadata?.guestId === guestId ||
              (data.targetId === guestId && data.module === 'Front Desk')
            );

          if (matchesReservation || matchesGuest) {
            fetchedLogs.push({
              id: doc.id,
              ...data,
              timestamp: data.timestamp || data.createdAt || new Date().toISOString(),
              actor: data.actor || data.user || data.userName || data.userEmail || 'System User',
              userRole: data.userRole || data.role || 'Staff'
            } as AuditLog);
          }
        });

        // Default sort descending (most recent first)
        fetchedLogs.sort((a, b) => {
          const tA = new Date(a.timestamp).getTime() || 0;
          const tB = new Date(b.timestamp).getTime() || 0;
          return tB - tA;
        });

        setLogs(fetchedLogs);
        setLoading(false);
      },
      (err) => {
        console.error('Error streaming guest activity timeline:', err);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [hotel?.id, reservation?.id, reservation?.guestId]);

  // Toggle log expansion for deep metadata inspection
  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // Helper for categorizing action tags
  const getActionCategory = (action: string, module?: string): 'stay' | 'financial' | 'service' => {
    const act = (action || '').toUpperCase();
    const mod = (module || '').toUpperCase();

    if (
      act.includes('PAYMENT') || 
      act.includes('SETTLE') || 
      act.includes('REFUND') || 
      act.includes('DISCOUNT') || 
      act.includes('TRANSFER') || 
      act.includes('VOID') || 
      act.includes('CHARGE') || 
      act.includes('OVERSTAY') || 
      act.includes('LEDGER') ||
      mod.includes('FINANCE')
    ) {
      return 'financial';
    }

    if (
      act.includes('BREAKFAST') || 
      act.includes('RESTAURANT') || 
      act.includes('F&B') || 
      act.includes('F & B') || 
      act.includes('DINING') || 
      act.includes('LAUNDRY') || 
      act.includes('SERVICE') || 
      mod.includes('DINING') || 
      mod.includes('KITCHEN')
    ) {
      return 'service';
    }

    return 'stay';
  };

  // Icon, visual badge & clean title for action types
  const getActionVisuals = (action: string) => {
    const act = (action || '').toUpperCase();

    if (act === 'RESERVATION_CREATED' || act === 'CREATE_BOOKING') {
      return {
        label: 'Reservation Created',
        icon: PlusCircle,
        badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
        dotClass: 'bg-blue-500'
      };
    }
    if (act === 'CHECK_IN') {
      return {
        label: 'Guest Checked In',
        icon: LogIn,
        badgeClass: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30',
        dotClass: 'bg-emerald-500'
      };
    }
    if (act === 'CHECK_OUT' || act === 'FINALIZE_CHECKOUT') {
      return {
        label: 'Guest Checked Out',
        icon: LogOut,
        badgeClass: 'bg-zinc-500/10 text-zinc-300 border-zinc-500/30',
        dotClass: 'bg-zinc-400'
      };
    }
    if (act === 'ROOM_CHANGED' || act === 'ROOM_TRANSFER') {
      return {
        label: 'Room Changed / Transfer',
        icon: ArrowLeftRight,
        badgeClass: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
        dotClass: 'bg-purple-500'
      };
    }
    if (act === 'STAY_EXTENDED' || act === 'RESERVATION_POSTPONED') {
      return {
        label: 'Stay Extended',
        icon: Calendar,
        badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
        dotClass: 'bg-amber-500'
      };
    }
    if (act === 'OVERSTAY_CHARGED' || act === 'OVERSTAY_CHARGE_POSTED') {
      return {
        label: 'Overstay Charge Posted',
        icon: AlertTriangle,
        badgeClass: 'bg-amber-600/10 text-amber-500 border-amber-600/30',
        dotClass: 'bg-amber-500'
      };
    }
    if (act === 'ROOM_CHARGE_POSTED') {
      return {
        label: 'Room Charge Posted',
        icon: Bed,
        badgeClass: 'bg-sky-500/10 text-sky-400 border-sky-500/30',
        dotClass: 'bg-sky-500'
      };
    }
    if (act === 'PAYMENT_RECEIVED' || act === 'SETTLE_PAYMENT' || act === 'PAYMENT') {
      return {
        label: 'Payment Settle / Received',
        icon: CreditCard,
        badgeClass: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
        dotClass: 'bg-emerald-400'
      };
    }
    if (act === 'REFUND_PROCESSED' || act === 'REFUND') {
      return {
        label: 'Refund Processed',
        icon: RotateCcw,
        badgeClass: 'bg-rose-500/15 text-rose-400 border-rose-500/40',
        dotClass: 'bg-rose-500'
      };
    }
    if (act === 'DISCOUNT_APPLIED' || act === 'DISCOUNT') {
      return {
        label: 'Discount Applied',
        icon: Tag,
        badgeClass: 'bg-pink-500/15 text-pink-400 border-pink-500/40',
        dotClass: 'bg-pink-400'
      };
    }
    if (act === 'BALANCE_TRANSFERRED' || act === 'TRANSFER') {
      return {
        label: 'Balance Transferred',
        icon: ArrowDownUp,
        badgeClass: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/40',
        dotClass: 'bg-cyan-400'
      };
    }
    if (act === 'DEBT_TRANSFERRED' || act === 'CITY_LEDGER') {
      return {
        label: 'Debt Transferred to City Ledger',
        icon: Building2,
        badgeClass: 'bg-indigo-500/15 text-indigo-400 border-indigo-500/40',
        dotClass: 'bg-indigo-400'
      };
    }
    if (act === 'BREAKFAST_SERVED') {
      return {
        label: 'Breakfast Served',
        icon: Coffee,
        badgeClass: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
        dotClass: 'bg-amber-400'
      };
    }
    if (act === 'BREAKFAST_UNMARKED') {
      return {
        label: 'Breakfast Unmarked / Pending',
        icon: Clock,
        badgeClass: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
        dotClass: 'bg-zinc-500'
      };
    }
    if (act === 'RESTAURANT_ORDER' || act.includes('F&B') || act.includes('F & B')) {
      return {
        label: 'Restaurant / F&B Order',
        icon: Utensils,
        badgeClass: 'bg-orange-500/15 text-orange-400 border-orange-500/40',
        dotClass: 'bg-orange-400'
      };
    }
    if (act === 'TRANSACTION_VOIDED' || act === 'LEDGER_ENTRY_VOIDED') {
      return {
        label: 'Transaction Voided & Reversed',
        icon: Trash2,
        badgeClass: 'bg-red-500/15 text-red-400 border-red-500/40',
        dotClass: 'bg-red-500'
      };
    }
    if (act === 'SERVICE_POSTED' || act === 'SERVICE_CHARGE_POSTED') {
      return {
        label: 'Service Charge Posted',
        icon: Sparkles,
        badgeClass: 'bg-teal-500/15 text-teal-300 border-teal-500/40',
        dotClass: 'bg-teal-400'
      };
    }

    // Default fallback
    return {
      label: action.replace(/_/g, ' '),
      icon: History,
      badgeClass: 'bg-zinc-800 text-zinc-300 border-zinc-700',
      dotClass: 'bg-zinc-400'
    };
  };

  // Format timestamp helper
  const formatEventDate = (timestampStr: string) => {
    try {
      const date = parseISO(timestampStr);
      if (isValid(date)) {
        return {
          dateStr: format(date, 'MMM dd, yyyy'),
          timeStr: format(date, 'hh:mm:ss a'),
          relative: format(date, 'HH:mm')
        };
      }
    } catch {
      // Fallback
    }
    return { dateStr: timestampStr, timeStr: '', relative: '' };
  };

  // Filtered and sorted logs
  const filteredLogs = useMemo(() => {
    let result = [...logs];

    // Filter by Category
    if (categoryFilter !== 'all') {
      result = result.filter((log) => getActionCategory(log.action, log.module) === categoryFilter);
    }

    // Filter by Search Query
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter((log) => {
        const actionStr = (log.action || '').toLowerCase();
        const detailsStr = (log.details || '').toLowerCase();
        const actorStr = (log.actor || '').toLowerCase();
        const roleStr = (log.userRole || '').toLowerCase();
        const moduleStr = (log.module || '').toLowerCase();
        return (
          actionStr.includes(q) ||
          detailsStr.includes(q) ||
          actorStr.includes(q) ||
          roleStr.includes(q) ||
          moduleStr.includes(q)
        );
      });
    }

    // Sort order
    result.sort((a, b) => {
      const tA = new Date(a.timestamp).getTime() || 0;
      const tB = new Date(b.timestamp).getTime() || 0;
      return sortOrder === 'desc' ? tB - tA : tA - tB;
    });

    return result;
  }, [logs, categoryFilter, searchQuery, sortOrder]);

  // Print Timeline function
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className={cn("space-y-4", className)}>
      {/* Timeline Controls & Filter Bar */}
      <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-5 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800/80 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <History size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold text-zinc-100 uppercase tracking-wider">
                  Guest Activity Timeline
                </h3>
                <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Real-Time Sync
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Authoritative audit record of every guest folio transaction and account operation
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            <button
              type="button"
              onClick={() => setSortOrder(prev => prev === 'desc' ? 'asc' : 'desc')}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center gap-1.5 transition-colors"
              title="Toggle Chronological Direction"
            >
              <ArrowDownUp size={13} className="text-zinc-400" />
              <span>{sortOrder === 'desc' ? 'Newest First' : 'Oldest First'}</span>
            </button>

            <button
              type="button"
              onClick={handlePrint}
              className="px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-semibold text-zinc-300 flex items-center gap-1.5 transition-colors"
              title="Print Guest Activity Timeline"
            >
              <Printer size={13} className="text-zinc-400" />
              <span className="hidden sm:inline">Print Timeline</span>
            </button>
          </div>
        </div>

        {/* Filters Row */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
          {/* Category Chips */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 custom-scrollbar">
            <button
              type="button"
              onClick={() => setCategoryFilter('all')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap",
                categoryFilter === 'all'
                  ? "bg-zinc-100 text-black shadow-sm"
                  : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
              )}
            >
              All Events ({logs.length})
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('stay')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5",
                categoryFilter === 'stay'
                  ? "bg-blue-500 text-white shadow-sm"
                  : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
              )}
            >
              <Bed size={12} />
              <span>Stays & Rooms</span>
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('financial')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5",
                categoryFilter === 'financial'
                  ? "bg-emerald-500 text-black shadow-sm"
                  : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
              )}
            >
              <DollarSign size={12} />
              <span>Billing & Payments</span>
            </button>

            <button
              type="button"
              onClick={() => setCategoryFilter('service')}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5",
                categoryFilter === 'service'
                  ? "bg-amber-500 text-black shadow-sm"
                  : "bg-zinc-900/90 text-zinc-400 hover:text-zinc-200 border border-zinc-800"
              )}
            >
              <Utensils size={12} />
              <span>Dining & Services</span>
            </button>
          </div>

          {/* Search Box */}
          <div className="relative min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search actions, staff, details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-200 placeholder-zinc-500 outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
        </div>
      </div>

      {/* Timeline Stream */}
      <div className="bg-zinc-950 border border-zinc-800/90 rounded-2xl p-4 sm:p-6 shadow-sm">
        {loading ? (
          <div className="py-12 flex flex-col items-center justify-center text-zinc-500 space-y-3">
            <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-xs font-medium tracking-wide">Loading verified audit log entries...</p>
          </div>
        ) : filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-zinc-500 space-y-2">
            <History size={36} className="mx-auto text-zinc-600 mb-2 opacity-50" />
            <p className="text-sm font-semibold text-zinc-400">No matching activity records found</p>
            <p className="text-xs text-zinc-500 max-w-sm mx-auto">
              {searchQuery || categoryFilter !== 'all'
                ? 'Try adjusting your search query or switching to all events.'
                : 'All actions performed on this folio (bookings, room changes, charges, payments, settlements) will permanently appear here in real time.'}
            </p>
          </div>
        ) : (
          <div className="relative pl-6 sm:pl-8 before:absolute before:left-3 sm:before:left-4 before:top-3 before:bottom-3 before:w-0.5 before:bg-zinc-800 space-y-6">
            {filteredLogs.map((log) => {
              const visuals = getActionVisuals(log.action);
              const Icon = visuals.icon;
              const { dateStr, timeStr } = formatEventDate(log.timestamp);
              const isExpanded = expandedLogIds.has(log.id);

              return (
                <div key={log.id} className="relative group">
                  {/* Timeline Dot Marker */}
                  <div className={cn(
                    "absolute -left-6 sm:-left-8 top-1.5 w-3.5 h-3.5 rounded-full border-2 border-zinc-950 ring-2 ring-zinc-800/80 transition-all group-hover:scale-125",
                    visuals.dotClass
                  )} />

                  {/* Timeline Item Card */}
                  <div className="bg-zinc-900/60 hover:bg-zinc-900/90 border border-zinc-800/80 hover:border-zinc-700/80 rounded-xl p-4 transition-all">
                    {/* Header Row */}
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      {/* Action Tag & Icon */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={cn(
                          "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-bold border",
                          visuals.badgeClass
                        )}>
                          <Icon size={13} />
                          <span>{visuals.label}</span>
                        </span>

                        {log.module && (
                          <span className="text-[10px] font-semibold text-zinc-400 bg-zinc-800/80 px-2 py-0.5 rounded-md border border-zinc-700/50">
                            {log.module}
                          </span>
                        )}
                      </div>

                      {/* Timestamp */}
                      <div className="text-right">
                        <div className="text-xs font-mono font-semibold text-zinc-300">
                          {timeStr}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-mono">
                          {dateStr}
                        </div>
                      </div>
                    </div>

                    {/* Action Description / Details */}
                    <div className="mt-2 text-xs text-zinc-200 leading-relaxed">
                      {log.details || log.action}
                    </div>

                    {/* Meta Bar: Actor User & Role */}
                    <div className="mt-3 pt-3 border-t border-zinc-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
                      <div className="flex items-center gap-3">
                        <div className="flex items-center gap-1.5 text-zinc-400">
                          <User size={13} className="text-zinc-500" />
                          <span className="font-semibold text-zinc-200">
                            {log.actor || 'System'}
                          </span>
                        </div>

                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider bg-zinc-800 text-zinc-300 border border-zinc-700/60">
                          <Shield size={10} className="text-zinc-400" />
                          {log.userRole || 'Staff'}
                        </span>

                        {log.metadata?.roomNumber && (
                          <span className="text-[10px] text-zinc-400 bg-zinc-800/50 px-2 py-0.5 rounded border border-zinc-700/40">
                            Room {log.metadata.roomNumber}
                          </span>
                        )}
                      </div>

                      {/* State Diff / Expand Button if Before/After exists */}
                      {(log.before || log.after || log.metadata) && (
                        <button
                          type="button"
                          onClick={() => toggleExpand(log.id)}
                          className="text-[11px] font-semibold text-zinc-400 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                        >
                          <span>{isExpanded ? 'Hide Details' : 'View Details'}</span>
                          {isExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                      )}
                    </div>

                    {/* Expandable Deep Audit Metadata Panel */}
                    {isExpanded && (
                      <div className="mt-3 pt-3 border-t border-zinc-800/80 space-y-2 text-[11px]">
                        {/* State Change Comparison if available */}
                        {(log.before || log.after) && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 bg-zinc-950/70 p-3 rounded-xl border border-zinc-800">
                            {log.before && (
                              <div>
                                <span className="text-[10px] font-bold uppercase text-zinc-500 block mb-1">
                                  State Before Change:
                                </span>
                                <pre className="font-mono text-[10px] text-red-400/90 whitespace-pre-wrap overflow-x-auto bg-black/40 p-2 rounded-lg border border-red-500/10">
                                  {typeof log.before === 'string' ? log.before : JSON.stringify(log.before, null, 2)}
                                </pre>
                              </div>
                            )}
                            {log.after && (
                              <div>
                                <span className="text-[10px] font-bold uppercase text-emerald-500/80 block mb-1">
                                  State After Change:
                                </span>
                                <pre className="font-mono text-[10px] text-emerald-400/90 whitespace-pre-wrap overflow-x-auto bg-black/40 p-2 rounded-lg border border-emerald-500/10">
                                  {typeof log.after === 'string' ? log.after : JSON.stringify(log.after, null, 2)}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Extra Metadata */}
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div className="bg-zinc-950/50 p-2.5 rounded-xl border border-zinc-800/60 flex flex-wrap gap-2 items-center text-[10px] font-mono">
                            {Object.entries(log.metadata).map(([key, val]) => (
                              <span key={key} className="px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-300">
                                <span className="text-zinc-500">{key}:</span> {typeof val === 'object' ? JSON.stringify(val) : String(val)}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
