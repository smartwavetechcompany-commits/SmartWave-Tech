import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs, orderBy } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, Hotel, Room, FinanceRecord, CorporateAccount, Reservation, LedgerEntry } from '../types';
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
  Filter
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
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
import { format, subDays, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { toast } from 'sonner';

export function Reports() {
  const { hotel, currency, exchangeRate } = useAuth();
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
  const [loading, setLoading] = useState(false);

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
          .filter(e => e.type === 'debit' && e.category === 'corporate')
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

      } catch (error) {
        console.error("Error fetching report data:", error);
        toast.error("Failed to load report data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [hotel?.id, dateRange]);

  const exportPDF = () => {
    const doc = new jsPDF();
    
    // Add header
    doc.setFontSize(20);
    doc.text(`${hotel?.name || 'Hotel'} - Financial Report`, 14, 22);
    doc.setFontSize(10);
    doc.text(`Period: ${dateRange.start} to ${dateRange.end}`, 14, 30);
    doc.text(`Generated on: ${format(new Date(), 'yyyy-MM-dd HH:mm')}`, 14, 35);

    // Add stats summary
    doc.setFontSize(14);
    doc.text('Summary Statistics', 14, 45);
    doc.setFontSize(10);
    doc.text(`Total Revenue: ${formatForExport(stats.totalRevenue)}`, 14, 52);
    doc.text(`Corporate Revenue: ${formatForExport(stats.corporateRevenue)}`, 14, 57);
    doc.text(`Individual Revenue: ${formatForExport(stats.individualRevenue)}`, 14, 62);
    doc.text(`Total Guests: ${stats.totalGuests}`, 14, 67);

    // Add table
    const tableData = ledgerEntries.map(entry => [
      format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm'),
      entry.description,
      entry.category,
      entry.type.toUpperCase(),
      formatForExport(entry.amount)
    ]);

    (doc as any).autoTable({
      startY: 75,
      head: [['Date', 'Description', 'Category', 'Type', 'Amount']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129] }
    });

    doc.save(`hotel_report_${dateRange.start}_to_${dateRange.end}.pdf`);
    toast.success("PDF exported successfully");
  };

  const formatForExport = (amount: number) => {
    return `${currency} ${amount.toLocaleString()}`;
  };

  const exportExcel = () => {
    const worksheet = XLSX.utils.json_to_sheet(ledgerEntries.map(entry => ({
      Date: format(new Date(entry.timestamp), 'yyyy-MM-dd HH:mm'),
      Description: entry.description,
      Category: entry.category,
      Type: entry.type.toUpperCase(),
      Amount: entry.amount,
      Currency: currency
    })));

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Ledger Entries");
    XLSX.writeFile(workbook, `hotel_report_${dateRange.start}_to_${dateRange.end}.xlsx`);
    toast.success("Excel exported successfully");
  };

  const COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Reports & Analytics</h1>
          <p className="text-zinc-400">Monitor hotel performance and trends</p>
        </div>
        
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-2 rounded-xl">
            <Calendar size={16} className="text-zinc-500 ml-2" />
            <input 
              type="date" 
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-transparent text-white text-sm outline-none border-none p-1"
            />
            <span className="text-zinc-600">to</span>
            <input 
              type="date" 
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-transparent text-white text-sm outline-none border-none p-1"
            />
          </div>

          <div className="flex gap-2">
            <button 
              onClick={exportPDF}
              className="bg-zinc-900 border border-zinc-800 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
            >
              <FileText size={18} className="text-red-500" />
              PDF
            </button>
            <button 
              onClick={exportExcel}
              className="bg-zinc-900 border border-zinc-800 text-white px-4 py-2 rounded-xl font-bold flex items-center gap-2 hover:bg-zinc-800 transition-all active:scale-95"
            >
              <FileSpreadsheet size={18} className="text-emerald-500" />
              Excel
            </button>
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-blue-500/10 text-blue-500">
              <Bed size={20} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{stats.occupancy}%</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Occupancy Rate</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-500">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(stats.revPar, currency, exchangeRate)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">RevPAR</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(stats.adr, currency, exchangeRate)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">ADR</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-amber-500/10 text-amber-500">
              <Users size={20} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{stats.totalGuests}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Total Guests</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <h3 className="font-bold text-white mb-6">Revenue Trend</h3>
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
          <h3 className="font-bold text-white mb-6">Revenue Mix</h3>
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

        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <h3 className="font-bold text-white mb-6">Occupancy Trend</h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={occupancyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                <XAxis dataKey="name" stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#3b82f6' }}
                />
                <Bar dataKey="rate" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
