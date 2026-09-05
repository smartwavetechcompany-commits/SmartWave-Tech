import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, updateDoc } from 'firebase/firestore';
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
  ChevronLeft, 
  ChevronRight,
  History,
  TrendingUp,
  Building2,
  CalendarRange
} from 'lucide-react';
import { cn } from '../utils';
import { 
  format, 
  parseISO, 
  startOfDay, 
  endOfDay, 
  addDays, 
  subDays, 
  eachDayOfInterval, 
  isWithinInterval,
  startOfMonth,
  endOfMonth
} from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

interface BreakfastEntry {
  id: string;
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

interface HistoricalDaySummary {
  date: string;
  dayName: string;
  totalRooms: number;
  entitledPax: number;
  servedPax: number;
  unclaimedPax: number;
  servedRate: number;
}

interface HistoricalGuestLog {
  date: string;
  roomNumber: string;
  guestName: string;
  pax: number;
  roomType: string;
  entitlement: string;
  mealPlan: string;
  isServed: boolean;
  status: string;
  guestPhone?: string;
}

export function BreakfastList() {
  const { hotel, profile } = useAuth();
  
  // View Modes: 'daily' (live service roster for a day) | 'historical' (range logs & analytics)
  const [viewMode, setViewMode] = useState<'daily' | 'historical'>('daily');

  // Single Day selection
  const [selectedDate, setSelectedDate] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

  // Historical Range selection
  const [historicalPreset, setHistoricalPreset] = useState<'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month' | 'custom'>('last_7_days');
  const [rangeStart, setRangeStart] = useState<string>(format(subDays(new Date(), 7), 'yyyy-MM-dd'));
  const [rangeEnd, setRangeEnd] = useState<string>(format(new Date(), 'yyyy-MM-dd'));

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

  // Handle Preset changes for historical date range
  const applyPreset = (preset: 'yesterday' | 'last_7_days' | 'last_30_days' | 'this_month') => {
    setHistoricalPreset(preset);
    const today = new Date();
    if (preset === 'yesterday') {
      const y = format(subDays(today, 1), 'yyyy-MM-dd');
      setRangeStart(y);
      setRangeEnd(y);
    } else if (preset === 'last_7_days') {
      setRangeStart(format(subDays(today, 7), 'yyyy-MM-dd'));
      setRangeEnd(format(today, 'yyyy-MM-dd'));
    } else if (preset === 'last_30_days') {
      setRangeStart(format(subDays(today, 30), 'yyyy-MM-dd'));
      setRangeEnd(format(today, 'yyyy-MM-dd'));
    } else if (preset === 'this_month') {
      setRangeStart(format(startOfMonth(today), 'yyyy-MM-dd'));
      setRangeEnd(format(endOfMonth(today), 'yyyy-MM-dd'));
    }
  };

  // Helper to extract breakfast entitlement string
  const getEntitlement = (res: Reservation): string => {
    let entitlement = res.breakfastEntitlement;
    if (!entitlement) {
      const mealPlan = (res.mealPlan || '').toLowerCase();
      if (mealPlan.includes('room only')) {
        entitlement = 'Room Only (No Breakfast)';
      } else if (mealPlan.includes('continental')) {
        entitlement = 'Continental Buffet';
      } else if (mealPlan.includes('buffet') || mealPlan.includes('full')) {
        entitlement = 'Full English Buffet';
      } else {
        entitlement = 'Standard Breakfast Included';
      }
    }
    return entitlement;
  };

  // Helper to compute entries for any single target date string
  const getEntriesForDate = (targetDateStr: string): BreakfastEntry[] => {
    const targetDate = startOfDay(parseISO(targetDateStr));

    return reservations
      .filter(res => {
        if (res.status === 'cancelled' || res.status === 'no_show') return false;

        const checkInDate = startOfDay(parseISO(res.checkIn));
        const checkOutDate = startOfDay(parseISO(res.checkOut));

        const isInHouse = targetDate >= checkInDate && targetDate <= checkOutDate;
        if (!isInHouse) return false;

        if (res.status === 'checked_out' && targetDate > checkOutDate) return false;
        return true;
      })
      .map(res => {
        const resolvedRoomType = roomTypeMap.get(res.roomNumber) || 'Standard Room';
        const mealPlan = res.mealPlan || 'Bed & Breakfast';
        const entitlement = getEntitlement(res);
        const guestCount = res.numberOfGuests || (res.breakfastCount || 2);
        const isServed = ((res as any).breakfastServedDates || []).includes(targetDateStr);

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
          isServed,
          isMasterRoom: res.isPrincipalRoom,
          linkedRooms: res.linkedRoomNumbers
        };
      })
      .sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' }));
  };

