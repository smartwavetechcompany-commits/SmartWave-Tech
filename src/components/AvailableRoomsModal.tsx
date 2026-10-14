import React, { useState, useMemo } from 'react';
import { 
  X, 
  Calendar, 
  CalendarDays, 
  CheckCircle2, 
  Clock, 
  ArrowRight, 
  Search, 
  Users, 
  AlertCircle, 
  BedDouble, 
  Layers, 
  ShieldCheck, 
  RefreshCw, 
  Filter, 
  Sparkles,
  Info,
  CalendarCheck
} from 'lucide-react';
import { Room, Reservation, RoomBlocking, Hotel, RoomType } from '../types';
import { isRoomAvailable, doDateRangesOverlap, getRoomDisplayStatus } from '../utils/roomUtils';
import { formatCurrency, cn } from '../utils';
import { format, addDays, parseISO, startOfDay, endOfDay, isBefore, isAfter } from 'date-fns';

interface AvailableRoomsModalProps {
  isOpen: boolean;
  onClose: () => void;
  rooms: Room[];
  reservations: Reservation[];
  roomBlockings?: RoomBlocking[];
  roomTypes?: RoomType[];
  hotel: Hotel | null;
  currency: 'NGN' | 'USD' | string;
  exchangeRate: number;
  initialCheckIn?: string;
  initialCheckOut?: string;
  onSelectRoom: (room: Room, checkIn: string, checkOut: string) => void;
}

