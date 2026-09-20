import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { AuditLog } from '../types';
import { deepCloneSafe } from '../utils';

export interface LogActivityExtra {
  reservationId?: string;
  guestId?: string;
  roomNumber?: string;
  guestName?: string;
  metadata?: any;
  status?: 'success' | 'failure';
}

export const logActivity = async (
  hotelId: string,
  profile: any,
  action: string,
  module: string,
  details: string,
  targetId?: string,
  oldValue?: any,
  newValue?: any,
  extra?: LogActivityExtra
) => {
  if (!hotelId) return;
  try {
    // Infer reservationId and guestId if not explicitly provided
    let reservationId = extra?.reservationId;
    let guestId = extra?.guestId;
    let roomNumber = extra?.roomNumber;
    let guestName = extra?.guestName;

    if (!reservationId && targetId && !targetId.startsWith('guest_') && !targetId.startsWith('room_')) {
      reservationId = targetId;
    }
    if (!reservationId && newValue?.reservationId) reservationId = newValue.reservationId;
    if (!reservationId && oldValue?.reservationId) reservationId = oldValue.reservationId;

    if (!guestId && newValue?.guestId) guestId = newValue.guestId;
    if (!guestId && oldValue?.guestId) guestId = oldValue.guestId;

    if (!roomNumber && newValue?.roomNumber) roomNumber = newValue.roomNumber;
    if (!roomNumber && oldValue?.roomNumber) roomNumber = oldValue.roomNumber;

    if (!guestName && newValue?.guestName) guestName = newValue.guestName;
    if (!guestName && oldValue?.guestName) guestName = oldValue.guestName;

    const log: Omit<AuditLog, 'id'> = {
      hotelId,
      userId: profile?.uid || 'system',
      userEmail: profile?.email || '',
      userName: profile?.displayName || profile?.name || profile?.email || 'System Staff',
      userRole: profile?.role || profile?.staffRole || 'staff',
      action,
      module,
      details,
      timestamp: new Date().toISOString(),
      targetId: targetId || reservationId,
      reservationId: reservationId || undefined,
      guestId: guestId || undefined,
      roomNumber: roomNumber ? String(roomNumber) : undefined,
      guestName: guestName ? String(guestName) : undefined,
      status: extra?.status || 'success',
      oldValue: oldValue ? deepCloneSafe(oldValue) : null,
      newValue: newValue ? deepCloneSafe(newValue) : null,
      metadata: extra?.metadata ? deepCloneSafe(extra.metadata) : null,
    };

    // Non-blocking fire-and-forget background log
    await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), log).catch((error) => {
      console.warn('Failed to dispatch activity log:', error);
    });
  } catch (error) {
    console.warn('Failed to log activity:', error);
  }
};
