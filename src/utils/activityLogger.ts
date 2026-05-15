import { collection, doc, addDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { AuditLog } from '../types';

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
  try {
    const log: Omit<AuditLog, 'id'> = {
      hotelId,
      userId: profile.uid,
      userEmail: profile.email,
      userName: profile.displayName || profile.email,
      userRole: profile.role || profile.staffRole || 'staff',
      action,
      module,
      details,
      timestamp: new Date().toISOString(),
      targetId,
      oldValue: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
      newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
    };

    // Log to hotel-specific audit logs
    await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), log);
  } catch (error) {
    console.error('Failed to log activity:', error);
  }
};
