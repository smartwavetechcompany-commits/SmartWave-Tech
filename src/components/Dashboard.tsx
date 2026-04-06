import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { collection, onSnapshot, query, where, limit, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Room, Reservation, FinanceRecord, Hotel } from '../types';
import { formatCurrency, cn } from '../utils';
import { 
  Users, 
  BedDouble, 
  TrendingUp, 
  AlertCircle,
  CheckCircle2,
  Clock,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
  Calendar,
  DollarSign,
  Activity
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { AuditLogs } from './AuditLogs';

export function Dashboard() {
  const { hotel, profile, isSubscriptionActive, currency, exchangeRate } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);

  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [revenueChartData, setRevenueChartData] = useState<{ name: string; amount: number }[]>([]);

  useEffect(() => {
    if (!profile || hasPermissionError) return;
    setLoading(true);

    let unsubHotels = () => {};
    let unsubRooms = () => {};
    let unsubRes = () => {};
    let unsubFinance = () => {};

    if (profile.role === 'superAdmin') {
      unsubHotels = onSnapshot(collection(db, 'hotels'), (snap) => {
        setAllHotels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hotel)));
        setLoading(false);
      }, (err) => {
        if (err.code === 'permission-denied') setHasPermissionError(true);
      });
    } else if (hotel?.id) {
      unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
        setLoading(false);
      });

      unsubRes = onSnapshot(query(collection(db, 'hotels', hotel.id, 'reservations'), limit(5)), (snap) => {
        setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
      });

      unsubFinance = onSnapshot(query(collection(db, 'hotels', hotel.id, 'finance'), limit(100)), (snap) => {
        const records = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord));
        setFinance(records);

        // Process revenue chart data for last 7 days
        const last7Days = Array.from({ length: 7 }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - i);
          return d.toISOString().split('T')[0];
        }).reverse();

        const chartData = last7Days.map(date => {
          const dayRevenue = records
            .filter(r => r.type === 'income' && r.timestamp.startsWith(date))
            .reduce((acc, curr) => acc + curr.amount, 0);
          return {
            name: new Date(date).toLocaleDateString([], { weekday: 'short' }),
            amount: dayRevenue
          };
        });
        setRevenueChartData(chartData);
      });
    }

    return () => {
      unsubHotels();
      unsubRooms();
      unsubRes();
      unsubFinance();
    };
  }, [profile?.role, profile?.uid, hotel?.id, hasPermissionError]);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  const stats = profile?.role === 'superAdmin' 
    ? [
        { label: 'Total Hotels', value: allHotels.length, icon: BedDouble, color: 'text-blue-500' },
        { label: 'Active Subscriptions', value: allHotels.filter(h => h.subscriptionStatus === 'active').length, icon: CheckCircle2, color: 'text-emerald-500' },
        { label: 'Suspended', value: allHotels.filter(h => h.subscriptionStatus === 'suspended').length, icon: AlertCircle, color: 'text-red-500' },
        { label: 'Expired', value: allHotels.filter(h => h.subscriptionStatus === 'expired').length, icon: Clock, color: 'text-amber-500' },
      ]
    : [
        { label: 'Occupancy', value: `${rooms.length ? Math.round((rooms.filter(r => r.status === 'occupied').length / rooms.length) * 100) : 0}%`, icon: BedDouble, color: 'text-blue-500' },
        { label: 'Active Guests', value: rooms.filter(r => r.status === 'occupied').length, icon: Users, color: 'text-emerald-500' },
        { label: 'Today Revenue', value: formatCurrency(finance.filter(f => f.type === 'income' && f.timestamp.startsWith(new Date().toISOString().split('T')[0])).reduce((acc, curr) => acc + curr.amount, 0), currency, exchangeRate), icon: TrendingUp, color: 'text-amber-500' },
        { label: 'Dirty Rooms', value: rooms.filter(r => r.status === 'dirty').length, icon: AlertCircle, color: 'text-red-500' },
      ];

  const totalRevenue = finance.filter(f => f.type === 'income').reduce((acc, curr) => acc + curr.amount, 0);
  const previousRevenue = finance.filter(f => f.type === 'income' && !f.timestamp.startsWith(new Date().toISOString().split('T')[0])).reduce((acc, curr) => acc + curr.amount, 0);
  const revenueGrowth = previousRevenue > 0 ? ((totalRevenue - previousRevenue) / previousRevenue) * 100 : 0;

  if (!isSubscriptionActive && profile?.role !== 'superAdmin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-center">
        <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-2xl font-bold text-zinc-50 mb-2">Subscription Expired</h2>
        <p className="text-zinc-400 mb-6 max-w-md">
          Your hotel's subscription has expired or been suspended. Please contact the system owner to extend your access.
        </p>
        <button className="w-full sm:w-auto bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95">
          Extend Access
        </button>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">Overview</h1>
          <p className="text-zinc-400">
            {profile?.role === 'superAdmin' ? 'System-wide analytics and control' : `Welcome back to ${hotel?.name}`}
          </p>
        </div>
        <button 
          onClick={() => window.location.reload()}
          disabled={loading}
          className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50 self-start sm:self-center"
          title="Refresh Page"
        >
          <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
        </button>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
            key={stat.label}
            className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl hover:border-zinc-700 transition-colors cursor-default"
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-lg bg-zinc-950", stat.color)}>
                <stat.icon size={20} />
              </div>
            </div>
            <div className="text-2xl font-bold text-zinc-50 mb-1">{stat.value}</div>
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-8">
          {/* Revenue Chart */}
          {profile?.role !== 'superAdmin' && (
            <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="font-bold text-zinc-50">Revenue Overview</h3>
                  <p className="text-xs text-zinc-500">Last 7 days performance</p>
                </div>
                <div className="flex items-center gap-2 text-emerald-500 text-sm font-bold">
                  {revenueGrowth >= 0 ? <ArrowUpRight size={16} /> : <ArrowDownRight size={16} />}
                  {Math.abs(Math.round(revenueGrowth))}%
                </div>
              </div>
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueChartData}>
                    <defs>
                      <linearGradient id="colorRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                    <XAxis dataKey="name" stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#71717a" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(value) => currency === 'USD' ? `$${(value/exchangeRate).toFixed(0)}` : `₦${value.toLocaleString()}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                      itemStyle={{ color: '#10b981' }}
                    />
                    <Area type="monotone" dataKey="amount" stroke="#10b981" fillOpacity={1} fill="url(#colorRev)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Recent Reservations */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h3 className="font-bold text-zinc-50">Recent Reservations</h3>
              <Link to="/front-desk" className="text-emerald-500 text-sm font-medium hover:underline active:opacity-70 transition-opacity">View All</Link>
            </div>
            <div className="divide-y divide-zinc-800">
              {reservations.length === 0 ? (
                <div className="p-8 text-center text-zinc-500 text-sm">No recent reservations</div>
              ) : (
                reservations.map(res => (
                  <div key={res.id} className="p-4 flex items-center justify-between hover:bg-zinc-800/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                        <Users size={18} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-zinc-50">{res.guestName}</div>
                        <div className="text-xs text-zinc-500">Room {res.roomNumber} • {res.checkIn}</div>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                      res.status === 'pending' ? "bg-blue-500/10 text-blue-500" : "bg-zinc-800 text-zinc-400"
                    )}>
                      {res.status.replace('_', ' ')}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Audit Logs Section */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
            <div className="p-6 border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Activity size={18} className="text-emerald-500" />
                <h3 className="font-bold text-zinc-50">Recent Activity</h3>
              </div>
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <AuditLogs />
            </div>
          </div>
        </div>

        <div className="space-y-8">
          {/* Room Status Summary */}
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
            <h3 className="font-bold text-zinc-50 mb-6">Room Status</h3>
            <div className="space-y-4">
              {[
                { label: 'Vacant Clean', count: rooms.filter(r => r.status === 'clean').length, color: 'bg-emerald-500' },
                { label: 'Occupied', count: rooms.filter(r => r.status === 'occupied').length, color: 'bg-blue-500' },
                { label: 'Dirty', count: rooms.filter(r => r.status === 'dirty').length, color: 'bg-red-500' },
                { label: 'Maintenance', count: rooms.filter(r => r.status === 'maintenance').length, color: 'bg-amber-500' },
              ].map(item => (
                <div key={item.label} className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-zinc-400">{item.label}</span>
                    <span className="text-zinc-50 font-medium">{item.count}</span>
                  </div>
                  <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
                    <div 
                      className={cn("h-full rounded-full transition-all duration-500", item.color)} 
                      style={{ width: `${rooms.length ? (item.count / rooms.length) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Quick Actions */}
          {profile?.role !== 'superAdmin' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
              <h3 className="font-bold text-zinc-50 mb-4">Quick Actions</h3>
              <div className="grid grid-cols-2 gap-3">
                <Link to="/front-desk" className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl hover:border-emerald-500/50 transition-colors text-center">
                  <Calendar size={20} className="mx-auto mb-2 text-emerald-500" />
                  <span className="text-xs font-medium text-zinc-400">New Booking</span>
                </Link>
                <Link to="/rooms" className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl hover:border-blue-500/50 transition-colors text-center">
                  <BedDouble size={20} className="mx-auto mb-2 text-blue-500" />
                  <span className="text-xs font-medium text-zinc-400">Room Status</span>
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
</div>
  );
}
