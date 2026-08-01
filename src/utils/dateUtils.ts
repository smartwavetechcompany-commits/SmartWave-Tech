import { startOfDay, parseISO, differenceInDays } from 'date-fns';

export interface StayDuration {
  totalDays: number;
  totalNights: number;
}

export function calculateStayDuration(checkInDate: string | Date, checkoutDate: string | Date): StayDuration {
  const parseDate = (d: string | Date): Date => {
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

  return {
    totalDays,
    totalNights,
  };
}
