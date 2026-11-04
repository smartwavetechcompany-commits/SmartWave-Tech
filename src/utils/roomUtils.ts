import { Room, Reservation, RoomBlocking, Hotel } from '../types';
import { isWithinInterval, parseISO, startOfDay, endOfDay, addDays, format } from 'date-fns';

export type DisplayRoomStatus = Room['status'] | 'occupied' | 'reserved' | 'blocked';

export const getRoomDisplayStatus = (
  room: Room,
  reservations: Reservation[],
  roomBlockings: RoomBlocking[] = [],
  targetDate: Date = new Date()
): DisplayRoomStatus => {
  const date = startOfDay(targetDate);

  // 1. Check for active check-in (Highest priority)
  const today = startOfDay(new Date());
  const activeReservation = reservations.find(r => {
    if (r.roomId !== room.id || r.status !== 'checked_in') return false;
    const resStart = startOfDay(parseISO(r.checkIn));
    const resEnd = startOfDay(parseISO(r.checkOut));
    const effectiveOccupancyEnd = resEnd <= today ? addDays(today, 1) : resEnd;
    return date >= resStart && date < effectiveOccupancyEnd;
  });
  if (activeReservation) return 'occupied';

  // 2. Check for manual blockings
  const isBlocked = roomBlockings.some(b => {
    if (b.roomId !== room.id) return false;
    const start = startOfDay(parseISO(b.startDate));
    const end = endOfDay(parseISO(b.endDate));
    return date >= start && date <= end;
  });
  if (isBlocked) return 'maintenance'; // or 'blocked' if we add it to type

  // 3. Check for confirmed reservations for target date: [checkIn, checkOut)
  const hasReservation = reservations.some(r => {
    if (r.roomId !== room.id) return false;
    if (r.status !== 'confirmed' && r.status !== 'pending') return false;
    const resStart = startOfDay(parseISO(r.checkIn));
    const resEnd = startOfDay(parseISO(r.checkOut));
    // The room is reserved during the stay nights: resStart <= date < resEnd
    return date >= resStart && date < resEnd;
  });
  if (hasReservation) return 'reserved';

  // 4. Return physical status (Clean/Dirty/Maintenance)
  // If a room still has a legacy or leftover 'occupied' status in the database but no active reservation
  // is checked in today, treat the room as dirty (awaiting housekeeping cleaning) rather than occupied.
  if (room.status === 'occupied') {
    return 'dirty';
  }

  return room.status;
};

export interface RoomReservationInfo {
  isReserved: boolean;
  isOccupied: boolean;
  displayStatus: DisplayRoomStatus;
  primaryReservation?: Reservation;
  reservationDates?: string; // e.g. "Nov 4, 2026 – Nov 7, 2026"
  checkInDate?: string;
  checkOutDate?: string;
  nextAvailableDate?: string; // e.g. "Nov 7, 2026"
  nextAvailableDateIso?: string; // e.g. "2026-11-07"
  guestName?: string;
}

/**
 * Computes comprehensive reservation details for a room:
 * - Accurately detects active and upcoming reservations
 * - Formats reservation date span (e.g. "Nov 4, 2026 – Nov 7, 2026")
 * - Calculates the next date of availability (considering consecutive bookings and room blocks)
 */
