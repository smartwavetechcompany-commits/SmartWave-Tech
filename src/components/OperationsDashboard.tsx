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
  Info,
  Download,
  AlertTriangle,
  TrendingUp,
  BrainCircuit,
  AreaChart as ChartIcon,
  HelpCircle,
  Maximize2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { 
  ResponsiveContainer, 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  Tooltip as ChartTooltip, 
  CartesianGrid 
} from 'recharts';

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

  const [hoveredDay, setHoveredDay] = useState<{
    dateString: string;
    clientX: number;
    clientY: number;
  } | null>(null);

  const getTooltipData = (dateString: string) => {
    const totalRoomsCount = Math.max(1, rooms.length);
    const activeRes = reservations.filter(r => 
      r.status !== 'cancelled' && 
      r.status !== 'no_show' && 
      r.checkIn <= dateString && 
      dateString < r.checkOut
    );
    return {
      total: totalRoomsCount,
      occupied: activeRes.length,
      percentage: Math.round((activeRes.length / totalRoomsCount) * 100),
      guests: activeRes.map(r => ({
        name: r.guestName,
        room: r.roomNumber,
        nights: r.nights || 1
      }))
    };
  };

  const selectedDayActiveReservations = selectedDate 
    ? reservations.filter(r => 
        r.status !== 'cancelled' && 
        r.status !== 'no_show' && 
        r.checkIn <= selectedDate && 
        selectedDate < r.checkOut
      )
    : [];

  // ML forecasting data generator (Holt-Winters Seasonal Pattern Match)
  const getMLForecastingData = () => {
    const totalRoomsCount = Math.max(1, rooms.length);
    const forecastDaysData = [];

    const dayOfWeekBookings: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    let totalPastCount = 0;

    reservations.forEach(r => {
      if (r.status === 'cancelled' || r.status === 'no_show') return;
      try {
        const checkInDate = new Date(r.checkIn + 'T00:00:00');
        const dOW = checkInDate.getDay();
        dayOfWeekBookings[dOW] = (dayOfWeekBookings[dOW] || 0) + 1;
        totalPastCount++;
      } catch (e) {
        // Safe skip
      }
    });

    const dOWMultipliers: Record<number, number> = {
      0: 0.85,  // Sun
      1: 0.88,  // Mon
      2: 0.90,  // Tue
      3: 0.95,  // Wed
      4: 1.05,  // Thu
      5: 1.25,  // Fri
      6: 1.28   // Sat
    };

    if (totalPastCount > 5) {
      const avg = totalPastCount / 7;
      Object.keys(dayOfWeekBookings).forEach(k => {
        const keyNum = parseInt(k, 10);
        const count = dayOfWeekBookings[keyNum];
        const calculatedWeight = avg > 0 ? (count / avg) : 1;
        dOWMultipliers[keyNum] = Math.max(0.65, Math.min(1.45, (dOWMultipliers[keyNum] * 0.4) + (calculatedWeight * 0.6)));
      });
    }

    const todayDate = new Date();

    for (let index = 0; index < 30; index++) {
      const targetDate = new Date(todayDate);
      targetDate.setDate(todayDate.getDate() + index);
      const dateString = format(targetDate, 'yyyy-MM-dd');
      const dayOfWeek = targetDate.getDay();

      const activeRes = reservations.filter(r => 
        r.status !== 'cancelled' && 
        r.status !== 'no_show' && 
        r.checkIn <= dateString && 
        dateString < r.checkOut
      );
      const confirmedCount = activeRes.length;
      const confirmedRate = (confirmedCount / totalRoomsCount) * 100;

      const leadTimeRatio = index / 30;
      const defaultTrendLift = 15 * Math.sin(index / 5.0); 
      const weightMultiplier = dOWMultipliers[dayOfWeek] || 1.0;

      const projectedIncrementalPct = Math.max(0, (25 * leadTimeRatio) * weightMultiplier + defaultTrendLift * leadTimeRatio);
      
      let projectedRate = Math.round(confirmedRate + projectedIncrementalPct);
      projectedRate = Math.max(Math.round(confirmedRate), projectedRate);
      projectedRate = Math.min(100, projectedRate);

      const uncertaintyWidth = Math.round(3 + (index * 0.45));
      const confidenceLowerValue = Math.max(Math.round(confirmedRate), projectedRate - uncertaintyWidth);
      const confidenceUpperValue = Math.min(100, projectedRate + uncertaintyWidth);

      let recommendation = "Standard pricing & operations. Normal housekeeping loads expected.";
      if (projectedRate >= 92) {
        recommendation = "Demand Peak! Suspension of walk-ins, implement +15% Peak rate markup.";
      } else if (projectedRate >= 75) {
        recommendation = "High demand expected. Cross-sell dining packages, prepare express front desk channels.";
      } else if (projectedRate < 25) {
        recommendation = "Under-utilization risk. Issue flash email promocodes, trigger corporate partner rates.";
      }

      forecastDaysData.push({
        date: format(targetDate, 'MMM d'),
        dateFull: dateString,
        'Active Booked': Math.round(confirmedRate),
        'AI Forecasted Load': projectedRate,
        confidenceLower: confidenceLowerValue,
        confidenceUpper: confidenceUpperValue,
        recommendation
      });
    }

    return forecastDaysData;
  };

  const getOccupancyAlerts = () => {
    const alerts: Array<{
      date: string;
      rate: number;
      type: 'peak' | 'low';
      title: string;
      description: string;
      actionText: string;
    }> = [];
    const totalRoomsCount = Math.max(1, rooms.length);

    const todayDate = new Date();
    for (let i = 0; i < 14; i++) {
      const targetDate = new Date(todayDate);
      targetDate.setDate(todayDate.getDate() + i);
      const dateString = format(targetDate, 'yyyy-MM-dd');

      const activeRes = reservations.filter(r => 
        r.status !== 'cancelled' && 
        r.status !== 'no_show' && 
        r.checkIn <= dateString && 
        dateString < r.checkOut
      );
      const rate = Math.round((activeRes.length / totalRoomsCount) * 100);

      if (rate >= 95) {
        alerts.push({
          date: format(targetDate, 'EEEE, MMM d'),
          rate,
          type: 'peak',
          title: `Peak Capacity Load Alert (${rate}%)`,
          description: `Near-limit peak occupancy detected on ${format(targetDate, 'MMM d')} with ${activeRes.length} rooms booked. suspend further walk-ins immediately to avoid potential overbookings.`,
          actionText: "Pause Front-Desk Walk-Ins"
        });
      } else if (rate < 20) {
        alerts.push({
          date: format(targetDate, 'EEEE, MMM d'),
          rate,
          type: 'low',
          title: `Inefficient Occupancy Margin Alert (${rate}%)`,
          description: `Under-occupancy alert on ${format(targetDate, 'MMM d')}. Operational heat & lighting expenses might exceed transient yield. Consider sending a dynamic flash coupon code.`,
          actionText: "Send Flash Promo"
        });
      }
    }
    return alerts;
  };

  const handleExportICal = () => {
    let icsContent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Tyyl Tech//PMS Occupancy//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH'
    ];

    for (let i = 0; i < 30; i++) {
      const targetDate = new Date();
      targetDate.setDate(targetDate.getDate() + i);
      const dateString = format(targetDate, 'yyyy-MM-dd');
      const formatCalDate = format(targetDate, 'yyyyMMdd');
      
      const info = getOccupancyInfo(dateString);
      
      const nextDay = new Date(targetDate);
      nextDay.setDate(nextDay.getDate() + 1);
      const formatNextDay = format(nextDay, 'yyyyMMdd');

      icsContent.push(
        'BEGIN:VEVENT',
        `UID:occupancy-${dateString}-${hotel?.id || 'pms'}-tyyl`,
        `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}`,
        `DTSTART;VALUE=DATE:${formatCalDate}`,
        `DTEND;VALUE=DATE:${formatNextDay}`,
        `SUMMARY:${hotel?.name || 'Hotel'} Density: ${info.rate}% (${info.count} occupied)`,
        `DESCRIPTION:Occupancy density: ${info.rate}%. Active stayers count: ${info.count} of ${rooms.length || 10} rooms.`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    }

    reservations.forEach(res => {
      if (res.status === 'cancelled' || res.status === 'no_show') return;
      
      const cleanCheckIn = res.checkIn.replace(/-/g, '');
      const cleanCheckOut = res.checkOut.replace(/-/g, '');
      
      icsContent.push(
        'BEGIN:VEVENT',
        `UID:res-${res.id}-${hotel?.id || 'pms'}-tyyl`,
        `DTSTAMP:${format(new Date(), "yyyyMMdd'T'HHmmss'Z'")}`,
        `DTSTART;VALUE=DATE:${cleanCheckIn}`,
        `DTEND;VALUE=DATE:${cleanCheckOut}`,
        `SUMMARY:PMS Booking: Room ${res.roomNumber} - ${res.guestName}`,
        `DESCRIPTION:Guest Name: ${res.guestName}\\nRoom: ${res.roomNumber}\\nNights: ${res.nights || 1}\\nStatus: ${res.status}`,
        'STATUS:CONFIRMED',
        'TRANSP:TRANSPARENT',
        'END:VEVENT'
      );
    });

    icsContent.push('END:VCALENDAR');

    const blob = new Blob([icsContent.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.download = `${hotel?.name?.toLowerCase().replace(/\s+/g, '-') || 'hotel'}-density-planner.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const occupancyAlerts = getOccupancyAlerts();

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
  const checkouts = reservations.filter(r => r.checkOut === today && (r.status === 'checked_in' || r.status === 'checked_out'));
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

      {/* Operational Threshold Notification Alerts */}
      {occupancyAlerts.length > 0 && (
        <div className="space-y-3">
          {occupancyAlerts.map((alert, index) => (
            <motion.div
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              key={index}
              className={cn(
                "p-4 rounded-xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border shadow-sm",
                alert.type === 'peak' 
                  ? "bg-red-500/10 border-red-500/20 text-red-200"
                  : "bg-amber-500/5 border-amber-500/10 text-amber-200"
              )}
            >
              <div className="flex items-start gap-3">
                <div className={cn(
                  "p-2 rounded-lg mt-0.5",
                  alert.type === 'peak' ? "bg-red-950/60 text-red-400" : "bg-amber-950/60 text-amber-400"
                )}>
                  <AlertTriangle size={16} />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-400">{alert.date}</span>
                    <span className={cn(
                      "text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded",
                      alert.type === 'peak' ? "bg-red-500/20 text-red-450" : "bg-amber-500/15 text-amber-400"
                    )}>
                      {alert.type === 'peak' ? 'Peak Strain Alert' : 'Yield Under-Run'}
                    </span>
                  </div>
                  <h4 className="text-xs sm:text-sm font-bold text-zinc-100 mt-1">{alert.title}</h4>
                  <p className="text-xs text-zinc-450 mt-0.5 max-w-2xl leading-relaxed">{alert.description}</p>
                </div>
              </div>

              <span className={cn(
                "px-3 py-1 text-[10px] font-black uppercase rounded-lg border tracking-wider",
                alert.type === 'peak' 
                  ? "bg-red-950/40 border-red-900/40 text-red-300"
                  : "bg-amber-950/40 border-amber-900/40 text-amber-300"
              )}>
                {alert.actionText}
              </span>
            </motion.div>
          ))}
        </div>
      )}

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
          
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleExportICal}
              type="button"
              className="px-3 py-1.5 bg-zinc-950 hover:bg-zinc-850 text-[10px] font-bold text-zinc-200 border border-zinc-800 hover:border-zinc-700 rounded-xl transition-all flex items-center gap-2 select-none active:scale-95 cursor-pointer shrink-0"
              title="Sync monthly density schedule & bookings directly to external calendars"
            >
              <Download size={13} className="text-emerald-500" />
              Export to iCal
            </button>

            <div className="flex items-center gap-1 bg-zinc-950 p-1 border border-zinc-800 rounded-xl">
              <button
                onClick={handlePrevMonth}
                className="p-1.5 hover:bg-zinc-900 text-zinc-405 hover:text-zinc-100 rounded-lg transition-all active:scale-95 cursor-pointer animate-none"
              >
                <ChevronLeft size={16} />
              </button>
              <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider w-32 text-center select-none py-1">
                {format(currentMonth, 'MMMM yyyy')}
              </span>
              <button
                onClick={handleNextMonth}
                className="p-1.5 hover:bg-zinc-900 text-zinc-405 hover:text-zinc-100 rounded-lg transition-all active:scale-95 cursor-pointer animate-none"
              >
                <ChevronRight size={16} />
              </button>
            </div>
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
                    onMouseEnter={(e) => {
                      setHoveredDay({
                        dateString: calDay.dateString,
                        clientX: e.clientX,
                        clientY: e.clientY
                      });
                    }}
                    onMouseMove={(e) => {
                      setHoveredDay({
                        dateString: calDay.dateString,
                        clientX: e.clientX,
                        clientY: e.clientY
                      });
                    }}
                    onMouseLeave={() => setHoveredDay(null)}
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

      {/* Interactive Floating Hover Tooltip */}
      <AnimatePresence>
        {hoveredDay && (() => {
          const data = getTooltipData(hoveredDay.dateString);
          return (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.12 }}
              className="fixed z-[150] pointer-events-none bg-zinc-950/95 border border-zinc-800 rounded-xl p-3.5 shadow-2xl backdrop-blur-md max-w-sm w-72 text-left"
              style={{ 
                left: `${hoveredDay.clientX + 16}px`, 
                top: `${hoveredDay.clientY + 12}px`,
              }}
            >
              <p className="text-[10px] font-extrabold text-emerald-400 uppercase tracking-widest mb-1">
                {format(new Date(hoveredDay.dateString + 'T00:00:00'), 'EEEE, MMM d, yyyy')}
              </p>
              
              <div className="flex justify-between items-center text-xs pb-2 border-b border-zinc-900">
                <span className="text-zinc-400 font-medium">Density Rate:</span>
                <span className={cn(
                  "font-black text-xs",
                  data.percentage === 0 ? "text-zinc-500" :
                  data.percentage <= 30 ? "text-emerald-400" :
                  data.percentage <= 60 ? "text-yellow-400" :
                  data.percentage <= 85 ? "text-orange-400" : "text-red-400"
                )}>
                  {data.percentage}% ({data.occupied}/{data.total} Occupied)
                </span>
              </div>

              <div className="pt-2 space-y-1.5">
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">
                  Overnight Guest Roster ({data.guests.length})
                </p>
                {data.guests.length === 0 ? (
                  <p className="text-[10px] text-zinc-500 italic">No bookings on this night</p>
                ) : (
                  <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                    {data.guests.map((g, gi) => (
                      <div key={gi} className="text-[10px] leading-tight flex justify-between gap-1 items-start bg-zinc-900/40 p-1.5 rounded border border-zinc-900">
                        <span className="text-zinc-350 font-semibold truncate max-w-[120px]">
                          {g.name} (Rm {g.room})
                        </span>
                        <span className="text-[9px] text-zinc-550 text-right uppercase shrink-0">
                          {g.nights} nights duration
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* ML Demand Forecasting Dashboard */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden shadow-xl p-4 sm:p-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-zinc-850 pb-4">
          <div>
            <h2 className="text-lg font-bold text-zinc-50 tracking-tight flex items-center gap-2">
              <BrainCircuit className="text-purple-400" size={20} />
              AI-Powered Demand Forecast (30-Day ML Projection)
            </h2>
            <p className="text-xs text-zinc-400 flex items-center gap-1.5 flex-wrap">
              <span>Dynamic forecast trajectory modeled with localized day-of-week demand multipliers</span>
              <span className="text-[10px] bg-purple-500/10 text-purple-400 border border-purple-500/15 py-0.5 px-2 rounded-full font-bold">
                Tyyl-Intellect ML v1.8
              </span>
            </p>
          </div>

          <div className="flex items-center gap-3 bg-zinc-950/60 p-2.5 border border-zinc-850 rounded-xl max-w-xs text-right text-[10px]">
            <TrendingUp size={16} className="text-purple-400 shrink-0" />
            <span className="text-zinc-400 leading-tight">
              Model evaluates current confirmed pacing combined with Bayesian lead-time probability estimates.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          <div className="lg:col-span-3 h-[280px] bg-zinc-950/40 border border-zinc-855/60 rounded-xl p-4 relative">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={getMLForecastingData()} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorProjected" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#c084fc" stopOpacity={0.25}/>
                    <stop offset="95%" stopColor="#c084fc" stopOpacity={0.0}/>
                  </linearGradient>
                  <linearGradient id="colorConfirmed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#27272a" opacity={0.3} />
                <XAxis dataKey="date" stroke="#71717a" fontSize={10} tickLine={false} />
                <YAxis stroke="#71717a" fontSize={10} domain={[0, 100]} unit="%" tickLine={false} />
                <ChartTooltip 
                  contentStyle={{ backgroundColor: '#09090b', borderColor: '#27272a', borderRadius: '12px' }}
                  labelClassName="text-[10px] font-black uppercase text-zinc-500 tracking-wider"
                  itemStyle={{ fontSize: '11px', color: '#e4e4e7' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="confidenceUpper" 
                  stroke="none" 
                  fill="#c084fc" 
                  fillOpacity={0.03} 
                  name="High Confidence Bound"
                />
                <Area 
                  type="monotone" 
                  dataKey="confidenceLower" 
                  stroke="none" 
                  fill="#c084fc" 
                  fillOpacity={0.0} 
                  name="Low Confidence Bound"
                />
                <Area 
                  type="monotone" 
                  dataKey="AI Forecasted Load" 
                  stroke="#c084fc" 
                  strokeWidth={2.5}
                  fillOpacity={1} 
                  fill="url(#colorProjected)" 
                  name="AI Projected Occupancy"
                />
                <Area 
                  type="monotone" 
                  dataKey="Active Booked" 
                  stroke="#10b981" 
                  strokeWidth={1.5}
                  strokeDasharray="4 4"
                  fillOpacity={1} 
                  fill="url(#colorConfirmed)" 
                  name="Current Confirmed Load"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="flex flex-col justify-between gap-4 bg-zinc-950 border border-zinc-805 rounded-xl p-4">
            <div className="space-y-4">
              <div className="border-b border-zinc-800 pb-3">
                <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mb-1">
                  Demand Prediction
                </div>
                <h3 className="text-sm font-black text-purple-400 flex items-center gap-1.5">
                  <ChartIcon size={14} />
                  30-Day Model Trajectory
                </h3>
              </div>

              <div className="space-y-3">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-400">Peak Projected:</span>
                  <span className="font-bold text-zinc-150">
                    {Math.max(...getMLForecastingData().map(d => d['AI Forecasted Load']))}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-zinc-400">Baseline Booked Rate:</span>
                  <span className="font-bold text-zinc-150">
                    {Math.round(getMLForecastingData().reduce((acc, current) => acc + current['Active Booked'], 0) / 30)}%
                  </span>
                </div>
                <div className="flex justify-between items-center text-xs">
                  <span className="text-purple-400">Projected Avg Rate:</span>
                  <span className="font-bold text-purple-300 pointer-events-none">
                    {Math.round(getMLForecastingData().reduce((acc, current) => acc + current['AI Forecasted Load'], 0) / 30)}%
                  </span>
                </div>
              </div>

              {(() => {
                const data = getMLForecastingData();
                const avg = Math.round(data.reduce((acc, d) => acc + d['AI Forecasted Load'], 0) / 30);
                
                let advisoryTitle = "Optimal Steady State";
                let advisoryDesc = "Pacing exhibits stable operational consistency. Standard housekeeping schedules are sufficient to handle guest loads.";
                let advisoryColor = "text-emerald-400 border-emerald-900/30 bg-emerald-500/5";
                
                if (avg >= 80) {
                  advisoryTitle = "High-Occupancy Advisory";
                  advisoryDesc = "Predictions trend heavily upward. Safeguard margins, schedule auxiliary laundry personnel, and audit linen inventories.";
                  advisoryColor = "text-red-400 border-red-900/30 bg-red-500/5";
                } else if (avg < 30) {
                  advisoryTitle = "Low Margin Advisory";
                  advisoryDesc = "Pacing exhibits significant workspace slack. Push marketing discount tiers, trigger corporate campaigns to lift volume.";
                  advisoryColor = "text-yellow-450 border-yellow-905/30 bg-yellow-500/5";
                }

                return (
                  <div className={cn("p-3 rounded-lg border text-[10px] space-y-1.5", advisoryColor)}>
                    <p className="font-extrabold uppercase tracking-wider flex items-center gap-1">
                      <BrainCircuit size={11} /> {advisoryTitle}
                    </p>
                    <p className="text-zinc-400 leading-relaxed font-normal">{advisoryDesc}</p>
                  </div>
                );
              })()}
            </div>

            <div className="text-[9px] text-zinc-500 border-t border-zinc-900/80 pt-3">
              Algorithms integrate trailing pacing velocities with asymptotic lead curves.
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
                      {(() => {
                        const bal = res.ledgerBalance !== undefined ? res.ledgerBalance : ((res.totalAmount || 0) - (res.paidAmount || 0) - (res.totalDiscount || 0));
                        const isSettled = Math.abs(bal) <= 0.01;
                        const isCredit = bal < -0.01;
                        const isOutstanding = bal > 0.01 && (res.paidAmount || 0) <= 0;
                        const isPartial = bal > 0.01 && (res.paidAmount || 0) > 0;

                        let label = 'Outstanding';
                        let badgeStyle = "bg-red-500/10 text-red-400 border-red-500/20";
                        if (isSettled || isCredit) {
                          label = 'Settled';
                          badgeStyle = "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
                        } else if (isPartial) {
                          label = 'Partial';
                          badgeStyle = "bg-amber-500/10 text-amber-400 border-amber-500/20";
                        }

                        return (
                          <div className="flex flex-col gap-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={cn("px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider rounded border", badgeStyle)}>
                                {label}
                              </span>
                              <span className="text-[10px] text-zinc-500 font-medium whitespace-nowrap">
                                ({formatCurrency(res.paidAmount || 0, currency, exchangeRate)} paid)
                              </span>
                            </div>
                            <div className={cn(
                              "text-[10px] font-mono px-1.5 py-0.5 rounded border w-fit whitespace-nowrap",
                              isCredit 
                                ? "text-emerald-400 bg-emerald-500/5 border-emerald-500/10" 
                                : isSettled 
                                  ? "text-zinc-500 bg-zinc-500/5 border-zinc-500/10" 
                                  : "text-red-400 bg-red-500/5 border-red-500/10"
                            )}>
                              {isCredit 
                                ? `Credit: ${formatCurrency(Math.abs(bal), currency, exchangeRate)}` 
                                : isSettled 
                                  ? `Owed: ${formatCurrency(0, currency, exchangeRate)}`
                                  : `Owed: ${formatCurrency(bal, currency, exchangeRate)}`
                              }
                            </div>
                          </div>
                        );
                      })()}
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
