import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CurrencyToggle } from './CurrencyToggle';
import { Notifications } from './Notifications';
import { UIScaleControl } from './UIScaleControl';
import { AudioAlertWidget } from './AudioAlertWidget';
import { User, Building2, WifiOff, XCircle, LogOut, Search, Bed, Users, Calendar, ArrowRight, Loader2, ShieldAlert, CheckCircle2, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, limit, or } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../utils';
import { toast } from 'sonner';
import { GlobalSearchModal } from './GlobalSearchModal';

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const navigate = useNavigate();
  const { hotel, profile, isOffline, setSelectedHotelId, user } = useAuth();
  const [isGlobalSearchOpen, setIsGlobalSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [hotels, setHotels] = useState<any[]>([]);
  const [isSelectingHotel, setIsSelectingHotel] = useState(false);
  const [hotelFilter, setHotelFilter] = useState('');
  const [searchResults, setSearchResults] = useState<{
    hotels: any[];
    rooms: any[];
    guests: any[];
    reservations: any[];
  }>({ hotels: [], rooms: [], guests: [], reservations: [] });
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const selectRef = useRef<HTMLDivElement>(null);

  const isSuperAdmin = profile?.role === 'superAdmin';
  const isManaging = isSuperAdmin && hotel?.id;

  useEffect(() => {
    if (isSuperAdmin) {
      const fetchHotels = async () => {
        try {
          const snap = await getDocs(collection(db, 'hotels'));
          setHotels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
        } catch (error) {
          console.error('Error fetching hotels for SuperAdmin:', error);
        }
      };
      fetchHotels();
    }
  }, [isSuperAdmin]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsGlobalSearchOpen(prev => !prev);
        return;
      }
      if (e.key === 'Escape') {
        setShowResults(false);
        setIsSelectingHotel(false);
        setSearchQuery('');
        setHotelFilter('');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
      if (selectRef.current && !selectRef.current.contains(event.target as Node)) {
        setIsSelectingHotel(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (searchQuery.length < 2) {
      setSearchResults({ hotels: [], rooms: [], guests: [], reservations: [] });
      setShowResults(false);
      setIsSearching(false);
      return;
    }

    const delayDebounceFn = setTimeout(() => {
      handleSearch();
    }, 150);

    return () => clearTimeout(delayDebounceFn);
  }, [searchQuery]);

  const handleSearch = async () => {
    setIsSearching(true);
    setShowResults(true);
    try {
      const results: any = { hotels: [], rooms: [], guests: [], reservations: [] };
      const q = searchQuery.toLowerCase();

      if (profile?.role === 'superAdmin') {
        const hotelsSnap = await getDocs(query(collection(db, 'hotels'), limit(5)));
        results.hotels = hotelsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((h: any) => h.name?.toLowerCase().includes(q));
      }

      if (hotel?.id) {
        // Search Rooms
        const roomsSnap = await getDocs(query(collection(db, 'hotels', hotel.id, 'rooms'), limit(20)));
        results.rooms = roomsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((r: any) => r.roomNumber?.toLowerCase().includes(q) || r.type?.toLowerCase().includes(q));

        // Search Guests
        const guestsSnap = await getDocs(query(collection(db, 'hotels', hotel.id, 'guests'), limit(20)));
        results.guests = guestsSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((g: any) => g.name?.toLowerCase().includes(q) || g.email?.toLowerCase().includes(q) || g.phone?.toLowerCase().includes(q));

        // Search Reservations
        const resSnap = await getDocs(query(collection(db, 'hotels', hotel.id, 'reservations'), limit(20)));
        results.reservations = resSnap.docs
          .map(doc => ({ id: doc.id, ...doc.data() }))
          .filter((r: any) => r.guestName?.toLowerCase().includes(q) || r.roomNumber?.toLowerCase().includes(q));
      }

      setSearchResults(results);
    } catch (error) {
      console.error('Global search error:', error);
    } finally {
      setIsSearching(false);
    }
  };

  const handleStopManaging = () => {
    setSelectedHotelId(null);
    toast.success('Exited management mode');
    navigate('/super-admin');
  };

  const hasResults = searchResults.hotels.length > 0 || 
                     searchResults.rooms.length > 0 || 
                     searchResults.guests.length > 0 || 
                     searchResults.reservations.length > 0;

  return (
    <div className="h-16 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-3 sm:px-6 lg:px-8 sticky top-0 z-40">
      <div className="flex items-center gap-2 sm:gap-4 flex-1">
        <button 
          onClick={onMenuClick}
          className="lg:hidden min-w-[42px] min-h-[42px] flex items-center justify-center p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all shrink-0 active:scale-95"
          title="Toggle Menu"
          aria-label="Toggle Navigation Menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="flex items-center gap-2 text-zinc-400 min-w-0 cursor-pointer hover:text-zinc-50 transition-colors group" onClick={() => navigate('/')}>
            {hotel?.branding?.logoUrl ? (
              <img 
                src={hotel.branding.logoUrl} 
                alt={hotel?.name || 'Hotel Logo'} 
                className="w-5 h-5 rounded-md object-contain bg-zinc-900 border border-zinc-800 shrink-0"
                onError={(e) => { (e.target as HTMLElement).style.display = 'none'; }}
              />
            ) : (
              <Building2 size={16} className="text-emerald-500 group-hover:scale-110 transition-transform shrink-0" />
            )}
            <span className="text-xs sm:text-sm font-bold text-zinc-100 tracking-tight truncate max-w-[110px] xs:max-w-[150px] sm:max-w-[240px]">{hotel?.name || 'Hotel PMS'}</span>
          </div>

          {hotel?.subscriptionExpiry && (
            (() => {
              const expiryTime = new Date(hotel.subscriptionExpiry).getTime();
              if (isNaN(expiryTime)) return null;
              const now = Date.now();
              const isExpired = expiryTime <= now;
              const remainingDays = Math.ceil((expiryTime - now) / (24 * 60 * 60 * 1000));
              
              return (
                <div className={cn(
                  "hidden sm:flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider border",
                  isExpired 
                    ? "bg-red-500/10 border-red-500/20 text-red-400" 
                    : remainingDays <= 7 
                      ? "bg-amber-500/10 border-amber-500/20 text-amber-500 animate-pulse" 
                      : "bg-emerald-500/10 border-emerald-500/20 text-emerald-400"
                )}>
                  <span className="w-1.5 h-1.5 rounded-full bg-current" />
                  <span>{isExpired ? 'Expired' : `${remainingDays} ${remainingDays === 1 ? 'day' : 'days'} left`}</span>
                </div>
              );
            })()
          )}

          {isSuperAdmin && (
            <div className="relative border-l border-zinc-800 ml-2 pl-2" ref={selectRef}>
              <button 
                onClick={() => setIsSelectingHotel(!isSelectingHotel)}
                className="flex items-center gap-2 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors text-zinc-400 hover:text-zinc-50 group"
              >
                <div className="w-1 h-3 bg-emerald-500 rounded-full" />
                <div className="flex flex-col text-[10px] font-bold uppercase tracking-wider text-left leading-none">
                  <span>Switch</span>
                  <span>Hotel</span>
                </div>
                <ArrowRight size={12} className={cn("transition-all opacity-50 group-hover:opacity-100", isSelectingHotel ? "rotate-90" : "rotate-0")} />
              </button>

              <AnimatePresence>
                {isSelectingHotel && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute top-full left-0 mt-2 w-64 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl overflow-hidden z-50 py-2"
                  >
                      <div className="px-3 py-1.5 flex items-center justify-between border-b border-zinc-800/50 mb-1">
                        <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Manage Hotel</span>
                        {isManaging && (
                          <button 
                            onClick={handleStopManaging}
                            className="text-[9px] font-black text-emerald-500 hover:text-emerald-400 uppercase flex items-center gap-1"
                          >
                            Exit <XCircle size={10} />
                          </button>
                        )}
                      </div>
                      <div className="px-2 pb-2">
                        <div className="relative">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-600" size={10} />
                          <input 
                            type="text"
                            placeholder="Filter hotels..."
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-6 pr-6 py-1 text-[10px] text-zinc-50 outline-none focus:border-emerald-500/50"
                            value={hotelFilter}
                            onChange={(e) => setHotelFilter(e.target.value)}
                            autoFocus
                          />
                          {hotelFilter && (
                            <button 
                              onClick={() => setHotelFilter('')}
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
                            >
                              <XCircle size={10} />
                            </button>
                          )}
                        </div>
                      </div>
                      <div className="max-h-[300px] overflow-y-auto custom-scrollbar">
                        <button 
                          onClick={() => {
                            setSelectedHotelId(null);
                            setIsSelectingHotel(false);
                            setHotelFilter('');
                            navigate('/super-admin');
                          }}
                          className={cn(
                            "w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800 transition-colors",
                            !hotel?.id && "bg-emerald-500/10 text-emerald-500"
                          )}
                        >
                          <ShieldAlert size={14} />
                          <span className="text-xs font-semibold">Super Admin Dashboard</span>
                        </button>
                        <div className="h-px bg-zinc-800 my-1" />
                        {hotels
                          .filter(h => h.name?.toLowerCase().includes(hotelFilter.toLowerCase()))
                          .map(h => (
                          <button 
                            key={h.id}
                            onClick={() => {
                              if (hotel?.id === h.id) {
                                setIsSelectingHotel(false);
                                return;
                              }
                              setSelectedHotelId(h.id);
                              setIsSelectingHotel(false);
                              setHotelFilter('');
                              navigate('/');
                            }}
                            className={cn(
                              "w-full flex items-center justify-between px-3 py-2 text-left hover:bg-zinc-800 transition-colors group",
                              hotel?.id === h.id && "bg-emerald-500/10 text-emerald-500"
                            )}
                          >
                            <div className="flex flex-col">
                              <span className="text-xs font-medium truncate">{h.name}</span>
                              <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-tight">Plan: {h.plan}</span>
                            </div>
                            <div className="flex items-center gap-2">
                              {hotel?.id === h.id ? (
                                <CheckCircle2 size={12} className="text-emerald-500" />
                              ) : (
                                <ArrowRight size={12} className="text-zinc-700 opacity-0 group-hover:opacity-100 transition-all" />
                              )}
                            </div>
                          </button>
                        ))}
                      </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          )}
        </div>

        {/* Global Search Bar Quick Launcher */}
        <div className="relative max-w-md w-full ml-4 hidden md:block">
          <button 
            type="button"
            onClick={() => setIsGlobalSearchOpen(true)}
            className="w-full bg-zinc-900/60 border border-zinc-800 hover:border-zinc-700/80 rounded-xl pl-10 pr-3 py-1.5 text-xs text-left text-zinc-400 flex items-center justify-between group transition-all cursor-pointer shadow-sm relative"
          >
            <div className="flex items-center gap-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-hover:text-emerald-400 transition-colors" size={16} />
              <span className="truncate group-hover:text-zinc-200">Search guests, reservations, room numbers...</span>
            </div>
            <kbd className="hidden lg:inline-flex items-center font-mono text-[10px] text-zinc-500 bg-zinc-950 border border-zinc-800 px-1.5 py-0.5 rounded">
              Ctrl K
            </kbd>
          </button>
        </div>

        {isManaging && (
          <button 
            onClick={handleStopManaging}
            className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-500 ml-4 hover:bg-emerald-500/20 transition-all group"
          >
            <span className="text-[10px] font-bold uppercase tracking-wider">Management Mode</span>
            <XCircle size={14} className="group-hover:rotate-90 transition-transform" />
          </button>
        )}
        {isOffline && (
          <div className="flex items-center gap-2 px-3 py-1 bg-red-500/10 border border-red-500/20 rounded-full text-red-500 animate-pulse ml-4">
            <WifiOff size={14} />
            <span className="text-[10px] font-bold uppercase tracking-wider">Offline Mode</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1.5 sm:gap-4 md:gap-6 shrink-0">
        <div className="flex items-center gap-1 sm:gap-2.5 md:gap-4 border-r border-zinc-800 pr-1 sm:pr-4 md:pr-6 shrink-0">
          <button
            type="button"
            onClick={() => setIsGlobalSearchOpen(true)}
            className="p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all active:scale-95 cursor-pointer relative"
            title="Global Search guests, reservations, room numbers (Ctrl+K)"
            aria-label="Global Search"
          >
            <Search size={18} />
          </button>
          <UIScaleControl />
          <CurrencyToggle />
          <AudioAlertWidget />
          <Notifications />
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          <div className="text-right hidden md:block">
            <div className="text-sm font-bold text-zinc-50 leading-none mb-1">
              {profile?.displayName || profile?.email?.split('@')[0]}
            </div>
            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider leading-none">
              {profile?.role === 'superAdmin' ? 'Super Admin' : profile?.staffRole || profile?.role}
            </div>
          </div>
          <div 
            onClick={() => navigate('/settings')}
            className="w-9 h-9 sm:w-10 sm:h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-400 cursor-pointer hover:bg-zinc-800 active:scale-95 transition-all shrink-0"
            title="Settings & Profile"
            aria-label="User profile settings"
          >
            <User size={18} className="sm:size-5" />
          </div>
        </div>
      </div>

      <GlobalSearchModal 
        isOpen={isGlobalSearchOpen} 
        onClose={() => setIsGlobalSearchOpen(false)} 
        initialQuery={searchQuery}
      />
    </div>
  );
}
