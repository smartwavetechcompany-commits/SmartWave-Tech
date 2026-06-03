import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CurrencyToggle } from './CurrencyToggle';
import { Notifications } from './Notifications';
import { User, Building2, WifiOff, XCircle, LogOut, Search, Bed, Users, Calendar, ArrowRight, Loader2, ShieldAlert, CheckCircle2, Menu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, limit, or } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../utils';
import { toast } from 'sonner';

export function TopBar({ onMenuClick }: { onMenuClick?: () => void }) {
  const navigate = useNavigate();
  const { hotel, profile, isOffline, setSelectedHotelId, user } = useAuth();
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
    <div className="h-16 border-b border-zinc-800 bg-zinc-950/50 backdrop-blur-md flex items-center justify-between px-4 sm:px-8 sticky top-0 z-40">
      <div className="flex items-center gap-2 sm:gap-4 flex-1">
        <button 
          onClick={onMenuClick}
          className="lg:hidden p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all"
          title="Toggle Menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-zinc-400 min-w-fit cursor-pointer hover:text-zinc-50 transition-colors" onClick={() => navigate('/')}>
            <Building2 size={16} />
            <span className="text-xs sm:text-sm font-medium truncate max-w-[100px] sm:max-w-none">{hotel?.name || 'PMS'}</span>
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

        {/* Global Search Bar */}
        <div className="relative max-w-md w-full ml-4 hidden md:block" ref={searchRef}>
          <div className="relative">
            <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 transition-colors", isSearching ? "text-emerald-500" : "text-zinc-500")} size={16} />
            <input 
              type="text"
              placeholder="Search hotels, rooms, guests..."
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-10 pr-10 py-1.5 text-sm text-zinc-50 focus:border-emerald-500 outline-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
            />
            {searchQuery && (
              <button 
                onClick={() => {
                  setSearchQuery('');
                  setShowResults(false);
                }}
                className="absolute right-10 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                <XCircle size={14} />
              </button>
            )}
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 animate-spin" size={14} />
            )}
          </div>

          <AnimatePresence>
            {showResults && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="absolute top-full left-0 right-0 mt-2 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden z-50 max-h-[400px] overflow-y-auto backdrop-blur-xl"
              >
                {!isSearching && !hasResults ? (
                  <div className="p-8 text-center">
                    <Search className="mx-auto mb-2 text-zinc-700" size={24} />
                    <p className="text-sm text-zinc-500">No results found for "{searchQuery}"</p>
                  </div>
                ) : (
                  <div className="p-2 space-y-4">
                    {searchResults.hotels.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Hotels</div>
                        {searchResults.hotels.map(h => (
                          <button 
                            key={h.id}
                            onClick={() => {
                              setSelectedHotelId(h.id);
                              setShowResults(false);
                              setSearchQuery('');
                              navigate('/');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zinc-800 transition-colors text-left group"
                          >
                            <div className="w-8 h-8 bg-blue-500/10 text-blue-500 rounded-lg flex items-center justify-center">
                              <Building2 size={16} />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-50">{h.name}</div>
                              <div className="text-[10px] text-zinc-500">{h.location || 'System Hotel'}</div>
                            </div>
                            <ArrowRight size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.rooms.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Rooms</div>
                        {searchResults.rooms.map(r => (
                          <button 
                            key={r.id}
                            onClick={() => {
                              setShowResults(false);
                              setSearchQuery('');
                              navigate('/rooms');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zinc-800 transition-colors text-left group"
                          >
                            <div className="w-8 h-8 bg-emerald-500/10 text-emerald-500 rounded-lg flex items-center justify-center">
                              <Bed size={16} />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-50">Room {r.roomNumber}</div>
                              <div className="text-[10px] text-zinc-500">{r.type} • {r.status}</div>
                            </div>
                            <ArrowRight size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.guests.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Guests</div>
                        {searchResults.guests.map(g => (
                          <button 
                            key={g.id}
                            onClick={() => {
                              setShowResults(false);
                              setSearchQuery('');
                              navigate('/guests');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zinc-800 transition-colors text-left group"
                          >
                            <div className="w-8 h-8 bg-purple-500/10 text-purple-500 rounded-lg flex items-center justify-center">
                              <Users size={16} />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-50">{g.name}</div>
                              <div className="text-[10px] text-zinc-500">{g.phone || g.email}</div>
                            </div>
                            <ArrowRight size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}

                    {searchResults.reservations.length > 0 && (
                      <div>
                        <div className="px-3 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Reservations</div>
                        {searchResults.reservations.map(res => (
                          <button 
                            key={res.id}
                            onClick={() => {
                              setShowResults(false);
                              setSearchQuery('');
                              navigate('/front-desk');
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-zinc-800 transition-colors text-left group"
                          >
                            <div className="w-8 h-8 bg-amber-500/10 text-amber-500 rounded-lg flex items-center justify-center">
                              <Calendar size={16} />
                            </div>
                            <div className="flex-1">
                              <div className="text-sm font-medium text-zinc-50">{res.guestName}</div>
                              <div className="text-[10px] text-zinc-500">Room {res.roomNumber} • {res.checkIn}</div>
                            </div>
                            <ArrowRight size={14} className="text-zinc-700 group-hover:text-zinc-400 transition-colors" />
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
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

      <div className="flex items-center gap-2 sm:gap-6">
        <div className="flex items-center gap-2 sm:gap-4 border-r border-zinc-800 pr-2 sm:pr-6">
          <CurrencyToggle />
          <Notifications />
        </div>
        
        <div className="flex items-center gap-3">
          <div className="text-right hidden sm:block">
            <div className="text-sm font-bold text-zinc-50 leading-none mb-1">
              {profile?.displayName || profile?.email?.split('@')[0]}
            </div>
            <div className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider leading-none">
              {profile?.role === 'superAdmin' ? 'Super Admin' : profile?.staffRole || profile?.role}
            </div>
          </div>
          <div 
            onClick={() => navigate('/settings')}
            className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-400 cursor-pointer hover:bg-zinc-800 transition-colors"
          >
            <User size={20} />
          </div>
        </div>
      </div>
    </div>
  );
}
