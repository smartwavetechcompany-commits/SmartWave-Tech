import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  BarChart3, 
  PieChart, 
  TrendingUp, 
  Users, 
  Bed,
  Download,
  Calendar
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
  Area
} from 'recharts';

export function Reports() {
  const { hotel } = useAuth();
  const [stats, setStats] = useState({
    occupancy: 0,
    revPar: 0,
    adr: 0,
    totalGuests: 0
  });

  // Mock data for charts - in a real app, this would be aggregated from Firestore
  const revenueData = [
    { name: 'Mon', revenue: 4000 },
    { name: 'Tue', revenue: 3000 },
    { name: 'Wed', revenue: 2000 },
    { name: 'Thu', revenue: 2780 },
    { name: 'Fri', revenue: 1890 },
    { name: 'Sat', revenue: 2390 },
    { name: 'Sun', revenue: 3490 },
  ];

  const occupancyData = [
    { name: 'Mon', rate: 65 },
    { name: 'Tue', rate: 70 },
    { name: 'Wed', rate: 75 },
    { name: 'Thu', rate: 80 },
    { name: 'Fri', rate: 90 },
    { name: 'Sat', rate: 95 },
    { name: 'Sun', rate: 85 },
  ];

  useEffect(() => {
    if (!hotel?.id) return;
    
    // Fetch some real stats
    const fetchStats = async () => {
      const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');
      const roomsSnap = await getDocs(roomsRef);
      const totalRooms = roomsSnap.size;
      const occupiedRooms = roomsSnap.docs.filter(d => d.data().status === 'occupied').length;
      
      setStats(prev => ({
        ...prev,
        occupancy: totalRooms > 0 ? Math.round((occupiedRooms / totalRooms) * 100) : 0,
        revPar: 125.50, // Mocked for now
        adr: 150.00, // Mocked for now
        totalGuests: 42 // Mocked for now
      }));
    };

    fetchStats();
  }, [hotel?.id]);

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Reports & Analytics</h1>
          <p className="text-zinc-400">Monitor hotel performance and trends</p>
        </div>
        <button className="w-full sm:w-auto bg-zinc-900 border border-zinc-800 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all active:scale-95">
          <Download size={18} />
          Export PDF
        </button>
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
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(stats.revPar)}</div>
          <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">RevPAR</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="flex items-center justify-between mb-4">
            <div className="p-2 rounded-lg bg-purple-500/10 text-purple-500">
              <TrendingUp size={20} />
            </div>
          </div>
          <div className="text-2xl font-bold text-white mb-1">{formatCurrency(stats.adr)}</div>
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
                <YAxis stroke="#71717a" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(value) => `$${value}`} />
                <Tooltip 
                  contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                  itemStyle={{ color: '#10b981' }}
                />
                <Area type="monotone" dataKey="revenue" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
              </AreaChart>
            </ResponsiveContainer>
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
