import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, query } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Guest, OperationType } from '../types';
import { 
  FileText, 
  Search, 
  Calendar, 
  Printer, 
  Download, 
  FileSpreadsheet, 
  Users, 
  ShieldCheck, 
  Building2, 
  Filter, 
  RefreshCw,
  Clock
} from 'lucide-react';
import { cn } from '../utils';
import { 
  format, 
  parseISO, 
  startOfDay, 
  endOfDay, 
  startOfWeek, 
  endOfWeek, 
  startOfMonth, 
  endOfMonth, 
  subDays, 
  isWithinInterval 
} from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

export interface DSSGuestRecord {
  id: string;
  guestName: string;
  arrivalDate: string;
  departureDate: string;
  phoneNumber: string;
  idNumber: string;
  idType?: string;
  address: string;
  roomNumber?: string;
  reservationStatus: string;
}

export function DSSGuestReport() {
  const { hotel } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);

  // Time scope: 'daily' | 'weekly' | 'monthly' | 'custom'
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly' | 'custom'>('daily');
  const [customRange, setCustomRange] = useState({
    start: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });

  const [searchTerm, setSearchTerm] = useState('');

  // Live listener for reservations
  useEffect(() => {
    if (!hotel?.id) return;
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');

    const unsub = onSnapshot(resRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setReservations(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
      setLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Live listener for guests
  useEffect(() => {
    if (!hotel?.id) return;
    const guestsRef = collection(db, 'hotels', hotel.id, 'guests');

    const unsub = onSnapshot(guestsRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Guest));
      setGuests(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/guests`);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Quick guest profile lookup map by ID or Phone
  const guestMap = useMemo(() => {
    const map = new Map<string, Guest>();
    for (const g of guests) {
      if (g.id) map.set(g.id, g);
      if (g.phone) map.set(g.phone, g);
    }
    return map;
  }, [guests]);

  // Determine active date range based on period
  const activeInterval = useMemo(() => {
    const today = new Date();
    if (period === 'daily') {
      return {
        start: startOfDay(today),
        end: endOfDay(today),
        label: `Daily Report (${format(today, 'MMM dd, yyyy')})`
      };
    } else if (period === 'weekly') {
      return {
        start: startOfWeek(today, { weekStartsOn: 1 }),
        end: endOfWeek(today, { weekStartsOn: 1 }),
        label: `Weekly Report (${format(startOfWeek(today, { weekStartsOn: 1 }), 'MMM dd')} - ${format(endOfWeek(today, { weekStartsOn: 1 }), 'MMM dd, yyyy')})`
      };
    } else if (period === 'monthly') {
      return {
        start: startOfMonth(today),
        end: endOfMonth(today),
        label: `Monthly Report (${format(today, 'MMMM yyyy')})`
      };
    } else {
      const start = startOfDay(parseISO(customRange.start));
      const end = endOfDay(parseISO(customRange.end));
      return {
        start,
        end,
        label: `Custom Range (${format(start, 'MMM dd, yyyy')} - ${format(end, 'MMM dd, yyyy')})`
      };
    }
  }, [period, customRange]);

  // Compiled DSS Records strictly containing the user-mandated fields:
  // Guest Name, Arrival Date, Departure Date, Phone Number, ID Number, Address
  const dssRecords = useMemo<DSSGuestRecord[]>(() => {
    return reservations
      .filter(res => {
        // Exclude cancelled/no_show
        if (res.status === 'cancelled' || res.status === 'no_show') return false;

        const checkInDate = startOfDay(parseISO(res.checkIn));
        const checkOutDate = endOfDay(parseISO(res.checkOut));

        // Check if stay overlaps with target interval
        const overlaps = (
          (checkInDate >= activeInterval.start && checkInDate <= activeInterval.end) ||
          (checkOutDate >= activeInterval.start && checkOutDate <= activeInterval.end) ||
          (checkInDate <= activeInterval.start && checkOutDate >= activeInterval.end)
        );

        return overlaps;
      })
      .map(res => {
        // Find matching guest profile if available
        const matchedGuest = (res.guestId && guestMap.get(res.guestId)) ||
          (res.guestPhone && guestMap.get(res.guestPhone));

        const guestName = res.guestName || matchedGuest?.name || 'Unknown Guest';
        const arrivalDate = res.checkIn;
        const departureDate = res.checkOut;
        const phoneNumber = res.guestPhone || matchedGuest?.phone || 'N/A';
        const idNumber = res.idNumber || matchedGuest?.idNumber || 'On File / Unspecified';
        const idType = res.idType || matchedGuest?.idType || 'ID';
        const address = matchedGuest?.address || (res as any).address || 'Not Provided';

        return {
          id: res.id,
          guestName,
          arrivalDate,
          departureDate,
          phoneNumber,
          idNumber: idNumber !== 'On File / Unspecified' ? `${idNumber} (${idType})` : idNumber,
          idType,
          address,
          roomNumber: res.roomNumber,
          reservationStatus: res.status
        };
      })
      .sort((a, b) => new Date(a.arrivalDate).getTime() - new Date(b.arrivalDate).getTime());
  }, [reservations, guestMap, activeInterval]);

  // Filtered search
  const filteredRecords = useMemo(() => {
    if (!searchTerm) return dssRecords;
    const term = searchTerm.toLowerCase();
    return dssRecords.filter(r => 
      r.guestName.toLowerCase().includes(term) ||
      r.phoneNumber.toLowerCase().includes(term) ||
      r.idNumber.toLowerCase().includes(term) ||
      r.address.toLowerCase().includes(term) ||
      (r.roomNumber && r.roomNumber.toLowerCase().includes(term))
    );
  }, [dssRecords, searchTerm]);

  // PDF Export
  const handleExportPDF = () => {
    const doc = new jsPDF('landscape');
    const hotelName = hotel?.name || 'Hotel Property';
    const title = `${hotelName} - DSS / Daily Summary Statement (Guest Register)`;

    doc.setFontSize(16);
    doc.setTextColor(30, 41, 59);
    doc.text(title, 14, 18);

    doc.setFontSize(10);
    doc.setTextColor(100, 116, 139);
    doc.text(`Period: ${activeInterval.label} | Total Registered Guests: ${filteredRecords.length}`, 14, 25);

    // Exact required columns
    const headers = [
      ['Guest Name', 'Arrival Date', 'Departure Date', 'Phone Number', 'ID Number', 'Address']
    ];

    const data = filteredRecords.map(r => [
      r.guestName,
      r.arrivalDate,
      r.departureDate,
      r.phoneNumber,
      r.idNumber,
      r.address
    ]);

    (doc as any).autoTable({
      head: headers,
      body: data,
      startY: 32,
      theme: 'grid',
      headStyles: { fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
      styles: { fontSize: 8.5, cellPadding: 2.5 },
      alternateRowStyles: { fillColor: [248, 250, 252] }
    });

    const finalY = (doc as any).lastAutoTable?.finalY || 150;
    doc.setFontSize(9);
    doc.setTextColor(148, 163, 184);
    doc.text('Authorized Signature & Stamp: ___________________________        Generated: ' + format(new Date(), 'yyyy-MM-dd HH:mm'), 14, finalY + 16);

    doc.save(`dss_guest_report_${period}_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
    toast.success('DSS Guest Report PDF exported successfully');
  };

  // Excel Export
  const handleExportExcel = () => {
    const data = filteredRecords.map(r => ({
      'Guest Name': r.guestName,
      'Arrival Date': r.arrivalDate,
      'Departure Date': r.departureDate,
      'Phone Number': r.phoneNumber,
      'ID Number': r.idNumber,
      'Address': r.address
    }));

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'DSS Guest List');
    XLSX.writeFile(workbook, `dss_guest_report_${period}_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    toast.success('DSS Guest Report Excel exported successfully');
  };

  // Print
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-500/10 border border-blue-500/20 text-blue-400 rounded-xl">
              <FileText size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-zinc-50 tracking-tight flex items-center gap-2">
                DSS / Guest List Report
                <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 font-medium">
                  Official Register
                </span>
              </h2>
              <p className="text-sm text-zinc-400">
                Daily Summary Statement automatically populated from guest & reservation records
              </p>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2">
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

      {/* Time Range Selector Bar */}
      <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Period Pills */}
        <div className="flex items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800">
          <button
            onClick={() => setPeriod('daily')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              period === 'daily' ? "bg-blue-500 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Daily Report
          </button>
          <button
            onClick={() => setPeriod('weekly')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              period === 'weekly' ? "bg-blue-500 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Weekly Report
          </button>
          <button
            onClick={() => setPeriod('monthly')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              period === 'monthly' ? "bg-blue-500 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Monthly Report
          </button>
          <button
            onClick={() => setPeriod('custom')}
            className={cn(
              "px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
              period === 'custom' ? "bg-blue-500 text-white shadow-sm" : "text-zinc-400 hover:text-zinc-200"
            )}
          >
            Date Range
          </button>
        </div>

        {/* Custom Range Picker */}
        {period === 'custom' && (
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-300">
            <Calendar size={14} className="text-blue-400" />
            <input
              type="date"
              value={customRange.start}
              onChange={(e) => setCustomRange(prev => ({ ...prev, start: e.target.value }))}
              className="bg-transparent text-zinc-100 outline-none"
            />
            <span className="text-zinc-500">to</span>
            <input
              type="date"
              value={customRange.end}
              onChange={(e) => setCustomRange(prev => ({ ...prev, end: e.target.value }))}
              className="bg-transparent text-zinc-100 outline-none"
            />
          </div>
        )}

        {/* Search */}
        <div className="relative flex-1 min-w-[220px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search guest name, phone, ID..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-blue-500"
          />
        </div>
      </div>

      {/* Scope Info Badge */}
      <div className="flex items-center justify-between text-xs text-zinc-400 px-1">
        <div className="flex items-center gap-2">
          <ShieldCheck size={16} className="text-blue-400" />
          <span>Active Scope: <strong className="text-zinc-200">{activeInterval.label}</strong></span>
        </div>
        <div>
          <span>Total Registered Guests: <strong className="text-blue-400 font-bold">{filteredRecords.length}</strong></span>
        </div>
      </div>

      {/* DSS Report Table strictly featuring the required 6 columns */}
      <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-2xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950/80 text-zinc-400 uppercase tracking-wider text-[10px] border-b border-zinc-800">
              <tr>
                <th className="py-3.5 px-4 font-bold">Guest Name</th>
                <th className="py-3.5 px-4 font-bold">Arrival Date</th>
                <th className="py-3.5 px-4 font-bold">Departure Date</th>
                <th className="py-3.5 px-4 font-bold">Phone Number</th>
                <th className="py-3.5 px-4 font-bold">ID Number</th>
                <th className="py-3.5 px-4 font-bold">Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800/50 text-zinc-300">
              {loading ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-500" />
                    Generating live DSS records from PMS database...
                  </td>
                </tr>
              ) : filteredRecords.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-zinc-500">
                    <Users className="w-8 h-8 mx-auto mb-2 text-zinc-600" />
                    No guest records found for the selected period.
                  </td>
                </tr>
              ) : (
                filteredRecords.map((record) => (
                  <tr key={record.id} className="hover:bg-zinc-800/30 transition-colors">
                    {/* Guest Name */}
                    <td className="py-3 px-4 font-bold text-zinc-100">
                      <div className="flex items-center gap-2">
                        <span>{record.guestName}</span>
                        {record.roomNumber && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 font-mono">
                            Rm {record.roomNumber}
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Arrival Date */}
                    <td className="py-3 px-4 font-medium text-emerald-400">
                      {format(parseISO(record.arrivalDate), 'MMM dd, yyyy')}
                    </td>

                    {/* Departure Date */}
                    <td className="py-3 px-4 font-medium text-amber-400">
                      {format(parseISO(record.departureDate), 'MMM dd, yyyy')}
                    </td>

                    {/* Phone Number */}
                    <td className="py-3 px-4 text-zinc-200">
                      {record.phoneNumber}
                    </td>

                    {/* ID Number */}
                    <td className="py-3 px-4 font-mono text-zinc-300">
                      {record.idNumber}
                    </td>

                    {/* Address */}
                    <td className="py-3 px-4 text-zinc-400 max-w-xs truncate" title={record.address}>
                      {record.address}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="p-4 bg-zinc-950/60 border-t border-zinc-800 text-xs text-zinc-500 flex items-center justify-between">
          <span>
            Complies with statutory guest register and hospitality daily summary statement standards.
          </span>
          <span className="text-[11px] text-zinc-400">
            * Generated automatically from PMS database records without manual counting or copying.
          </span>
        </div>
      </div>
    </div>
  );
}
