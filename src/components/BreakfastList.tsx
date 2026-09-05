import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query, where, updateDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, RoomType, OperationType } from '../types';
import { 
  Coffee, 
  Search, 
  Calendar, 
  Filter, 
  Printer, 
  Download, 
  FileSpreadsheet, 
  Users, 
  CheckCircle2, 
  Clock, 
  Bed, 
  Utensils, 
  RefreshCw,
  Sparkles,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format, parseISO, startOfDay, endOfDay, isWithinInterval, addDays, subDays } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

interface BreakfastEntry {
  id: string; // reservation id
  guestName: string;
  guestPhone?: string;
  guestEmail?: string;
  roomNumber: string;
  roomId?: string;
  roomType: string;
  checkIn: string;
  checkOut: string;
  status: Reservation['status'];
  numberOfGuests: number;
  breakfastEntitlement: string;
  mealPlan: string;
  specialNotes?: string;
  isServed?: boolean;
  servedAt?: string;
  isMasterRoom?: boolean;
  linkedRooms?: string[];
}

export function BreakfastList() {
  const { hotel, profile } = useAuth();
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedRoomType, setSelectedRoomType] = useState('all');
  const [selectedPackage, setSelectedPackage] = useState('all');
  const [servedStatusFilter, setServedStatusFilter] = useState<'all' | 'served' | 'pending'>('all');

  // Real-time listener for reservations
  useEffect(() => {
    if (!hotel?.id) return;
    const reservationsRef = collection(db, 'hotels', hotel.id, 'reservations');

    const unsub = onSnapshot(reservationsRef, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setReservations(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
      setLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Real-time listener for rooms
  useEffect(() => {
    if (!hotel?.id) return;
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');

    const unsub = onSnapshot(roomsRef, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as Room));
      setRooms(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Real-time listener for room types
  useEffect(() => {
    if (!hotel?.id) return;
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');

    const unsub = onSnapshot(typesRef, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() } as RoomType));
      setRoomTypes(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/room_types`);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Map room numbers to room types
  const roomTypeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rooms) {
      map.set(r.roomNumber, r.type || 'Standard');
    }
    return map;
  }, [rooms]);

  // Compute live breakfast entries for the selected date
  const breakfastEntries = useMemo<BreakfastEntry[]>(() => {
    const targetDate = startOfDay(parseISO(selectedDate));

    return reservations
      .filter(res => {
        // Automatically include checked-in guests who are in-house on this date
        // Exclude cancelled or checked_out guests (unless they check out today and have breakfast before leaving!)
        if (res.status === 'cancelled' || res.status === 'no_show') return false;

        const checkInDate = startOfDay(parseISO(res.checkIn));
        const checkOutDate = startOfDay(parseISO(res.checkOut));

        // In hotel operations, breakfast on departure date is included, breakfast on checkin day is typically not unless early checkin
        const isInHouse = targetDate >= checkInDate && targetDate <= checkOutDate;
        if (!isInHouse) return false;

        // If today is after checkout date and guest is checked out, exclude
        if (res.status === 'checked_out' && targetDate > checkOutDate) return false;

        return true;
      })
      .map(res => {
        const resolvedRoomType = roomTypeMap.get(res.roomNumber) || 'Standard Room';

        // Extract meal plan and breakfast entitlement
        let mealPlan = res.mealPlan || 'Bed & Breakfast';
        let entitlement = res.breakfastEntitlement;
        if (!entitlement) {
          if (mealPlan.toLowerCase().includes('room only')) {
            entitlement = 'Room Only (No Breakfast)';
          } else if (mealPlan.toLowerCase().includes('continental')) {
            entitlement = 'Continental Buffet';
          } else if (mealPlan.toLowerCase().includes('buffet') || mealPlan.toLowerCase().includes('full')) {
            entitlement = 'Full English Buffet';
          } else {
            entitlement = 'Standard Breakfast Included';
          }
        }

        const guestCount = res.numberOfGuests || (res.breakfastCount || 2);

        return {
          id: res.id,
          guestName: res.guestName || 'Guest',
          guestPhone: res.guestPhone,
          guestEmail: res.guestEmail,
          roomNumber: res.roomNumber,
          roomId: res.roomId,
          roomType: resolvedRoomType,
          checkIn: res.checkIn,
          checkOut: res.checkOut,
          status: res.status,
          numberOfGuests: guestCount,
          breakfastEntitlement: entitlement,
          mealPlan: mealPlan,
          specialNotes: res.notes,
          isServed: (res as any).breakfastServedDates?.includes(selectedDate) || false,
          isMasterRoom: res.isPrincipalRoom,
          linkedRooms: res.linkedRoomNumbers
        };
      })
      .sort((a, b) => {
        // Sort by room number naturally
        return a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
      });
  }, [reservations, selectedDate, roomTypeMap]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    return breakfastEntries.filter(entry => {
      // Search
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch = 
          entry.guestName.toLowerCase().includes(term) ||
          entry.roomNumber.toLowerCase().includes(term) ||
          (entry.guestPhone && entry.guestPhone.includes(term));
        if (!matchesSearch) return false;
      }

      // Room Type
      if (selectedRoomType !== 'all' && entry.roomType !== selectedRoomType) {
        return false;
      }

      // Package / Entitlement
      if (selectedPackage !== 'all') {
        if (selectedPackage === 'included' && entry.breakfastEntitlement.toLowerCase().includes('room only')) return false;
        if (selectedPackage === 'room_only' && !entry.breakfastEntitlement.toLowerCase().includes('room only')) return false;
        if (selectedPackage === 'buffet' && !entry.breakfastEntitlement.toLowerCase().includes('buffet')) return false;
        if (selectedPackage === 'continental' && !entry.breakfastEntitlement.toLowerCase().includes('continental')) return false;
      }

      // Served status
      if (servedStatusFilter === 'served' && !entry.isServed) return false;
      if (servedStatusFilter === 'pending' && entry.isServed) return false;

      return true;
    });
  }, [breakfastEntries, searchTerm, selectedRoomType, selectedPackage, servedStatusFilter]);

  // Summary Metrics
  const metrics = useMemo(() => {
    const totalRooms = breakfastEntries.length;
    const eligibleRooms = breakfastEntries.filter(e => !e.breakfastEntitlement.toLowerCase().includes('room only'));
    const totalEligiblePax = eligibleRooms.reduce((acc, curr) => acc + curr.numberOfGuests, 0);
    const totalServedRooms = eligibleRooms.filter(e => e.isServed).length;
    const totalServedPax = eligibleRooms.filter(e => e.isServed).reduce((acc, curr) => acc + curr.numberOfGuests, 0);

    return {
      totalRooms,
      eligibleRooms: eligibleRooms.length,
      totalEligiblePax,
      totalServedRooms,
      totalServedPax,
      pendingPax: Math.max(0, totalEligiblePax - totalServedPax)
    };
  }, [breakfastEntries]);

  // Toggle Breakfast Served Status
  const toggleServedStatus = async (entry: BreakfastEntry) => {
    if (!hotel?.id) return;
    try {
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', entry.id);
      const res = reservations.find(r => r.id === entry.id);
      const existingDates: string[] = (res as any)?.breakfastServedDates || [];

      let updatedDates: string[];
      if (entry.isServed) {
        updatedDates = existingDates.filter(d => d !== selectedDate);
        toast.info(`Marked Room ${entry.roomNumber} breakfast as pending`);
      } else {
        updatedDates = Array.from(new Set([...existingDates, selectedDate]));
        toast.success(`Marked Room ${entry.roomNumber} breakfast as served`);
      }

      await updateDoc(resRef, {
        breakfastServedDates: updatedDates,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      toast.error('Failed to update breakfast served state');
    }
  };

  // Export PDF
  const handleExportPDF = () => {
    const doc = new jsPDF('landscape');
    const title = `${hotel?.name || 'Hotel'} - Daily Breakfast Roster`;
    const dateStr = format(parseISO(selectedDate), 'EEEE, MMMM dd, yyyy');

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text(title, 14, 20);

    doc.setFontSize(11);
    doc.setTextColor(100, 116, 139);
    doc.text(`Date: ${dateStr} | Total Entitled Pax: ${metrics.totalEligiblePax} | Rooms: ${metrics.eligibleRooms}`, 14, 28);

    const headers = [
      ['Room', 'Guest Name', 'Pax', 'Room Type', 'Entitlement / Package', 'Status', 'Served / Signature']
    ];

    const data = filteredEntries.map(e => [
      e.roomNumber + (e.isMasterRoom ? ' (Master)' : ''),
      e.guestName,
      e.numberOfGuests.toString(),
      e.roomType,
      e.breakfastEntitlement,
      e.status === 'checked_in' ? 'In-House' : e.status.toUpperCase(),
      e.isServed ? 'Served [X]' : '__________'
    ]);

    (doc as any).autoTable({
      head: headers,
      body: data,
      startY: 34,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 9, cellPadding: 3 },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    doc.save(`breakfast_list_${selectedDate}.pdf`);
    toast.success('Breakfast list PDF exported');
  };

  // Export Excel
  const handleExportExcel = () => {
    const data = filteredEntries.map(e => ({
      'Room Number': e.roomNumber,
      'Guest Name': e.guestName,
      'Guests (Pax)': e.numberOfGuests,
      'Room Type': e.roomType,
      'Breakfast Entitlement': e.breakfastEntitlement,
      'Meal Plan': e.mealPlan,
      'Reservation Status': e.status,
      'Check In': e.checkIn,
      'Check Out': e.checkOut,
      'Phone': e.guestPhone || '-',
      'Served Today': e.isServed ? 'Yes' : 'No'
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Breakfast List');
    XLSX.writeFile(workbook, `breakfast_list_${selectedDate}.xlsx`);
    toast.success('Breakfast list Excel exported');
  };

  // Print Roster
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header with Title and Quick Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
              <Coffee size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-zinc-50 tracking-tight flex items-center gap-2">
                Automated Breakfast List
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                  Live Sync
                </span>
              </h2>
              <p className="text-sm text-zinc-400">
                Directly calculated from checked-in guests, reservation records, and meal plans
              </p>
            </div>
          </div>
        </div>

        {/* Date Selector & Action Buttons */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
            <button
              onClick={() => setSelectedDate(format(subDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
              className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-colors"
              title="Previous Day"
            >
              <ChevronLeft size={16} />
            </button>
            <div className="flex items-center gap-2 px-2">
              <Calendar size={14} className="text-emerald-500" />
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="bg-transparent text-zinc-100 text-xs font-semibold outline-none cursor-pointer"
              />
            </div>
            <button
              onClick={() => setSelectedDate(format(addDays(parseISO(selectedDate), 1), 'yyyy-MM-dd'))}
              className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-colors"
              title="Next Day"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            onClick={() => setSelectedDate(format(new Date(), 'yyyy-MM-dd'))}
            className={cn(
              "px-3 py-1.5 text-xs font-semibold rounded-xl border transition-all",
              selectedDate === format(new Date(), 'yyyy-MM-dd')
                ? "bg-emerald-500 text-black border-emerald-500"
                : "bg-zinc-900 text-zinc-400 border-zinc-800 hover:text-zinc-100"
            )}
          >
            Today
          </button>

          <button
            onClick={handlePrint}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-all"
          >
            <Printer size={14} />
            <span>Print</span>
          </button>

          <button
            onClick={handleExportPDF}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-all"
          >
            <Download size={14} />
            <span>PDF</span>
          </button>

          <button
            onClick={handleExportExcel}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-all"
          >
            <FileSpreadsheet size={14} />
            <span>Excel</span>
          </button>
        </div>
      </div>

      {/* Metrics Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Total Entitled Pax</span>
            <Users size={18} className="text-emerald-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-zinc-50">{metrics.totalEligiblePax}</span>
            <span className="text-xs text-zinc-500">guests</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Across {metrics.eligibleRooms} occupied rooms</p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Served Today</span>
            <CheckCircle2 size={18} className="text-blue-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-blue-400">{metrics.totalServedPax}</span>
            <span className="text-xs text-zinc-500">served</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">{metrics.totalServedRooms} room vouchers claimed</p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Pending Breakfasts</span>
            <Clock size={18} className="text-amber-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-amber-400">{metrics.pendingPax}</span>
            <span className="text-xs text-zinc-500">remaining</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Ready for restaurant service</p>
        </div>

        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">In-House Rooms</span>
            <Bed size={18} className="text-zinc-400" />
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-black text-zinc-50">{metrics.totalRooms}</span>
            <span className="text-xs text-zinc-500">rooms active</span>
          </div>
          <p className="text-[11px] text-zinc-500 mt-1">Live from reservations database</p>
        </div>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by guest name, room number..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500"
          />
        </div>

        {/* Filter Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Room Type Filter */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Filter size={14} className="text-zinc-500" />
            <select
              value={selectedRoomType}
              onChange={(e) => setSelectedRoomType(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
            >
              <option value="all">All Room Types</option>
              {roomTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Package Filter */}
          <select
            value={selectedPackage}
            onChange={(e) => setSelectedPackage(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="all">All Breakfast Packages</option>
            <option value="included">Breakfast Included</option>
            <option value="buffet">Buffet Packages</option>
            <option value="continental">Continental Only</option>
            <option value="room_only">Room Only (None)</option>
          </select>

          {/* Served Filter */}
          <select
            value={servedStatusFilter}
            onChange={(e) => setServedStatusFilter(e.target.value as any)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="all">All Service States</option>
            <option value="pending">Pending Breakfast</option>
            <option value="served">Served Breakfast</option>
          </select>
        </div>
      </div>

      {/* Breakfast Roster Table */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4 font-bold">Room</th>
                <th className="py-3.5 px-4 font-bold">Guest Name</th>
                <th className="py-3.5 px-4 font-bold">Pax</th>
                <th className="py-3.5 px-4 font-bold">Room Type</th>
                <th className="py-3.5 px-4 font-bold">Breakfast Entitlement</th>
                <th className="py-3.5 px-4 font-bold">Stay Dates</th>
                <th className="py-3.5 px-4 font-bold text-center">Service Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
              {loading ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading live breakfast records...
                  </td>
                </tr>
              ) : filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-zinc-500">
                    <Utensils className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No breakfast entries match the selected filters for {format(parseISO(selectedDate), 'MMM dd, yyyy')}.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => {
                  const isRoomOnly = entry.breakfastEntitlement.toLowerCase().includes('room only');

                  return (
                    <tr 
                      key={entry.id}
                      className={cn(
                        "hover:bg-zinc-800/30 transition-colors",
                        entry.isServed ? "bg-emerald-950/10" : ""
                      )}
                    >
                      {/* Room Number */}
                      <td className="py-3 px-4 font-bold text-zinc-50">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-1 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 font-mono">
                            {entry.roomNumber}
                          </span>
                          {entry.isMasterRoom && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-semibold">
                              Master ({entry.linkedRooms?.length || 0})
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Guest Name */}
                      <td className="py-3 px-4">
                        <div className="font-semibold text-zinc-100">{entry.guestName}</div>
                        {entry.guestPhone && (
                          <div className="text-[10px] text-zinc-500">{entry.guestPhone}</div>
                        )}
                      </td>

                      {/* Pax */}
                      <td className="py-3 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 font-bold">
                          {entry.numberOfGuests} {entry.numberOfGuests === 1 ? 'Guest' : 'Guests'}
                        </span>
                      </td>

                      {/* Room Type */}
                      <td className="py-3 px-4 text-zinc-300">
                        {entry.roomType}
                      </td>

                      {/* Entitlement */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <span className={cn(
                            "px-2.5 py-1 rounded-lg text-[11px] font-semibold",
                            isRoomOnly
                              ? "bg-zinc-800/80 text-zinc-400"
                              : entry.breakfastEntitlement.toLowerCase().includes('buffet')
                              ? "bg-purple-500/20 text-purple-300 border border-purple-500/30"
                              : "bg-emerald-500/20 text-emerald-300 border border-emerald-500/30"
                          )}>
                            {entry.breakfastEntitlement}
                          </span>
                        </div>
                      </td>

                      {/* Stay Dates */}
                      <td className="py-3 px-4 text-[11px] text-zinc-400">
                        <span>{format(parseISO(entry.checkIn), 'MMM dd')} - {format(parseISO(entry.checkOut), 'MMM dd')}</span>
                      </td>

                      {/* Service Action Button */}
                      <td className="py-3 px-4 text-center">
                        <button
                          onClick={() => toggleServedStatus(entry)}
                          disabled={isRoomOnly}
                          className={cn(
                            "px-3 py-1 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 mx-auto",
                            isRoomOnly
                              ? "bg-zinc-800 text-zinc-600 cursor-not-allowed"
                              : entry.isServed
                              ? "bg-blue-500 text-white shadow-sm hover:bg-blue-600"
                              : "bg-zinc-800 hover:bg-emerald-600 text-zinc-300 hover:text-white border border-zinc-700 hover:border-emerald-500"
                          )}
                        >
                          {entry.isServed ? (
                            <>
                              <CheckCircle2 size={13} />
                              <span>Served</span>
                            </>
                          ) : (
                            <>
                              <Clock size={13} />
                              <span>Mark Served</span>
                            </>
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Footer info */}
        <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>
            Showing {filteredEntries.length} of {breakfastEntries.length} in-house reservations
          </span>
          <span className="text-[11px] text-zinc-400">
            * All data is generated live from database records. No manual calculation or duplicate entry needed.
          </span>
        </div>
      </div>
    </div>
  );
}
