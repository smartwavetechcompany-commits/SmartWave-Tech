import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { CurrencyToggle } from './CurrencyToggle';
import { Notifications } from './Notifications';
import { User, Building2, WifiOff, XCircle, LogOut, Search, Bed, Users, Calendar, ArrowRight, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, where, getDocs, limit, or } from 'firebase/firestore';
import { db } from '../firebase';
import { cn } from '../utils';
import { toast } from 'sonner';

export function TopBar() {
  const navigate = useNavigate();
  const { hotel, profile, isOffline, setSelectedHotelId } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<{
    hotels: any[];
    rooms: any[];
    guests: any[];
    reservations: any[];
  }>({ hotels: [], rooms: [], guests: [], reservations: [] });
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const isManaging = profile?.role === 'superAdmin' && hotel?.id;

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowResults(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (searchQuery.length >= 2) {
        handleSearch();
      } else {
        setSearchResults({ hotels: [], rooms: [], guests: [], reservations: [] });
        setShowResults(false);
      }
    }, 300);

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
      <div className="flex items-center gap-4 flex-1">
        <div className="flex items-center gap-2 text-zinc-400 min-w-fit">
          <Building2 size={16} />
          <span className="text-xs sm:text-sm font-medium truncate max-w-[100px] sm:max-w-none">{hotel?.name || 'PMS'}</span>
        </div>

        {/* Global Search Bar */}
        <div className="relative max-w-md w-full ml-4 hidden md:block" ref={searchRef}>
          <div className="relative">
            <Search className={cn("absolute left-3 top-1/2 -translate-y-1/2 transition-colors", isSearching ? "text-emerald-500" : "text-zinc-500")} size={16} />
            <input 
              type="text"
              placeholder="Search hotels, rooms, guests..."
              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-10 pr-4 py-1.5 text-sm text-zinc-50 focus:border-emerald-500 outline-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={() => searchQuery.length >= 2 && setShowResults(true)}
            />
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
          <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full text-emerald-500 ml-4">
            <span className="text-[10px] font-bold uppercase tracking-wider">Management Mode</span>
            <button 
              onClick={handleStopManaging}
              className="hover:text-emerald-400 transition-colors flex items-center gap-1"
              title="Exit Management Mode"
            >
              <span className="text-[10px] font-bold">Exit</span>
              <XCircle size={14} />
            </button>
          </div>
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
          <div className="w-10 h-10 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center justify-center text-zinc-400">
            <User size={20} />
          </div>
        </div>
      </div>
    </div>
  );
}