export function AvailableRoomsModal({
  isOpen,
  onClose,
  rooms,
  reservations,
  roomBlockings = [],
  roomTypes = [],
  hotel,
  currency,
  exchangeRate,
  initialCheckIn,
  initialCheckOut,
  onSelectRoom
}: AvailableRoomsModalProps) {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const tomorrowStr = format(addDays(new Date(), 1), 'yyyy-MM-dd');
  const safeCurrency: 'NGN' | 'USD' = currency === 'USD' ? 'USD' : 'NGN';

  const [checkIn, setCheckIn] = useState<string>(initialCheckIn || todayStr);
  const [checkOut, setCheckOut] = useState<string>(initialCheckOut || tomorrowStr);
  const [selectedType, setSelectedType] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [activeTab, setActiveTab] = useState<'available' | 'schedule'>('available');

  // Keep dates valid: checkOut must be strictly after checkIn
  const handleCheckInChange = (newCheckIn: string) => {
    setCheckIn(newCheckIn);
    if (newCheckIn >= checkOut) {
      setCheckOut(format(addDays(parseISO(newCheckIn), 1), 'yyyy-MM-dd'));
    }
  };

  const handleCheckOutChange = (newCheckOut: string) => {
    if (newCheckOut <= checkIn) {
      return;
    }
    setCheckOut(newCheckOut);
  };

  // Quick stay presets
  const applyPreset = (preset: 'today' | 'tomorrow' | 'weekend' | '2nights' | '7nights') => {
    const today = new Date();
    if (preset === 'today') {
      setCheckIn(format(today, 'yyyy-MM-dd'));
      setCheckOut(format(addDays(today, 1), 'yyyy-MM-dd'));
    } else if (preset === 'tomorrow') {
      const tomorrow = addDays(today, 1);
      setCheckIn(format(tomorrow, 'yyyy-MM-dd'));
      setCheckOut(format(addDays(tomorrow, 1), 'yyyy-MM-dd'));
    } else if (preset === '2nights') {
      setCheckIn(format(today, 'yyyy-MM-dd'));
      setCheckOut(format(addDays(today, 2), 'yyyy-MM-dd'));
    } else if (preset === '7nights') {
      setCheckIn(format(today, 'yyyy-MM-dd'));
      setCheckOut(format(addDays(today, 7), 'yyyy-MM-dd'));
    } else if (preset === 'weekend') {
      // Find upcoming Friday
      const day = today.getDay();
      const daysUntilFriday = (5 - day + 7) % 7 || 7;
      const friday = addDays(today, daysUntilFriday === 7 && day === 5 ? 0 : daysUntilFriday);
      const sunday = addDays(friday, 2);
      setCheckIn(format(friday, 'yyyy-MM-dd'));
      setCheckOut(format(sunday, 'yyyy-MM-dd'));
    }
  };

  // Calculate stay duration
  const nights = useMemo(() => {
    try {
      const start = parseISO(checkIn);
      const end = parseISO(checkOut);
      const diffMs = end.getTime() - start.getTime();
      const calculated = Math.max(1, Math.round(diffMs / (1000 * 60 * 60 * 24)));
      return isNaN(calculated) ? 1 : calculated;
    } catch {
      return 1;
    }
  }, [checkIn, checkOut]);

  // Unique room types list
  const availableTypes = useMemo(() => {
    const typeSet = new Set<string>();
    rooms.forEach(r => {
      if (r.type) typeSet.add(r.type);
    });
    return Array.from(typeSet);
  }, [rooms]);

  // Evaluate room availability and upcoming reservations
  const roomAnalysis = useMemo(() => {
    const startSelected = startOfDay(parseISO(checkIn));
    const endSelected = startOfDay(parseISO(checkOut));
    const today = startOfDay(new Date());

    return rooms.map(room => {
      // System authoritative availability
      const isAvailable = isRoomAvailable(
        room.id,
        checkIn,
        checkOut,
        reservations,
        roomBlockings,
        hotel
      );

      // Current live physical status on target date
      const displayStatus = getRoomDisplayStatus(room, reservations, roomBlockings, startSelected);

      // Gather upcoming & active reservations for this room (ordered chronologically)
      const roomRes = reservations
        .filter(r => 
          r.roomId === room.id && 
          r.status !== 'cancelled' && 
          r.status !== 'no_show'
        )
        .sort((a, b) => new Date(a.checkIn).getTime() - new Date(b.checkIn).getTime());

      // Currently checked-in reservation
      const activeCheckIn = roomRes.find(r => r.status === 'checked_in');

      // Conflicting reservations for the chosen interval [checkIn, checkOut)
      const conflicts = roomRes.filter(r => {
        const resStart = startOfDay(parseISO(r.checkIn));
        const resEnd = startOfDay(parseISO(r.checkOut));
        const effectiveEnd = (r.status === 'checked_in' && resEnd <= today) ? addDays(today, 1) : resEnd;
        return doDateRangesOverlap(startSelected, endSelected, resStart, effectiveEnd);
      });

      // Conflicting room blockings
      const activeBlocks = roomBlockings.filter(b => {
        if (b.roomId !== room.id) return false;
        const bStart = startOfDay(parseISO(b.startDate));
        const bEnd = endOfDay(parseISO(b.endDate));
        return startSelected <= bEnd && endSelected >= bStart;
      });

      // Find when room becomes available next
      let nextAvailableText = '';
      if (!isAvailable) {
        if (activeCheckIn) {
          nextAvailableText = `Available from ${activeCheckIn.checkOut} (Guest departs)`;
        } else if (conflicts.length > 0) {
          const latestConflictingCheckOut = conflicts.reduce((latest, c) => {
            return c.checkOut > latest ? c.checkOut : latest;
          }, conflicts[0].checkOut);
          nextAvailableText = `Available starting ${latestConflictingCheckOut}`;
        } else if (activeBlocks.length > 0) {
          nextAvailableText = `Blocked until ${activeBlocks[0].endDate}`;
        } else {
          nextAvailableText = 'Occupied during selected dates';
        }
      } else {
        // If available, check when the NEXT future booking starts (free window)
        const futureRes = roomRes.filter(r => startOfDay(parseISO(r.checkIn)) >= endSelected);
        if (futureRes.length > 0) {
          const nextBooking = futureRes[0];
          nextAvailableText = `Free until ${nextBooking.checkIn} (Next guest arrives)`;
        } else {
          nextAvailableText = 'Completely open for future bookings';
        }
      }

      // Calculate stay rate
      const roomRate = room.price || 0;
      const totalCost = roomRate * nights;

      return {
        room,
        isAvailable,
        displayStatus,
        activeCheckIn,
        conflicts,
        activeBlocks,
        nextAvailableText,
        upcomingReservations: roomRes.filter(r => endOfDay(parseISO(r.checkOut)) >= today),
        roomRate,
        totalCost
      };
    });
  }, [rooms, reservations, roomBlockings, hotel, checkIn, checkOut, nights]);

  // Filtered lists
  const availableRoomsList = useMemo(() => {
    return roomAnalysis.filter(item => {
      if (!item.isAvailable) return false;
      if (selectedType !== 'all' && item.room.type !== selectedType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNumber = (item.room.roomNumber || '').toLowerCase().includes(q);
        const matchType = (item.room.type || '').toLowerCase().includes(q);
        const matchName = (item.room.name || '').toLowerCase().includes(q);
        const matchFloor = (item.room.floor || '').toLowerCase().includes(q);
        if (!matchNumber && !matchType && !matchName && !matchFloor) return false;
      }
      return true;
    });
  }, [roomAnalysis, selectedType, searchQuery]);

  const allRoomsList = useMemo(() => {
    return roomAnalysis.filter(item => {
      if (selectedType !== 'all' && item.room.type !== selectedType) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const matchNumber = (item.room.roomNumber || '').toLowerCase().includes(q);
        const matchType = (item.room.type || '').toLowerCase().includes(q);
        const matchName = (item.room.name || '').toLowerCase().includes(q);
        const matchFloor = (item.room.floor || '').toLowerCase().includes(q);
        if (!matchNumber && !matchType && !matchName && !matchFloor) return false;
      }
      return true;
    });
  }, [roomAnalysis, selectedType, searchQuery]);

  if (!isOpen) return null;

  return (
    <div 
      className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div 
        className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl flex flex-col max-h-[92vh] shadow-2xl overflow-hidden my-auto animate-in fade-in zoom-in-95 duration-200"
        role="dialog"
        aria-modal="true"
        aria-labelledby="available-rooms-title"
      >
        {/* Modal Header */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/70 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
              <CheckCircle2 size={22} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 id="available-rooms-title" className="text-lg sm:text-xl font-bold text-zinc-50 tracking-tight">
                  Available Rooms
                </h2>
                <span className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Live Availability Engine
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Check conflict-free rooms for any stay dates and inspect future booking schedules
              </p>
            </div>
          </div>
          <button 
            onClick={onClose} 
            className="p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all"
            aria-label="Close available rooms dialog"
          >
            <X size={20} />
          </button>
        </div>

        {/* Date Selector & Stay Duration Strip */}
        <div className="p-4 sm:p-5 border-b border-zinc-800 bg-zinc-900/60 space-y-3 shrink-0">
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            {/* Date Pickers */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
              <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
                <Calendar size={16} className="text-emerald-500 shrink-0" />
                <div className="flex flex-col">
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-tight">
                    Check-In Date
                  </label>
                  <input
                    type="date"
                    value={checkIn}
                    onChange={(e) => handleCheckInChange(e.target.value)}
                    className="bg-transparent text-zinc-50 text-xs font-bold outline-none cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
              </div>

              <div className="hidden sm:flex items-center justify-center text-zinc-500">
                <ArrowRight size={16} />
              </div>

              <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2">
                <CalendarDays size={16} className="text-blue-500 shrink-0" />
                <div className="flex flex-col">
                  <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest leading-tight">
                    Check-Out Date
                  </label>
                  <input
                    type="date"
                    value={checkOut}
                    min={format(addDays(parseISO(checkIn), 1), 'yyyy-MM-dd')}
                    onChange={(e) => handleCheckOutChange(e.target.value)}
                    className="bg-transparent text-zinc-50 text-xs font-bold outline-none cursor-pointer"
                    style={{ colorScheme: 'dark' }}
                  />
                </div>
              </div>

              {/* Stay length pill */}
              <div className="px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center gap-1.5 self-center sm:self-auto">
                <Clock size={14} className="text-zinc-400" />
                <span className="text-xs font-bold text-zinc-200">
                  {nights} {nights === 1 ? 'Night' : 'Nights'}
                </span>
              </div>
            </div>

            {/* Quick Date Presets */}
            <div className="flex items-center flex-wrap gap-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mr-1">
                Quick:
              </span>
              <button
                type="button"
                onClick={() => applyPreset('today')}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-all hover:border-zinc-700"
              >
                Tonight
              </button>
              <button
                type="button"
                onClick={() => applyPreset('tomorrow')}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-all hover:border-zinc-700"
              >
                Tomorrow
              </button>
              <button
                type="button"
                onClick={() => applyPreset('2nights')}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-all hover:border-zinc-700"
              >
                2 Nights
              </button>
              <button
                type="button"
                onClick={() => applyPreset('weekend')}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-all hover:border-zinc-700"
              >
                Weekend
              </button>
              <button
                type="button"
                onClick={() => applyPreset('7nights')}
                className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition-all hover:border-zinc-700"
              >
                7 Nights
              </button>
            </div>
          </div>

          {/* Search, Filter & Tabs Toolbar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-1 border-t border-zinc-800/60">
            {/* View Mode Tabs */}
            <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
              <button
                type="button"
                onClick={() => setActiveTab('available')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  activeTab === 'available'
                    ? "bg-emerald-500 text-black shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <CheckCircle2 size={14} />
                <span>Available ({availableRoomsList.length})</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('schedule')}
                className={cn(
                  "px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5",
                  activeTab === 'schedule'
                    ? "bg-zinc-800 text-zinc-50 shadow-sm"
                    : "text-zinc-400 hover:text-zinc-200"
                )}
              >
                <CalendarCheck size={14} />
                <span>All Rooms & Schedule ({rooms.length})</span>
              </button>
            </div>

            {/* Room Type & Search */}
            <div className="flex items-center gap-2 flex-1 sm:justify-end">
              <div className="relative flex-1 sm:max-w-xs">
                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                <input
                  type="text"
                  placeholder="Filter room #, floor, name..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                />
              </div>

              {availableTypes.length > 0 && (
                <select
                  value={selectedType}
                  onChange={(e) => setSelectedType(e.target.value)}
                  className="bg-zinc-950 border border-zinc-800 rounded-lg px-2.5 py-1.5 text-xs text-zinc-300 outline-none focus:border-emerald-500 cursor-pointer"
                >
                  <option value="all">All Room Types</option>
                  {availableTypes.map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              )}
            </div>
          </div>
        </div>

        {/* Modal Body - Tab 1: Available Rooms Grid */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 custom-scrollbar space-y-4">
          {activeTab === 'available' ? (
            availableRoomsList.length === 0 ? (
              <div className="py-16 px-4 text-center border border-dashed border-zinc-800 rounded-2xl bg-zinc-950/40 max-w-lg mx-auto">
                <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-4">
                  <AlertCircle size={28} />
                </div>
                <h3 className="text-lg font-bold text-zinc-100">
                  No Rooms Available for Selected Stay
                </h3>
                <p className="text-xs text-zinc-400 mt-2 leading-relaxed">
                  Every room in this category has an active reservation, guest stay, or maintenance block between{' '}
                  <strong className="text-zinc-200">{checkIn}</strong> and <strong className="text-zinc-200">{checkOut}</strong>.
                </p>
                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => applyPreset('tomorrow')}
                    className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold transition-all"
                  >
                    Check Tomorrow
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab('schedule')}
                    className="px-3.5 py-2 bg-emerald-500 text-black hover:bg-emerald-400 rounded-xl text-xs font-bold transition-all"
                  >
                    View Occupancy Schedule
                  </button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                {availableRoomsList.map(({ room, roomRate, totalCost, nextAvailableText }) => (
                  <div
                    key={room.id}
                    className="bg-zinc-950/80 border border-zinc-800/90 hover:border-emerald-500/40 rounded-2xl p-4 transition-all flex flex-col justify-between group shadow-sm"
                  >
                    <div>
                      {/* Top Row: Room number & status badge */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-base font-black text-zinc-50 font-mono tracking-tight">
                            Room {room.roomNumber}
                          </span>
                          {room.floor && (
                            <span className="text-[10px] font-bold text-zinc-500 bg-zinc-900 px-2 py-0.5 rounded-md border border-zinc-800">
                              Floor {room.floor}
                            </span>
                          )}
                        </div>
                        <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                          Available
                        </span>
                      </div>

                      {/* Room Type & Description */}
                      <h4 className="text-sm font-bold text-zinc-200 group-hover:text-emerald-400 transition-colors">
                        {room.type || 'Standard Room'}
                      </h4>
                      {room.name && room.name !== room.roomNumber && (
                        <p className="text-xs text-zinc-400 italic mt-0.5">{room.name}</p>
                      )}

                      {/* Capacity and details */}
                      <div className="flex items-center gap-3 text-xs text-zinc-400 mt-2.5">
                        <span className="flex items-center gap-1">
                          <Users size={13} className="text-zinc-500" />
                          <span>{room.capacity || 2} Pax</span>
                        </span>
                        {room.status && (
                          <span className="capitalize text-[11px] text-zinc-500">
                            Condition: <strong className="text-zinc-400">{room.status}</strong>
                          </span>
                        )}
                      </div>

                      {/* Amenities snippet */}
                      {room.amenities && room.amenities.length > 0 && (
                        <div className="flex items-center flex-wrap gap-1 mt-2.5">
                          {room.amenities.slice(0, 3).map((a, i) => (
                            <span 
                              key={i} 
                              className="text-[9px] font-semibold text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800/80"
                            >
                              {a}
                            </span>
                          ))}
                          {room.amenities.length > 3 && (
                            <span className="text-[9px] text-zinc-500 font-semibold">
                              +{room.amenities.length - 3} more
                            </span>
                          )}
                        </div>
                      )}

                      {/* Future availability info */}
                      <div className="mt-3 p-2 bg-zinc-900/50 border border-zinc-800/60 rounded-xl text-[11px] text-zinc-400 flex items-start gap-1.5">
                        <Info size={13} className="text-emerald-500 shrink-0 mt-0.5" />
                        <span className="leading-tight">{nextAvailableText}</span>
                      </div>
                    </div>

                    {/* Bottom Row: Pricing & Book Action */}
                    <div className="mt-4 pt-3 border-t border-zinc-800/80 flex items-center justify-between">
                      <div>
                        <div className="text-sm font-black text-zinc-50 font-mono">
                          {formatCurrency(roomRate, safeCurrency, exchangeRate)}
                          <span className="text-[10px] font-normal text-zinc-500"> /night</span>
                        </div>
                        {nights > 1 && (
                          <div className="text-[10px] text-zinc-400">
                            Total: <strong className="text-zinc-200">{formatCurrency(totalCost, safeCurrency, exchangeRate)}</strong> ({nights}n)
                          </div>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => onSelectRoom(room, checkIn, checkOut)}
                        className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 active:scale-95 shadow-sm shadow-emerald-500/20 cursor-pointer"
                        title="Book this room for selected dates"
                      >
                        <span>Reserve</span>
                        <ArrowRight size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )
          ) : (
            /* Tab 2: All Rooms & Upcoming Occupancy Schedule */
            <div className="space-y-3">
              <div className="p-3 bg-zinc-950/70 border border-zinc-800 rounded-xl flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-2 font-medium">
                  <CalendarCheck size={16} className="text-emerald-500" />
                  Showing all {allRoomsList.length} rooms and their upcoming reservation schedules
                </span>
                <span className="text-[11px] text-zinc-500">
                  Target Stay: <strong className="text-zinc-300">{checkIn} ➔ {checkOut}</strong> ({nights} {nights === 1 ? 'night' : 'nights'})
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3">
                {allRoomsList.map(({ room, isAvailable, displayStatus, activeCheckIn, conflicts, nextAvailableText, upcomingReservations, roomRate }) => (
                  <div
                    key={room.id}
                    className={cn(
                      "p-4 rounded-2xl border transition-all flex flex-col md:flex-row md:items-center justify-between gap-4",
                      isAvailable 
                        ? "bg-zinc-950/60 border-zinc-800 hover:border-emerald-500/30" 
                        : "bg-zinc-950/90 border-zinc-800/80 opacity-90"
                    )}
                  >
                    {/* Room Info */}
                    <div className="space-y-1.5 min-w-[220px]">
                      <div className="flex items-center gap-2">
                        <span className="text-base font-black text-zinc-50 font-mono">
                          Room {room.roomNumber}
                        </span>
                        <span className="text-xs font-bold text-zinc-300">
                          {room.type}
                        </span>
                        {isAvailable ? (
                          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 uppercase">
                            Available
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 text-[9px] font-bold rounded-full bg-blue-500/10 border border-blue-500/20 text-blue-400 uppercase">
                            {displayStatus === 'occupied' ? 'Occupied' : 'Booked / Blocked'}
                          </span>
                        )}
                      </div>

                      <div className="text-xs text-zinc-400 flex items-center gap-2">
                        <span>Floor {room.floor || 1}</span>
                        <span>•</span>
                        <span>{formatCurrency(roomRate, safeCurrency, exchangeRate)}/night</span>
                        <span>•</span>
                        <span>{room.capacity || 2} Pax</span>
                      </div>

                      <div className="text-xs text-emerald-400 font-semibold flex items-center gap-1.5 pt-0.5">
                        <Clock size={13} />
                        <span>{nextAvailableText}</span>
                      </div>
                    </div>

                    {/* Upcoming Reservations List */}
                    <div className="flex-1 min-w-0 md:max-w-md">
                      <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1">
                        Upcoming Stays / Bookings:
                      </div>
                      {upcomingReservations.length === 0 ? (
                        <p className="text-xs text-zinc-500 italic">No upcoming reservations logged</p>
                      ) : (
                        <div className="space-y-1 max-h-24 overflow-y-auto custom-scrollbar pr-1">
                          {upcomingReservations.map(res => {
                            const isConflict = conflicts.some(c => c.id === res.id);
                            return (
                              <div
                                key={res.id}
                                className={cn(
                                  "text-[11px] px-2.5 py-1 rounded-lg border flex items-center justify-between gap-2",
                                  isConflict 
                                    ? "bg-red-500/10 border-red-500/20 text-red-300"
                                    : "bg-zinc-900 border-zinc-800 text-zinc-300"
                                )}
                              >
                                <span className="font-semibold truncate">
                                  {res.guestName}
                                  {res.status === 'checked_in' && ' (In-House)'}
                                </span>
                                <span className="font-mono text-[10px] text-zinc-400 shrink-0">
                                  {res.checkIn} ➔ {res.checkOut}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>

                    {/* Action Button */}
                    <div className="shrink-0 flex items-center justify-end">
                      {isAvailable ? (
                        <button
                          type="button"
                          onClick={() => onSelectRoom(room, checkIn, checkOut)}
                          className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-xs rounded-xl transition-all flex items-center gap-1.5 active:scale-95 shadow-sm shadow-emerald-500/20"
                        >
                          <span>Reserve Room</span>
                          <ArrowRight size={14} />
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled
                          className="px-3 py-2 bg-zinc-900 border border-zinc-800 text-zinc-500 rounded-xl text-xs font-semibold cursor-not-allowed"
                        >
                          Unavailable
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-3 sm:p-4 border-t border-zinc-800 bg-zinc-950/80 flex items-center justify-between text-xs text-zinc-400 shrink-0">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span>
              <strong>{availableRoomsList.length}</strong> of {rooms.length} rooms available for{' '}
              <strong className="text-zinc-200">{checkIn}</strong> to <strong className="text-zinc-200">{checkOut}</strong>
            </span>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
