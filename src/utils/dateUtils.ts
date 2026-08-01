import React from 'react';
import { startOfDay, parseISO, differenceInDays } from 'date-fns';

export interface StayDuration {
  totalDays: number;
  totalNights: number;
}

export function calculateStayDuration(checkInDate: string | Date, checkoutDate: string | Date): StayDuration {
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
  const totalNights = Math.max(0, differenceInDays(cout, cin));
  const totalDays = totalNights + 1;

  // Audit check: Ensure parity between totalDays and totalNights (totalNights = totalDays - 1)
  if (totalNights !== totalDays - 1) {
    console.warn(`[StayDuration Audit Warning] Inconsistent duration calculation detected: totalDays=${totalDays}, totalNights=${totalNights}. Total nights must equal totalDays - 1.`);
  }

  return {
    totalDays,
    totalNights,
  };
}

export function formatStayDuration(checkInDate: string | Date, checkoutDate: string | Date): string {
  const { totalDays, totalNights } = calculateStayDuration(checkInDate, checkoutDate);
  return `${totalDays} Days / ${totalNights} Nights`;
}

export function StayDurationDisplay({ 
  checkIn, 
  checkOut, 
  overstayNights = 0,
  className = "text-[10px] font-black text-amber-500 mt-0.5" 
}: { 
  checkIn: string | Date; 
  checkOut: string | Date; 
  overstayNights?: number;
  className?: string;
}) {
  const { totalDays, totalNights } = calculateStayDuration(checkIn, checkOut);
  const nights = totalNights + overstayNights;
  const days = totalDays + overstayNights;

  return React.createElement(
    'div',
    { className },
    `${days} Days / ${nights} Nights`
  );
}

