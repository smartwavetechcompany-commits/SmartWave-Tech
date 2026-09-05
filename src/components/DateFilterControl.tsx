import React from 'react';
import { Calendar, X, Clock, CalendarDays, CalendarRange } from 'lucide-react';
import { 
  format, 
  startOfDay, 
  endOfDay, 
  isWithinInterval, 
  subDays 
} from 'date-fns';
import { cn } from '../utils';

export type DateFilterMode = 'all' | 'day' | 'month' | 'year' | 'range';

export interface DateFilterValue {
  mode: DateFilterMode;
  day: string; // 'YYYY-MM-DD'
  month: number; // 0 to 11
  year: number; // e.g. 2026
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
}

export const getDefaultDateFilter = (): DateFilterValue => {
  const now = new Date();
  const todayStr = format(now, 'yyyy-MM-dd');
  return {
    mode: 'all',
    day: todayStr,
    month: now.getMonth(),
    year: now.getFullYear(),
    startDate: format(subDays(now, 30), 'yyyy-MM-dd'),
    endDate: todayStr,
  };
};

export function parseToDate(val: any): Date | null {
  if (!val) return null;
  if (val instanceof Date) return isNaN(val.getTime()) ? null : val;
  if (typeof val.toDate === 'function') {
    try {
      const d = val.toDate();
      return isNaN(d.getTime()) ? null : d;
    } catch {
      return null;
    }
  }
  if (typeof val === 'object' && val.seconds !== undefined) {
    const d = new Date(Number(val.seconds) * 1000 + (Number(val.nanoseconds || 0) / 1000000));
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function matchesDateFilter(dateVal: any, filter: DateFilterValue): boolean {
  if (!filter || filter.mode === 'all') return true;
  const d = parseToDate(dateVal);
  if (!d) return false;

  switch (filter.mode) {
    case 'day': {
      if (!filter.day) return true;
      return format(d, 'yyyy-MM-dd') === filter.day;
    }
    case 'month': {
      return d.getFullYear() === filter.year && d.getMonth() === filter.month;
    }
    case 'year': {
      return d.getFullYear() === filter.year;
    }
    case 'range': {
      if (!filter.startDate || !filter.endDate) return true;
      try {
        const start = startOfDay(new Date(filter.startDate));
        const end = endOfDay(new Date(filter.endDate));
        return isWithinInterval(d, { start, end });
      } catch {
        return true;
      }
    }
    default:
      return true;
  }
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

interface DateFilterControlProps {
  value: DateFilterValue;
  onChange: (val: DateFilterValue) => void;
  className?: string;
  compact?: boolean;
}

export const DateFilterControl: React.FC<DateFilterControlProps> = ({
  value,
  onChange,
  className,
  compact = false,
}) => {
  const currentYear = new Date().getFullYear();
  // Available years: currentYear - 4 to currentYear + 1
  const years = Array.from({ length: 6 }, (_, i) => currentYear - 4 + i).reverse();

  const handleModeChange = (mode: DateFilterMode) => {
    onChange({ ...value, mode });
  };

  const setToday = () => {
    const now = new Date();
    onChange({
      ...value,
      mode: 'day',
      day: format(now, 'yyyy-MM-dd'),
      month: now.getMonth(),
      year: now.getFullYear(),
    });
  };

  const setYesterday = () => {
    const yest = subDays(new Date(), 1);
    onChange({
      ...value,
      mode: 'day',
      day: format(yest, 'yyyy-MM-dd'),
      month: yest.getMonth(),
      year: yest.getFullYear(),
    });
  };

  const setThisMonth = () => {
    const now = new Date();
    onChange({
      ...value,
      mode: 'month',
      month: now.getMonth(),
      year: now.getFullYear(),
    });
  };

  const setThisYear = () => {
    const now = new Date();
    onChange({
      ...value,
      mode: 'year',
      year: now.getFullYear(),
    });
  };

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      {/* Mode Pills */}
      <div className="flex items-center gap-0.5 bg-zinc-950 p-1 rounded-xl border border-zinc-800 text-xs">
        <button
          type="button"
          onClick={() => handleModeChange('all')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all select-none",
            value.mode === 'all'
              ? "bg-zinc-800 text-zinc-100 shadow-sm"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          All Time
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('day')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all select-none flex items-center gap-1",
            value.mode === 'day'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Clock size={12} />
          Day
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('month')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all select-none flex items-center gap-1",
            value.mode === 'month'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <CalendarDays size={12} />
          Month
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('year')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all select-none flex items-center gap-1",
            value.mode === 'year'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Calendar size={12} />
          Year
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('range')}
          className={cn(
            "px-2.5 py-1 rounded-lg text-xs font-semibold transition-all select-none flex items-center gap-1",
            value.mode === 'range'
              ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
              : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <CalendarRange size={12} />
          Range
        </button>
      </div>

      {/* Sub-controls depending on mode */}
      {value.mode === 'day' && (
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1 text-xs">
          <input
            type="date"
            value={value.day}
            onChange={(e) => onChange({ ...value, day: e.target.value })}
            className="bg-transparent text-zinc-200 text-xs font-mono focus:outline-none cursor-pointer"
            style={{ colorScheme: 'dark' }}
          />
          <button
            type="button"
            onClick={setToday}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
          >
            Today
          </button>
          <button
            type="button"
            onClick={setYesterday}
            className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
          >
            Yesterday
          </button>
        </div>
      )}

      {value.mode === 'month' && (
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1 text-xs">
          <select
            value={value.month}
            onChange={(e) => onChange({ ...value, month: Number(e.target.value) })}
            className="bg-transparent text-zinc-200 text-xs focus:outline-none cursor-pointer pr-1"
          >
            {MONTH_NAMES.map((m, idx) => (
              <option key={m} value={idx} className="bg-zinc-900 text-zinc-200">
                {m}
              </option>
            ))}
          </select>
          <span className="text-zinc-600">/</span>
          <select
            value={value.year}
            onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
            className="bg-transparent text-zinc-200 text-xs font-mono focus:outline-none cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-zinc-900 text-zinc-200">
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={setThisMonth}
            className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
          >
            Current
          </button>
        </div>
      )}

      {value.mode === 'year' && (
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1 text-xs">
          <select
            value={value.year}
            onChange={(e) => onChange({ ...value, year: Number(e.target.value) })}
            className="bg-transparent text-zinc-200 text-xs font-mono focus:outline-none cursor-pointer"
          >
            {years.map((y) => (
              <option key={y} value={y} className="bg-zinc-900 text-zinc-200">
                {y}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={setThisYear}
            className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-bold bg-zinc-800 text-zinc-400 hover:text-emerald-400 transition-colors"
          >
            Current Year
          </button>
        </div>
      )}

      {value.mode === 'range' && (
        <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2 py-1 text-xs">
          <input
            type="date"
            value={value.startDate}
            onChange={(e) => onChange({ ...value, startDate: e.target.value })}
            className="bg-transparent text-zinc-200 text-[11px] font-mono focus:outline-none cursor-pointer w-[95px]"
            style={{ colorScheme: 'dark' }}
          />
          <span className="text-zinc-600 text-[10px]">to</span>
          <input
            type="date"
            value={value.endDate}
            onChange={(e) => onChange({ ...value, endDate: e.target.value })}
            className="bg-transparent text-zinc-200 text-[11px] font-mono focus:outline-none cursor-pointer w-[95px]"
            style={{ colorScheme: 'dark' }}
          />
        </div>
      )}

      {value.mode !== 'all' && (
        <button
          type="button"
          onClick={() => handleModeChange('all')}
          title="Reset date filter"
          className="p-1 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
};
