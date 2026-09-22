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

export interface GracePeriodInfo {
  isBeforeCheckout: boolean;
  isWithinGracePeriod: boolean;
  isOverstay: boolean;
  standardCheckoutTime: string;
  approvedLateCheckoutTime?: string;
  effectiveCheckoutTimeStr: string;
  scheduledCheckoutDateTime: Date;
  effectiveDeadlineDateTime: Date;
  hotelGraceMinutes: number;
  customGraceMinutes: number;
  totalGraceMinutes: number;
  minutesRemainingInGrace: number;
  statusLabel: 'before_checkout' | 'within_grace' | 'overstay';
  displayText: string;
}

/**
 * Authoritative Grace Period calculation engine.
 * Computes exact checkout deadlines, ad-hoc extensions, grace cushions, and live status.
 */
export function getGracePeriodInfo(
  res: any,
  hotel: any,
  currentTime: Date = new Date()
): GracePeriodInfo {
  const parseDateStr = (d: any): string => {
    if (!d) return format(new Date(), 'yyyy-MM-dd');
    const dt = parseTimestampToDate(d);
    if (!isNaN(dt.getTime()) && dt.getTime() > 0) {
      return format(dt, 'yyyy-MM-dd');
    }
    return format(new Date(), 'yyyy-MM-dd');
  };

  const coutDateStr = parseDateStr(res?.checkOut);
  const [y, m, d] = coutDateStr.split('-').map(Number);

  const standardCheckoutTime = res?.checkOutTime || hotel?.defaultCheckOutTime || hotel?.settings?.checkout?.defaultTime || '12:00';
  const approvedLateCheckoutTime = res?.approvedLateCheckoutTime;

  // Base checkout time: if approved late checkout is set, use it; else standard checkout time
  const effectiveBaseTime = approvedLateCheckoutTime || standardCheckoutTime;
  const [baseHours, baseMins] = (effectiveBaseTime || '12:00').split(':').map(Number);

  const scheduledCheckoutDateTime = new Date(
    y || new Date().getFullYear(),
    (m !== undefined ? m - 1 : new Date().getMonth()),
    d || new Date().getDate(),
    isNaN(baseHours) ? 12 : baseHours,
    isNaN(baseMins) ? 0 : baseMins,
    0,
    0
  );

  // Hotel standard grace period in minutes
  const hotelGraceMinutes = hotel?.settings?.checkout?.gracePeriod !== undefined && hotel?.settings?.checkout?.gracePeriod !== null
    ? Number(hotel.settings.checkout.gracePeriod)
    : (hotel?.overstayGraceHours !== undefined && hotel?.overstayGraceHours !== null
        ? Number(hotel.overstayGraceHours) * 60
        : 120); // Default 120 mins = 2 hours

  // Ad-hoc guest custom extension
  const customGraceMinutes = Number(res?.customGracePeriodMinutes || 0);
  const totalGraceMinutes = Math.max(0, hotelGraceMinutes + customGraceMinutes);

  const effectiveDeadlineDateTime = new Date(scheduledCheckoutDateTime.getTime() + totalGraceMinutes * 60 * 1000);
  const effectiveCheckoutTimeStr = format(effectiveDeadlineDateTime, 'HH:mm');

  const nowMs = currentTime.getTime();
  const scheduledMs = scheduledCheckoutDateTime.getTime();
  const deadlineMs = effectiveDeadlineDateTime.getTime();

  let isBeforeCheckout = false;
  let isWithinGracePeriod = false;
  let isOverstay = false;
  let minutesRemainingInGrace = 0;
  let statusLabel: 'before_checkout' | 'within_grace' | 'overstay' = 'before_checkout';
  let displayText = '';

  if (nowMs < scheduledMs) {
    isBeforeCheckout = true;
    statusLabel = 'before_checkout';
    displayText = `Checkout at ${effectiveBaseTime}`;
  } else if (nowMs <= deadlineMs) {
    isWithinGracePeriod = true;
    statusLabel = 'within_grace';
    minutesRemainingInGrace = Math.max(1, Math.ceil((deadlineMs - nowMs) / (60 * 1000)));
    const hoursRem = Math.floor(minutesRemainingInGrace / 60);
    const minsRem = minutesRemainingInGrace % 60;
    const remStr = hoursRem > 0 ? `${hoursRem}h ${minsRem}m` : `${minsRem}m`;
    displayText = `Grace Period Active (${remStr} left - ends ${effectiveCheckoutTimeStr})`;
  } else {
    isOverstay = true;
    statusLabel = 'overstay';
    const minutesPast = Math.floor((nowMs - deadlineMs) / (60 * 1000));
    const hoursPast = Math.floor(minutesPast / 60);
    const minsPast = minutesPast % 60;
    const pastStr = hoursPast > 0 ? `${hoursPast}h ${minsPast}m` : `${minsPast}m`;
    displayText = `Grace Expired (+${pastStr} overstay)`;
  }

  return {
    isBeforeCheckout,
    isWithinGracePeriod,
    isOverstay,
    standardCheckoutTime,
    approvedLateCheckoutTime,
    effectiveCheckoutTimeStr,
    scheduledCheckoutDateTime,
    effectiveDeadlineDateTime,
    hotelGraceMinutes,
    customGraceMinutes,
    totalGraceMinutes,
    minutesRemainingInGrace,
    statusLabel,
    displayText
  };
}

