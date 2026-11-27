import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isValid,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfYear,
  subDays,
} from 'date-fns';
import { Reservation, Room } from '../types';
import { DateFilterValue } from '../components/DateFilterControl';

export type OccupancyGranularity = 'daily' | 'monthly' | 'yearly';

export interface DailyOccupancyPoint {
  dateKey: string; // YYYY-MM-DD
  label: string; // e.g., "Nov 27" or "27"
  fullLabel: string; // e.g., "Fri, Nov 27, 2026"
  occupiedRooms: number;
  reservedRooms: number;
  totalRooms: number;
  occupancyRate: number; // 0-100 rounded to 1 decimal or integer
  projectedRate: number; // occupied + reserved %
  stays: Array<{
    reservationId: string;
    guestName: string;
    roomNumber: string;
    status: string;
    checkIn: string;
    checkOut: string;
  }>;
}

export interface AggregatedOccupancyRow {
  key: string; // YYYY-MM-DD | YYYY-MM | YYYY
  label: string; // Chart axis label
  fullLabel: string; // Table display label
  daysCount: number;
  occupiedRoomNights: number;
  reservedRoomNights: number;
  availableRoomNights: number;
  avgOccupiedRooms: number;
  occupancyRate: number; // 0-100 (1 decimal)
  projectedRate: number; // 0-100 (1 decimal)
  peakOccupancyRate: number;
  // Optional drilldown metadata
  year?: number;
  month?: number; // 0-11
  dateKey?: string;
}

