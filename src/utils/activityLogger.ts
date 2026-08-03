import { collection, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { AuditLog } from '../types';
import { deepCloneSafe } from '../utils';

export const logActivity = async (
  hotelId: string,
  profile: any,
  action: string,
  module: string,
  details: string,
  targetId?: string,
  oldValue?: any,
  newValue?: any
) => {
  if (!hotelId) return;
  try {
    const log: Omit<AuditLog, 'id'> = {
      hotelId,
      userId: profile?.uid || 'system',
      userEmail: profile?.email || '',
      userName: profile?.displayName || profile?.email || 'System',
      userRole: profile?.role || profile?.staffRole || 'staff',
      action,
      module,
      details,
      timestamp: new Date().toISOString(),
      targetId,
      oldValue: oldValue ? deepCloneSafe(oldValue) : null,
      newValue: newValue ? deepCloneSafe(newValue) : null,
    };

    // Non-blocking fire-and-forget background log
    addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), log).catch((error) => {
      console.warn('Failed to dispatch activity log:', error);
    });
  } catch (error) {
    console.warn('Failed to log activity:', error);
  }
};