export const getRoomDetailedReservationInfo = (
  room: Room,
  reservations: Reservation[],
  roomBlockings: RoomBlocking[] = [],
  targetDate: Date = new Date()
): RoomReservationInfo => {
  const today = startOfDay(targetDate);

  // Filter valid non-cancelled reservations for this room
  const roomRes = reservations.filter(r => {
    if (r.roomId !== room.id && r.roomNumber !== room.roomNumber) return false;
    if (r.status === 'cancelled' || r.status === 'checked_out' || r.status === 'no_show') return false;
    return true;
  });

  // Sort chronologically by check-in date
  roomRes.sort((a, b) => {
    const tA = new Date(a.checkIn || 0).getTime();
    const tB = new Date(b.checkIn || 0).getTime();
    return tA - tB;
  });

  // 1. Check for active checked-in guest
  const activeStay = roomRes.find(r => r.status === 'checked_in');
  
  // 2. Check for confirmed/pending reservation covering target date
  const reservedToday = roomRes.find(r => {
    if (r.status !== 'confirmed' && r.status !== 'pending') return false;
    const start = startOfDay(parseISO(r.checkIn));
    const end = startOfDay(parseISO(r.checkOut));
    return today >= start && today < end;
  });

  // 3. Check for upcoming confirmed/pending reservation in the future
  const upcomingRes = roomRes.find(r => {
    if (r.status !== 'confirmed' && r.status !== 'pending') return false;
    const start = startOfDay(parseISO(r.checkIn));
    const end = startOfDay(parseISO(r.checkOut));
    return start >= today || end > today;
  });

  const relevantRes = activeStay || reservedToday || upcomingRes;
  const isOccupied = !!activeStay;
  const isReserved = !isOccupied && (!!reservedToday || !!upcomingRes || room.status === 'reserved');

  const baseDisplayStatus = getRoomDisplayStatus(room, reservations, roomBlockings, targetDate);
  const displayStatus: DisplayRoomStatus = isOccupied ? 'occupied' : isReserved ? 'reserved' : baseDisplayStatus;

  if (!relevantRes) {
    return {
      isReserved: false,
      isOccupied: false,
      displayStatus,
      nextAvailableDate: 'Available Now',
      nextAvailableDateIso: format(today, 'yyyy-MM-dd')
    };
  }

  // Format reservation dates
  let reservationDates = '';
  try {
    const sDate = parseISO(relevantRes.checkIn);
    const eDate = parseISO(relevantRes.checkOut);
    reservationDates = `${format(sDate, 'MMM d, yyyy')} – ${format(eDate, 'MMM d, yyyy')}`;
  } catch {
    reservationDates = `${relevantRes.checkIn} – ${relevantRes.checkOut}`;
  }

  // Calculate next date of availability:
  // Follow chain of contiguous consecutive reservations on this room
  let endChain = parseISO(relevantRes.checkOut);
  const relevantIndex = roomRes.indexOf(relevantRes);
  if (relevantIndex >= 0) {
    for (let i = relevantIndex + 1; i < roomRes.length; i++) {
      const nextRes = roomRes[i];
      const nextStart = parseISO(nextRes.checkIn);
      const nextEnd = parseISO(nextRes.checkOut);
      // If consecutive without gap (next starts on or before current ends)
      if (startOfDay(nextStart).getTime() <= startOfDay(endChain).getTime()) {
        if (startOfDay(nextEnd) > startOfDay(endChain)) {
          endChain = nextEnd;
        }
      } else {
        break;
      }
    }
  }

  // Also check if any maintenance blockings extend the unavailability
  const relevantBlocks = roomBlockings.filter(b => b.roomId === room.id);
  for (const b of relevantBlocks) {
    try {
      const bStart = parseISO(b.startDate);
      const bEnd = parseISO(b.endDate);
      if (startOfDay(bStart).getTime() <= startOfDay(endChain).getTime() && endOfDay(bEnd).getTime() >= startOfDay(endChain).getTime()) {
        endChain = addDays(endOfDay(bEnd), 1);
      }
    } catch {}
  }

  let nextAvailableDate = '';
  let nextAvailableDateIso = '';
  try {
    nextAvailableDate = format(endChain, 'MMM d, yyyy');
    nextAvailableDateIso = format(endChain, 'yyyy-MM-dd');
  } catch {
    nextAvailableDate = relevantRes.checkOut;
    nextAvailableDateIso = relevantRes.checkOut;
  }

  return {
    isReserved,
    isOccupied,
    displayStatus,
    primaryReservation: relevantRes,
    reservationDates,
    checkInDate: relevantRes.checkIn,
    checkOutDate: relevantRes.checkOut,
    nextAvailableDate,
    nextAvailableDateIso,
    guestName: relevantRes.guestName
  };
};

export interface ConflictCheckResult {
  hasConflict: boolean;
  conflictingReservation?: Reservation;
  conflictingBlocking?: RoomBlocking;
  reason?: string;
}

/**
 * Validates whether two date intervals overlap:
 * Overlap exists when:
 *   New Check-In < Existing Check-Out
 *   AND
 *   New Check-Out > Existing Check-In
 * 
 * No conflict exists when:
 *   New Check-In >= Existing Check-Out
 *   OR
 *   New Check-Out <= Existing Check-In
 */
export const doDateRangesOverlap = (
  startA: Date,
  endA: Date,
  startB: Date,
  endB: Date
): boolean => {
  return startA < endB && endA > startB;
};

/**
 * Checks for conflicts when extending an existing reservation or in-house guest stay.
 * Returns { hasConflict: false } if extension is approved, or { hasConflict: true, conflictingReservation, reason } if denied.
 */
