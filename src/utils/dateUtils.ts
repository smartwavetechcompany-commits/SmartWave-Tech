import React from 'react';
import { startOfDay, parseISO, differenceInDays, format } from 'date-fns';

export interface StayDuration {
  bookedDays: number;
  bookedNights: number;
  overstayNights: number;
  actualDays: number;
  actualNights: number;
  totalDays: number;
  totalNights: number;
}

/**
 * Universal safe parser for any Firestore timestamp, ISO string, number, or Date object.
 */
export function parseTimestampToDate(ts: any): Date {
  if (!ts) return new Date(0);
  if (ts instanceof Date) return ts;
  if (typeof ts.toDate === 'function') {
    try { return ts.toDate(); } catch { return new Date(0); }
  }
  if (typeof ts === 'object' && typeof ts.seconds === 'number') {
    return new Date(ts.seconds * 1000);
  }
  if (typeof ts === 'number') {
    return new Date(ts);
  }
  if (typeof ts === 'string') {
    if (ts.includes('T')) {
      try {
        const parsed = parseISO(ts);
        if (!isNaN(parsed.getTime())) return parsed;
      } catch {}
    }
    const d = new Date(ts);
    return isNaN(d.getTime()) ? new Date(0) : d;
  }
  return new Date(0);
}

/**
 * Safely format any timestamp without throwing RangeError on invalid or Firestore objects.
 */
export function safeFormatDate(ts: any, formatPattern: string = 'MMM d, HH:mm'): string {
  try {
    const d = parseTimestampToDate(ts);
    if (isNaN(d.getTime()) || d.getTime() === 0) return 'N/A';
    return format(d, formatPattern);
  } catch {
    return 'N/A';
  }
}

export interface StayDurationOptions {
  checkInTime?: string;
  checkOutTime?: string;
  gracePeriodMinutes?: number;
  currentTime?: Date;
  hotel?: any;
  res?: any;
}

/**
 * Calculates exact overstay nights using hotel-configured checkout time, grace period, and actual stay duration.
 * A chargeable night must only be added when the guest exceeds the configured checkout time plus grace period.
 */
export function getOverstayNightsFromSettings(
  checkOutDate: string | Date,
  checkOutTime: string = '12:00',
  gracePeriodMinutes: number = 0,
  now: Date = new Date()
): number {
  const parseDateStr = (d: string | Date): string => {
    if (!d) return format(new Date(), 'yyyy-MM-dd');
    if (d instanceof Date) return format(d, 'yyyy-MM-dd');
    if (typeof d === 'string') {
      if (d.includes('T')) return d.split('T')[0];
      return d;
    }
    return format(new Date(), 'yyyy-MM-dd');
  };

  const coutDateStr = parseDateStr(checkOutDate);
  const parts = coutDateStr.split('-').map(Number);
  if (parts.length < 3 || isNaN(parts[0])) return 0;

  let overstayNights = 0;
  // Day-by-day evaluation starting from scheduled checkout day (k = 0)
  while (true) {
    const baseTargetDate = new Date(parts[0], parts[1] - 1, parts[2] + overstayNights);
    const [chHours, chMins] = (checkOutTime || '12:00').split(':').map(Number);
    const scheduledDeadline = new Date(
      baseTargetDate.getFullYear(),
      baseTargetDate.getMonth(),
      baseTargetDate.getDate(),
      chHours || 0,
      chMins || 0,
      0,
      0
    );
    // Add grace period
    const graceThreshold = new Date(scheduledDeadline.getTime() + (gracePeriodMinutes || 0) * 60 * 1000);

    // Chargeable night is added ONLY when the guest exceeds checkout time + grace period
    if (now > graceThreshold) {
      overstayNights++;
      if (overstayNights > 3650) break; // safety boundary
    } else {
      break;
    }
  }

  return overstayNights;
}

/**
 * Single Authoritative Duration Engine for PMS
 */
