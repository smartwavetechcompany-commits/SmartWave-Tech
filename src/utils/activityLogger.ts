import { collection, addDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { AuditLog } from '../types';
import { deepCloneSafe } from '../utils';
import { settingsManager } from '../services/settingsManager';

export interface LogActivityExtra {
  reservationId?: string;
  guestId?: string;
  roomNumber?: string;
  guestName?: string;
  metadata?: any;
  status?: 'success' | 'failure';
}

export function shouldLogActivity(moduleName: string, actionName: string): boolean {
  const settings = settingsManager.getSettings();
  const auditSettings = settings?.auditLogs;
  const staffSettings = settings?.staff;

  const act = (actionName || '').toUpperCase();
  const mod = (moduleName || '').toLowerCase();

  // Always preserve Admin Controls & City Ledger financial audit trail
  if (act.includes('ADMIN_SETTINGS') || mod === 'admin settings' || mod === 'configuration engine' || mod === 'city ledger') {
    return true;
  }

  if (auditSettings?.enableFullLogging === false || staffSettings?.allowActivityTracking === false) {
    return false;
  }

  if (auditSettings) {
    if (auditSettings.trackDeletions === false && (act.includes('DELETE') || act.includes('VOID') || act.includes('REMOVE'))) {
      return false;
    }
    if (auditSettings.trackAuthEvents === false && (mod === 'auth' || act.includes('LOGIN') || act.includes('LOGOUT') || act.includes('PASSWORD') || act.includes('SESSION'))) {
      return false;
    }
    if (auditSettings.trackPayments === false && (mod === 'finance' || mod === 'ledger' || act.includes('PAYMENT') || act.includes('REFUND') || act.includes('SETTLE') || act.includes('LEDGER') || act.includes('DISCOUNT'))) {
      return false;
    }
    if (auditSettings.trackReservations === false && (mod === 'front desk' || mod === 'reservations' || act.includes('RESERVATION') || act.includes('CHECK_IN') || act.includes('CHECKIN') || act.includes('CHECK_OUT') || act.includes('CHECKOUT') || act.includes('BOOKING'))) {
      return false;
    }
    if (auditSettings.trackRoomChanges === false && (mod === 'rooms' || mod === 'housekeeping' || mod === 'maintenance' || act.includes('ROOM') || act.includes('BLOCK') || act.includes('HOUSEKEEPING'))) {
      return false;
    }
  }

  return true;
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
  if (!shouldLogActivity(module, action)) return;
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
