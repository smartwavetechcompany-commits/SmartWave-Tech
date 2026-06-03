import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, OperationType } from '../types';
import { cn, formatCurrency } from '../utils';
import { 
  Users, 
  LogIn, 
  LogOut, 
  BedDouble,
  Search,
  Calendar,
  Clock,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion } from 'motion/react';
import { format } from 'date-fns';

export function OperationsDashboard() {
  const { hotel, currency, exchangeRate } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [activeTab, setActiveTab] = useState<'arrivals' | 'checkins' | 'checkouts' | 'inhouse'>('arrivals');
  const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(format(new Date(), 'yyyy-MM-dd'));

  const handlePrevMonth = () => {
    setCurrentMonth(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() - 1);
      return d;
    });
  };

  const handleNextMonth = () => {
    setCurrentMonth(prev => {
      const d = new Date(prev);
      d.setMonth(d.getMonth() + 1);
      return d;
    });
  };

  const getCalendarDays = () => {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();

    const firstDayOfMonth = new Date(year, month, 1);
    const startDayOfWeek = firstDayOfMonth.getDay();

    const totalDaysInMonth = new Date(year, month + 1, 0).getDate();

    const daysPrevMonth = new Date(year, month, 0).getDate();
    const prevMonthList = [];
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      prevMonthList.push({
        day: daysPrevMonth - i,
        isCurrentMonth: false,
        dateString: format(new Date(year, month - 1, daysPrevMonth - i), 'yyyy-MM-dd'),
        dateObj: new Date(year, month - 1, daysPrevMonth - i)
      });
    }

    const currentMonthList = [];
    for (let i = 1; i <= totalDaysInMonth; i++) {
      currentMonthList.push({
        day: i,
        isCurrentMonth: true,
        dateString: format(new Date(year, month, i), 'yyyy-MM-dd'),
        dateObj: new Date(year, month, i)
      });
    }

    const totalCells = prevMonthList.length + currentMonthList.length;
    const nextMonthPadding = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);
    const nextMonthList = [];
    for (let i = 1; i <= nextMonthPadding; i++) {
      nextMonthList.push({
        day: i,
        isCurrentMonth: false,
        dateString: format(new Date(year, month + 1, i), 'yyyy-MM-dd'),
        dateObj: new Date(year, month + 1, i)
      });
    }

    return [...prevMonthList, ...currentMonthList, ...nextMonthList];
  };

  const getOccupancyInfo = (dateString: string) => {
    const totalRoomsCount = rooms.length || 10;
    const activeRes = reservations.filter(r => 
      r.status !== 'cancelled' && 
      r.status !== 'no_show' && 
      r.checkIn <= dateString && 
      dateString < r.checkOut
    );
    const count = activeRes.length;
    const rate = Math.round((count / totalRoomsCount) * 100);

    let colorClass = '';
    let textClass = '';
    let level: 'none' | 'low' | 'moderate' | 'high' | 'peak' = 'none';

    if (rate === 0) {
      colorClass = 'bg-zinc-950/40 text-zinc-650 border border-zinc-900 hover:border-zinc-805';
      textClass = 'text-zinc-650';
      level = 'none';
    } else if (rate <= 30) {
      colorClass = 'bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/20 hover:border-emerald-500/40';
      textClass = 'text-emerald-400 font-bold';
      level = 'low';
    } else if (rate <= 60) {
      colorClass = 'bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-300 border border-yellow-500/20 hover:border-yellow-500/40';
      textClass = 'text-yellow-400 font-bold';
      level = 'moderate';
    } else if (rate <= 85) {
      colorClass = 'bg-orange-500/10 hover:bg-orange-500/20 text-orange-300 border border-orange-500/25 hover:border-orange-500/50';
      textClass = 'text-orange-400 font-bold';
      level = 'high';
    } else {
      colorClass = 'bg-red-500/15 hover:bg-red-500/25 text-red-300 border border-red-500/30 hover:border-red-500/50';
      textClass = 'text-red-400 font-black';
      level = 'peak';
    }

    return { count, rate, colorClass, textClass, level };
  };

  const calendarDays = getCalendarDays();

  const selectedDayActiveReservations = selectedDate 
    ? reservations.filter(r => 
        r.status !== 'cancelled' && 
        r.status !== 'no_show' && 
        r.checkIn <= selectedDate && 
        selectedDate < r.checkOut
      )
    : [];

  useEffect(() => {
    if (!hotel?.id) return;

    const unsubRes = onSnapshot(collection(db, 'hotels', hotel.id, 'reservations'), (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
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
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8">
      <header>
        <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 tracking-tight">Daily Operations</h1>
        <p className="text-xs text-zinc-400">Manage today's guest movements and room status</p>
      </header>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 md:gap-6">
        {stats.map((stat) => (
          <button
            key={stat.tab}
            type="button"
            onClick={() => setActiveTab(stat.tab as any)}
            className={cn(
               "bg-zinc-900 border p-3 sm:p-4 rounded-xl transition-all text-left group",
               activeTab === stat.tab ? "border-emerald-500 ring-1 ring-emerald-500/20 shadow-lg shadow-emerald-500/5" : "border-zinc-800 hover:border-zinc-700"
            )}
          >
            <div className="flex items-center justify-between mb-2">
              <div className={cn("p-1.5 rounded-lg bg-zinc-950", stat.color)}>
                <stat.icon size={16} />
              </div>
              {activeTab === stat.tab && (
                <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              )}
            </div>
            <div className="text-lg sm:text-2xl font-bold text-zinc-50 mb-0.5">{stat.count}</div>
            <div className="text-[9px] font-bold text-zinc-500 uppercase tracking-widest">{stat.label}</div>
          </button>
        ))}
      </div>

      {/* Calendar Occupancy Section */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-4">
          <div>
            <h2 className="text-lg font-bold text-zinc-50 tracking-tight flex items-center gap-2">
              <Calendar className="text-emerald-500" size={20} />
              Monthly Occupancy Forecast
            </h2>
            <p className="text-xs text-zinc-400">Click any date to see overnight bookings and density limits</p>
          </div>
          
          <div className="flex items-center gap-1 bg-zinc-950 p-1 border border-zinc-800 rounded-xl">
            <button
              onClick={handlePrevMonth}
              className="p-1.5 hover:bg-zinc-900 text-zinc-405 hover:text-zinc-100 rounded-lg transition-all active:scale-95"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider w-32 text-center select-none py-1">
              {format(currentMonth, 'MMMM yyyy')}
            </span>
            <button
              onClick={handleNextMonth}
              className="p-1.5 hover:bg-zinc-900 text-zinc-405 hover:text-zinc-100 rounded-lg transition-all active:scale-95"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        </div>

        {/* Legend of density levels */}
        <div className="flex flex-wrap items-center gap-3 sm:gap-4 bg-zinc-950/40 p-3 rounded-xl border border-zinc-850 text-[10px] sm:text-xs">
          <span className="text-zinc-500 font-bold uppercase tracking-wider">Density Legend:</span>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-zinc-950 border border-zinc-900" />
            <span className="text-zinc-400">0% (Empty)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-emerald-500/20 border border-emerald-500/40" />
            <span className="text-zinc-400">1-30% (Low)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-yellow-500/20 border border-yellow-500/40" />
            <span className="text-zinc-400">31-60% (Moderate)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-orange-500/20 border border-orange-500/40" />
            <span className="text-zinc-400">61-85% (High)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded bg-red-400/20 border border-red-500/40" />
            <span className="text-zinc-400">86-100% (Peak)</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Calendar Grid */}
          <div className="lg:col-span-2 space-y-3">
            <div className="grid grid-cols-7 gap-1 text-center font-bold text-[10px] uppercase tracking-wider text-zinc-500 mb-1">
              <div>Sun</div>
              <div>Mon</div>
              <div>Tue</div>
              <div>Wed</div>
              <div>Thu</div>
              <div>Fri</div>
              <div>Sat</div>
            </div>

            <div className="grid grid-cols-7 gap-1.5 animate-fade-in">
              {calendarDays.map((calDay, i) => {
                const info = getOccupancyInfo(calDay.dateString);
                const isSelected = selectedDate === calDay.dateString;
                const isTodayStr = calDay.dateString === today;

                return (
                  <button
                    key={`${calDay.dateString}-${i}`}
                    onClick={() => setSelectedDate(calDay.dateString)}
                    type="button"
                    className={cn(
                      "min-h-[72px] sm:min-h-[84px] p-2 flex flex-col justify-between text-left rounded-xl transition-all cursor-pointer select-none",
                      info.colorClass,
                      !calDay.isCurrentMonth && "opacity-30",
                      isSelected && "ring-2 ring-emerald-500 ring-offset-2 ring-offset-zinc-900 scale-[0.99]"
                    )}
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className={cn(
                        "text-xs font-bold",
                        isTodayStr ? "w-6 h-6 flex items-center justify-center bg-emerald-600 text-white rounded-full font-black shadow-md shadow-emerald-600/20" : "text-zinc-400"
                      )}>
                        {calDay.day}
                      </span>
                      {info.rate > 0 && (
                        <span className={cn("text-[8px] tracking-tight py-0.5 px-1 rounded bg-zinc-950/60 font-medium", info.textClass)}>
                          {info.rate}%
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex flex-col justify-end">
                      <span className="text-[9px] font-semibold text-zinc-300 leading-none truncate block">
                        {info.count > 0 ? `${info.count} room${info.count > 1 ? 's' : ''}` : 'Vacant'}
                      </span>
                      <span className="text-[8px] text-zinc-400 font-normal capitalize block mt-0.5">
                        {info.level !== 'none' ? `${info.level} occupancy` : 'Available'}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Details Sidebar/Card Panel */}
          <div className="bg-zinc-950 border border-zinc-805 rounded-xl p-4 flex flex-col justify-between gap-4">
            <div className="space-y-4">
              <div className="border-b border-zinc-800 pb-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                  Selected Date Forecast
                </div>
                <h3 className="text-sm font-bold text-emerald-400">
                  {selectedDate ? format(new Date(selectedDate + 'T00:00:00'), 'E, MMMM d, yyyy') : 'No Date Selected'}
                </h3>
              </div>

              {/* Day Occupancy Percentage Visual Ring/Scale */}
              {selectedDate && (() => {
                const info = getOccupancyInfo(selectedDate);
                return (
                  <div className="bg-zinc-900/40 border border-zinc-800/60 p-3 rounded-xl space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-zinc-400 font-medium">Occupancy Rate:</span>
                      <span className={cn("font-bold text-xs", info.textClass)}>
                        {info.rate}%
                      </span>
                    </div>
                    {/* Visual Progress Bar */}
                    <div className="w-full bg-zinc-950 h-2 rounded-full overflow-hidden border border-zinc-855">
                      <div 
                        className={cn(
                          "h-full rounded-full transition-all duration-300",
                          info.level === 'none' ? 'bg-zinc-850' :
                          info.level === 'low' ? 'bg-emerald-500' :
                          info.level === 'moderate' ? 'bg-yellow-500' :
                          info.level === 'high' ? 'bg-orange-500' : 'bg-red-500'
                        )} 
                        style={{ width: `${Math.min(info.rate, 100)}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[9px] text-zinc-500">
                      <span>{info.count} of {rooms.length || 10} rooms occupied</span>
                      <span className="capitalize">{info.level} Load</span>
                    </div>
                  </div>
                );
              })()}

              {/* Selected date stayers list */}
              <div className="space-y-2">
                <div className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest flex items-center justify-between">
                  <span>Overnight Residents ({selectedDayActiveReservations.length})</span>
                  {selectedDayActiveReservations.length > 0 && <span className="text-zinc-500 text-[9px]">Roll Call</span>}
                </div>

                <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
                  {selectedDayActiveReservations.length === 0 ? (
                    <div className="py-8 text-center bg-zinc-900/20 rounded-xl border border-dashed border-zinc-800 text-zinc-500 text-xs">
                      <Info size={14} className="mx-auto mb-1 text-zinc-650" />
                      No booked stayers on this date
                    </div>
                  ) : (
                    selectedDayActiveReservations.map((res) => (
                      <div 
                        key={res.id}
                        className="p-2.5 bg-zinc-900/60 border border-zinc-805 hover:border-zinc-700/50 rounded-lg flex items-center justify-between text-left transition-colors"
                      >
                        <div className="min-w-0 pr-2">
                          <span className="text-xs font-bold text-zinc-200 block truncate">{res.guestName}</span>
                          <span className="text-[9px] text-zinc-500 block">
                            Room {res.roomNumber} &bull; {res.checkIn} to {res.checkOut}
                          </span>
                        </div>
                        <span className={cn(
                          "text-[8px] px-1.5 py-0.5 rounded uppercase font-bold tracking-wider shrink-0",
                          res.status === 'checked_in' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        )}>
                          {res.status.replace('_', ' ')}
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* General monthly insights footer inside detail card */}
            <div className="text-[9px] text-zinc-500 border-t border-zinc-900 pt-3">
              This interactive widget reflects active commitments in real-time. Cancelled stays are excluded dynamically to keep statistics accurate.
            </div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl">
        <div className="p-4 sm:p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/50">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-bold text-zinc-50 capitalize tracking-tight">{activeTab.replace('-', ' ')}</h2>
            <span className="px-2 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] font-black rounded-full">
              {filteredData().length}
            </span>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input
              type="text"
              placeholder="Search guest or room..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500 transition-colors w-full sm:w-64"
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
                          <div className="text-sm font-medium text-zinc-50">{res.guestName}</div>
                          <div className="text-xs text-zinc-500">{res.guestEmail}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2">
                        <BedDouble size={14} className="text-emerald-500" />
                        <span className="text-sm text-zinc-50 font-medium">Room {res.roomNumber}</span>
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
                        {formatCurrency(res.totalAmount - res.paidAmount, currency, exchangeRate)}
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