export function calculateStayDuration(
  checkInDate: string | Date, 
  checkoutDate: string | Date,
  overstayNightsInput?: number | string | Date,
  status?: string,
  currentDateOrOptions?: Date | StayDurationOptions,
  legacyOptions?: StayDurationOptions
): StayDuration {
  const parseDate = (d: string | Date): Date => {
    if (!d) return new Date();
    if (d instanceof Date) return d;
    if (typeof d === 'string') {
      if (d.includes('T')) {
        return parseISO(d);
      }
      const parts = d.split('-');
      if (parts.length === 3) {
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return new Date(d);
    }
    return new Date();
  };

  const cin = startOfDay(parseDate(checkInDate));
  const cout = startOfDay(parseDate(checkoutDate));
  const bookedNights = Math.max(1, differenceInDays(cout, cin));
  const bookedDays = bookedNights + 1;

  // Extract options if provided
  let options: StayDurationOptions = {};
  let now = new Date();
  if (currentDateOrOptions instanceof Date) {
    now = currentDateOrOptions;
    if (legacyOptions) options = legacyOptions;
  } else if (currentDateOrOptions && typeof currentDateOrOptions === 'object') {
    options = currentDateOrOptions;
    if (options.currentTime) now = options.currentTime;
  }

  const checkOutTime = options.checkOutTime || options.res?.checkOutTime || options.hotel?.defaultCheckOutTime || options.hotel?.settings?.checkout?.defaultTime || '12:00';
  const gracePeriodMinutes = options.gracePeriodMinutes ?? (
    options.hotel?.settings?.checkout?.gracePeriod !== undefined && options.hotel?.settings?.checkout?.gracePeriod !== null
      ? Number(options.hotel.settings.checkout.gracePeriod)
      : (options.hotel?.overstayGraceHours !== undefined && options.hotel?.overstayGraceHours !== null
          ? Number(options.hotel.overstayGraceHours) * 60
          : 0)
  );

  let overstayNights = 0;
  if (status === 'checked_in') {
    // For checked-in guests, calculate actual overstay nights based on checkout time + grace period
    const calculatedOverstay = getOverstayNightsFromSettings(checkoutDate, checkOutTime, gracePeriodMinutes, now);
    const manualOverstay = typeof overstayNightsInput === 'number' ? overstayNightsInput : 0;
    overstayNights = Math.max(manualOverstay, calculatedOverstay);
  } else if (status === 'checked_out') {
    if (typeof overstayNightsInput === 'number' && overstayNightsInput >= 0) {
      overstayNights = overstayNightsInput;
    } else {
      overstayNights = getOverstayNightsFromSettings(checkoutDate, checkOutTime, gracePeriodMinutes, now);
    }
  } else if (typeof overstayNightsInput === 'number' && overstayNightsInput > 0) {
    overstayNights = overstayNightsInput;
  }

  const actualNights = bookedNights + overstayNights;
  const actualDays = bookedDays + overstayNights;

  return {
    bookedDays,
    bookedNights,
    overstayNights,
    actualDays,
    actualNights,
    totalDays: actualDays,
    totalNights: actualNights
  };
}

export function formatStayDuration(
  checkInDate: string | Date, 
  checkoutDate: string | Date,
  overstayNights?: number,
  status?: string
): string {
  const duration = calculateStayDuration(checkInDate, checkoutDate, overstayNights, status);
  if (duration.overstayNights > 0) {
    return `${duration.actualDays} Days / ${duration.actualNights} Nights (+${duration.overstayNights} Overstay)`;
  }
  return `${duration.bookedDays} Days / ${duration.bookedNights} Nights`;
}

export function StayDurationDisplay({ 
  checkIn, 
  checkOut, 
  overstayNights,
  status,
  currentDate,
  className = "text-[10px] font-black text-amber-500 mt-0.5",
  showDetailed = false,
  mode = 'compact'
}: { 
  checkIn: string | Date; 
  checkOut: string | Date; 
  overstayNights?: number;
  status?: string;
  currentDate?: Date;
  className?: string;
  showDetailed?: boolean;
  mode?: 'compact' | 'detailed' | 'full';
}) {
  const duration = calculateStayDuration(checkIn, checkOut, overstayNights, status, currentDate);

  if (showDetailed || mode === 'full') {
    return React.createElement(
      'div',
      { className: 'space-y-1.5 bg-zinc-900/90 p-3 rounded-xl border border-zinc-800 text-xs text-zinc-300 shadow-inner' },
      React.createElement(
        'div',
        { className: 'flex justify-between items-center text-zinc-400 font-medium' },
        React.createElement('span', { className: 'text-zinc-500 text-[10px] uppercase font-bold tracking-wider' }, 'Original Booking:'),
        React.createElement('span', { className: 'font-semibold text-zinc-200' }, `${duration.bookedDays} Days / ${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'}`)
      ),
      duration.overstayNights > 0 && React.createElement(
        'div',
        { className: 'flex justify-between items-center text-red-400 font-medium bg-red-500/10 px-2 py-1 rounded border border-red-500/20' },
        React.createElement('span', { className: 'text-red-400 text-[10px] uppercase font-bold tracking-wider flex items-center gap-1' }, 'Overstay Duration:'),
        React.createElement('span', { className: 'font-extrabold text-red-400' }, `${duration.overstayNights} Night${duration.overstayNights === 1 ? '' : 's'}`)
      ),
      React.createElement(
        'div',
        { className: 'flex justify-between items-center pt-1.5 border-t border-zinc-800 text-amber-400 font-bold' },
        React.createElement('span', { className: 'uppercase tracking-wider text-[10px]' }, 'Actual Stay:'),
        React.createElement('span', { className: 'text-sm font-black' }, `${duration.actualDays} Days / ${duration.actualNights} Night${duration.actualNights === 1 ? '' : 's'}`)
      )
    );
  }

  const text = duration.overstayNights > 0
    ? `${duration.actualDays} Days / ${duration.actualNights} Nights (+${duration.overstayNights} Overstay)`
    : `${duration.bookedDays} Days / ${duration.bookedNights} Nights`;

  return React.createElement(
    'div',
    { className },
    text
  );
}

