import React, { useMemo, useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { BedDouble, Calendar, ChevronRight, Table2, BarChart3 } from 'lucide-react';
import { cn } from '../utils';
import { DateFilterValue } from './DateFilterControl';
import {
  OccupancyGranularity,
  OccupancyPeriodSummary,
  resolveOccupancyDateBounds,
} from '../utils/occupancyAnalytics';
import { Reservation } from '../types';

interface DashboardOccupancyPanelProps {
  summary: OccupancyPeriodSummary;
  filter: DateFilterValue;
  onFilterChange: (next: DateFilterValue) => void;
  reservations: Reservation[];
  isLight: boolean;
}

export const DashboardOccupancyPanel: React.FC<DashboardOccupancyPanelProps> = ({
  summary,
  filter,
  onFilterChange,
  reservations,
  isLight,
}) => {
  const { defaultGranularity } = useMemo(
    () => resolveOccupancyDateBounds(filter, reservations),
    [filter, reservations]
  );

  const [granularity, setGranularity] = useState<OccupancyGranularity>(defaultGranularity);
  const [showTable, setShowTable] = useState<boolean>(true);

  // Sync granularity smoothly whenever the user switches date filter mode
  useEffect(() => {
    setGranularity(defaultGranularity);
  }, [defaultGranularity, filter.mode]);

  const chartData = useMemo(() => {
    if (granularity === 'yearly') {
      return summary.yearlyRows.map((row) => ({
        key: row.key,
        name: row.label,
        fullLabel: row.fullLabel,
        rate: row.occupancyRate,
        projectedRate: row.projectedRate,
        occupied: row.occupiedRoomNights,
        reserved: row.reservedRoomNights,
        available: row.availableRoomNights,
        avgOccupied: row.avgOccupiedRooms,
        daysCount: row.daysCount,
        year: row.year,
        isSelected: false,
      }));
    }
    if (granularity === 'monthly') {
      return summary.monthlyRows.map((row) => ({
        key: row.key,
        name: row.label,
        fullLabel: row.fullLabel,
        rate: row.occupancyRate,
        projectedRate: row.projectedRate,
        occupied: row.occupiedRoomNights,
        reserved: row.reservedRoomNights,
        available: row.availableRoomNights,
        avgOccupied: row.avgOccupiedRooms,
        daysCount: row.daysCount,
        year: row.year,
        month: row.month,
        isSelected: false,
      }));
    }
    // Daily points (cap chart display cleanly if user clicks Daily on multi-year range)
    const points =
      summary.dailyPoints.length > 90
        ? summary.dailyPoints.slice(-90)
        : summary.dailyPoints;
    return points.map((p) => ({
      key: p.dateKey,
      name: p.label,
      fullLabel: p.fullLabel,
      rate: p.occupancyRate,
      projectedRate: p.projectedRate,
      occupied: p.occupiedRooms,
      reserved: p.reservedRooms,
      available: p.totalRooms,
      avgOccupied: p.occupiedRooms,
      daysCount: 1,
      dateKey: p.dateKey,
      isSelected: filter.mode === 'day' && p.dateKey === filter.day,
    }));
  }, [granularity, summary, filter.mode, filter.day]);

  const handleDrillToYear = (year?: number) => {
    if (!year) return;
    onFilterChange({
      ...filter,
      mode: 'year',
      year,
    });
  };

  const handleDrillToMonth = (year?: number, month?: number) => {
    if (year === undefined || month === undefined) return;
    onFilterChange({
      ...filter,
      mode: 'month',
      year,
      month,
    });
  };

  const handleDrillToDay = (dateKey?: string) => {
    if (!dateKey) return;
    const [y, m] = dateKey.split('-').map(Number);
    onFilterChange({
      ...filter,
      mode: 'day',
      day: dateKey,
      month: (m || 1) - 1,
      year: y || filter.year,
    });
  };

  const isSingleDay = filter.mode === 'day';
  const dailyTablePoints = useMemo(() => {
    // Show most recent 120 days in table if huge range, keeping UI snappy
    if (summary.dailyPoints.length > 120) {
      return summary.dailyPoints.slice(-120).reverse();
    }
    return [...summary.dailyPoints].reverse();
  }, [summary.dailyPoints]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 p-4 sm:p-6 rounded-2xl space-y-5">
      {/* Header + Granularity Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <BedDouble size={16} className="text-blue-500" />
            <h3 className="font-bold text-zinc-50 text-sm sm:text-base">Occupancy Overview</h3>
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            {summary.periodLabel} • {summary.daysCount} {summary.daysCount === 1 ? 'day' : 'days'} ({summary.totalRooms} total rooms)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Granularity Toggle: Daily / Monthly / Yearly */}
          <div className="flex items-center gap-0.5 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
            {(['daily', 'monthly', 'yearly'] as OccupancyGranularity[]).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={cn(
                  'px-2.5 py-1 rounded-lg text-[11px] font-semibold capitalize transition-all cursor-pointer',
                  granularity === g
                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                    : 'text-zinc-500 hover:text-zinc-300'
                )}
              >
                {g}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setShowTable((prev) => !prev)}
            className={cn(
              'px-2.5 py-1.5 rounded-xl border text-[11px] font-semibold flex items-center gap-1.5 transition-colors cursor-pointer',
              showTable
                ? 'bg-zinc-800 border-zinc-700 text-zinc-100'
                : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:text-zinc-200'
            )}
            title={showTable ? 'Hide breakdown table' : 'Show breakdown table'}
          >
            {showTable ? <BarChart3 size={13} /> : <Table2 size={13} />}
            <span>{showTable ? 'Table On' : 'Table'}</span>
          </button>
        </div>
      </div>

      {/* Period KPI Mini-Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {isSingleDay ? 'Day Occupancy' : 'Avg Occupancy'}
          </div>
          <div className="text-lg font-bold text-blue-400 mt-0.5">{summary.exactOccupancyRate}%</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">
            {summary.reservedRoomNights > 0
              ? `${summary.projectedRate}% incl. reserved`
              : 'Actual stayed rooms'}
          </div>
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {isSingleDay ? 'Rooms Occupied' : 'Occupied Room-Nights'}
          </div>
          <div className="text-lg font-bold text-zinc-100 mt-0.5">
            {summary.occupiedRoomNights.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">
            of {summary.availableRoomNights.toLocaleString()} available
          </div>
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            {isSingleDay ? 'Reserved (Upcoming)' : 'Avg Rooms / Day'}
          </div>
          <div className="text-lg font-bold text-emerald-400 mt-0.5">
            {isSingleDay ? summary.reservedRoomNights : summary.avgOccupiedRooms}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">
            {isSingleDay
              ? `Confirmed bookings`
              : `out of ${summary.totalRooms} rooms`}
          </div>
        </div>

        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-3">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Peak Occupancy
          </div>
          <div className="text-lg font-bold text-amber-400 mt-0.5">{summary.peakRate}%</div>
          <div className="text-[10px] text-zinc-500 mt-0.5 truncate">{summary.peakLabel}</div>
        </div>
      </div>

      {/* Occupancy Bar Chart */}
      <div>
        {granularity === 'daily' && summary.dailyPoints.length > 90 && (
          <p className="text-[10px] text-zinc-500 mb-2">
            Showing the latest 90 days in daily chart. Switch to Monthly or Yearly for the full span.
          </p>
        )}
        {isSingleDay && (
          <p className="text-[10px] text-zinc-500 mb-2">
            7-day context around selected date (highlighted in green). Click any bar to inspect that day.
          </p>
        )}
        <div className="h-[200px] sm:h-[230px] w-full min-w-0 relative" style={{ minHeight: 200, width: '100%' }}>
          <ResponsiveContainer width="100%" height="100%" minWidth={100} minHeight={200} debounce={50} initialDimension={{ width: 500, height: 200 }}>
            <BarChart data={chartData} margin={{ top: 6, right: 6, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={isLight ? '#dce2eb' : '#27272a'} vertical={false} />
              <XAxis
                dataKey="name"
                stroke={isLight ? '#64748b' : '#71717a'}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                stroke={isLight ? '#64748b' : '#71717a'}
                fontSize={10}
                tickLine={false}
                axisLine={false}
                domain={[0, 100]}
                tickFormatter={(v) => `${v}%`}
              />
              <Tooltip
                cursor={{ fill: isLight ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.04)' }}
                content={({ active, payload }) => {
                  if (!active || !payload || !payload.length) return null;
                  const item = payload[0].payload;
                  return (
                    <div
                      className={cn(
                        'rounded-lg border px-3 py-2 text-[11px] shadow-lg space-y-1',
                        isLight
                          ? 'bg-white border-slate-200 text-slate-800'
                          : 'bg-zinc-900 border-zinc-700 text-zinc-100'
                      )}
                    >
                      <div className="font-bold">{item.fullLabel}</div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-400">Occupancy:</span>
                        <span className="font-bold text-blue-400">{item.rate}%</span>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <span className="text-zinc-400">
                          {granularity === 'daily' ? 'Occupied Rooms:' : 'Occupied Room-Nights:'}
                        </span>
                        <span className="font-semibold">
                          {item.occupied} / {item.available}
                        </span>
                      </div>
                      {item.reserved > 0 && (
                        <div className="flex items-center justify-between gap-4">
                          <span className="text-zinc-400">Reserved:</span>
                          <span className="font-semibold text-amber-400">
                            {item.reserved} ({item.projectedRate}% total)
                          </span>
                        </div>
                      )}
                    </div>
                  );
                }}
              />
              <Bar
                dataKey="rate"
                radius={[4, 4, 0, 0]}
                maxBarSize={36}
                onClick={(entry: any) => {
                  if (!entry) return;
                  if (granularity === 'yearly') handleDrillToYear(entry.year);
                  else if (granularity === 'monthly') handleDrillToMonth(entry.year, entry.month);
                  else if (granularity === 'daily') handleDrillToDay(entry.dateKey);
                }}
                className="cursor-pointer"
              >
                {chartData.map((entry) => (
                  <Cell
                    key={entry.key}
                    fill={
                      entry.isSelected
                        ? '#10b981'
                        : isLight
                          ? '#2563eb'
                          : '#3b82f6'
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Selected Day Occupied / Reserved Rooms Detail */}
      {isSingleDay && summary.selectedDayPoint && (
        <div className="border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center gap-1.5 text-xs font-bold text-zinc-200">
              <Calendar size={13} className="text-emerald-400" />
              <span>Rooms on {summary.selectedDayPoint.fullLabel}</span>
            </div>
            <span className="text-[11px] text-zinc-400">
              {summary.selectedDayPoint.occupiedRooms} occupied • {summary.selectedDayPoint.reservedRooms} reserved
            </span>
          </div>
          {summary.selectedDayPoint.stays.length === 0 ? (
            <div className="text-xs text-zinc-500 bg-zinc-950/60 border border-zinc-800/70 rounded-xl p-3.5 text-center">
              No occupied or confirmed rooms recorded for {summary.selectedDayPoint.fullLabel}.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
              {summary.selectedDayPoint.stays.map((stay) => (
                <div
                  key={stay.reservationId}
                  className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl px-3 py-2 flex items-center justify-between gap-2 text-xs"
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-zinc-100 truncate">
                      Room {stay.roomNumber} • {stay.guestName}
                    </div>
                    <div className="text-[10px] text-zinc-500">
                      {stay.checkIn} → {stay.checkOut}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider shrink-0',
                      stay.status === 'checked_in'
                        ? 'bg-emerald-500/15 text-emerald-400'
                        : stay.status === 'checked_out'
                          ? 'bg-blue-500/15 text-blue-400'
                          : 'bg-amber-500/15 text-amber-400'
                    )}
                  >
                    {stay.status.replace('_', ' ')}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Breakdown Table (Daily / Monthly / Yearly) */}
      {showTable && (
        <div className="border-t border-zinc-800 pt-4">
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
              {granularity === 'daily'
                ? 'Daily Occupancy Breakdown'
                : granularity === 'monthly'
                  ? 'Monthly Occupancy Breakdown'
                  : 'Yearly Occupancy Breakdown'}
            </h4>
            <span className="text-[10px] text-zinc-500">
              {granularity === 'yearly'
                ? 'Click a year to view months'
                : granularity === 'monthly'
                  ? 'Click a month to view days'
                  : 'Click a date to inspect day'}
            </span>
          </div>

          <div className="max-h-64 overflow-y-auto rounded-xl border border-zinc-800/80 bg-zinc-950/50">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="sticky top-0 bg-zinc-900/95 border-b border-zinc-800 text-[10px] uppercase tracking-wider text-zinc-400">
                {granularity === 'daily' ? (
                  <tr>
                    <th className="py-2 px-3 font-bold">Date</th>
                    <th className="py-2 px-3 font-bold text-right">Occupied</th>
                    <th className="py-2 px-3 font-bold text-right">Reserved</th>
                    <th className="py-2 px-3 font-bold text-right">Rooms</th>
                    <th className="py-2 px-3 font-bold text-right">Occupancy %</th>
                  </tr>
                ) : (
                  <tr>
                    <th className="py-2 px-3 font-bold">
                      {granularity === 'monthly' ? 'Month' : 'Year'}
                    </th>
                    <th className="py-2 px-3 font-bold text-right">Occupied Nights</th>
                    <th className="py-2 px-3 font-bold text-right">Available</th>
                    <th className="py-2 px-3 font-bold text-right">Avg / Day</th>
                    <th className="py-2 px-3 font-bold text-right">Occupancy %</th>
                  </tr>
                )}
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {granularity === 'daily' &&
                  dailyTablePoints.map((p) => {
                    const isSelectedRow = filter.mode === 'day' && p.dateKey === filter.day;
                    return (
                      <tr
                        key={p.dateKey}
                        onClick={() => handleDrillToDay(p.dateKey)}
                        className={cn(
                          'hover:bg-zinc-800/40 transition-colors cursor-pointer',
                          isSelectedRow && 'bg-emerald-500/10'
                        )}
                      >
                        <td className="py-2 px-3 font-medium text-zinc-200 flex items-center gap-1.5">
                          <span>{p.fullLabel}</span>
                          {isSelectedRow && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400">
                              Selected
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold text-zinc-100">
                          {p.occupiedRooms}
                        </td>
                        <td className="py-2 px-3 text-right text-amber-400/90">
                          {p.reservedRooms}
                        </td>
                        <td className="py-2 px-3 text-right text-zinc-400">{p.totalRooms}</td>
                        <td className="py-2 px-3 text-right">
                          <div className="inline-flex items-center gap-2 justify-end">
                            <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden hidden sm:block">
                              <div
                                className={cn(
                                  'h-full rounded-full',
                                  isSelectedRow ? 'bg-emerald-500' : 'bg-blue-500'
                                )}
                                style={{ width: `${Math.min(100, p.occupancyRate)}%` }}
                              />
                            </div>
                            <span className="font-bold text-zinc-100 w-10 text-right">
                              {p.occupancyRate}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}

                {granularity === 'monthly' &&
                  summary.monthlyRows.map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => handleDrillToMonth(row.year, row.month)}
                      className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-3 font-medium text-zinc-200">
                        <span className="inline-flex items-center gap-1">
                          {row.fullLabel}
                          <ChevronRight size={12} className="text-zinc-500" />
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-zinc-100">
                        {row.occupiedRoomNights.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-zinc-400">
                        {row.availableRoomNights.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-zinc-300">
                        {row.avgOccupiedRooms}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.min(100, row.occupancyRate)}%` }}
                            />
                          </div>
                          <span className="font-bold text-zinc-100 w-10 text-right">
                            {row.occupancyRate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}

                {granularity === 'yearly' &&
                  summary.yearlyRows.map((row) => (
                    <tr
                      key={row.key}
                      onClick={() => handleDrillToYear(row.year)}
                      className="hover:bg-zinc-800/40 transition-colors cursor-pointer"
                    >
                      <td className="py-2 px-3 font-medium text-zinc-200">
                        <span className="inline-flex items-center gap-1">
                          {row.fullLabel}
                          <ChevronRight size={12} className="text-zinc-500" />
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-semibold text-zinc-100">
                        {row.occupiedRoomNights.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-zinc-400">
                        {row.availableRoomNights.toLocaleString()}
                      </td>
                      <td className="py-2 px-3 text-right text-zinc-300">
                        {row.avgOccupiedRooms}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <div className="inline-flex items-center gap-2 justify-end">
                          <div className="w-14 h-1.5 bg-zinc-800 rounded-full overflow-hidden hidden sm:block">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${Math.min(100, row.occupancyRate)}%` }}
                            />
                          </div>
                          <span className="font-bold text-zinc-100 w-10 text-right">
                            {row.occupancyRate}%
                          </span>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
