import React from 'react';
import { startOfDay, parseISO, differenceInDays } from 'date-fns';

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
 * Single Authoritative Duration Engine for PMS
 */
export function calculateStayDuration(
  checkInDate: string | Date, 
  checkoutDate: string | Date,
  overstayNightsInput?: number | string | Date,
  status?: string,
  currentDate?: Date
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
  const bookedNights = Math.max(0, differenceInDays(cout, cin));
  const bookedDays = bookedNights + 1;

  let overstayNights = 0;
  if (typeof overstayNightsInput === 'number' && overstayNightsInput > 0) {
    overstayNights = overstayNightsInput;
  } else if (overstayNightsInput instanceof Date || (typeof overstayNightsInput === 'string' && overstayNightsInput.includes('-'))) {
    const curr = startOfDay(parseDate(overstayNightsInput as string | Date));
    if (curr > cout) {
      overstayNights = Math.max(0, differenceInDays(curr, cout));
    }
  }

  // Dynamic overstay calculation if not explicitly provided as a positive number
  if (overstayNights === 0 && (status === 'checked_in' || status === undefined)) {
    const now = startOfDay(currentDate || new Date());
    if (now > cout) {
      overstayNights = Math.max(0, differenceInDays(now, cout));
    }
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

