import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, Hotel, Room, FinanceRecord, CorporateAccount, Reservation, LedgerEntry, Guest } from '../types';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  Users, 
  Bed,
  Download,
  Calendar,
  Building2,
  FileSpreadsheet,
  FileText,
  Filter,
  LayoutDashboard,
  CreditCard,
  Wallet,
  Receipt,
  Trash2
} from 'lucide-react';
import { cn, formatCurrency, safeStringify } from '../utils';
import { ConfirmModal } from './ConfirmModal';
import { deleteDoc, doc, addDoc } from 'firebase/firestore';
import { handleFirestoreError } from '../firebase';
import { OperationType } from '../types';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  LineChart,
  Line,
  AreaChart,
  Area,
  Cell,
  Pie
} from 'recharts';
import { format, subDays, startOfDay, endOfDay, isWithinInterval, addDays } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

export function Reports() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 7), 'yyyy-MM-dd'),
    end: format(new Date(), 'yyyy-MM-dd')
  });
  
  const [stats, setStats] = useState({
    occupancy: 0,
    revPar: 0,
    adr: 0,
    totalGuests: 0,
    corporateRevenue: 0,
    individualRevenue: 0,
    totalRevenue: 0
  });

  const [revenueData, setRevenueData] = useState<{ name: string; revenue: number }[]>([]);
  const [occupancyData, setOccupancyData] = useState<{ name: string; rate: number }[]>([]);
  const [corporateData, setCorporateData] = useState<{ name: string; value: number }[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [financeRecords, setFinanceRecords] = useState<FinanceRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [recordToDelete, setRecordToDelete] = useState<{ id: string; collection: string; label: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!hotel?.id) return;
    
    const fetchData = async () => {
      setLoading(true);
      try {
        const startDate = startOfDay(new Date(dateRange.start));
        const endDate = endOfDay(new Date(dateRange.end));

        // Fetch rooms for occupancy (current)
        const roomsSnap = await getDocs(collection(db, 'hotels', hotel.id, 'rooms'));
        const totalRooms = roomsSnap.size;
        const occupiedRooms = roomsSnap.docs.filter(d => d.data().status === 'occupied').length;
        const currentOccupancy = totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0;

        // Fetch ledger entries for revenue
        const ledgerSnap = await getDocs(collection(db, 'hotels', hotel.id, 'ledger'));
        const allEntries = ledgerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry));
        
        // Fetch all other data needed for reports
        const [rSnap, gSnap, cSnap, fSnap] = await Promise.all([
          getDocs(collection(db, 'hotels', hotel.id, 'reservations')),
          getDocs(collection(db, 'hotels', hotel.id, 'guests')),
          getDocs(collection(db, 'hotels', hotel.id, 'corporate_accounts')),
          getDocs(collection(db, 'hotels', hotel.id, 'finance'))
        ]);

        const allReservations = rSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));
        const allRooms = roomsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room));
        const allGuests = gSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest));
        const allCorps = cSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount));
        const allFinance = fSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord));

        setReservations(allReservations);
        setRooms(allRooms);
        setGuests(allGuests);
        setCorporateAccounts(allCorps);
        setFinanceRecords(allFinance);

        const filteredEntries = allEntries.filter(entry => {
          const entryDate = new Date(entry.timestamp);
          return isWithinInterval(entryDate, { start: startDate, end: endDate });
        });

        setLedgerEntries(filteredEntries);

        // Calculate stats
        const totalRevenue = filteredEntries
          .filter(e => e.type === 'debit')
          .reduce((acc, curr) => acc + curr.amount, 0);

        const corpRev = filteredEntries
          .filter(e => e.type === 'debit' && e.corporateId)
          .reduce((acc, curr) => acc + curr.amount, 0);
        
        const indivRev = totalRevenue - corpRev;

        // Fetch reservations for occupancy trends
        const resSnap = await getDocs(collection(db, 'hotels', hotel.id, 'reservations'));
        const allRes = resSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation));

        // Group revenue by category for chart
        const categoryRevenue: { [key: string]: number } = {};
        filteredEntries.forEach(entry => {
          if (entry.type === 'debit') {
            const cat = entry.category || 'Other';
            categoryRevenue[cat] = (categoryRevenue[cat] || 0) + entry.amount;
          }
        });

        const revenueByCategory = Object.entries(categoryRevenue).map(([name, value]) => ({ name, value }));
        setCorporateData(revenueByCategory.length > 0 ? revenueByCategory : [{ name: 'No Data', value: 0 }]);

        // Group revenue by day for chart
        const dailyRevenue: { [key: string]: number } = {};
        filteredEntries.forEach(entry => {
          if (entry.type === 'debit') {
            const day = format(new Date(entry.timestamp), 'MMM d');
            dailyRevenue[day] = (dailyRevenue[day] || 0) + entry.amount;
          }
        });

        const chartData = Object.entries(dailyRevenue).map(([name, revenue]) => ({ name, revenue }));
        setRevenueData(chartData.length > 0 ? chartData : [{ name: 'No Data', revenue: 0 }]);

        setStats({
          occupancy: currentOccupancy,
          revPar: totalRevenue / (totalRooms || 1),
          adr: totalRevenue / (occupiedRooms || 1),
          totalGuests: new Set(filteredEntries.map(e => e.reservationId)).size,
          corporateRevenue: corpRev,
          individualRevenue: indivRev,
          totalRevenue
        });

        // Calculate occupancy trend
        const trend: { name: string; rate: number }[] = [];
        let curr = new Date(startDate);
        while (curr <= endDate) {
          const dayStr = format(curr, 'MMM d');
          const activeOnDay = allRes.filter(res => {
            const checkIn = new Date(res.checkIn);
            const checkOut = new Date(res.checkOut);
            return curr >= startOfDay(checkIn) && curr < startOfDay(checkOut);
          }).length;
          
          trend.push({
            name: dayStr,
            rate: totalRooms > 0 ? Math.round((activeOnDay / totalRooms) * 100) : 0
          });
          
          curr.setDate(curr.getDate() + 1);
        }
        setOccupancyData(trend);

      } catch (err: any) {
        console.error("Error fetching report data:", err.message || safeStringify(err));
        toast.error("Failed to load report data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hotel?.id, dateRange]);

  const getReportHeaders = (type: string): string[] => {
    const headers = (() => {
      switch (type) {
        case 'occupancy': return ['Date', 'Total Rooms', 'Occupied', 'Occupancy %'];
        case 'inhouse': return ['Room', 'Guest Name', 'Arrival', 'Departure', 'Nights', 'Balance'];
        case 'reservations': return ['Res #', 'Guest Name', 'Room', 'Arrival', 'Departure', 'Status', 'Total'];
        case 'daily_sales': return ['Date', 'Room Revenue', 'F & B', 'Other', 'Total'];
        case 'monthly_sales': return ['Month', 'Room Revenue', 'F & B', 'Other', 'Total'];
        case 'payments': return ['Date', 'Guest', 'Method', 'Description', 'Amount'];
        case 'balance': return ['Guest Name', 'Room', 'Total Charges', 'Total Paid', 'Balance'];
        case 'rooms': return ['Room #', 'Type', 'Status', 'Total Revenue', 'Occupancy Count'];
        case 'guests': return ['Guest Name', 'Email', 'Phone', 'Total Stays', 'Total Spent'];
        case 'services': return ['Date', 'Service', 'Guest', 'Room', 'Amount'];
        case 'laundry': return ['Date', 'Guest', 'Room', 'Description', 'Amount'];
        case 'staff_sales': return ['Staff Name', 'Module', 'Total Sales', 'Count'];
        default: return ['Date', 'Description', 'Category', 'Amount'];
      }
    })();

    // Add Actions header for deletable reports
    const deletableReports = ['reservations', 'payments', 'services', 'laundry', 'inhouse', 'balance'];
    if (deletableReports.includes(type) && (profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin')) {
      return [...headers, 'Actions'];
    }
    return headers;
  };

  const getReportData = (type: string): any[] => {
    const startDate = startOfDay(new Date(dateRange.start));
    const endDate = endOfDay(new Date(dateRange.end));

    switch (type) {
      case 'occupancy': {
        const data: any[] = [];
        let curr = new Date(startDate);
        while (curr <= endDate) {
          const dayStr = format(curr, 'yyyy-MM-dd');
          const occupied = reservations.filter(res => {
            const checkIn = new Date(res.checkIn);
            const checkOut = new Date(res.checkOut);
            return curr >= startOfDay(checkIn) && curr < startOfDay(checkOut) && (res.status === 'checked_in' || res.status === 'checked_out');
          }).length;
          data.push({
            Date: dayStr,
            'Total Rooms': rooms.length,
            Occupied: occupied,
            'Occupancy %': rooms.length > 0 ? `${Math.round((occupied / rooms.length) * 100)}%` : '0%'
          });
          curr = addDays(curr, 1);
        }
        return data;
      }
      case 'inhouse': {
        return reservations
          .filter(res => res.status === 'checked_in')
          .map(res => ({
            Room: res.roomNumber,
            'Guest Name': res.guestName,
            Arrival: res.checkIn,
            Departure: res.checkOut,
            Nights: res.nights || 0,
            Balance: res.totalAmount - (res.paidAmount || 0),
            _id: res.id,
            _collection: 'reservations',
            _label: `In-House Reservation: ${res.guestName}`
          }));
      }
      case 'reservations': {
        return reservations
          .filter(res => {
            const date = new Date(res.createdAt || res.checkIn);
            return isWithinInterval(date, { start: startDate, end: endDate });
          })
          .map(res => ({
            'Res #': res.id.slice(-6).toUpperCase(),
            'Guest Name': res.guestName,
            Room: res.roomNumber,
            Arrival: res.checkIn,
            Departure: res.checkOut,
            Status: res.status.replace('_', ' ').toUpperCase(),
            Total: res.totalAmount,
            _id: res.id,
            _collection: 'reservations',
            _label: `Reservation ${res.id.slice(-6).toUpperCase()}`
          }));
      }
      case 'daily_sales': {
        const data: any[] = [];
        let curr = new Date(startDate);
        while (curr <= endDate) {
          const dayStr = format(curr, 'yyyy-MM-dd');
          const dayEntries = ledgerEntries.filter(e => format(new Date(e.timestamp), 'yyyy-MM-dd') === dayStr);
          const roomRev = dayEntries.filter(e => e.category === 'room' && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
          const fbRev = dayEntries.filter(e => e.category === 'F & B' && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
          const otherRev = dayEntries.filter(e => !['room', 'F & B'].includes(e.category) && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
          data.push({
            Date: dayStr,
            'Room Revenue': roomRev,
            'F & B': fbRev,
            Other: otherRev,
            Total: roomRev + fbRev + otherRev
          });
          curr = addDays(curr, 1);
        }
        return data;
      }
      case 'payments': {
        return ledgerEntries
          .filter(e => e.category === 'payment' && e.type === 'credit')
          .map(e => ({
            Date: format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm'),
            Guest: reservations.find(r => r.id === e.reservationId)?.guestName || 'Unknown',
            Method: e.description.split('via ')[1] || 'Cash',
            Description: e.description,
            Amount: e.amount,
            _id: e.id,
            _collection: 'ledger',
            _label: `Payment: ${e.description}`
          }));
      }
      case 'balance': {
        return reservations
          .filter(res => res.status === 'checked_in')
          .map(res => ({
            'Guest Name': res.guestName,
            Room: res.roomNumber,
            'Total Charges': res.totalAmount,
            'Total Paid': res.paidAmount || 0,
            Balance: res.totalAmount - (res.paidAmount || 0),
            _id: res.id,
            _collection: 'reservations',
            _label: `Balance Record: ${res.guestName}`
          }));
      }
      case 'rooms': {
        return rooms.map(room => {
          const roomRes = reservations.filter(r => r.roomId === room.id);
          const revenue = ledgerEntries.filter(e => e.reservationId && roomRes.find(r => r.id === e.reservationId) && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
          return {
            'Room #': room.roomNumber,
            Type: room.type,
            Status: room.status.toUpperCase(),
            'Total Revenue': revenue,
            'Occupancy Count': roomRes.length
          };
        });
      }
      case 'guests': {
        return guests.map(guest => ({
          'Guest Name': guest.name,
          Email: guest.email,
          Phone: guest.phone,
          'Total Stays': guest.totalStays || 0,
          'Total Spent': guest.totalSpent || 0
        }));
      }
      case 'services': {
        return ledgerEntries
          .filter(e => ['restaurant', 'laundry', 'F & B', 'service'].includes(e.category) && e.type === 'debit')
          .map(e => ({
            Date: format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm'),
            Service: e.category.toUpperCase(),
            Guest: reservations.find(r => r.id === e.reservationId)?.guestName || 'Unknown',
            Room: reservations.find(r => r.id === e.reservationId)?.roomNumber || 'N/A',
            Amount: e.amount,
            _id: e.id,
            _collection: 'ledger',
            _label: `${e.category.toUpperCase()} Service: ${e.amount}`
          }));
      }
      case 'laundry': {
        return ledgerEntries
          .filter(e => e.category === 'laundry' && e.type === 'debit')
          .map(e => ({
            Date: format(new Date(e.timestamp), 'yyyy-MM-dd HH:mm'),
            Guest: reservations.find(r => r.id === e.reservationId)?.guestName || 'Unknown',
            Room: reservations.find(r => r.id === e.reservationId)?.roomNumber || 'N/A',
            Description: e.description,
            Amount: e.amount,
            _id: e.id,
            _collection: 'ledger',
            _label: `Laundry: ${e.description}`
          }));
      }
      case 'staff_sales': {
        const staffSales: Record<string, { name: string; module: string; total: number; count: number }> = {};
        ledgerEntries.filter(e => e.type === 'debit').forEach(e => {
          const key = `${e.postedBy}_${e.category}`;
          if (!staffSales[key]) {
            staffSales[key] = { name: e.postedBy, module: e.category, total: 0, count: 0 };
          }
          staffSales[key].total += e.amount;
          staffSales[key].count += 1;
        });
        return Object.values(staffSales).map(s => ({
          'Staff Name': s.name,
          Module: s.module.toUpperCase(),
          'Total Sales': s.total,
          Count: s.count
        }));
      }
      default: return [];
    }
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const reportLabel = reportTypes.find(r => r.id === activeReport)?.label || 'Report';
    
    // Add header
    doc.setFontSize(20);
    doc.text(`${hotel?.name || 'Hotel'} - ${reportLabel}`, 14, 22);
    doc.setFontSize(10);
    doc.text(`Period: ${dateRange.start} to ${dateRange.end}`, 14, 30);
    doc.text(`Generated on: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 14, 35);

    // Add table
    const headers = getReportHeaders(activeReport);
    const data = getReportData(activeReport);
    
    const tableData = data.map(row => Object.values(row).map((val: any, j) => {
      if (typeof val === 'number' && !['Quantity', 'Nights', 'Count'].some(k => Object.keys(row)[j].includes(k))) {
        return formatForExport(val);
      }
      return val;
    }));

    (doc as any).autoTable({
      startY: 45,
      head: [headers],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] }
    });

    doc.save(`hotel_${activeReport}_report_${dateRange.start}_to_${dateRange.end}.pdf`);
    toast.success("PDF exported successfully");
  };

  const handleDeleteRecord = async () => {
    if (!hotel?.id || !recordToDelete || !profile) return;
    
    setIsDeleting(true);
    try {
      const { id, collection: colName, label } = recordToDelete;
      await deleteDoc(doc(db, 'hotels', hotel.id, colName, id));
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'REPORT_RECORD_DELETED',
        resource: `${label} deleted from ${activeReport} report`,
        hotelId: hotel.id,
        module: 'Reports'
      });

      toast.success('Record deleted successfully');
      
      // Refresh data locally by removing from state
      if (colName === 'reservations') {
        setReservations(prev => prev.filter(r => r.id !== id));
      } else if (colName === 'ledger') {
        setLedgerEntries(prev => prev.filter(e => e.id !== id));
      } else if (colName === 'finance') {
        setFinanceRecords(prev => prev.filter(f => f.id !== id));
      }
      
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/${recordToDelete.collection}/${recordToDelete.id}`);
      toast.error('Failed to delete record');
    } finally {
      setIsDeleting(false);
      setRecordToDelete(null);
    }
  };

  const formatForExport = (amount: number) => {
    return `${currency} ${amount.toLocaleString()}`;
  };

  const exportExcel = () => {
    const data = getReportData(activeReport);
    const reportLabel = reportTypes.find(r => r.id === activeReport)?.label || 'Report';
    
    const worksheet = XLSX.utils.json_to_sheet(data.map(row => {
      const formattedRow: any = {};
      Object.entries(row).forEach(([key, val], j) => {
        if (typeof val === 'number' && !['Quantity', 'Nights', 'Count'].some(k => key.includes(k))) {
          formattedRow[key] = val; // Keep as number for Excel
        } else {
          formattedRow[key] = val;
        }
      });
      return formattedRow;
    }));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, reportLabel.slice(0, 31));
    XLSX.writeFile(workbook, `hotel_${activeReport}_report_${dateRange.start}_to_${dateRange.end}.xlsx`);
    toast.success("Excel exported successfully");
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  const [activeReport, setActiveReport] = useState('overview');
  
  const reportTypes = [
    { id: 'overview', label: 'Overview', icon: PieChart },
    { id: 'occupancy', label: 'Daily Occupancy', icon: Bed },
    { id: 'inhouse', label: 'In House Guests', icon: Users },
    { id: 'occupancy_ratio', label: 'Occupancy Ratio', icon: BarChart3 },
    { id: 'reservations', label: 'Reservation Report', icon: Calendar },
    { id: 'source', label: 'Source Report', icon: Building2 },
    { id: 'rooms', label: 'Room Report', icon: Bed },
    { id: 'services', label: 'Service Report', icon: LayoutDashboard },
    { id: 'guests', label: 'Guest Report', icon: Users },
    { id: 'countries', label: 'Country Report', icon: Building2 },
    { id: 'daily_sales', label: 'Daily Sale Report', icon: TrendingUp },
    { id: 'monthly_sales', label: 'Monthly Sale Report', icon: TrendingUp },
    { id: 'payments', label: 'Payment Report', icon: CreditCard },
    { id: 'balance', label: 'Balance', icon: Wallet },
    { id: 'laundry', label: 'Daily Laundry Report', icon: Receipt },
    { id: 'staff_sales', label: 'Staff Sale Report', icon: Users },
    { id: 'staff_payments', label: 'Staff Payment Report', icon: CreditCard },
    { id: 'taxation', label: 'Taxation Report', icon: Receipt },
  ];

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">Reports & Analytics</h1>
          <p className="text-zinc-400">Monitor hotel performance and trends</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-2 rounded-xl relative">
            <Calendar size={18} className="text-emerald-500 ml-2 pointer-events-none" />
            <input 
              type="date" 
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-transparent text-zinc-50 text-sm outline-none border-none p-1 appearance-none"
              style={{ colorScheme: 'dark' }}
            />
            <span className="text-zinc-600">to</span>
            <input 
              type="date" 
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-transparent text-zinc-50 text-sm outline-none border-none p-1 appearance-none"
              style={{ colorScheme: 'dark' }}
            />
          </div>

          <div className="flex gap-2">
            <button 
              onClick={exportPDF}
              className="bg-zinc-900 border border-zinc-800 text-zinc-50 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
            >
              <FileText size={18} className="text-red-500" />
              PDF
            </button>
            <button 
              onClick={exportExcel}
              className="bg-zinc-900 border border-zinc-800 text-zinc-50 px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
            >
              <FileSpreadsheet size={18} className="text-emerald-500" />
              Excel
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-1 max-h-[calc(100vh-200px)] overflow-y-auto pr-2 custom-scrollbar">
          {reportTypes.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveReport(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all",
                activeReport === item.id 
                  ? "bg-emerald-500 text-zinc-50 shadow-lg shadow-emerald-500/20" 
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          {activeReport === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
                      <Bed size={20} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-zinc-50 mb-1">{stats.occupancy}%</div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Occupancy Rate</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
                      <TrendingUp size={20} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-zinc-50 mb-1">{formatCurrency(stats.revPar, currency, exchangeRate)}</div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">RevPAR</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
                      <TrendingUp size={20} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-zinc-50 mb-1">{formatCurrency(stats.adr, currency, exchangeRate)}</div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">ADR</div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <div className="flex items-center justify-between mb-4">
                    <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
                      <Users size={20} />
                    </div>
                  </div>
                  <div className="text-2xl font-bold text-zinc-50 mb-1">{stats.totalGuests}</div>
                  <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Guests</div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <h3 className="font-bold text-zinc-50 mb-6">Revenue Trend</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={revenueData}>
                        <defs>
                          <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                            <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                        <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => currency === 'USD' ? `$${(value/exchangeRate).toFixed(0)}` : `₦${value.toLocaleString()}`} />
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                          itemStyle={{ color: '#10b981' }}
                          formatter={(value: number) => formatCurrency(value, currency, exchangeRate)}
                        />
                        <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                  <h3 className="font-bold text-zinc-50 mb-6">Revenue Mix</h3>
                  <div className="h-[300px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={corporateData}
                          cx="50%"
                          cy="50%"
                          innerRadius={60}
                          outerRadius={80}
                          paddingAngle={5}
                          dataKey="value"
                        >
                          {corporateData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                          ))}
                        </Pie>
                        <Tooltip 
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                          formatter={(value: number) => formatCurrency(value, currency, exchangeRate)}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex justify-center gap-6 mt-4">
                    {corporateData.map((entry, index) => (
                      <div key={entry.name} className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }} />
                        <span className="text-xs text-zinc-400">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeReport !== 'overview' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-zinc-50">{reportTypes.find(r => r.id === activeReport)?.label}</h3>
                  <p className="text-xs text-zinc-500">Detailed report for the period {dateRange.start} to {dateRange.end}</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={exportExcel}
                    className="flex items-center gap-2 px-3 py-1.5 bg-zinc-800 text-zinc-400 rounded-lg hover:text-zinc-50 transition-colors text-xs font-bold"
                  >
                    <FileSpreadsheet size={14} />
                    Excel
                  </button>
                  <button 
                    onClick={exportPDF}
                    className="flex items-center gap-2 px-3 py-1.5 bg-emerald-500/10 text-emerald-500 rounded-lg hover:bg-emerald-500 hover:text-zinc-50 transition-colors text-xs font-bold"
                  >
                    <FileText size={14} />
                    PDF
                  </button>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead className="bg-zinc-950 border-b border-zinc-800">
                    <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">
                      {getReportHeaders(activeReport).map(header => (
                        <th key={header} className="px-6 py-4">{header}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {getReportData(activeReport).length === 0 ? (
                      <tr>
                        <td colSpan={getReportHeaders(activeReport).length} className="px-6 py-12 text-center text-zinc-500 italic">
                          No data found for this period
                        </td>
                      </tr>
                    ) : (
                      getReportData(activeReport).map((row, i) => (
                        <tr key={i} className="hover:bg-zinc-800/50 transition-colors">
                          {Object.entries(row).filter(([key]) => !key.startsWith('_')).map(([key, val]: [string, any], j) => (
                            <td key={j} className="px-6 py-4 text-sm text-zinc-400">
                              {typeof val === 'number' && !['Quantity', 'Nights', 'Count'].some(k => key.includes(k))
                                ? formatCurrency(val, currency, exchangeRate)
                                : val}
                            </td>
                          ))}
                          {row._id && row._collection && (
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => setRecordToDelete({ id: row._id, collection: row._collection, label: row._label || 'Record' })}
                                className="p-2 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                title="Delete Record"
                              >
                                <Trash2 size={16} />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmModal
        isOpen={!!recordToDelete}
        title="Delete Record"
        message={`Are you sure you want to delete "${recordToDelete?.label}"? This action cannot be undone and will affect hotel balances and statistics.`}
        onConfirm={handleDeleteRecord}
        onCancel={() => setRecordToDelete(null)}
        type="danger"
        confirmText="Delete Permanently"
        isLoading={isDeleting}
      />
    </div>
  );
}
