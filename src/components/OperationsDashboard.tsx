import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room } from '../types';
import { cn } from '../utils';
import { 
  Users, 
  LogIn, 
  LogOut, 
  BedDouble,
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';

export function OperationsDashboard() {
  const { hotel } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'arrivals' | 'checkins' | 'checkouts' | 'inhouse'>('arrivals');

  useEffect(() => {
    if (!hotel?.id) return;

    const unsubRes = onSnapshot(collection(db, 'hotels', hotel.id, 'reservations'), (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    const unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    });

    return () => {
      unsubRes();
      unsubRooms();
    };
  }, [hotel?.id]);

  const today = format(new Date(), 'yyyy-MM-dd');

  const arrivals = reservations.filter(r => r.checkIn === today && r.status === 'pending');
  const checkins = reservations.filter(r => r.checkIn === today && r.status === 'checked_in');
  const checkouts = reservations.filter(r => r.checkOut === today && r.status === 'checked_in');
  const inhouse = reservations.filter(r => r.status === 'checked_in');

  const filteredData = () => {
    let data: Reservation[] = [];
    switch (activeTab) {
      case 'arrivals': data = arrivals; break;
      case 'checkins': data = checkins; break;
      case 'checkouts': data = checkouts; break;
      case 'inhouse': data = inhouse; break;
    }
    return data.filter(r => 
      (r.guestName?.toLowerCase() || '').includes(searchTerm.toLowerCase()) ||
      (r.roomNumber?.toLowerCase() || '').includes(searchTerm.toLowerCase())
    );
  };

  const stats = [
    { label: 'Arrivals', count: arrivals.length, icon: LogIn, color: 'text-blue-500', tab: 'arrivals' },
    { label: 'Check-ins', count: checkins.length, icon: CheckCircle2, color: 'text-emerald-500', tab: 'checkins' },
    { label: 'Check-outs', count: checkouts.length, icon: LogOut, color: 'text-amber-500', tab: 'checkouts' },
    { label: 'In-house', count: inhouse.length, icon: BedDouble, color: 'text-indigo-500', tab: 'inhouse' },
  ];

  return (
    <div className="p-8 space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Daily Operations</h1>
        <p className="text-zinc-400">Manage today's guest movements and room status</p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat) => (
          <button
            key={stat.tab}
            onClick={() => setActiveTab(stat.tab as any)}
            className={cn(
              "bg-zinc-900 border p-6 rounded-2xl transition-all text-left",
              activeTab === stat.tab ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-zinc-800 hover:border-zinc-700"
            )}
          >
            <div className="flex items-center justify-between mb-4">
              <div className={cn("p-2 rounded-lg bg-zinc-950", stat.color)}>
                <stat.icon size={20} />
              </div>
              {activeTab === stat.tab && (
                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </div>
            <div className="text-2xl font-bold text-white mb-1">{stat.count}</div>
            <div className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">{stat.label}</div>
          </button>
        ))}
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <h2 className="text-xl font-bold text-white capitalize">{activeTab.replace('-', ' ')}</h2>
            <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-xs font-bold rounded-full">
              {filteredData().length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input
              type="text"
              placeholder="Search guest or room..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors w-full sm:w-64"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-950/50 text-zinc-500 text-xs font-bold uppercase tracking-wider">
                <th className="px-6 py-4 border-b border-zinc-800">Guest</th>
                <th className="px-6 py-4 border-b border-zinc-800">Room</th>
                <th className="px-6 py-4 border-b border-zinc-800">Stay Period</th>
                <th className="px-6 py-4 border-b border-zinc-800">Status</th>
                <th className="px-6 py-4 border-b border-zinc-800">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredData().length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-zinc-500">
                    No {activeTab} found for today
                  </td>
                </tr>
              ) : (
                filteredData().map((res) => (
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    key={res.id}
                    className="hover:bg-zinc-800/30 transition-colors"
                  >
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                          <Users size={14} />
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">{res.guestName}</div>
                          <div className="text-xs text-zinc-500">{res.guestEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <BedDouble size={14} className="text-emerald-500" />
                        <span className="text-sm text-white font-medium">Room {res.roomNumber}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-xs text-zinc-400">
                          <Calendar size={12} />
                          <span>{res.checkIn} to {res.checkOut}</span>
                        </div>
                        <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                          <Clock size={10} />
                          <span>{res.nights} nights</span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "inline-flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                        res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                        res.status === 'pending' ? "bg-blue-500/10 text-blue-500" :
                        res.status === 'checked_out' ? "bg-zinc-800 text-zinc-400" : "bg-red-500/10 text-red-500"
                      )}>
                        {res.status === 'checked_in' && <div className="w-1 h-1 rounded-full bg-emerald-500 animate-pulse" />}
                        {res.status.replace('_', ' ')}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "text-sm font-bold",
                        (res.totalAmount - res.paidAmount) > 0 ? "text-red-400" : "text-emerald-400"
                      )}>
                        ${(res.totalAmount - res.paidAmount).toFixed(2)}
                      </div>
                    </td>
                  </motion.tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
