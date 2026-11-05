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
  return room.status;
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
