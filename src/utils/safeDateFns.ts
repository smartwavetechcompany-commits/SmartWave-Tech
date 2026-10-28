import * as originalDateFns from '../../node_modules/date-fns/index.js';

export * from '../../node_modules/date-fns/index.js';

/**
 * Universal safe parser for any date input, Firestore Timestamp, ISO string, etc.
 */
function safeToDate(val: any): Date | null {
  if (val === null || val === undefined || val === '') return null;
  if (val instanceof Date) {
    return isNaN(val.getTime()) ? null : val;
  }
  if (typeof val === 'number') {
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'object') {
    if (typeof val.toDate === 'function') {
      try {
        const d = val.toDate();
        return (d instanceof Date && !isNaN(d.getTime())) ? d : null;
      } catch {
        return null;
      }
    }
    if (typeof val.seconds === 'number') {
      const d = new Date(val.seconds * 1000);
      return isNaN(d.getTime()) ? null : d;
    }
    const d = new Date(val);
    return isNaN(d.getTime()) ? null : d;
  }
  if (typeof val === 'string') {
    const trimmed = val.trim();
    if (!trimmed) return null;
    if (trimmed.includes('T')) {
      try {
        const parsed = originalDateFns.parseISO(trimmed);
        if (!isNaN(parsed.getTime())) return parsed;
      } catch {}
    }
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d;
    try {
      const parsed = originalDateFns.parseISO(trimmed);
      if (!isNaN(parsed.getTime())) return parsed;
    } catch {}
    return null;
  }
  return null;
}

/**
 * Bulletproof drop-in replacement for date-fns format.
 * Never throws RangeError: Invalid time value under any circumstances.
 */
export function format(date: any, formatStr: string, options?: any): string {
  try {
    const d = safeToDate(date);
    if (!d) return 'N/A';
    return originalDateFns.format(d, formatStr, options);
  } catch {
    return 'N/A';
  }
}

/**
 * Bulletproof drop-in replacement for date-fns isWithinInterval.
 */
export function isWithinInterval(date: any, interval: any, options?: any): boolean {
  try {
    const d = safeToDate(date);
    if (!d) return false;
    const start = safeToDate(interval?.start);
    const end = safeToDate(interval?.end);
    if (!start || !end) return false;
    return originalDateFns.isWithinInterval(d, { start, end }, options);
  } catch {
    return false;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns differenceInDays.
 */
export function differenceInDays(dateLeft: any, dateRight: any, options?: any): number {
  try {
    const left = safeToDate(dateLeft);
    const right = safeToDate(dateRight);
    if (!left || !right) return 0;
    return originalDateFns.differenceInDays(left, right, options);
  } catch {
    return 0;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns addDays.
 */
export function addDays(date: any, amount: number, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.addDays(d, amount, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns subDays.
 */
export function subDays(date: any, amount: number, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.subDays(d, amount, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns startOfDay.
 */
export function startOfDay(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.startOfDay(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns endOfDay.
 */
export function endOfDay(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.endOfDay(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns startOfMonth.
 */
export function startOfMonth(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.startOfMonth(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns endOfMonth.
 */
export function endOfMonth(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.endOfMonth(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns startOfWeek.
 */
export function startOfWeek(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.startOfWeek(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns endOfWeek.
 */
export function endOfWeek(date: any, options?: any): Date {
  try {
    const d = safeToDate(date);
    if (!d) return new Date();
    return originalDateFns.endOfWeek(d, options);
  } catch {
    return new Date();
  }
}

/**
 * Bulletproof drop-in replacement for date-fns isBefore.
 */
export function isBefore(date: any, dateToCompare: any): boolean {
  try {
    const d1 = safeToDate(date);
    const d2 = safeToDate(dateToCompare);
    if (!d1 || !d2) return false;
    return originalDateFns.isBefore(d1, d2);
  } catch {
    return false;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns isAfter.
 */
export function isAfter(date: any, dateToCompare: any): boolean {
  try {
    const d1 = safeToDate(date);
    const d2 = safeToDate(dateToCompare);
    if (!d1 || !d2) return false;
    return originalDateFns.isAfter(d1, d2);
  } catch {
    return false;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns isSameDay.
 */
export function isSameDay(dateLeft: any, dateRight: any): boolean {
  try {
    const d1 = safeToDate(dateLeft);
    const d2 = safeToDate(dateRight);
    if (!d1 || !d2) return false;
    return originalDateFns.isSameDay(d1, d2);
  } catch {
    return false;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns isToday.
 */
export function isToday(date: any): boolean {
  try {
    const d = safeToDate(date);
    if (!d) return false;
    return originalDateFns.isToday(d);
  } catch {
    return false;
  }
}

/**
 * Bulletproof drop-in replacement for date-fns parseISO.
 */
export function parseISO(argument: any, options?: any): Date {
  try {
    const d = safeToDate(argument);
    if (!d) return new Date();
    return d;
  } catch {
    return new Date();
  }
}
