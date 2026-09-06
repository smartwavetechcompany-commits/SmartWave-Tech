import { Room, Reservation, RoomBlocking, Hotel } from '../types';
import { isWithinInterval, parseISO, startOfDay, endOfDay, addDays } from 'date-fns';

export type DisplayRoomStatus = Room['status'] | 'occupied' | 'reserved' | 'blocked';

export const getRoomDisplayStatus = (
  room: Room,
  reservations: Reservation[],
  roomBlockings: RoomBlocking[] = [],
  targetDate: Date = new Date()
): DisplayRoomStatus => {
  const date = startOfDay(targetDate);

  // 1. Check for active check-in (Highest priority)
  const activeReservation = reservations.find(r => 
    r.roomId === room.id && 
    r.status === 'checked_in'
  );
  if (activeReservation) return 'occupied';

  // 2. Check for manual blockings
  const isBlocked = roomBlockings.some(b => {
    if (b.roomId !== room.id) return false;
    const start = startOfDay(parseISO(b.startDate));
    const end = endOfDay(parseISO(b.endDate));
    return date >= start && date <= end;
  });
  if (isBlocked) return 'maintenance'; // or 'blocked' if we add it to type

  // 3. Check for confirmed reservations for today
  const hasReservation = reservations.some(r => 
    r.roomId === room.id && 
    (r.status === 'confirmed' || r.status === 'pending') &&
    isWithinInterval(date, {
      start: startOfDay(parseISO(r.checkIn)),
      end: endOfDay(parseISO(r.checkOut))
    })
  );
  if (hasReservation) return 'reserved';

  // 4. Return physical status (Clean/Dirty/Maintenance)
  return room.status;
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
    // The room CANNOT be checked into or booked for today (same day) until they check out!
    if (r.status === 'checked_in') {
      // While checked in, the occupancy holds the room through today at minimum.
      // Even if scheduled checkout was earlier today or in the past (overstay), until checkout happens,
      // the room is physically occupied today.
      const effectiveOccupancyEnd = resEnd <= today ? addDays(today, 1) : resEnd;

      // Overlap with the active checked-in stay:
      const overlapsActiveStay = start < effectiveOccupancyEnd && end > resStart;
      if (overlapsActiveStay) return true;

      // Same-day check-in block: If the requested booking/check-in starts today or spans today,
      // and someone is already checked in, block it until they check out:
      if (start.getTime() === today.getTime() || (start <= today && end > today)) {
        return true;
      }

      return false;
    }

    // 2. For future / pending / confirmed reservations:
    // Overlap if: (StartA < EndB) and (EndA > StartB)
    return start < resEnd && end > resStart;
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