  // Compute live breakfast entries for selected single date
  const breakfastEntries = useMemo<BreakfastEntry[]>(() => {
    return getEntriesForDate(selectedDate);
  }, [reservations, selectedDate, roomTypeMap]);

  // Filtered single-date entries
  const filteredEntries = useMemo(() => {
    return breakfastEntries.filter(entry => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const matchesSearch = 
          entry.guestName.toLowerCase().includes(term) ||
          entry.roomNumber.toLowerCase().includes(term) ||
          (entry.guestPhone && entry.guestPhone.includes(term));
        if (!matchesSearch) return false;
      }

      if (selectedRoomType !== 'all' && entry.roomType !== selectedRoomType) {
        return false;
      }

      if (selectedPackage !== 'all') {
        if (selectedPackage === 'included' && entry.breakfastEntitlement.toLowerCase().includes('room only')) return false;
        if (selectedPackage === 'room_only' && !entry.breakfastEntitlement.toLowerCase().includes('room only')) return false;
        if (selectedPackage === 'buffet' && !entry.breakfastEntitlement.toLowerCase().includes('buffet')) return false;
        if (selectedPackage === 'continental' && !entry.breakfastEntitlement.toLowerCase().includes('continental')) return false;
      }

      if (servedStatusFilter === 'served' && !entry.isServed) return false;
      if (servedStatusFilter === 'pending' && entry.isServed) return false;

      return true;
    });
  }, [breakfastEntries, searchTerm, selectedRoomType, selectedPackage, servedStatusFilter]);

  // Single-day Summary Metrics
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
        toast.info(`Room ${entry.roomNumber} breakfast status marked Pending`);
      } else {
        updatedDates = Array.from(new Set([...existingDates, selectedDate]));
        toast.success(`Room ${entry.roomNumber} breakfast recorded as Served`);
      }

      await updateDoc(resRef, {
        breakfastServedDates: updatedDates,
        updatedAt: new Date().toISOString()
      });
    } catch (err: any) {
      toast.error('Failed to update breakfast served state');
    }
  };

  // ==========================================
  // HISTORICAL DATA PROCESSING (Date Range)
  // ==========================================
  const historicalData = useMemo(() => {
    try {
      const start = parseISO(rangeStart);
      const end = parseISO(rangeEnd);
      if (start > end) return { dailySummaries: [], guestLogs: [], totalServed: 0, totalEntitled: 0, avgDailyServed: 0 };

      const days = eachDayOfInterval({ start, end });
      const dailySummaries: HistoricalDaySummary[] = [];
      const guestLogs: HistoricalGuestLog[] = [];

      let totalServedPaxAccum = 0;
      let totalEntitledPaxAccum = 0;

      days.forEach(day => {
        const dateStr = format(day, 'yyyy-MM-dd');
        const dayEntries = getEntriesForDate(dateStr);
        const eligible = dayEntries.filter(e => !e.breakfastEntitlement.toLowerCase().includes('room only'));
        const entitledPax = eligible.reduce((acc, c) => acc + c.numberOfGuests, 0);
        const servedPax = eligible.filter(e => e.isServed).reduce((acc, c) => acc + c.numberOfGuests, 0);
        const unclaimedPax = Math.max(0, entitledPax - servedPax);
        const rate = entitledPax > 0 ? Math.round((servedPax / entitledPax) * 100) : 0;

        totalServedPaxAccum += servedPax;
        totalEntitledPaxAccum += entitledPax;

        dailySummaries.push({
          date: dateStr,
          dayName: format(day, 'EEE, MMM dd'),
          totalRooms: dayEntries.length,
          entitledPax,
          servedPax,
          unclaimedPax,
          servedRate: rate
        });

        // Add guest logs for this date
        dayEntries.forEach(e => {
          guestLogs.push({
            date: dateStr,
            roomNumber: e.roomNumber,
            guestName: e.guestName,
            pax: e.numberOfGuests,
            roomType: e.roomType,
            entitlement: e.breakfastEntitlement,
            mealPlan: e.mealPlan,
            isServed: !!e.isServed,
            status: e.status,
            guestPhone: e.guestPhone
          });
        });
      });

      const avgDailyServed = days.length > 0 ? Math.round(totalServedPaxAccum / days.length) : 0;

      return {
        dailySummaries,
        guestLogs,
        totalServed: totalServedPaxAccum,
        totalEntitled: totalEntitledPaxAccum,
        avgDailyServed
      };
    } catch (e) {
      console.error('Error generating historical breakfast data:', e);
      return { dailySummaries: [], guestLogs: [], totalServed: 0, totalEntitled: 0, avgDailyServed: 0 };
    }
  }, [reservations, rangeStart, rangeEnd, roomTypeMap]);

  // Filtered historical logs
  const filteredHistoricalLogs = useMemo(() => {
    return historicalData.guestLogs.filter(log => {
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const match = 
          log.guestName.toLowerCase().includes(term) ||
          log.roomNumber.toLowerCase().includes(term) ||
          (log.guestPhone && log.guestPhone.includes(term));
        if (!match) return false;
      }
      if (selectedRoomType !== 'all' && log.roomType !== selectedRoomType) return false;
      if (servedStatusFilter === 'served' && !log.isServed) return false;
      if (servedStatusFilter === 'pending' && log.isServed) return false;
      return true;
    });
  }, [historicalData.guestLogs, searchTerm, selectedRoomType, servedStatusFilter]);

  // ==========================================
  // PRINT & EXPORT HANDLERS
  // ==========================================

  const handlePrint = () => {
    window.print();
  };

  // Export PDF (Single Day or Historical)
  const handleExportPDF = () => {
    const doc = new jsPDF('landscape');
    const hotelName = hotel?.name || 'Hotel Property';
    const isHistorical = viewMode === 'historical';
    const title = isHistorical 
      ? `${hotelName} - Historical Breakfast Consumption Report`
      : `${hotelName} - Daily Breakfast Service Manifest`;

    const subTitle = isHistorical
      ? `Period: ${rangeStart} to ${rangeEnd} | Total Served: ${historicalData.totalServed} pax | Total Entitled: ${historicalData.totalEntitled} pax`
      : `Date: ${format(parseISO(selectedDate), 'EEEE, MMMM dd, yyyy')} | Entitled: ${metrics.totalEligiblePax} pax (${metrics.eligibleRooms} rooms) | Served: ${metrics.totalServedPax} pax`;

    doc.setFontSize(18);
    doc.setTextColor(30, 41, 59);
    doc.text(title, 14, 20);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(subTitle, 14, 27);

    if (hotel?.branding?.address || hotel?.branding?.phone) {
      doc.setFontSize(9);
      doc.text(`${hotel?.branding?.address || ''}  ${hotel?.branding?.phone ? `| Tel: ${hotel.branding.phone}` : ''}`, 14, 33);
    }

    if (!isHistorical) {
      const headers = [
        ['Room', 'Guest Name', 'Pax', 'Room Type', 'Entitlement / Package', 'Stay Dates', 'Status', 'Served / Signature']
      ];

      const data = filteredEntries.map(e => [
        e.roomNumber + (e.isMasterRoom ? ' (Master)' : ''),
        e.guestName,
        e.numberOfGuests.toString(),
        e.roomType,
        e.breakfastEntitlement,
        `${e.checkIn} to ${e.checkOut}`,
        e.status === 'checked_in' ? 'In-House' : e.status.toUpperCase(),
        e.isServed ? 'Served [X]' : 'Pending [  ]'
      ]);

      (doc as any).autoTable({
        head: headers,
        body: data,
        startY: 38,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 2.5 },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });
    } else {
      // Historical Export: Summary Table first
      const summaryHeaders = [['Date', 'Day', 'In-House Rooms', 'Entitled Pax', 'Served Pax', 'Unclaimed Pax', 'Served Rate %']];
      const summaryRows = historicalData.dailySummaries.map(s => [
        s.date,
        s.dayName,
        s.totalRooms.toString(),
        s.entitledPax.toString(),
        s.servedPax.toString(),
        s.unclaimedPax.toString(),
        `${s.servedRate}%`
      ]);

      (doc as any).autoTable({
        head: summaryHeaders,
        body: summaryRows,
        startY: 38,
        theme: 'grid',
        headStyles: { fillColor: [16, 185, 129], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8.5, cellPadding: 2 },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });

      const nextY = (doc as any).lastAutoTable?.finalY || 100;
      doc.setFontSize(12);
      doc.setTextColor(30, 41, 59);
      doc.text('Detailed Guest Breakfast Service Ledger', 14, nextY + 12);

      const ledgerHeaders = [['Date', 'Room', 'Guest Name', 'Pax', 'Meal Plan', 'Entitlement', 'Service Status']];
      const ledgerRows = filteredHistoricalLogs.map(l => [
        l.date,
        l.roomNumber,
        l.guestName,
        l.pax.toString(),
        l.mealPlan,
        l.entitlement,
        l.isServed ? 'SERVED' : 'UNCLAIMED'
      ]);

      (doc as any).autoTable({
        head: ledgerHeaders,
        body: ledgerRows,
        startY: nextY + 16,
        theme: 'grid',
        headStyles: { fillColor: [71, 85, 105], textColor: [255, 255, 255], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 2 },
        alternateRowStyles: { fillColor: [248, 250, 252] }
      });
    }

    const cleanHotel = (hotel?.name || 'Hotel').replace(/[^a-zA-Z0-9]/g, '_');
    const filename = isHistorical 
      ? `${cleanHotel}_Breakfast_Historical_${rangeStart}_to_${rangeEnd}.pdf`
      : `${cleanHotel}_Breakfast_Manifest_${selectedDate}.pdf`;

    doc.save(filename);
    toast.success('Breakfast report PDF downloaded');
  };

  // Export Excel (Single Day or Multi-sheet Historical)
  const handleExportExcel = () => {
    const isHistorical = viewMode === 'historical';
    const workbook = XLSX.utils.book_new();
    const cleanHotel = (hotel?.name || 'Hotel').replace(/[^a-zA-Z0-9]/g, '_');

    if (!isHistorical) {
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
        'Served Status': e.isServed ? 'Served' : 'Pending'
      }));

      const worksheet = XLSX.utils.json_to_sheet(data);
      XLSX.utils.book_append_sheet(workbook, worksheet, 'Daily Breakfast List');
      XLSX.writeFile(workbook, `${cleanHotel}_Breakfast_List_${selectedDate}.xlsx`);
    } else {
      // Historical Export: 2 Sheets
      // Sheet 1: Daily Summary
      const summaryData = historicalData.dailySummaries.map(s => ({
        'Date': s.date,
        'Day': s.dayName,
        'In-House Rooms': s.totalRooms,
        'Entitled Pax': s.entitledPax,
        'Served Pax': s.servedPax,
        'Unclaimed Pax': s.unclaimedPax,
        'Consumption Rate %': `${s.servedRate}%`
      }));
      const summarySheet = XLSX.utils.json_to_sheet(summaryData);
      XLSX.utils.book_append_sheet(workbook, summarySheet, 'Daily Summary');

      // Sheet 2: Guest Service Records
      const ledgerData = filteredHistoricalLogs.map(l => ({
        'Date': l.date,
        'Room Number': l.roomNumber,
        'Guest Name': l.guestName,
        'Pax': l.pax,
        'Room Type': l.roomType,
        'Meal Plan': l.mealPlan,
        'Entitlement': l.entitlement,
        'Service Status': l.isServed ? 'Served' : 'Unclaimed',
        'Phone': l.guestPhone || '-'
      }));
      const ledgerSheet = XLSX.utils.json_to_sheet(ledgerData);
      XLSX.utils.book_append_sheet(workbook, ledgerSheet, 'Guest Service Ledger');

      XLSX.writeFile(workbook, `${cleanHotel}_Breakfast_Historical_${rangeStart}_to_${rangeEnd}.xlsx`);
    }

    toast.success('Breakfast report Excel exported successfully');
  };

  const hotelDisplayName = hotel?.name || 'Hotel Property';

  return (
    <div className="space-y-6">
      {/* =========================================================================
          PRINT-ONLY OFFICIAL HOTEL MANIFEST (Pure white, black text, official layout)
          ========================================================================= */}
      <div className="hidden print:block text-black p-4 bg-white">
        <div className="flex items-start justify-between border-b-2 border-black pb-4 mb-4">
          <div>
            <h1 className="text-2xl font-black uppercase tracking-tight text-black">{hotelDisplayName}</h1>
            {hotel?.branding?.address && <p className="text-xs text-zinc-700">{hotel.branding.address}</p>}
            {hotel?.branding?.phone && <p className="text-xs text-zinc-700">Phone: {hotel.branding.phone} {hotel?.branding?.email ? `| Email: ${hotel.branding.email}` : ''}</p>}
            <h2 className="text-sm font-bold uppercase tracking-wider mt-2 text-zinc-900 border-t border-zinc-300 pt-1">
              {viewMode === 'historical' 
                ? `HISTORICAL BREAKFAST CONSUMPTION ARCHIVE (${rangeStart} TO ${rangeEnd})`
                : `DAILY BREAKFAST SERVICE MANIFEST (${format(parseISO(selectedDate), 'EEEE, MMMM dd, yyyy')})`}
            </h2>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold text-black">OFFICIAL KITCHEN ROSTER</p>
            <p className="text-zinc-600 mt-1">Printed: {format(new Date(), 'dd/MM/yyyy HH:mm')}</p>
            <p className="text-zinc-600">Generated by: {profile?.displayName || profile?.username || profile?.role || 'Hotel Staff'}</p>
          </div>
        </div>

        {/* Print Summary Strip */}
        <div className="grid grid-cols-4 gap-3 p-3 bg-zinc-100 border border-zinc-400 rounded-md mb-4 text-xs font-semibold">
          {viewMode === 'daily' ? (
            <>
              <div>Total Entitled Rooms: <span className="font-bold">{metrics.eligibleRooms}</span></div>
              <div>Total Entitled Pax: <span className="font-bold">{metrics.totalEligiblePax}</span></div>
              <div>Served / Claimed: <span className="font-bold text-emerald-800">{metrics.totalServedPax} pax ({metrics.totalServedRooms} rms)</span></div>
              <div>Pending / Remaining: <span className="font-bold text-amber-800">{metrics.pendingPax} pax</span></div>
            </>
          ) : (
            <>
              <div>Date Range: <span className="font-bold">{rangeStart} - {rangeEnd}</span></div>
              <div>Total Entitled Pax: <span className="font-bold">{historicalData.totalEntitled}</span></div>
              <div>Total Claimed Pax: <span className="font-bold text-emerald-800">{historicalData.totalServed}</span></div>
              <div>Daily Average Served: <span className="font-bold">{historicalData.avgDailyServed} pax/day</span></div>
            </>
          )}
        </div>

        {/* Printable Table */}
        <table className="w-full text-left text-xs border border-black border-collapse">
          <thead>
            <tr className="bg-zinc-200 text-black font-bold uppercase text-[10px] border-b border-black">
              {viewMode === 'historical' && <th className="p-2 border-r border-black">Date</th>}
              <th className="p-2 border-r border-black">Room</th>
              <th className="p-2 border-r border-black">Guest Name</th>
              <th className="p-2 border-r border-black">Pax</th>
              <th className="p-2 border-r border-black">Room Type</th>
              <th className="p-2 border-r border-black">Entitlement / Meal Plan</th>
              <th className="p-2 border-r border-black">Stay Dates</th>
              <th className="p-2 border-r border-black">Status</th>
              <th className="p-2">Guest / Staff Signature</th>
            </tr>
          </thead>
          <tbody>
            {viewMode === 'daily' ? (
              filteredEntries.map((e) => (
                <tr key={e.id} className="border-b border-zinc-300 break-inside-avoid">
                  <td className="p-2 border-r border-zinc-300 font-bold font-mono">{e.roomNumber}</td>
                  <td className="p-2 border-r border-zinc-300 font-semibold">{e.guestName}</td>
                  <td className="p-2 border-r border-zinc-300">{e.numberOfGuests}</td>
                  <td className="p-2 border-r border-zinc-300">{e.roomType}</td>
                  <td className="p-2 border-r border-zinc-300">{e.breakfastEntitlement}</td>
                  <td className="p-2 border-r border-zinc-300">{e.checkIn} to {e.checkOut}</td>
                  <td className="p-2 border-r border-zinc-300 font-bold">{e.isServed ? 'SERVED' : 'PENDING'}</td>
                  <td className="p-2 text-zinc-400">________________________</td>
                </tr>
              ))
            ) : (
              filteredHistoricalLogs.map((l, idx) => (
                <tr key={idx} className="border-b border-zinc-300 break-inside-avoid">
                  <td className="p-2 border-r border-zinc-300 font-mono">{l.date}</td>
                  <td className="p-2 border-r border-zinc-300 font-bold font-mono">{l.roomNumber}</td>
                  <td className="p-2 border-r border-zinc-300 font-semibold">{l.guestName}</td>
                  <td className="p-2 border-r border-zinc-300">{l.pax}</td>
                  <td className="p-2 border-r border-zinc-300">{l.roomType}</td>
                  <td className="p-2 border-r border-zinc-300">{l.entitlement}</td>
                  <td className="p-2 border-r border-zinc-300 font-mono text-[10px]">{l.status}</td>
                  <td className="p-2 border-r border-zinc-300 font-bold">{l.isServed ? 'SERVED' : 'UNCLAIMED'}</td>
                  <td className="p-2 text-zinc-400">________________________</td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {/* Print Sign-off Footer */}
        <div className="mt-8 pt-4 border-t border-black flex justify-between text-xs text-zinc-800">
          <div>
            <p>Prepared by: _____________________________________</p>
            <p className="text-[10px] text-zinc-500 mt-1">Food & Beverage Restaurant Captain</p>
          </div>
          <div>
            <p>Verified by: _____________________________________</p>
            <p className="text-[10px] text-zinc-500 mt-1">Front Office / Operations Duty Manager</p>
          </div>
          <div>
            <p>Hotel Official Stamp:</p>
            <div className="w-24 h-12 border border-dashed border-zinc-400 rounded mt-1"></div>
          </div>
        </div>
      </div>

      {/* =========================================================================
          SCREEN-ONLY INTERACTIVE UI (Hidden during print)
          ========================================================================= */}
      <div className="print:hidden space-y-6">
        {/* Header with Title and Mode Switcher */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
                <Coffee size={24} />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-zinc-50 tracking-tight flex items-center gap-2">
                  Automated Breakfast System
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                    Live Sync
                  </span>
                </h2>
                <p className="text-xs sm:text-sm text-zinc-400">
                  {hotelDisplayName} — Real-time breakfast entitlement, service tracking, and historical logs
                </p>
              </div>
            </div>
          </div>

          {/* Mode Tabs: Daily Roster vs Historical Archive */}
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl p-1 self-start md:self-auto">
            <button
              onClick={() => setViewMode('daily')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                viewMode === 'daily' 
                  ? "bg-emerald-500 text-black shadow-sm" 
                  : "text-zinc-400 hover:text-zinc-100"
              )}
            >
              <Utensils size={14} />
              <span>Daily Roster</span>
            </button>
            <button
              onClick={() => setViewMode('historical')}
              className={cn(
                "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                viewMode === 'historical' 
                  ? "bg-emerald-500 text-black shadow-sm" 
                  : "text-zinc-400 hover:text-zinc-100"
              )}
            >
              <History size={14} />
              <span>Historical Archive</span>
            </button>
          </div>
        </div>

        {/* Date Controls & Action Buttons */}
        <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-3.5 flex flex-wrap items-center justify-between gap-3">
          {viewMode === 'daily' ? (
            /* Daily Date Navigator */
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1">
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
                    : "bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-zinc-100"
                )}
              >
                Today
              </button>
            </div>
          ) : (
            /* Historical Date Range Controls */
            <div className="flex flex-wrap items-center gap-2">
              {/* Presets */}
              <div className="flex items-center bg-zinc-950 border border-zinc-800 rounded-xl p-1">
                <button
                  onClick={() => applyPreset('yesterday')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors",
                    historicalPreset === 'yesterday' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  Yesterday
                </button>
                <button
                  onClick={() => applyPreset('last_7_days')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors",
                    historicalPreset === 'last_7_days' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  Last 7 Days
                </button>
                <button
                  onClick={() => applyPreset('last_30_days')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors",
                    historicalPreset === 'last_30_days' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  Last 30 Days
                </button>
                <button
                  onClick={() => applyPreset('this_month')}
                  className={cn(
                    "px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors",
                    historicalPreset === 'this_month' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:text-zinc-100"
                  )}
                >
                  This Month
                </button>
              </div>

              {/* Custom Range Inputs */}
              <div className="flex items-center gap-1.5 bg-zinc-950 border border-zinc-800 rounded-xl px-2.5 py-1 text-xs">
                <CalendarRange size={14} className="text-emerald-500" />
                <input
                  type="date"
                  value={rangeStart}
                  onChange={(e) => {
                    setRangeStart(e.target.value);
                    setHistoricalPreset('custom');
                  }}
                  className="bg-transparent text-zinc-200 outline-none cursor-pointer"
                />
                <span className="text-zinc-500">to</span>
                <input
                  type="date"
                  value={rangeEnd}
                  onChange={(e) => {
                    setRangeEnd(e.target.value);
                    setHistoricalPreset('custom');
                  }}
                  className="bg-transparent text-zinc-200 outline-none cursor-pointer"
                />
              </div>
            </div>
          )}

          {/* Action Buttons: Print, PDF, Excel */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-all hover:border-zinc-700"
              title="Print Manifest"
            >
              <Printer size={14} />
              <span>Print</span>
            </button>

            <button
              onClick={handleExportPDF}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-200 text-xs font-semibold transition-all hover:border-zinc-700"
              title="Export as PDF"
            >
              <Download size={14} />
              <span>PDF</span>
            </button>

            <button
              onClick={handleExportExcel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 text-emerald-400 text-xs font-semibold transition-all"
              title="Export as Excel"
            >
              <FileSpreadsheet size={14} />
              <span>Excel</span>
            </button>
          </div>
        </div>

        {/* Metrics Summary Cards */}
        {viewMode === 'daily' ? (
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
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Historical Total Served</span>
                <CheckCircle2 size={18} className="text-emerald-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-emerald-400">{historicalData.totalServed}</span>
                <span className="text-xs text-zinc-500">breakfasts</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Claimed between {rangeStart} and {rangeEnd}</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Total Entitled Pax</span>
                <Users size={18} className="text-blue-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-blue-400">{historicalData.totalEntitled}</span>
                <span className="text-xs text-zinc-500">eligible</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Across all confirmed in-house bookings</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Average Daily Served</span>
                <TrendingUp size={18} className="text-purple-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-purple-400">{historicalData.avgDailyServed}</span>
                <span className="text-xs text-zinc-500">pax/day</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Over {historicalData.dailySummaries.length} days period</p>
            </div>

            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Serving Efficiency</span>
                <Coffee size={18} className="text-amber-400" />
              </div>
              <div className="mt-2 flex items-baseline gap-2">
                <span className="text-2xl font-black text-amber-400">
                  {historicalData.totalEntitled > 0 ? Math.round((historicalData.totalServed / historicalData.totalEntitled) * 100) : 0}%
                </span>
                <span className="text-xs text-zinc-500">claimed</span>
              </div>
              <p className="text-[11px] text-zinc-500 mt-1">Overall consumption rate</p>
            </div>
          </div>
        )}

        {/* Filter Toolbar */}
        <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
          <div className="relative flex-1 min-w-[240px] max-w-md">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
            <input
              type="text"
              placeholder="Search by guest name, room number, or phone..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500"
            />
          </div>

          <div className="flex flex-wrap items-center gap-3">
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

            {viewMode === 'daily' && (
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
            )}

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

        {/* View Content: Daily Roster vs Historical View */}
        {viewMode === 'daily' ? (
          /* Daily Table */
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

                          <td className="py-3 px-4">
                            <div className="font-semibold text-zinc-100">{entry.guestName}</div>
                            {entry.guestPhone && (
                              <div className="text-[10px] text-zinc-500">{entry.guestPhone}</div>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-zinc-200 font-bold">
                              {entry.numberOfGuests} {entry.numberOfGuests === 1 ? 'Guest' : 'Guests'}
                            </span>
                          </td>

                          <td className="py-3 px-4 text-zinc-300">
                            {entry.roomType}
                          </td>

                          <td className="py-3 px-4">
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
                          </td>

                          <td className="py-3 px-4 text-[11px] text-zinc-400 font-mono">
                            <span>{format(parseISO(entry.checkIn), 'MMM dd')} - {format(parseISO(entry.checkOut), 'MMM dd')}</span>
                          </td>

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

            <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 text-xs text-zinc-500 flex flex-col sm:flex-row items-center justify-between gap-2">
              <span>
                Showing {filteredEntries.length} of {breakfastEntries.length} in-house reservations for {format(parseISO(selectedDate), 'MMM dd, yyyy')}
              </span>
              <span className="text-[11px] text-zinc-400">
                * Live synchronization with hotel room occupancy.
              </span>
            </div>
          </div>
        ) : (
          /* Historical View: Daily Aggregates + Detailed Ledger */
          <div className="space-y-6">
            {/* Daily Consumption Breakdown */}
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <TrendingUp size={16} className="text-emerald-500" />
                    Daily Consumption Summary ({rangeStart} to {rangeEnd})
                  </h3>
                  <p className="text-[11px] text-zinc-400">Aggregated breakfast entitlement versus claimed rate by day</p>
                </div>
                <span className="text-xs text-zinc-400 font-semibold">{historicalData.dailySummaries.length} days analyzed</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4 font-bold">Date</th>
                      <th className="py-3 px-4 font-bold">In-House Rooms</th>
                      <th className="py-3 px-4 font-bold">Entitled Pax</th>
                      <th className="py-3 px-4 font-bold">Served Pax</th>
                      <th className="py-3 px-4 font-bold">Unclaimed Pax</th>
                      <th className="py-3 px-4 font-bold">Claim Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                    {historicalData.dailySummaries.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-zinc-500">
                          No dates found in the selected range.
                        </td>
                      </tr>
                    ) : (
                      historicalData.dailySummaries.map(s => (
                        <tr key={s.date} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2.5 px-4 font-bold text-zinc-100 font-mono">
                            {s.dayName}
                          </td>
                          <td className="py-2.5 px-4">{s.totalRooms} rooms</td>
                          <td className="py-2.5 px-4 font-semibold text-zinc-200">{s.entitledPax} pax</td>
                          <td className="py-2.5 px-4 font-bold text-emerald-400">{s.servedPax} served</td>
                          <td className="py-2.5 px-4 text-zinc-400">{s.unclaimedPax} unclaimed</td>
                          <td className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <div className="w-20 bg-zinc-800 rounded-full h-2 overflow-hidden">
                                <div 
                                  className="bg-emerald-500 h-full rounded-full" 
                                  style={{ width: `${Math.min(100, s.servedRate)}%` }}
                                />
                              </div>
                              <span className="font-bold text-zinc-200 text-[11px]">{s.servedRate}%</span>
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Detailed Historical Guest Ledger */}
            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                    <History size={16} className="text-blue-400" />
                    Historical Guest Service Records
                  </h3>
                  <p className="text-[11px] text-zinc-400">Complete audit trail of breakfast served per guest</p>
                </div>
                <span className="text-xs text-zinc-400 font-semibold">{filteredHistoricalLogs.length} records</span>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
                    <tr>
                      <th className="py-3 px-4 font-bold">Date</th>
                      <th className="py-3 px-4 font-bold">Room</th>
                      <th className="py-3 px-4 font-bold">Guest Name</th>
                      <th className="py-3 px-4 font-bold">Pax</th>
                      <th className="py-3 px-4 font-bold">Room Type</th>
                      <th className="py-3 px-4 font-bold">Meal Plan</th>
                      <th className="py-3 px-4 font-bold text-center">Service Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
                    {filteredHistoricalLogs.length === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-8 text-center text-zinc-500">
                          No historical breakfast records match your filter criteria.
                        </td>
                      </tr>
                    ) : (
                      filteredHistoricalLogs.slice(0, 100).map((log, idx) => (
                        <tr key={idx} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="py-2.5 px-4 font-mono text-zinc-400 text-[11px]">{log.date}</td>
                          <td className="py-2.5 px-4 font-bold text-zinc-100 font-mono">{log.roomNumber}</td>
                          <td className="py-2.5 px-4 font-semibold text-zinc-200">
                            {log.guestName}
                            {log.guestPhone && <span className="text-[10px] text-zinc-500 block">{log.guestPhone}</span>}
                          </td>
                          <td className="py-2.5 px-4">{log.pax} {log.pax === 1 ? 'Guest' : 'Guests'}</td>
                          <td className="py-2.5 px-4 text-zinc-300">{log.roomType}</td>
                          <td className="py-2.5 px-4">
                            <span className="text-[11px] text-zinc-300 font-medium">{log.entitlement}</span>
                          </td>
                          <td className="py-2.5 px-4 text-center">
                            {log.isServed ? (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                <CheckCircle2 size={11} /> Served
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-zinc-800 text-zinc-400 border border-zinc-700">
                                <Clock size={11} /> Unclaimed
                              </span>
                            )}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>

              {filteredHistoricalLogs.length > 100 && (
                <div className="p-3 bg-zinc-950/60 border-t border-zinc-800 text-center text-xs text-zinc-500">
                  Showing first 100 of {filteredHistoricalLogs.length} historical logs. Use Excel/PDF export to view all {filteredHistoricalLogs.length} records.
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
