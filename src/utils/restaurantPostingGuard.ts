import { Room, Reservation, RoomRestaurantPostingHistoryEntry, RoomRestaurantPostingRestriction } from '../types';
import { hasPermission } from './permissions';

export const RESTAURANT_POSTING_BLOCKED_MESSAGE =
  'Restaurant posting is blocked for this room. Please contact Front Desk.';

export const RESTAURANT_POSTING_PERMISSION_DENIED_MESSAGE =
  'Unauthorized: You do not have the "Block/Unblock Restaurant Posting for Rooms" permission.';

export function canManageRoomRestaurantPosting(
  profile: any,
  customRoles: any[] = []
): boolean {
  return hasPermission(profile, 'block_restaurant_posting', customRoles);
}

export function isRoomRestaurantPostingBlocked(room?: Partial<Room> | null): boolean {
  if (!room) return false;
  return Boolean(room.restaurantPostingBlocked || room.restaurantPostingRestriction?.isBlocked);
}

export function isRestaurantCategory(category?: string | null): boolean {
  const normalized = (category || '').toLowerCase().trim();
  return (
    normalized === 'f & b' ||
    normalized === 'f&b' ||
    normalized === 'restaurant' ||
    normalized === 'food' ||
    normalized === 'bar' ||
    normalized === 'room_service'
  );
}

export function findTargetRoomForOrder(
  rooms: Room[],
  params: {
    roomId?: string | null;
    roomNumber?: string | null;
    reservation?: Partial<Reservation> | null;
  }
): Room | undefined {
  const candidateRoomId = params.roomId || params.reservation?.roomId;
  if (candidateRoomId) {
    const byId = rooms.find(r => r.id === candidateRoomId);
    if (byId) return byId;
  }

  const candidateRoomNumber = params.roomNumber || params.reservation?.roomNumber;
  if (candidateRoomNumber && candidateRoomNumber !== 'Walk-in') {
    const normalized = String(candidateRoomNumber).trim().toLowerCase();
    return rooms.find(r => String(r.roomNumber || '').trim().toLowerCase() === normalized);
  }

  return undefined;
}

export function buildRoomRestaurantPostingUpdate(params: {
  room: Pick<Room, 'id' | 'roomNumber' | 'restaurantPostingHistory'>;
  block: boolean;
  reason: string;
  profile: any;
  customRoles?: any[];
  nowISO?: string;
}): {
  restaurantPostingBlocked: boolean;
  restaurantPostingRestriction: RoomRestaurantPostingRestriction;
  restaurantPostingHistory: RoomRestaurantPostingHistoryEntry[];
} {
  const { room, block, reason, profile, customRoles = [], nowISO } = params;

  if (!canManageRoomRestaurantPosting(profile, customRoles)) {
    throw new Error(RESTAURANT_POSTING_PERMISSION_DENIED_MESSAGE);
  }

  const trimmedReason = (reason || '').trim();
  if (!trimmedReason) {
    throw new Error(
      `A reason is required to ${block ? 'block' : 'unblock'} restaurant posting for Room ${room.roomNumber}.`
    );
  }

  const timestamp = nowISO || new Date().toISOString();
  const staffUid = profile?.uid || 'unknown';
  const staffName =
    profile?.displayName ||
    profile?.name ||
    profile?.email ||
    staffUid;
  const staffEmail = profile?.email || undefined;
  const action: 'blocked' | 'unblocked' = block ? 'blocked' : 'unblocked';

  const restriction: RoomRestaurantPostingRestriction = {
    isBlocked: block,
    reason: trimmedReason,
    updatedByUid: staffUid,
    updatedByName: staffName,
    ...(staffEmail ? { updatedByEmail: staffEmail } : {}),
    updatedAt: timestamp,
    action,
  };

  const newHistoryEntry: RoomRestaurantPostingHistoryEntry = {
    action,
    reason: trimmedReason,
    staffUid,
    staffName,
    ...(staffEmail ? { staffEmail } : {}),
    timestamp,
  };

  const existingHistory = Array.isArray(room.restaurantPostingHistory)
    ? room.restaurantPostingHistory
    : [];

  return {
    restaurantPostingBlocked: block,
    restaurantPostingRestriction: restriction,
    restaurantPostingHistory: [newHistoryEntry, ...existingHistory].slice(0, 50),
  };
}