export interface OccupancyPeriodSummary {
  periodLabel: string;
  startDate: Date;
  endDate: Date;
  daysCount: number;
  totalRooms: number;
  occupiedRoomNights: number;
  reservedRoomNights: number;
  availableRoomNights: number;
  avgOccupiedRooms: number;
  occupancyRate: number; // integer 0-100 for KPI parity
  exactOccupancyRate: number; // 1 decimal
  projectedRate: number; // integer 0-100
  peakLabel: string;
  peakRate: number;
  dailyPoints: DailyOccupancyPoint[];
  monthlyRows: AggregatedOccupancyRow[];
  yearlyRows: AggregatedOccupancyRow[];
  selectedDayPoint: DailyOccupancyPoint | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 3660; // Safety cap (~10 years) so invalid inputs never hang UI

function parseCalendarDate(value?: string | null): Date | null {
  if (!value || typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Prefer YYYY-MM-DD prefix parsing as local calendar day to prevent UTC shifts
  const datePart = trimmed.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    const [y, m, d] = datePart.split('-').map(Number);
    const localDate = new Date(y, m - 1, d);
    return isValid(localDate) ? startOfDay(localDate) : null;
  }
  const parsed = parseISO(trimmed);
  if (isValid(parsed)) return startOfDay(parsed);
  const fallback = new Date(trimmed);
  return isValid(fallback) ? startOfDay(fallback) : null;
}

interface ParsedStay {
  reservationId: string;
  roomKey: string;
  roomNumber: string;
  guestName: string;
  status: string;
  checkIn: string;
  checkOut: string;
  startMs: number;
  endMs: number; // exclusive
  isActual: boolean;
  isReserved: boolean;
  isCurrentlyCheckedIn: boolean;
}

function parseReservationsForOccupancy(reservations: Reservation[], rooms: Room[], todayStart: Date): ParsedStay[] {
  const validRoomIds = new Set(rooms.map(r => r.id));
  const tomorrowMs = addDays(todayStart, 1).getTime();
  const parsed: ParsedStay[] = [];

  for (const res of reservations) {
    if (!res) continue;
    if (res.status === 'cancelled' || res.status === 'no_show') continue;

    const isActual = res.status === 'checked_in' || res.status === 'checked_out';
    const isReserved = res.status === 'confirmed' || res.status === 'pending';
    if (!isActual && !isReserved) continue;

    const resStart = parseCalendarDate(res.checkIn);
    const resEndRaw = parseCalendarDate(res.checkOut);
    if (!resStart) continue;

    let effectiveEnd = resEndRaw && resEndRaw > resStart ? resEndRaw : addDays(resStart, 1);

    if (res.overstayNights && res.overstayNights > 0 && resEndRaw) {
      const extended = addDays(resEndRaw, res.overstayNights);
      if (extended > effectiveEnd) effectiveEnd = extended;
    }

    if (res.status === 'checked_in') {
      if (tomorrowMs > effectiveEnd.getTime()) {
        effectiveEnd = new Date(tomorrowMs);
      }
    }

    const roomKey =
      res.roomId && (validRoomIds.size === 0 || validRoomIds.has(res.roomId))
        ? `id:${res.roomId}`
        : res.roomNumber
          ? `num:${res.roomNumber}`
          : `res:${res.id}`;

    parsed.push({
      reservationId: res.id,
      roomKey,
      roomNumber: res.roomNumber || '—',
      guestName: res.guestName || 'Guest',
      status: res.status,
      checkIn: res.checkIn,
      checkOut: res.checkOut,
      startMs: resStart.getTime(),
      endMs: effectiveEnd.getTime(),
      isActual,
      isReserved,
      isCurrentlyCheckedIn: res.status === 'checked_in',
    });
  }

  return parsed;
}

export function resolveOccupancyDateBounds(
  filter: DateFilterValue,
  reservations: Reservation[]
): { startDate: Date; endDate: Date; periodLabel: string; defaultGranularity: OccupancyGranularity } {
  const now = new Date();
  const today = startOfDay(now);

  switch (filter.mode) {
    case 'day': {
      const target = parseCalendarDate(filter.day) || today;
      return {
        startDate: target,
        endDate: target,
        periodLabel: format(target, 'MMM d, yyyy'),
        defaultGranularity: 'daily',
      };
    }
    case 'month': {
      const base = new Date(filter.year || now.getFullYear(), filter.month ?? now.getMonth(), 1);
      const start = startOfMonth(base);
      const end = endOfMonth(base);
      return {
        startDate: start,
        endDate: end,
        periodLabel: format(base, 'MMMM yyyy'),
        defaultGranularity: 'daily',
      };
    }
    case 'year': {
      const yr = filter.year || now.getFullYear();
      const base = new Date(yr, 0, 1);
      return {
        startDate: startOfYear(base),
        endDate: endOfYear(base),
        periodLabel: `Year ${yr}`,
        defaultGranularity: 'monthly',
      };
    }
    case 'range': {
      let start = parseCalendarDate(filter.startDate) || subDays(today, 29);
      let end = parseCalendarDate(filter.endDate) || today;
      if (start > end) {
        const tmp = start;
        start = end;
        end = tmp;
      }
      const totalDays = differenceInCalendarDays(end, start) + 1;
      if (totalDays > MAX_RANGE_DAYS) {
        start = subDays(end, MAX_RANGE_DAYS - 1);
      }
      const span = differenceInCalendarDays(end, start) + 1;
      const defaultGranularity: OccupancyGranularity =
        span <= 62 ? 'daily' : span <= 730 ? 'monthly' : 'yearly';
      return {
        startDate: start,
        endDate: end,
        periodLabel: `${format(start, 'MMM d, yyyy')} – ${format(end, 'MMM d, yyyy')}`,
        defaultGranularity,
      };
    }
    case 'all':
    default: {
      // For All Time, span from the start of the earliest reservation's year (or current year)
      // through the end of the current year (or latest reservation's year), capped safely.
      const currentYear = now.getFullYear();
      let minYear = currentYear;
      let maxYear = currentYear;
      for (const r of reservations) {
        if (!r || r.status === 'cancelled' || r.status === 'no_show') continue;
        const ci = parseCalendarDate(r.checkIn);
        const co = parseCalendarDate(r.checkOut);
        if (ci) {
          const y = ci.getFullYear();
          if (y >= currentYear - 5 && y < minYear) minYear = y;
          if (y <= currentYear + 2 && y > maxYear) maxYear = y;
        }
        if (co) {
          const y = co.getFullYear();
          if (y <= currentYear + 2 && y > maxYear) maxYear = y;
        }
      }
      const start = startOfYear(new Date(minYear, 0, 1));
      const end = endOfYear(new Date(maxYear, 11, 31));
      return {
        startDate: start,
        endDate: end,
        periodLabel: minYear === maxYear ? `${currentYear} Overview` : `${minYear} – ${maxYear}`,
        defaultGranularity: minYear === maxYear ? 'monthly' : 'yearly',
      };
    }
  }
}

export function computeOccupancyAnalytics(
  rooms: Room[],
  reservations: Reservation[],
  filter: DateFilterValue
): OccupancyPeriodSummary {
  const totalRooms = rooms.length;
  const todayStart = startOfDay(new Date());
  const todayMs = todayStart.getTime();
  const stays = parseReservationsForOccupancy(reservations, rooms, todayStart);

  const { startDate, endDate, periodLabel } = resolveOccupancyDateBounds(filter, reservations);

  // If single day mode, also generate a 7-day surrounding context window for the chart,
  // while computing KPI totals strictly on the selected single day.
  const isSingleDay = filter.mode === 'day';
  const evalStart = startOfDay(startDate);
  const evalEnd = startOfDay(endDate);
  const totalSpanDays = Math.min(MAX_RANGE_DAYS, Math.max(1, differenceInCalendarDays(evalEnd, evalStart) + 1));

  const buildDayPoint = (d: Date, includeStays: boolean): DailyOccupancyPoint => {
    const dayMs = d.getTime();
    const occupiedSet = new Set<string>();
    const reservedSet = new Set<string>();
    const dayStays: DailyOccupancyPoint['stays'] = [];

    for (const s of stays) {
      const matchesDay =
        (dayMs >= s.startMs && dayMs < s.endMs) ||
        (s.isCurrentlyCheckedIn && dayMs === todayMs);

      if (!matchesDay) continue;

      if (s.isActual) {
        occupiedSet.add(s.roomKey);
        if (includeStays) {
          dayStays.push({
            reservationId: s.reservationId,
            guestName: s.guestName,
            roomNumber: s.roomNumber,
            status: s.status,
            checkIn: s.checkIn,
            checkOut: s.checkOut,
          });
        }
      } else if (s.isReserved) {
        reservedSet.add(s.roomKey);
        if (includeStays) {
          dayStays.push({
            reservationId: s.reservationId,
            guestName: s.guestName,
            roomNumber: s.roomNumber,
            status: s.status,
            checkIn: s.checkIn,
            checkOut: s.checkOut,
          });
        }
      }
    }

    // Remove rooms from reservedSet that are already counted in occupiedSet
    occupiedSet.forEach(k => reservedSet.delete(k));

    const occupiedRooms = totalRooms > 0 ? Math.min(totalRooms, occupiedSet.size) : occupiedSet.size;
    const reservedRooms =
      totalRooms > 0 ? Math.min(Math.max(0, totalRooms - occupiedRooms), reservedSet.size) : reservedSet.size;

    const occupancyRate = totalRooms > 0 ? Number(((occupiedRooms / totalRooms) * 100).toFixed(1)) : 0;
    const projectedRate =
      totalRooms > 0 ? Number((((occupiedRooms + reservedRooms) / totalRooms) * 100).toFixed(1)) : 0;

    return {
      dateKey: format(d, 'yyyy-MM-dd'),
      label: totalSpanDays <= 31 ? format(d, 'MMM d') : format(d, 'MMM d, yy'),
      fullLabel: format(d, 'EEE, MMM d, yyyy'),
      occupiedRooms,
      reservedRooms,
      totalRooms,
      occupancyRate,
      projectedRate,
      stays: dayStays,
    };
  };

  const dailyPoints: DailyOccupancyPoint[] = [];
  const monthBuckets = new Map<
    string,
    {
      key: string;
      year: number;
      month: number;
      label: string;
      fullLabel: string;
      daysCount: number;
      occupiedRoomNights: number;
      reservedRoomNights: number;
      availableRoomNights: number;
      peakOccupancyRate: number;
    }
  >();
  const yearBuckets = new Map<
    string,
    {
      key: string;
      year: number;
      label: string;
      fullLabel: string;
      daysCount: number;
      occupiedRoomNights: number;
      reservedRoomNights: number;
      availableRoomNights: number;
      peakOccupancyRate: number;
    }
  >();

  let occupiedRoomNights = 0;
  let reservedRoomNights = 0;
  let availableRoomNights = 0;
  let peakRate = -1;
  let peakLabel = '—';

  const startMs = evalStart.getTime();
  for (let i = 0; i < totalSpanDays; i++) {
    const d = new Date(startMs + i * DAY_MS);
    const point = buildDayPoint(d, isSingleDay);
    dailyPoints.push(point);

    occupiedRoomNights += point.occupiedRooms;
    reservedRoomNights += point.reservedRooms;
    availableRoomNights += totalRooms;

    if (point.occupancyRate > peakRate) {
      peakRate = point.occupancyRate;
      peakLabel = format(d, 'MMM d, yyyy');
    }

    const yr = d.getFullYear();
    const mo = d.getMonth();
    const mKey = `${yr}-${String(mo + 1).padStart(2, '0')}`;
    const existingMonth = monthBuckets.get(mKey);
    if (existingMonth) {
      existingMonth.daysCount += 1;
      existingMonth.occupiedRoomNights += point.occupiedRooms;
      existingMonth.reservedRoomNights += point.reservedRooms;
      existingMonth.availableRoomNights += totalRooms;
      if (point.occupancyRate > existingMonth.peakOccupancyRate) {
        existingMonth.peakOccupancyRate = point.occupancyRate;
      }
    } else {
      monthBuckets.set(mKey, {
        key: mKey,
        year: yr,
        month: mo,
        label: format(d, 'MMM yy'),
        fullLabel: format(d, 'MMMM yyyy'),
        daysCount: 1,
        occupiedRoomNights: point.occupiedRooms,
        reservedRoomNights: point.reservedRooms,
        availableRoomNights: totalRooms,
        peakOccupancyRate: point.occupancyRate,
      });
    }

    const yKey = String(yr);
    const existingYear = yearBuckets.get(yKey);
    if (existingYear) {
      existingYear.daysCount += 1;
      existingYear.occupiedRoomNights += point.occupiedRooms;
      existingYear.reservedRoomNights += point.reservedRooms;
      existingYear.availableRoomNights += totalRooms;
      if (point.occupancyRate > existingYear.peakOccupancyRate) {
        existingYear.peakOccupancyRate = point.occupancyRate;
      }
    } else {
      yearBuckets.set(yKey, {
        key: yKey,
        year: yr,
        label: yKey,
        fullLabel: `Year ${yKey}`,
        daysCount: 1,
        occupiedRoomNights: point.occupiedRooms,
        reservedRoomNights: point.reservedRooms,
        availableRoomNights: totalRooms,
        peakOccupancyRate: point.occupancyRate,
      });
    }
  }

  // If single day mode, build a 7-day surrounding context for visual chart clarity
  const selectedDayPoint = isSingleDay ? dailyPoints[0] || null : null;
  let chartDailyPoints = dailyPoints;
  if (isSingleDay && selectedDayPoint) {
    const contextStart = subDays(evalStart, 3);
    chartDailyPoints = Array.from({ length: 7 }, (_, idx) => {
      const d = addDays(contextStart, idx);
      if (d.getTime() === evalStart.getTime()) return selectedDayPoint;
      return buildDayPoint(d, false);
    });
  }

  const monthlyRows: AggregatedOccupancyRow[] = Array.from(monthBuckets.values()).map((b) => {
    const rate = b.availableRoomNights > 0 ? Number(((b.occupiedRoomNights / b.availableRoomNights) * 100).toFixed(1)) : 0;
    const proj =
      b.availableRoomNights > 0
        ? Number((((b.occupiedRoomNights + b.reservedRoomNights) / b.availableRoomNights) * 100).toFixed(1))
        : 0;
    return {
      key: b.key,
      label: filter.mode === 'year' ? format(new Date(b.year, b.month, 1), 'MMM') : b.label,
      fullLabel: b.fullLabel,
      daysCount: b.daysCount,
      occupiedRoomNights: b.occupiedRoomNights,
      reservedRoomNights: b.reservedRoomNights,
      availableRoomNights: b.availableRoomNights,
      avgOccupiedRooms: b.daysCount > 0 ? Number((b.occupiedRoomNights / b.daysCount).toFixed(1)) : 0,
      occupancyRate: rate,
      projectedRate: proj,
      peakOccupancyRate: b.peakOccupancyRate,
      year: b.year,
      month: b.month,
    };
  });

  const yearlyRows: AggregatedOccupancyRow[] = Array.from(yearBuckets.values()).map((b) => {
    const rate = b.availableRoomNights > 0 ? Number(((b.occupiedRoomNights / b.availableRoomNights) * 100).toFixed(1)) : 0;
    const proj =
      b.availableRoomNights > 0
        ? Number((((b.occupiedRoomNights + b.reservedRoomNights) / b.availableRoomNights) * 100).toFixed(1))
        : 0;
    return {
      key: b.key,
      label: b.label,
      fullLabel: b.fullLabel,
      daysCount: b.daysCount,
      occupiedRoomNights: b.occupiedRoomNights,
      reservedRoomNights: b.reservedRoomNights,
      availableRoomNights: b.availableRoomNights,
      avgOccupiedRooms: b.daysCount > 0 ? Number((b.occupiedRoomNights / b.daysCount).toFixed(1)) : 0,
      occupancyRate: rate,
      projectedRate: proj,
      peakOccupancyRate: b.peakOccupancyRate,
      year: b.year,
    };
  });

  const exactOccupancyRate =
    availableRoomNights > 0 ? Number(((occupiedRoomNights / availableRoomNights) * 100).toFixed(1)) : 0;
  const occupancyRate = Math.round(exactOccupancyRate);
  const projectedRate =
    availableRoomNights > 0
      ? Math.round(((occupiedRoomNights + reservedRoomNights) / availableRoomNights) * 100)
      : 0;
  const avgOccupiedRooms = totalSpanDays > 0 ? Number((occupiedRoomNights / totalSpanDays).toFixed(1)) : 0;

  return {
    periodLabel,
    startDate: evalStart,
    endDate: evalEnd,
    daysCount: totalSpanDays,
    totalRooms,
    occupiedRoomNights,
    reservedRoomNights,
    availableRoomNights,
    avgOccupiedRooms,
    occupancyRate,
    exactOccupancyRate,
    projectedRate,
    peakLabel: peakRate > 0 ? peakLabel : '—',
    peakRate: peakRate > 0 ? peakRate : 0,
    dailyPoints: chartDailyPoints,
    monthlyRows,
    yearlyRows,
    selectedDayPoint,
  };
}