export const checkStayExtensionConflict = (
  roomId: string,
  currentCheckOut: string,
  newCheckOut: string,
  reservations: Reservation[],
  roomBlockings: RoomBlocking[] = [],
  excludeReservationId?: string
): ConflictCheckResult => {
  const extensionStart = startOfDay(parseISO(currentCheckOut));
  const extensionEnd = startOfDay(parseISO(newCheckOut));

  // Check if extension dates are valid
  if (extensionEnd <= extensionStart) {
    return {
      hasConflict: true,
      reason: 'New check-out date must be after current check-out date.'
    };
  }

  // Find any reservation on the same room that overlaps with the extension period [currentCheckOut, newCheckOut)
  for (const r of reservations) {
    if (r.roomId !== roomId) continue;
    if (excludeReservationId && r.id === excludeReservationId) continue;
    if (r.status === 'cancelled' || r.status === 'checked_out' || r.status === 'no_show') continue;

    const resStart = startOfDay(parseISO(r.checkIn));
    const resEnd = startOfDay(parseISO(r.checkOut));

    if (doDateRangesOverlap(extensionStart, extensionEnd, resStart, resEnd)) {
      const formattedStartDate = format(resStart, 'MMMM d');
      return {
        hasConflict: true,
        conflictingReservation: r,
        reason: `Cannot extend stay. Room already has a confirmed reservation beginning ${formattedStartDate}.`
      };
    }
  }

  // Check maintenance / room blockings
  for (const b of roomBlockings) {
    if (b.roomId !== roomId) continue;
    const blockStart = startOfDay(parseISO(b.startDate));
    const blockEnd = endOfDay(parseISO(b.endDate));

    if (extensionStart <= blockEnd && extensionEnd >= blockStart) {
      return {
        hasConflict: true,
        conflictingBlocking: b,
        reason: `Cannot extend stay. Room is scheduled for maintenance/blocking starting ${format(blockStart, 'MMMM d')}.`
      };
    }
  }

  return { hasConflict: false };
};

export const isRoomAvailable = (
  roomId: string,
  checkIn: string,
  checkOut: string,
  reservations: Reservation[],
  roomBlockings: RoomBlocking[] = [],
  hotel: Hotel | null = null,
  excludeReservationId?: string
): boolean => {
  const start = startOfDay(parseISO(checkIn));
  const end = startOfDay(parseISO(checkOut));
  const today = startOfDay(new Date());

  // Check Reservations
  const hasConflict = reservations.some(r => {
    if (r.roomId !== roomId) return false;
    if (excludeReservationId && r.id === excludeReservationId) return false;
    if (r.status === 'cancelled' || r.status === 'checked_out' || r.status === 'no_show') return false;
    
    const resStart = startOfDay(parseISO(r.checkIn));
    const resEnd = startOfDay(parseISO(r.checkOut));

    // 1. If someone is CURRENTLY CHECKED IN to this room:
    // That person is physically occupying the room right now.
    if (r.status === 'checked_in') {
      // While checked in, the occupancy holds the room through today at minimum if past due
      const effectiveOccupancyEnd = resEnd <= today ? addDays(today, 1) : resEnd;

      // Overlap with the active checked-in stay:
      const overlapsActiveStay = doDateRangesOverlap(start, end, resStart, effectiveOccupancyEnd);
      if (overlapsActiveStay) return true;

      // Same-day check-in block: If the requested booking/check-in starts today or spans today,
      // and someone is already checked in, block it until they check out:
      if (start.getTime() === today.getTime() || (start <= today && end > today)) {
        return true;
      }

      return false;
    }

    // 2. For future / pending / confirmed reservations:
    // Overlap exists when: (New Check-In < Existing Check-Out) AND (New Check-Out > Existing Check-In)
    // No conflict exists when: (New Check-In >= Existing Check-Out) OR (New Check-Out <= Existing Check-In)
    return doDateRangesOverlap(start, end, resStart, resEnd);
  });

  if (hasConflict) return false;

  // Check Blockings if setting is enabled (or defaults to true)
  const preventBookingBlocked = hotel?.settings?.roomBlocking?.preventBookingBlocked ?? true;
  if (preventBookingBlocked) {
    const hasBlock = roomBlockings.some(b => {
      if (b.roomId !== roomId) return false;
      const blockStart = startOfDay(parseISO(b.startDate));
      const blockEnd = endOfDay(parseISO(b.endDate));
      return start <= blockEnd && end >= blockStart;
    });

    if (hasBlock) return false;
  }

  return true;
};
