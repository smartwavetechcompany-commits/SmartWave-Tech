import React, { useState, useEffect, useRef } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, KitchenOrder } from '../types';
import { getGracePeriodInfo, formatStayDuration } from '../utils/dateUtils';
import { formatCurrency, cn } from '../utils';
import { soundAlerts } from '../utils/soundAlerts';
import { 
  Volume2, 
  VolumeX, 
  Clock, 
  AlertTriangle, 
  DollarSign, 
  ChevronDown, 
  Bed, 
  Utensils, 
  CheckCircle2,
  Building2,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

export function SoundAlertIndicator() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const navigate = useNavigate();

  const [isMuted, setIsMuted] = useState<boolean>(() => soundAlerts.getIsMuted());
  const [activeReservations, setActiveReservations] = useState<Reservation[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);
  const [debtorReservations, setDebtorReservations] = useState<Reservation[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Subscribe to Sound Alert mute state changes
  useEffect(() => {
    return soundAlerts.subscribe((muted) => setIsMuted(muted));
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Listen to Firestore for checked_in reservations, kitchen orders, and debtor reservations
  useEffect(() => {
    if (!hotel?.id || !profile) return;

    // 1. In-house reservations (for overdue stay check)
    const unsubRes = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'reservations'), where('status', '==', 'checked_in')),
      (snap) => {
        setActiveReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
      },
      () => {}
    );

    // 2. Kitchen orders (for pending F&B settlements)
    const unsubOrders = onSnapshot(
      collection(db, 'hotels', hotel.id, 'kitchen_orders'),
      (snap) => {
        setKitchenOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenOrder)));
      },
      () => {}
    );

    // 3. Checked out reservations with debtor ledger balance
    const unsubDebtors = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'reservations'), where('status', '==', 'checked_out')),
      (snap) => {
        const debtors = snap.docs
          .map(doc => ({ id: doc.id, ...doc.data() } as Reservation))
          .filter(r => (r.ledgerBalance || 0) > 0.01);
        setDebtorReservations(debtors);
      },
      () => {}
    );

    return () => {
      unsubRes();
      unsubOrders();
      unsubDebtors();
    };
  }, [hotel?.id, profile?.uid]);

  // Compute overdue reservations:
  // A stay is overdue if current time has passed scheduled checkout + all hotel & custom grace periods!
  const now = new Date();
  const overdueReservations = activeReservations.filter(res => {
    const graceInfo = getGracePeriodInfo(res, hotel, now);
    return graceInfo.isOverstay;
  });

  // Compute pending settlement orders:
  // An F&B order needs settlement if direct balance owing > 0.01
  const pendingSettlementOrders = kitchenOrders.filter(order => {
    if (order.status === 'delivered') {
      const orderTotal = order.totalAmount || order.price || 0;
      let directPaid = 0;
      let roomCharged = 0;

      if (Array.isArray(order.payments) && order.payments.length > 0) {
        order.payments.forEach(p => {
          if (p.method === 'room') {
            roomCharged += (p.amount || 0);
          } else {
            directPaid += (p.amount || 0);
          }
        });
      } else if (order.paidAmount !== undefined) {
        if (order.paymentMethod === 'room') {
          roomCharged = order.paidAmount;
        } else {
          directPaid = order.paidAmount;
        }
      }

      const unsettledBalance = Math.max(0, orderTotal - directPaid - roomCharged);
      return unsettledBalance > 0.01;
    }
    return false;
  });

  const totalOverdueCount = overdueReservations.length;
  const totalSettlementCount = pendingSettlementOrders.length + debtorReservations.length;
  const hasActiveAlerts = totalOverdueCount > 0 || totalSettlementCount > 0;

  // Sound Beeping Loop:
  // Beeps periodically while overdue stays or pending settlements exist.
  // Stops as soon as reservations are checked out, postponed, given grace period, or orders settled!
  useEffect(() => {
    if (!hasActiveAlerts || isMuted) return;

    // Immediately play tone once upon detecting overdue stay or pending settlement
    if (totalOverdueCount > 0) {
      soundAlerts.playOverdueStayBeep();
    } else if (totalSettlementCount > 0) {
      soundAlerts.playPendingSettlementBeep();
    }

    // Interval loop for repeating alert beeping
    const intervalTimer = setInterval(() => {
      if (totalOverdueCount > 0) {
        soundAlerts.playOverdueStayBeep();
      } else if (totalSettlementCount > 0) {
        soundAlerts.playPendingSettlementBeep();
      }
    }, 16000); // repeats every 16 seconds

    return () => clearInterval(intervalTimer);
  }, [totalOverdueCount, totalSettlementCount, isMuted, hasActiveAlerts]);

  const toggleSound = () => {
    const nextMuted = soundAlerts.toggleMute();
    setIsMuted(nextMuted);
    if (!nextMuted) {
      toast.success('Audible notification sound alerts ENABLED');
      // Play a quick test confirmation beep
      if (totalOverdueCount > 0) {
        soundAlerts.playOverdueStayBeep();
      } else {
        soundAlerts.playPendingSettlementBeep();
      }
    } else {
      toast.info('Audible notification sound alerts MUTED');
    }
  };

  return (
    <div className="relative shrink-0" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border text-xs font-bold transition-all relative",
          hasActiveAlerts && !isMuted
            ? totalOverdueCount > 0
              ? "bg-red-500/15 border-red-500/40 text-red-400 ring-2 ring-red-500/30 animate-pulse"
              : "bg-amber-500/15 border-amber-500/40 text-amber-400 ring-1 ring-amber-500/30"
            : isMuted
            ? "bg-zinc-900 border-zinc-800 text-zinc-500 hover:text-zinc-300"
            : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
        )}
        title={
          hasActiveAlerts
            ? `${totalOverdueCount} Overdue Stay(s), ${totalSettlementCount} Pending Settlement(s)`
            : isMuted ? 'Sound alerts are muted' : 'Sound alerts active'
        }
      >
        {isMuted ? (
          <VolumeX size={16} className="text-zinc-500" />
        ) : (
          <Volume2 size={16} className={cn(hasActiveAlerts ? (totalOverdueCount > 0 ? "text-red-400 animate-bounce" : "text-amber-400") : "text-zinc-400")} />
        )}

        {hasActiveAlerts && (
          <div className="flex items-center gap-1">
            {totalOverdueCount > 0 && (
              <span className="px-1.5 py-0.2 bg-red-500 text-white rounded-full text-[10px] font-black leading-tight shadow-sm">
                {totalOverdueCount} Overdue
              </span>
            )}
            {totalSettlementCount > 0 && (
              <span className="px-1.5 py-0.2 bg-amber-500 text-black rounded-full text-[10px] font-black leading-tight shadow-sm">
                {totalSettlementCount} Settle
              </span>
            )}
          </div>
        )}

        <ChevronDown size={12} className={cn("transition-transform duration-200", isOpen && "rotate-180")} />
      </button>

      {/* Dropdown Popup */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.96 }}
            className="absolute right-0 mt-2 w-80 sm:w-96 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 z-[100] text-zinc-100"
          >
            {/* Header with Mute Toggle */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className={cn("p-1.5 rounded-lg", hasActiveAlerts ? "bg-red-500/10 text-red-400" : "bg-zinc-800 text-zinc-400")}>
                  {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-200">PMS Notification Sounds</h4>
                  <p className="text-[10px] text-zinc-400">
                    {isMuted ? 'Muted' : 'Beeping until resolved / settled'}
                  </p>
                </div>
              </div>

              <button
                type="button"
                onClick={toggleSound}
                className={cn(
                  "px-2.5 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1",
                  isMuted 
                    ? "bg-emerald-500 hover:bg-emerald-400 text-black" 
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                )}
              >
                {isMuted ? 'Unmute Sound' : 'Mute'}
              </button>
            </div>

            {/* Alert Explanation Banner */}
            <div className="py-2.5 text-[11px] text-zinc-400 leading-relaxed border-b border-zinc-800/80">
              Sounds actively repeat for:
              <ul className="list-disc list-inside mt-1 space-y-0.5 text-zinc-300 text-[10px]">
                <li><strong className="text-red-400">Overdue Stays:</strong> Beeps until checked out, postponed, or granted a grace period.</li>
                <li><strong className="text-amber-400">Pending Settlements:</strong> Beeps until outstanding balances or debts are settled.</li>
              </ul>
            </div>

            {/* Active Alert Items List */}
            <div className="mt-3 max-h-64 overflow-y-auto space-y-2.5 pr-1">
              {/* Overdue Stays Section */}
              {overdueReservations.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-red-400 mb-1 flex items-center gap-1">
                    <Clock size={12} /> Overdue Stays ({overdueReservations.length})
                  </div>
                  <div className="space-y-1.5">
                    {overdueReservations.map(res => {
                      const graceInfo = getGracePeriodInfo(res, hotel, now);
                      return (
                        <div
                          key={res.id}
                          onClick={() => {
                            setIsOpen(false);
                            navigate('/front-desk');
                          }}
                          className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/15 cursor-pointer transition-colors flex items-center justify-between"
                        >
                          <div>
                            <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                              <Bed size={13} className="text-red-400" />
                              Room {res.roomNumber} • {res.guestName}
                            </div>
                            <div className="text-[10px] text-red-300 mt-0.5">
                              {graceInfo.displayText || 'Grace expired overstay'}
                            </div>
                          </div>
                          <ExternalLink size={13} className="text-zinc-500" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pending F&B Settlement Section */}
              {pendingSettlementOrders.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                    <Utensils size={12} /> F&B Orders Needing Settlement ({pendingSettlementOrders.length})
                  </div>
                  <div className="space-y-1.5">
                    {pendingSettlementOrders.map(order => {
                      const orderTotal = order.totalAmount || order.price || 0;
                      let directPaid = 0;
                      let roomCharged = 0;
                      if (Array.isArray(order.payments)) {
                        order.payments.forEach(p => {
                          if (p.method === 'room') roomCharged += (p.amount || 0);
                          else directPaid += (p.amount || 0);
                        });
                      } else if (order.paidAmount !== undefined) {
                        if (order.paymentMethod === 'room') roomCharged = order.paidAmount;
                        else directPaid = order.paidAmount;
                      }
                      const balanceDue = Math.max(0, orderTotal - directPaid - roomCharged);

                      return (
                        <div
                          key={order.id}
                          onClick={() => {
                            setIsOpen(false);
                            navigate('/f-and-b');
                          }}
                          className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 cursor-pointer transition-colors flex items-center justify-between"
                        >
                          <div>
                            <div className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                              <Utensils size={13} className="text-amber-400" />
                              Room {order.roomNumber || 'Walk-in'} • Order #{order.id.slice(-6)}
                            </div>
                            <div className="text-[10px] text-amber-300 font-bold mt-0.5">
                              Owing: {formatCurrency(balanceDue, currency, exchangeRate)}
                            </div>
                          </div>
                          <ExternalLink size={13} className="text-zinc-500" />
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Debtor Reservations Section */}
              {debtorReservations.length > 0 && (
                <div>
                  <div className="text-[10px] font-bold uppercase tracking-wider text-amber-400 mb-1 flex items-center gap-1">
                    <DollarSign size={12} /> Departed Guest Debts ({debtorReservations.length})
                  </div>
                  <div className="space-y-1.5">
                    {debtorReservations.slice(0, 5).map(res => (
                      <div
                        key={res.id}
                        onClick={() => {
                          setIsOpen(false);
                          navigate('/finance');
                        }}
                        className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/15 cursor-pointer transition-colors flex items-center justify-between"
                      >
                        <div>
                          <div className="text-xs font-bold text-zinc-200">
                            {res.guestName} (Room {res.roomNumber})
                          </div>
                          <div className="text-[10px] text-amber-300 font-bold mt-0.5">
                            Balance Due: {formatCurrency(res.ledgerBalance || 0, currency, exchangeRate)}
                          </div>
                        </div>
                        <ExternalLink size={13} className="text-zinc-500" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!hasActiveAlerts && (
                <div className="py-6 text-center text-zinc-500 space-y-2">
                  <CheckCircle2 size={24} className="mx-auto text-emerald-500/60" />
                  <p className="text-xs text-zinc-400 font-medium">All stays on schedule and all balances settled.</p>
                  <p className="text-[10px] text-zinc-600">Audio will automatically chime when an overdue stay or unsettled balance occurs.</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
