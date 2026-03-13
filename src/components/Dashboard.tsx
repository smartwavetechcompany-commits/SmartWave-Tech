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
  RefreshCw
} from 'lucide-react';
import { motion } from 'motion/react';
import { AuditLogs } from './AuditLogs';
import { ErrorBoundary } from './ErrorBoundary';

export function Dashboard() {
  const { hotel, profile, isSubscriptionActive } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [finance, setFinance] = useState<FinanceRecord[]>([]);
  const [allHotels, setAllHotels] = useState<Hotel[]>([]);

  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const fetchData = React.useCallback(async () => {
    // This is now handled by real-time listeners in useEffect
    // But we keep it for manual refresh if needed, though onSnapshot is automatic
    setLoading(true);
    setTimeout(() => setLoading(false), 500);
  }, []);

  useEffect(() => {
    if (!profile || hasPermissionError) return;

    const unsubs: (() => void)[] = [];

    if (profile.role === 'superAdmin') {
      const unsub = onSnapshot(collection(db, 'hotels'), 
        (snap) => {
          setAllHotels(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Hotel)));
        },
        (err) => {
          if (err.code === 'permission-denied') setHasPermissionError(true);
          else console.error("SuperAdmin hotels listener error:", err);
        }
      );
      unsubs.push(unsub);
    } else if (hotel?.id) {
      const unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      });
      const unsubReservations = onSnapshot(query(collection(db, 'hotels', hotel.id, 'reservations'), limit(5)), (snap) => {
        setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
      });
      const unsubFinance = onSnapshot(query(collection(db, 'hotels', hotel.id, 'finance'), limit(10)), (snap) => {
        setFinance(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord)));
      });
      unsubs.push(unsubRooms, unsubReservations, unsubFinance);
    }

    return () => unsubs.forEach(unsub => unsub());
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
        { label: 'Today Revenue', value: formatCurrency(finance.filter(f => f.type === 'income').reduce((acc, curr) => acc + curr.amount, 0)), icon: TrendingUp, color: 'text-amber-500' },
        { label: 'Dirty Rooms', value: rooms.filter(r => r.status === 'dirty').length, icon: AlertCircle, color: 'text-red-500' },
      ];

  if (!isSubscriptionActive && profile?.role !== 'superAdmin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-full text-center">
        <div className="w-16 h-16 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mb-4">
          <AlertCircle size={32} />
        </div>
        <h2 className="text-2xl font-bold text-white mb-2">Subscription Expired</h2>
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
          <h1 className="text-3xl font-bold text-white tracking-tight">Overview</h1>
          <p className="text-zinc-400">
            {profile?.role === 'superAdmin' ? 'System-wide analytics and control' : `Welcome back to ${hotel?.name}`}
          </p>
        </div>
        <button 
          onClick={() => fetchData()}
          disabled={loading}
          className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50 self-start sm:self-center"
          title="Refresh Data"
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
            <div className="text-2xl font-bold text-white mb-1">{stat.value}</div>
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{stat.label}</div>
          </motion.div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {profile?.role === 'superAdmin' ? (
          <div className="lg:col-span-2">
            <ErrorBoundary>
              <AuditLogs />
            </ErrorBoundary>
          </div>
        ) : (
          <>
            {/* Recent Reservations */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
            <h3 className="font-bold text-white">Recent Reservations</h3>
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
                      <div className="text-sm font-medium text-white">{res.guestName}</div>
                      <div className="text-xs text-zinc-500">Room {res.roomNumber || (res as any).roomNumber} • {res.checkIn}</div>
                    </div>
                  </div>
                  <div className={cn(
                    "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                    res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                    (res.status as string) === 'pending' ? "bg-blue-500/10 text-blue-500" : "bg-zinc-800 text-zinc-400"
                  )}>
                    {res.status.replace('_', ' ')}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Room Status Summary */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
          <h3 className="font-bold text-white mb-6">Room Status</h3>
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
                  <span className="text-white font-medium">{item.count}</span>
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
      </>
    )}
  </div>
</div>
  );
}