/**
 * Calculates exact overstay nights using hotel-configured checkout time, grace period, and actual stay duration.
 * A chargeable night must only be added when the guest exceeds the configured checkout time plus grace period.
 */
export function getOverstayNightsFromSettings(
  checkOutDate: string | Date | any,
  checkOutTime: string = '12:00',
  gracePeriodMinutes: number = 0,
  now: Date = new Date(),
  res?: any,
  hotel?: any
): number {
  if (res && res.autoNightDeduction === false) {
    return 0; // Halts overstay room charges completely when toggle is OFF!
  }

  const graceInfo = getGracePeriodInfo(
    res || { checkOut: checkOutDate, checkOutTime, customGracePeriodMinutes: 0 },
    hotel || { settings: { checkout: { gracePeriod: gracePeriodMinutes } } },
    now
  );

  // If before checkout OR currently within grace period, strictly 0 overstay charges!
  if (!graceInfo.isOverstay) {
    return 0;
  }

  // Once Grace Period expires, calculate overstay nights strictly past the effective deadline
  const msOverstay = now.getTime() - graceInfo.effectiveDeadlineDateTime.getTime();
  if (msOverstay <= 0) return 0;

  // Day 1 overstay starts immediately after grace period deadline
  const daysOverstay = Math.floor(msOverstay / (24 * 60 * 60 * 1000)) + 1;
  return Math.min(365, Math.max(1, daysOverstay));
}

/**
 * Single Authoritative Duration Engine for PMS
 */
export function calculateStayDuration(
  checkInDate: string | Date | any, 
  checkoutDate: string | Date | any,
  overstayNightsInput?: number | string | Date | any,
  status?: string,
  currentDateOrOptions?: Date | StayDurationOptions,
  legacyOptions?: StayDurationOptions
): StayDuration {
  const parseDate = (d: any): Date => {
    if (!d) return new Date();
    const dt = parseTimestampToDate(d);
    if (!isNaN(dt.getTime()) && dt.getTime() > 0) return dt;
    return new Date();
  };

  const cin = startOfDay(parseDate(checkInDate));
  const cout = startOfDay(parseDate(checkoutDate));
  // Total Nights = DateDiff(CheckOutDate, CheckInDate). A stay from Sep 20 to Sep 21 is strictly 1 night.
  const bookedNights = Math.max(1, differenceInDays(cout, cin));
  const bookedDays = bookedNights; // In standard hotel PMS, stays are measured by nights

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
          : 120)
  );

  let overstayNights = 0;
  if (status === 'checked_in') {
    // If auto deduction is turned OFF on the reservation, halt overstay calculations
    if (options.res && options.res.autoNightDeduction === false) {
      overstayNights = 0;
    } else {
      // For checked-in guests, calculate actual overstay nights based on checkout time + grace period
      const calculatedOverstay = getOverstayNightsFromSettings(checkoutDate, checkOutTime, gracePeriodMinutes, now, options.res, options.hotel);
      const manualOverstay = typeof overstayNightsInput === 'number' ? overstayNightsInput : 0;
      overstayNights = Math.max(manualOverstay, calculatedOverstay);
    }
  } else if (status === 'checked_out') {
    if (typeof overstayNightsInput === 'number' && overstayNightsInput >= 0) {
      overstayNights = overstayNightsInput;
    } else {
      overstayNights = getOverstayNightsFromSettings(checkoutDate, checkOutTime, gracePeriodMinutes, now, options.res, options.hotel);
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
  status?: string,
  options?: StayDurationOptions
): string {
  const duration = calculateStayDuration(checkInDate, checkoutDate, overstayNights, status, options);
  if (duration.overstayNights > 0) {
    return `${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'} (+${duration.overstayNights} Overstay)`;
  }
  return `${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'}`;
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
        React.createElement('span', { className: 'font-semibold text-zinc-200' }, `${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'}`)
      ),
      duration.overstayNights > 0 && React.createElement(
        'div',
        { className: 'flex justify-between items-center text-red-400 font-medium bg-red-500/10 px-2 py-1 rounded border border-red-500/20' },
        React.createElement('span', { className: 'text-red-400 text-[10px] uppercase font-bold tracking-wider flex items-center gap-1' }, 'Overstay Duration:'),
        React.createElement('span', { className: 'font-extrabold text-red-400' }, `+${duration.overstayNights} Night${duration.overstayNights === 1 ? '' : 's'}`)
      ),
      React.createElement(
        'div',
        { className: 'flex justify-between items-center pt-1.5 border-t border-zinc-800 text-amber-400 font-bold' },
        React.createElement('span', { className: 'uppercase tracking-wider text-[10px]' }, 'Total Chargeable:'),
        React.createElement('span', { className: 'text-sm font-black' }, `${duration.actualNights} Night${duration.actualNights === 1 ? '' : 's'}`)
      )
    );
  }

  const text = duration.overstayNights > 0
    ? `${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'} (+${duration.overstayNights} Overstay)`
    : `${duration.bookedNights} Night${duration.bookedNights === 1 ? '' : 's'}`;

  return React.createElement(
    'div',
    { className },
    text
  );
}

