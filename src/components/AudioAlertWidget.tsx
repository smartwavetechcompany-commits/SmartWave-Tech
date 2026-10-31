import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Volume2, VolumeX, AlertTriangle, Clock, DollarSign, ChevronRight, X, BellRing } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { Reservation, KitchenOrder } from '../types';
import { getGracePeriodInfo } from '../utils/dateUtils';
import { getReservationLiveBalance } from '../utils/billingEngine';
import { soundAlertManager } from '../utils/audioAlerts';
import { useNavigate } from 'react-router-dom';
import { cn, formatCurrency } from '../utils';
import { motion, AnimatePresence } from 'motion/react';

export function AudioAlertWidget() {
  const { hotel, currency, exchangeRate } = useAuth();
  const navigate = useNavigate();

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [kitchenOrders, setKitchenOrders] = useState<KitchenOrder[]>([]);
  const [isMuted, setIsMuted] = useState(soundAlertManager.getIsMuted());
  const [isOpen, setIsOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const [isAudioUnlocked, setIsAudioUnlocked] = useState(false);
  const [lastBeepAt, setLastBeepAt] = useState<number>(0);

  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync mute state
  useEffect(() => {
    const unsub = soundAlertManager.subscribe((muted) => setIsMuted(muted));
    return () => {
      unsub();
    };
  }, []);

  // Update clock every 30 seconds
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
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

  // Unlock AudioContext on first user interaction
  useEffect(() => {
    const handleUserInteraction = () => {
      soundAlertManager.unlockAudio();
      setIsAudioUnlocked(true);
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
    };
    window.addEventListener('click', handleUserInteraction, { once: true });
    window.addEventListener('keydown', handleUserInteraction, { once: true });
    return () => {
      window.removeEventListener('click', handleUserInteraction);
      window.removeEventListener('keydown', handleUserInteraction);
    };
  }, []);

  // Listen to active reservations (checked_in and checked_out for debtors)
  useEffect(() => {
    if (!hotel?.id) return;

    const q = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('status', 'in', ['checked_in', 'checked_out'])
    );

    const unsub = onSnapshot(q, (snap) => {
      setReservations(snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation)));
    }, () => {});

    return () => unsub();
  }, [hotel?.id]);

  // Listen to kitchen orders
  useEffect(() => {
    if (!hotel?.id) return;

    const unsub = onSnapshot(
      collection(db, 'hotels', hotel.id, 'kitchen_orders'),
      (snap) => {
        setKitchenOrders(snap.docs.map(d => ({ id: d.id, ...d.data() } as KitchenOrder)));
      },
      () => {}
    );

    return () => unsub();
  }, [hotel?.id]);

  // Identify overdue stays
  const overdueStays = useMemo(() => {
    if (!hotel) return [];
    return reservations.filter(res => {
      if (res.status !== 'checked_in') return false;
      const info = getGracePeriodInfo(res, hotel, now);
      return info.isOverstay === true;
    });
  }, [reservations, hotel, now]);

  // Identify pending settlements
  const pendingSettlements = useMemo(() => {
    if (!hotel) return { checkedInFolios: [], debtorFolios: [], fbOrders: [] };

    // 1. In-house checked_in with balance > 0
    const checkedInFolios = reservations.filter(res => {
      if (res.status !== 'checked_in') return false;
      const balance = getReservationLiveBalance(res, hotel);
      return balance > 0.01;
    });

    // 2. Departed / debtor with balance > 0
    const debtorFolios = reservations.filter(res => {
      if (res.status !== 'checked_out') return false;
      const balance = getReservationLiveBalance(res, hotel);
      return balance > 0.01;
    });

    // 3. F&B orders that have unpaid balance
    const fbOrders = kitchenOrders.filter(order => {
      const orderTotal = order.totalAmount || order.price || 0;
      let directPaid = 0;
      if (Array.isArray(order.payments) && order.payments.length > 0) {
        directPaid = order.payments
          .filter(p => p.method !== 'room')
          .reduce((sum, p) => sum + (p.amount || 0), 0);
      } else if (order.paidAmount !== undefined && order.paidAmount > 0 && order.paymentMethod !== 'room') {
        directPaid = order.paidAmount;
      }
      const remaining = orderTotal - directPaid;
      return remaining > 0.01;
    });

    return { checkedInFolios, debtorFolios, fbOrders };
  }, [reservations, kitchenOrders, hotel]);

  const totalOverdueCount = overdueStays.length;
  const totalSettlementCount = 
    pendingSettlements.checkedInFolios.length + 
    pendingSettlements.debtorFolios.length + 
    pendingSettlements.fbOrders.length;

  const hasActiveAlerts = totalOverdueCount > 0 || totalSettlementCount > 0;

  // Periodic Beeping Engine: keeps beeping until resolved!
  useEffect(() => {
    if (!hasActiveAlerts || isMuted) return;

    // Trigger an initial beep
    const alertType = totalOverdueCount > 0 ? 'overdue' : 'settlement';
    soundAlertManager.playAlertBeep(alertType);
    setLastBeepAt(Date.now());

    // Loop every 12 seconds
    const interval = setInterval(() => {
      soundAlertManager.playAlertBeep(alertType);
      setLastBeepAt(Date.now());
    }, 12000);

    return () => clearInterval(interval);
  }, [hasActiveAlerts, isMuted, totalOverdueCount, totalSettlementCount]);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundAlertManager.unlockAudio();
    soundAlertManager.setMuted(!isMuted);
  };

  const handleOpenDropdown = () => {
    soundAlertManager.unlockAudio();
    setIsOpen(!isOpen);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={handleOpenDropdown}
        className={cn(
          "relative p-2 rounded-xl transition-all duration-200 flex items-center justify-center cursor-pointer",
          hasActiveAlerts
            ? totalOverdueCount > 0
              ? "bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/30"
              : "bg-amber-500/15 text-amber-400 hover:bg-amber-500/25 border border-amber-500/30"
            : "text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800"
        )}
        title={
          hasActiveAlerts
            ? `${totalOverdueCount} Overdue Stay(s), ${totalSettlementCount} Pending Settlement(s) - Click to inspect or mute`
            : "System Sound Alerts: No pending overdue or settlement alerts"
        }
        aria-label="Audio alerts for overdue stays and settlements"
      >
        {isMuted ? (
          <VolumeX size={18} className="text-zinc-500" />
        ) : hasActiveAlerts ? (
          <BellRing size={18} className="animate-bounce" />
        ) : (
          <Volume2 size={18} />
        )}

        {/* Pulsing Alert Badge */}
        {hasActiveAlerts && (
          <span className="absolute -top-1 -right-1 flex h-4 w-4">
            <span className={cn(
              "animate-ping absolute inline-flex h-full w-full rounded-full opacity-75",
              totalOverdueCount > 0 ? "bg-red-400" : "bg-amber-400"
            )} />
            <span className={cn(
              "relative inline-flex rounded-full h-4 w-4 text-[9px] font-black items-center justify-center text-black",
              totalOverdueCount > 0 ? "bg-red-400" : "bg-amber-400"
            )}>
              {totalOverdueCount + totalSettlementCount}
            </span>
          </span>
        )}
      </button>

      {/* Dropdown Panel */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            className="absolute right-0 top-full mt-2 w-80 sm:w-96 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-4 z-50 overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <div className={cn(
                  "p-1.5 rounded-lg",
                  hasActiveAlerts ? (totalOverdueCount > 0 ? "bg-red-500/20 text-red-400" : "bg-amber-500/20 text-amber-400") : "bg-zinc-800 text-zinc-400"
                )}>
                  <Volume2 size={16} />
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-100 uppercase tracking-wider">
                    Audio Alert Watcher
                  </h4>
                  <p className="text-[10px] text-zinc-400">
                    Beeps continuously until resolved or settled
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={toggleMute}
                  className={cn(
                    "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-colors flex items-center gap-1",
                    isMuted
                      ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                      : "bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 hover:bg-emerald-500/20"
                  )}
                >
                  {isMuted ? <VolumeX size={12} /> : <Volume2 size={12} />}
                  {isMuted ? 'Unmute' : 'Mute'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="p-1 text-zinc-500 hover:text-zinc-300 rounded-lg hover:bg-zinc-800"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Content List */}
            <div className="py-3 space-y-3 max-h-[360px] overflow-y-auto custom-scrollbar">
              {/* Overdue Stays Category */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider flex items-center gap-1">
                    <Clock size={12} /> Overdue Stays ({totalOverdueCount})
                  </span>
                  {totalOverdueCount > 0 && (
                    <span className="text-[9px] text-zinc-500">Checkout past deadline</span>
                  )}
                </div>
                {totalOverdueCount === 0 ? (
                  <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-[11px] text-zinc-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    All in-house guests are within their stay schedule.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {overdueStays.map(res => {
                      const graceInfo = getGracePeriodInfo(res, hotel, now);
                      return (
                        <div
                          key={res.id}
                          className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-red-200 truncate">
                              Room {res.roomNumber} - {res.guestName}
                            </div>
                            <div className="text-[10px] text-red-400 font-medium truncate">
                              {graceInfo.displayText}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              navigate('/reservations');
                            }}
                            className="px-2 py-1 rounded bg-red-500 hover:bg-red-400 text-black text-[10px] font-bold shrink-0 flex items-center gap-0.5"
                          >
                            Action <ChevronRight size={10} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Pending Settlements Category */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1">
                    <DollarSign size={12} /> Pending Settlements ({totalSettlementCount})
                  </span>
                </div>

                {totalSettlementCount === 0 ? (
                  <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60 text-[11px] text-zinc-400 flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
                    No pending folios or unsettled F&B tabs.
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {/* In-House Guests Owing */}
                    {pendingSettlements.checkedInFolios.slice(0, 3).map(res => {
                      const bal = getReservationLiveBalance(res, hotel);
                      return (
                        <div
                          key={res.id}
                          className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-amber-200 truncate">
                              Room {res.roomNumber} - {res.guestName}
                            </div>
                            <div className="text-[10px] text-amber-400 font-medium">
                              Folio Balance: {formatCurrency(bal, currency, exchangeRate)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              navigate('/reservations');
                            }}
                            className="px-2 py-1 rounded bg-amber-500 hover:bg-amber-400 text-black text-[10px] font-bold shrink-0"
                          >
                            Settle
                          </button>
                        </div>
                      );
                    })}

                    {/* Unsettled F&B Orders */}
                    {pendingSettlements.fbOrders.slice(0, 3).map(order => {
                      const orderTotal = order.totalAmount || order.price || 0;
                      const directPaid = (order.payments || [])
                        .filter(p => p.method !== 'room')
                        .reduce((sum, p) => sum + (p.amount || 0), 0);
                      const due = orderTotal - directPaid;
                      return (
                        <div
                          key={order.id}
                          className="p-2.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-zinc-200 truncate">
                              F&B #{order.id.slice(-5)} (Room {order.roomNumber || 'Walk-in'})
                            </div>
                            <div className="text-[10px] text-zinc-400 truncate">
                              Owing: <span className="text-red-400 font-bold">{formatCurrency(due, currency, exchangeRate)}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              navigate('/food-beverage');
                            }}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[10px] font-bold shrink-0"
                          >
                            View Order
                          </button>
                        </div>
                      );
                    })}

                    {/* Departed Debtors */}
                    {pendingSettlements.debtorFolios.slice(0, 2).map(res => {
                      const bal = getReservationLiveBalance(res, hotel);
                      return (
                        <div
                          key={res.id}
                          className="p-2.5 rounded-xl bg-red-950/40 border border-red-800/40 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-red-200 truncate">
                              Debtor: {res.guestName} (Room {res.roomNumber})
                            </div>
                            <div className="text-[10px] text-red-400 font-medium">
                              Unpaid: {formatCurrency(bal, currency, exchangeRate)}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsOpen(false);
                              navigate('/reports');
                            }}
                            className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 text-white text-[10px] font-bold shrink-0"
                          >
                            Debtors
                          </button>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Footer with Audio Test / Unlock helper */}
            <div className="pt-2 border-t border-zinc-800 flex items-center justify-between text-[10px] text-zinc-500">
              <span className="flex items-center gap-1">
                <span className={cn("w-1.5 h-1.5 rounded-full", isMuted ? "bg-zinc-500" : "bg-emerald-400")} />
                {isMuted ? 'Alerts Muted' : 'Beeps every 12s when active'}
              </span>
              <button
                type="button"
                onClick={() => soundAlertManager.playAlertBeep('overdue')}
                className="text-emerald-400 hover:underline font-semibold"
              >
                Test Sound
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
