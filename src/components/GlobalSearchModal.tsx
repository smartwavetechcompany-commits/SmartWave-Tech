import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, getDocs, limit, where } from 'firebase/firestore';
import { db } from '../firebase';
import { 
  Search, 
  X, 
  Users, 
  Calendar, 
  Bed, 
  ArrowRight, 
  Loader2, 
  CheckCircle2, 
  Clock, 
  Phone, 
  Mail, 
  CreditCard,
  Building2,
  Sparkles,
  ChevronRight,
  ShieldAlert,
  Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { createPortal } from 'react-dom';
import { cn, formatCurrency } from '../utils';
import { safeFormatDate } from '../utils/dateUtils';
import { Guest, Reservation, Room } from '../types';

export interface GlobalSearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

type SearchCategory = 'all' | 'guests' | 'reservations' | 'rooms';

interface SearchResultItem {
  id: string;
  category: 'guest' | 'reservation' | 'room';
  title: string;
  subtitle: string;
  metadata?: string;
  status?: string;
  statusVariant?: 'success' | 'warning' | 'info' | 'danger' | 'neutral';
  targetUrl: string;
  raw: any;
}

export function GlobalSearchModal({ isOpen, onClose, initialQuery = '' }: GlobalSearchModalProps) {
  const navigate = useNavigate();
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [searchTerm, setSearchTerm] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<SearchCategory>('all');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const [guests, setGuests] = useState<Guest[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Sync initial query
  useEffect(() => {
    if (isOpen) {
      setSearchTerm(initialQuery || '');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 60);
    }
  }, [isOpen, initialQuery]);

  // Handle hotkeys inside modal (Arrow navigation, Enter, Escape)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Search runner with debouncing
  useEffect(() => {
    if (!isOpen || !hotel?.id) return;

    const term = searchTerm.trim().toLowerCase();
    if (!term) {
      setGuests([]);
      setReservations([]);
      setRooms([]);
      setIsLoading(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsLoading(true);
      try {
        const hotelId = hotel.id;

        // Query collections in parallel with generous limits for client-side multi-field filtering
        const [guestsSnap, resSnap, roomsSnap] = await Promise.all([
          getDocs(query(collection(db, 'hotels', hotelId, 'guests'), limit(80))),
          getDocs(query(collection(db, 'hotels', hotelId, 'reservations'), limit(80))),
          getDocs(query(collection(db, 'hotels', hotelId, 'rooms'), limit(80)))
        ]);

        const allGuests = guestsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest));
        const allRes = resSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
        const allRooms = roomsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));

        // Multi-field guest filter
        const matchedGuests = allGuests.filter(g => {
          const name = (g.name || '').toLowerCase();
          const email = (g.email || '').toLowerCase();
          const phone = (g.phone || '').toLowerCase();
          const idNum = (g.idNumber || '').toLowerCase();
          return name.includes(term) || email.includes(term) || phone.includes(term) || idNum.includes(term);
        });

        // Multi-field reservation filter
        const matchedReservations = allRes.filter(r => {
          const guestName = (r.guestName || '').toLowerCase();
          const roomNum = (r.roomNumber || '').toLowerCase();
          const resId = (r.id || '').toLowerCase();
          const email = (r.guestEmail || '').toLowerCase();
          const phone = (r.guestPhone || '').toLowerCase();
          const status = (r.status || '').toLowerCase();
          return guestName.includes(term) || 
                 roomNum.includes(term) || 
                 resId.includes(term) || 
                 email.includes(term) || 
                 phone.includes(term) ||
                 status.includes(term);
        });

        // Multi-field room filter
        const matchedRooms = allRooms.filter(rm => {
          const num = (rm.roomNumber || '').toLowerCase();
          const type = (rm.type || '').toLowerCase();
          const floor = String(rm.floor || '').toLowerCase();
          const status = (rm.status || '').toLowerCase();
          return num.includes(term) || type.includes(term) || floor.includes(term) || status.includes(term);
        });

        setGuests(matchedGuests);
        setReservations(matchedReservations);
        setRooms(matchedRooms);
        setSelectedIndex(0);
      } catch (err) {
        console.error('Global search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 120);

    return () => clearTimeout(timer);
  }, [searchTerm, isOpen, hotel?.id]);

  // Transform raw items into unified list items
  const unifiedItems: SearchResultItem[] = [];

  if (activeTab === 'all' || activeTab === 'guests') {
    guests.forEach(g => {
      unifiedItems.push({
        id: `guest-${g.id}`,
        category: 'guest',
        title: g.name,
        subtitle: [g.phone, g.email].filter(Boolean).join(' • ') || 'No contact details',
        metadata: g.idNumber ? `ID: ${g.idNumber}` : undefined,
        status: (g as any).vip ? 'VIP' : undefined,
        statusVariant: 'warning',
        targetUrl: `/guests?q=${encodeURIComponent(g.name)}`,
        raw: g
      });
    });
  }

  if (activeTab === 'all' || activeTab === 'reservations') {
    reservations.forEach(r => {
      let variant: SearchResultItem['statusVariant'] = 'info';
      if (r.status === 'checked_in') variant = 'success';
      if (r.status === 'confirmed') variant = 'info';
      if (r.status === 'checked_out') variant = 'neutral';
      if (r.status === 'cancelled') variant = 'danger';

      const dates = `${safeFormatDate(r.checkIn, 'MMM dd', 'N/A')} - ${safeFormatDate(r.checkOut, 'MMM dd, yyyy', 'N/A')}`;

      unifiedItems.push({
        id: `res-${r.id}`,
        category: 'reservation',
        title: r.guestName || 'Unnamed Guest',
        subtitle: `Room ${r.roomNumber || 'TBD'} • ${dates}`,
        metadata: formatCurrency(r.totalAmount || 0, currency, exchangeRate),
        status: (r.status || 'pending').replace('_', ' ').toUpperCase(),
        statusVariant: variant,
        targetUrl: `/front-desk?reservationId=${r.id}`,
        raw: r
      });
    });
  }

  if (activeTab === 'all' || activeTab === 'rooms') {
    rooms.forEach(rm => {
      let variant: SearchResultItem['statusVariant'] = 'neutral';
      if (rm.status === 'clean') variant = 'success';
      if (rm.status === 'dirty') variant = 'warning';
      if (rm.status === 'occupied') variant = 'info';
      if (rm.status === 'maintenance' || rm.status === 'out_of_order') variant = 'danger';

      unifiedItems.push({
        id: `room-${rm.id}`,
        category: 'room',
        title: `Room ${rm.roomNumber}`,
        subtitle: `${rm.type || 'Standard'} • Floor ${rm.floor || '1'}`,
        metadata: formatCurrency(rm.price || 0, currency, exchangeRate),
        status: (rm.status || 'vacant').toUpperCase(),
        statusVariant: variant,
        targetUrl: `/rooms?roomNumber=${encodeURIComponent(rm.roomNumber)}`,
        raw: rm
      });
    });
  }

  // Handle arrow navigation and enter key
  useEffect(() => {
    if (!isOpen) return;

    const handleListKeys = (e: KeyboardEvent) => {
      if (unifiedItems.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex(prev => (prev + 1) % unifiedItems.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex(prev => (prev - 1 + unifiedItems.length) % unifiedItems.length);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const selected = unifiedItems[selectedIndex];
        if (selected) {
          handleSelect(selected);
        }
      }
    };

    window.addEventListener('keydown', handleListKeys);
    return () => window.removeEventListener('keydown', handleListKeys);
  }, [isOpen, unifiedItems, selectedIndex]);

  // Scroll active item into view
  useEffect(() => {
    if (listRef.current) {
      const activeEl = listRef.current.querySelector('[data-selected="true"]');
      if (activeEl) {
        activeEl.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [selectedIndex]);

  const handleSelect = (item: SearchResultItem) => {
    onClose();
    navigate(item.targetUrl);
  };

  const totalResults = guests.length + reservations.length + rooms.length;

  const getStatusBadgeClass = (variant?: SearchResultItem['statusVariant']) => {
    switch (variant) {
      case 'success':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
      case 'warning':
        return 'bg-amber-500/10 text-amber-400 border-amber-500/20';
      case 'danger':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/20';
      case 'info':
        return 'bg-sky-500/10 text-sky-400 border-sky-500/20';
      default:
        return 'bg-zinc-800 text-zinc-400 border-zinc-700';
    }
  };

  const getCategoryIcon = (category: SearchResultItem['category']) => {
    switch (category) {
      case 'guest':
        return <Users size={16} className="text-emerald-400" />;
      case 'reservation':
        return <Calendar size={16} className="text-sky-400" />;
      case 'room':
        return <Bed size={16} className="text-amber-400" />;
    }
  };

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[9999] flex items-start justify-center pt-4 sm:pt-[8vh] p-2 sm:p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/80 backdrop-blur-md"
      />

      {/* Main Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: -10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: -10 }}
        transition={{ duration: 0.15, ease: 'easeOut' }}
        className="relative w-full max-w-2xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[88vh] sm:max-h-[82vh] z-10"
      >
        {/* Top Search Input Bar */}
        <div className="p-3.5 sm:p-4 border-b border-zinc-800 flex items-center gap-3 bg-zinc-950/70 relative">
          <Search className={cn("shrink-0 transition-colors", isLoading ? "text-emerald-500" : "text-zinc-400")} size={20} />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search guests, reservations, room numbers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-transparent border-none text-zinc-50 placeholder-zinc-500 text-sm sm:text-base outline-none pr-12 font-medium"
          />

          {isLoading ? (
            <Loader2 size={18} className="text-emerald-500 animate-spin absolute right-12 top-1/2 -translate-y-1/2" />
          ) : searchTerm ? (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                inputRef.current?.focus();
              }}
              className="absolute right-12 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
              title="Clear input"
            >
              <X size={16} />
            </button>
          ) : null}

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
            title="Close (ESC)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Category Filter Chips Bar */}
        <div className="px-3 py-2 bg-zinc-950/40 border-b border-zinc-800/80 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          <button
            type="button"
            onClick={() => { setActiveTab('all'); setSelectedIndex(0); }}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer",
              activeTab === 'all'
                ? "bg-emerald-500 text-black shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <span>All Results</span>
            {searchTerm.trim() && (
              <span className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                activeTab === 'all' ? "bg-black/20 text-black font-black" : "bg-zinc-700 text-zinc-300"
              )}>
                {totalResults}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('guests'); setSelectedIndex(0); }}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer",
              activeTab === 'guests'
                ? "bg-emerald-500 text-black shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <Users size={13} />
            <span>Guests</span>
            {searchTerm.trim() && (
              <span className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                activeTab === 'guests' ? "bg-black/20 text-black font-black" : "bg-zinc-700 text-zinc-300"
              )}>
                {guests.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('reservations'); setSelectedIndex(0); }}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer",
              activeTab === 'reservations'
                ? "bg-emerald-500 text-black shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <Calendar size={13} />
            <span>Reservations</span>
            {searchTerm.trim() && (
              <span className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                activeTab === 'reservations' ? "bg-black/20 text-black font-black" : "bg-zinc-700 text-zinc-300"
              )}>
                {reservations.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => { setActiveTab('rooms'); setSelectedIndex(0); }}
            className={cn(
              "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shrink-0 cursor-pointer",
              activeTab === 'rooms'
                ? "bg-emerald-500 text-black shadow-sm"
                : "bg-zinc-800/60 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
            )}
          >
            <Bed size={13} />
            <span>Rooms</span>
            {searchTerm.trim() && (
              <span className={cn(
                "px-1.5 py-0.2 rounded-full text-[10px] font-mono",
                activeTab === 'rooms' ? "bg-black/20 text-black font-black" : "bg-zinc-700 text-zinc-300"
              )}>
                {rooms.length}
              </span>
            )}
          </button>
        </div>

        {/* Results Body */}
        <div 
          ref={listRef}
          className="flex-1 overflow-y-auto p-2 sm:p-3 space-y-1 custom-scrollbar min-h-[220px]"
        >
          {!searchTerm.trim() ? (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center mx-auto mb-3 text-zinc-400">
                <Search size={22} className="text-emerald-500" />
              </div>
              <h4 className="text-sm font-bold text-zinc-200">Global PMS Quick Search</h4>
              <p className="text-xs text-zinc-500 mt-1 max-w-sm mx-auto">
                Type any guest name, phone number, room number (e.g. 101), or reservation reference to instantly find records across the system.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 mt-4 text-[11px] text-zinc-400">
                <span className="bg-zinc-800/80 px-2 py-1 rounded-md border border-zinc-700/60">Guests by Name or Phone</span>
                <span className="bg-zinc-800/80 px-2 py-1 rounded-md border border-zinc-700/60">Rooms by Number or Type</span>
                <span className="bg-zinc-800/80 px-2 py-1 rounded-md border border-zinc-700/60">Live Reservations & Dates</span>
              </div>
            </div>
          ) : unifiedItems.length === 0 && !isLoading ? (
            <div className="py-12 px-4 text-center">
              <div className="w-12 h-12 rounded-2xl bg-zinc-800/60 border border-zinc-700/50 flex items-center justify-center mx-auto mb-3 text-zinc-500">
                <Search size={22} />
              </div>
              <h4 className="text-sm font-bold text-zinc-200">No matching results found</h4>
              <p className="text-xs text-zinc-500 mt-1">
                No guests, reservations, or rooms matched <span className="text-zinc-300 font-mono">"{searchTerm}"</span>
              </p>
            </div>
          ) : (
            unifiedItems.map((item, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={item.id}
                  type="button"
                  data-selected={isSelected}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "w-full flex items-center justify-between p-3 rounded-xl transition-all text-left cursor-pointer group",
                    isSelected
                      ? "bg-zinc-800/90 border border-emerald-500/40 shadow-sm"
                      : "bg-zinc-950/30 hover:bg-zinc-800/50 border border-zinc-800/40"
                  )}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div className={cn(
                      "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 border",
                      isSelected ? "bg-emerald-500/20 border-emerald-500/30" : "bg-zinc-800 border-zinc-700/60"
                    )}>
                      {getCategoryIcon(item.category)}
                    </div>

                    <div className="min-w-0 flex-1 pr-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-xs sm:text-sm font-bold truncate",
                          isSelected ? "text-emerald-400" : "text-zinc-100"
                        )}>
                          {item.title}
                        </span>
                        {item.status && (
                          <span className={cn(
                            "px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0",
                            getStatusBadgeClass(item.statusVariant)
                          )}>
                            {item.status}
                          </span>
                        )}
                      </div>

                      <div className="text-[11px] text-zinc-400 truncate mt-0.5 font-medium">
                        {item.subtitle}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {item.metadata && (
                      <span className="text-xs font-mono font-bold text-zinc-400 hidden sm:inline-block">
                        {item.metadata}
                      </span>
                    )}
                    <ChevronRight size={16} className={cn(
                      "transition-transform",
                      isSelected ? "text-emerald-400 translate-x-0.5" : "text-zinc-600 group-hover:text-zinc-400"
                    )} />
                  </div>
                </button>
              );
            })
          )}
        </div>

        {/* Keyboard Legend & Footer */}
        <div className="p-3 bg-zinc-950 border-t border-zinc-800 text-[10px] text-zinc-500 flex items-center justify-between font-mono">
          <div className="flex items-center gap-3">
            <span>Use <kbd className="text-zinc-300 font-bold">↑↓</kbd> to navigate</span>
            <span><kbd className="text-zinc-300 font-bold">↵</kbd> to open</span>
            <span><kbd className="text-zinc-300 font-bold">ESC</kbd> to exit</span>
          </div>
          <div>
            Showing <strong className="text-zinc-300">{unifiedItems.length}</strong> {activeTab === 'all' ? 'matches' : activeTab}
          </div>
        </div>
      </motion.div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
