import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as d3 from 'd3';
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  eachDayOfInterval, 
  addMonths, 
  subMonths, 
  isSameMonth, 
  isToday, 
  differenceInDays,
  getDay,
  parseISO
} from 'date-fns';
import { FinanceRecord, Reservation, Hotel } from '../types';
import { calculateBilling } from '../utils/billingEngine';
import { formatCurrency, cn, exportToCSV } from '../utils';
import { toast } from 'sonner';
import { 
  Calendar as CalendarIcon, 
  TrendingUp, 
  Flame, 
  ChevronLeft, 
  ChevronRight, 
  Sparkles, 
  BedDouble, 
  BarChart3, 
  Layers,
  Info,
  Download
} from 'lucide-react';
import { motion } from 'motion/react';

interface RevenueHeatmapProps {
  records: FinanceRecord[];
  reservations: Reservation[];
  hotel: Hotel | null;
  currency: 'NGN' | 'USD';
  exchangeRate: number;
}

interface DayData {
  date: Date;
  dateStr: string;
  dayOfMonth: number;
  dayOfWeek: number; // 0 = Sun, 6 = Sat
  weekIndex: number; // 0 to 5
  revenue: number;
  bookingCount: number;
  isPeak: boolean;
  isToday: boolean;
}

export function RevenueHeatmap({
  records,
  reservations,
  hotel,
  currency,
  exchangeRate
}: RevenueHeatmapProps) {
  const [currentMonth, setCurrentMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [filterMode, setFilterMode] = useState<'all' | 'peaks' | 'weekends'>('all');
  const [hoveredDay, setHoveredDay] = useState<DayData | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Month navigation handlers
  const handlePrevMonth = () => setCurrentMonth(prev => subMonths(prev, 1));
  const handleNextMonth = () => setCurrentMonth(prev => addMonths(prev, 1));
  const handleCurrentMonth = () => setCurrentMonth(startOfMonth(new Date()));

  // Export raw daily revenue data for current heatmap month
  const handleDownloadCSV = () => {
    if (!monthDaysData || monthDaysData.length === 0) {
      toast.info('No data available to export for this month');
      return;
    }

    const filename = `daily_room_revenue_heatmap_${format(currentMonth, 'yyyy_MM')}.csv`;

    const dataToExport = monthDaysData.map(d => ({
      'Date': d.dateStr,
      'Day of Week': format(d.date, 'EEEE'),
      'Day Number': d.dayOfMonth,
      'Week Number': d.weekIndex + 1,
      'Room Revenue': d.revenue,
      'Formatted Revenue': formatCurrency(d.revenue, currency, exchangeRate),
      'Active Bookings': d.bookingCount,
      'Peak Period': d.isPeak ? 'YES' : 'NO',
      'Currency': currency
    }));

    exportToCSV(dataToExport, filename);
    toast.success(`Exported raw daily revenue data for ${format(currentMonth, 'MMMM yyyy')} (${monthDaysData.length} days)`);
  };

  // Aggregate daily room revenue for the selected month
  const monthDaysData = useMemo(() => {
    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

    // Determine week index for each day relative to first week
    const firstDayOfWeek = getDay(monthStart);

    const rawDays = daysInMonth.map((d, index) => {
      const dateStr = format(d, 'yyyy-MM-dd');
      const dayOfWeek = getDay(d);
      const dayOfMonth = d.getDate();

      // Week index relative to the month's start
      const weekIndex = Math.floor((index + firstDayOfWeek) / 7);

      // 1. Direct room revenue from finance income records
      const directIncome = records
        .filter(r => {
          if (r.type !== 'income') return false;
          const isRoomCategory = 
            r.category === 'Room Revenue' || 
            r.category?.toLowerCase() === 'room' || 
            (r.description && r.description.toLowerCase().includes('room'));
          if (!isRoomCategory) return false;

          const rDateStr = r.timestamp ? format(new Date(r.timestamp), 'yyyy-MM-dd') : '';
          return rDateStr === dateStr;
        })
        .reduce((sum, r) => sum + (Number(r.amount) || 0), 0);

      // 2. Room revenue and occupancy from active reservations covering this date
      const activeBookings = reservations.filter(res => {
        if (['cancelled', 'no_show'].includes(res.status)) return false;
        if (!res.checkIn || !res.checkOut) return false;

        const cinStr = format(new Date(res.checkIn), 'yyyy-MM-dd');
        const coutStr = format(new Date(res.checkOut), 'yyyy-MM-dd');
        return cinStr <= dateStr && dateStr < coutStr;
      });

      const bookingDailyRev = activeBookings.reduce((sum, res) => {
        const billing = calculateBilling(res, hotel);
        const nights = Math.max(1, billing.nightsCount || differenceInDays(new Date(res.checkOut), new Date(res.checkIn)) || 1);
        const dailyRate = billing.nightlyRate > 0 ? billing.nightlyRate : ((res.totalAmount || 0) / nights);
        return sum + dailyRate;
      }, 0);

      // Total daily room revenue (max of recorded income vs prorated bookings for comprehensive accuracy)
      const dailyRevenue = Math.max(directIncome, bookingDailyRev);

      return {
        date: d,
        dateStr,
        dayOfMonth,
        dayOfWeek,
        weekIndex,
        revenue: dailyRevenue,
        bookingCount: activeBookings.length,
        isPeak: false,
        isToday: isToday(d)
      };
    });

    // Determine peak thresholds: top 20% of revenue days or > 125% of average
    const nonZeroRevenues = rawDays.map(d => d.revenue).filter(r => r > 0);
    const avgRevenue = nonZeroRevenues.length > 0 
      ? nonZeroRevenues.reduce((a, b) => a + b, 0) / nonZeroRevenues.length 
      : 0;
    const maxRev = Math.max(0, ...rawDays.map(d => d.revenue));
    const peakCutoff = Math.max(avgRevenue * 1.25, maxRev * 0.7);

    return rawDays.map(d => ({
      ...d,
      isPeak: d.revenue > 0 && d.revenue >= peakCutoff
    }));
  }, [currentMonth, records, reservations, hotel]);

  // Overall Month Statistics
  const monthStats = useMemo(() => {
    const totalRev = monthDaysData.reduce((sum, d) => sum + d.revenue, 0);
    const daysWithRev = monthDaysData.filter(d => d.revenue > 0);
    const avgRev = daysWithRev.length > 0 ? totalRev / daysWithRev.length : 0;

    let peakDay: DayData | null = null;
    let maxRev = -1;
    monthDaysData.forEach(d => {
      if (d.revenue > maxRev) {
        maxRev = d.revenue;
        peakDay = d;
      }
    });

    const totalPeakDays = monthDaysData.filter(d => d.isPeak).length;
    const totalBookingsHandled = monthDaysData.reduce((sum, d) => sum + d.bookingCount, 0);

    return {
      totalRev,
      avgRev,
      peakDay,
      maxRev: Math.max(0, maxRev),
      totalPeakDays,
      totalBookingsHandled
    };
  }, [monthDaysData]);

  // D3 Rendering Engine
  useEffect(() => {
    if (!svgRef.current || monthDaysData.length === 0) return;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove(); // Clean previous render

    const containerWidth = containerRef.current?.clientWidth || 800;
    const margin = { top: 40, right: 30, bottom: 40, left: 45 };

    const totalWeeks = Math.max(5, d3.max(monthDaysData, d => d.weekIndex)! + 1);

    // Responsive sizing
    const availableWidth = Math.max(680, containerWidth - margin.left - margin.right);
    const cellWidth = Math.floor((availableWidth - 6 * 10) / 7);
    const cellHeight = Math.max(65, Math.floor(cellWidth * 0.78));
    const gap = 10;

    const width = 7 * (cellWidth + gap) + margin.left + margin.right;
    const height = totalWeeks * (cellHeight + gap) + margin.top + margin.bottom;

    svg
      .attr('viewBox', `0 0 ${width} ${height}`)
      .attr('width', '100%')
      .attr('height', 'auto')
      .style('max-height', `${height}px`);

    const g = svg
      .append('g')
      .attr('transform', `translate(${margin.left}, ${margin.top})`);

    // D3 Color Scales
    const maxRev = monthStats.maxRev || 1;
    const colorScale = d3.scaleLinear<string>()
      .domain([0, maxRev * 0.25, maxRev * 0.6, maxRev])
      .range(['#18181b', '#064e3b', '#059669', '#10b981'])
      .clamp(true);

    const dayLabels = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    // Day of week header labels
    const dayHeaders = g.append('g').attr('class', 'day-headers');
    dayLabels.forEach((label, i) => {
      dayHeaders
        .append('text')
        .attr('x', i * (cellWidth + gap) + cellWidth / 2)
        .attr('y', -16)
        .attr('text-anchor', 'middle')
        .attr('fill', i === 0 || i === 6 ? '#a1a1aa' : '#71717a')
        .attr('font-size', '11px')
        .attr('font-weight', '700')
        .attr('letter-spacing', '0.05em')
        .text(label.toUpperCase());
    });

    // Week row labels (W1, W2, etc.)
    const weekHeaders = g.append('g').attr('class', 'week-headers');
    for (let w = 0; w < totalWeeks; w++) {
      weekHeaders
        .append('text')
        .attr('x', -14)
        .attr('y', w * (cellHeight + gap) + cellHeight / 2 + 4)
        .attr('text-anchor', 'end')
        .attr('fill', '#52525b')
        .attr('font-size', '10px')
        .attr('font-weight', '600')
        .text(`W${w + 1}`);
    }

    // Render Heatmap Cells
    const cellsGroup = g.append('g').attr('class', 'heatmap-cells');

    monthDaysData.forEach((day) => {
      const x = day.dayOfWeek * (cellWidth + gap);
      const y = day.weekIndex * (cellHeight + gap);

      // Filtering visibility check
      let isDimmed = false;
      if (filterMode === 'peaks' && !day.isPeak) isDimmed = true;
      if (filterMode === 'weekends' && day.dayOfWeek !== 0 && day.dayOfWeek !== 6) isDimmed = true;

      const cellG = cellsGroup
        .append('g')
        .attr('class', `day-cell day-${day.dateStr}`)
        .attr('transform', `translate(${x}, ${y})`)
        .style('cursor', 'pointer')
        .style('opacity', isDimmed ? 0.25 : 1)
        .style('transition', 'all 0.2s ease');

      // Cell Background Rect
      const rect = cellG
        .append('rect')
        .attr('width', cellWidth)
        .attr('height', cellHeight)
        .attr('rx', 10)
        .attr('ry', 10)
        .attr('fill', day.revenue > 0 ? colorScale(day.revenue) : '#141416')
        .attr('stroke', day.isToday ? '#38bdf8' : (day.isPeak ? '#34d399' : '#27272a'))
        .attr('stroke-width', day.isToday ? 2 : (day.isPeak ? 1.5 : 1))
        .attr('stroke-dasharray', day.isToday ? 'none' : 'none');

      // Date number
      cellG
        .append('text')
        .attr('x', 10)
        .attr('y', 18)
        .attr('fill', day.isToday ? '#38bdf8' : (day.revenue > 0 ? '#f4f4f5' : '#71717a'))
        .attr('font-size', '12px')
        .attr('font-weight', day.isToday || day.isPeak ? '800' : '600')
        .text(day.dayOfMonth);

      // Peak Indicator Badge (Small flame dot on top right)
      if (day.isPeak) {
        const badgeG = cellG.append('g').attr('transform', `translate(${cellWidth - 18}, 8)`);
        badgeG
          .append('circle')
          .attr('r', 5)
          .attr('cx', 5)
          .attr('cy', 5)
          .attr('fill', '#f59e0b');
      }

      // Revenue Text in Cell
      if (day.revenue > 0) {
        const revShort = formatCurrency(day.revenue, currency, exchangeRate);
        cellG
          .append('text')
          .attr('x', cellWidth - 10)
          .attr('y', cellHeight - 12)
          .attr('text-anchor', 'end')
          .attr('fill', day.isPeak ? '#ffffff' : '#e4e4e7')
          .attr('font-size', '11px')
          .attr('font-weight', '700')
          .text(revShort);

        // Booking Count pill
        if (day.bookingCount > 0) {
          cellG
            .append('text')
            .attr('x', 10)
            .attr('y', cellHeight - 12)
            .attr('fill', day.isPeak ? '#fcd34d' : '#a1a1aa')
            .attr('font-size', '9px')
            .attr('font-weight', '600')
            .text(`${day.bookingCount} rms`);
        }
      } else {
        cellG
          .append('text')
          .attr('x', cellWidth / 2)
          .attr('y', cellHeight / 2 + 8)
          .attr('text-anchor', 'middle')
          .attr('fill', '#3f3f46')
          .attr('font-size', '10px')
          .attr('font-weight', '500')
          .text('—');
      }

      // Hover interactions
      cellG
        .on('mouseenter', (event) => {
          rect
            .transition()
            .duration(150)
            .attr('stroke', '#10b981')
            .attr('stroke-width', 2.5);

          setHoveredDay(day);
          const rectBox = (event.currentTarget as HTMLElement).getBoundingClientRect();
          const parentBox = containerRef.current?.getBoundingClientRect() || { left: 0, top: 0 };
          setTooltipPos({
            x: rectBox.left - parentBox.left + cellWidth / 2,
            y: rectBox.top - parentBox.top - 12
          });
        })
        .on('mouseleave', () => {
          rect
            .transition()
            .duration(150)
            .attr('stroke', day.isToday ? '#38bdf8' : (day.isPeak ? '#34d399' : '#27272a'))
            .attr('stroke-width', day.isToday ? 2 : (day.isPeak ? 1.5 : 1));

          setHoveredDay(null);
          setTooltipPos(null);
        });
    });

  }, [monthDaysData, monthStats, filterMode, currency, exchangeRate]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-3xl p-5 sm:p-7 space-y-6 shadow-xl relative overflow-hidden">
      {/* Header with Title and Month Controls */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-zinc-800/80">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
              <Flame size={20} className="animate-pulse" />
            </div>
            <div>
              <h3 className="text-lg font-bold text-zinc-50 flex items-center gap-2">
                Room Revenue Heatmap
                <span className="text-[10px] uppercase font-black tracking-widest px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  D3.js Visualization
                </span>
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Daily room revenue trends and peak booking intensity for {format(currentMonth, 'MMMM yyyy')}
              </p>
            </div>
          </div>
        </div>

        {/* Month Navigation & Preset Filters */}
        <div className="flex flex-wrap items-center gap-2">
          {/* Filter Mode Pills */}
          <div className="flex items-center bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
            <button
              type="button"
              onClick={() => setFilterMode('all')}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all",
                filterMode === 'all' ? "bg-zinc-800 text-zinc-100 shadow" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              All Days
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('peaks')}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all",
                filterMode === 'peaks' ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              <Flame size={12} /> Peaks Only
            </button>
            <button
              type="button"
              onClick={() => setFilterMode('weekends')}
              className={cn(
                "px-2.5 py-1 rounded-lg font-bold transition-all",
                filterMode === 'weekends' ? "bg-zinc-800 text-zinc-100 shadow" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              Weekends
            </button>
          </div>

          {/* Month Switcher */}
          <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-xl border border-zinc-800">
            <button
              type="button"
              onClick={handlePrevMonth}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="Previous Month"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={handleCurrentMonth}
              className="px-2.5 py-1 text-xs font-bold text-zinc-200 hover:text-emerald-400 transition-colors cursor-pointer"
              title="Jump to Current Month"
            >
              {format(currentMonth, 'MMM yyyy')}
            </button>
            <button
              type="button"
              onClick={handleNextMonth}
              className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-lg transition-colors cursor-pointer"
              title="Next Month"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          {/* Download CSV Button */}
          <button
            type="button"
            onClick={handleDownloadCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-950 hover:bg-zinc-850 border border-zinc-800 hover:border-emerald-500/50 rounded-xl text-xs font-bold text-zinc-200 hover:text-emerald-400 transition-all active:scale-95 shadow-sm cursor-pointer"
            title={`Download CSV of raw daily revenue data for ${format(currentMonth, 'MMMM yyyy')}`}
          >
            <Download size={14} className="text-emerald-400" />
            <span>Download CSV</span>
          </button>
        </div>
      </div>

      {/* Metric Cards Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-3.5">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <CalendarIcon size={12} className="text-emerald-400" /> Total Room Revenue
          </div>
          <div className="text-base sm:text-lg font-black text-emerald-400">
            {formatCurrency(monthStats.totalRev, currency, exchangeRate)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            Across {monthDaysData.length} days
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-3.5">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <TrendingUp size={12} className="text-blue-400" /> Daily Average
          </div>
          <div className="text-base sm:text-lg font-black text-blue-400">
            {formatCurrency(monthStats.avgRev, currency, exchangeRate)}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            On active revenue days
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-3.5">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Flame size={12} className="text-amber-400" /> Peak Day
          </div>
          <div className="text-base sm:text-lg font-black text-amber-400 truncate">
            {monthStats.peakDay && monthStats.peakDay.revenue > 0 ? (
              `${format(monthStats.peakDay.date, 'MMM d')}: ${formatCurrency(monthStats.peakDay.revenue, currency, exchangeRate)}`
            ) : (
              'None recorded'
            )}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {monthStats.peakDay && monthStats.peakDay.bookingCount > 0 
              ? `${monthStats.peakDay.bookingCount} active bookings` 
              : 'Highest single day'}
          </div>
        </div>

        <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-3.5">
          <div className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-1 flex items-center gap-1.5">
            <Sparkles size={12} className="text-purple-400" /> Peak Booking Periods
          </div>
          <div className="text-base sm:text-lg font-black text-purple-400">
            {monthStats.totalPeakDays} Day{monthStats.totalPeakDays === 1 ? '' : 's'}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            High-yield occupancy peaks
          </div>
        </div>
      </div>

      {/* D3 Heatmap SVG Canvas Container */}
      <div className="relative min-h-[300px] w-full overflow-x-auto pb-2" ref={containerRef}>
        <svg ref={svgRef} className="w-full select-none" />

        {/* Interactive Floating Tooltip */}
        {hoveredDay && tooltipPos && (
          <div
            style={{
              position: 'absolute',
              left: `${tooltipPos.x}px`,
              top: `${tooltipPos.y}px`,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none'
            }}
            className="z-50 bg-zinc-950 border border-zinc-700/80 rounded-xl px-3.5 py-2.5 shadow-2xl backdrop-blur-md text-left min-w-[190px] animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="flex items-center justify-between gap-2 border-b border-zinc-800 pb-1.5 mb-1.5">
              <span className="text-xs font-bold text-zinc-200">
                {format(hoveredDay.date, 'EEEE, MMM d, yyyy')}
              </span>
              {hoveredDay.isToday && (
                <span className="text-[9px] font-black uppercase px-1.5 py-0.2 rounded bg-sky-500/20 text-sky-400 border border-sky-500/30">
                  Today
                </span>
              )}
            </div>

            <div className="space-y-1 text-xs">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Room Revenue:</span>
                <span className="font-bold text-emerald-400">
                  {formatCurrency(hoveredDay.revenue, currency, exchangeRate)}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Active Bookings:</span>
                <span className="font-bold text-zinc-200">
                  {hoveredDay.bookingCount} room{hoveredDay.bookingCount === 1 ? '' : 's'}
                </span>
              </div>
              {hoveredDay.isPeak && (
                <div className="pt-1 mt-1 border-t border-zinc-800 flex items-center gap-1 text-[10px] font-bold text-amber-400">
                  <Flame size={12} className="animate-bounce" />
                  Peak Booking Period (High Volume)
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Heatmap Legend Bar & Guidance */}
      <div className="pt-4 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-zinc-400">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Revenue Intensity:
          </span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] text-zinc-500">₦0</span>
            <div className="flex items-center gap-1">
              <span className="w-3.5 h-3.5 rounded bg-[#141416] border border-zinc-800" title="Zero" />
              <span className="w-3.5 h-3.5 rounded bg-[#064e3b]" title="Low" />
              <span className="w-3.5 h-3.5 rounded bg-[#059669]" title="Moderate" />
              <span className="w-3.5 h-3.5 rounded bg-[#10b981]" title="High" />
            </div>
            <span className="text-[10px] text-emerald-400 font-bold">
              {formatCurrency(monthStats.maxRev, currency, exchangeRate)} (Peak)
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3 text-[11px] text-zinc-500">
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />
            <span>Peak Booking Period</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded border border-sky-400 inline-block" />
            <span>Current Date</span>
          </div>
        </div>
      </div>
    </div>
  );
}
