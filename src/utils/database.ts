import { 
  doc, 
  setDoc, 
  updateDoc, 
  addDoc, 
  deleteDoc,
  collection, 
  getDoc, 
  serverTimestamp,
  Firestore,
  DocumentReference,
  CollectionReference,
  DocumentData,
  WriteBatch,
  writeBatch
} from 'firebase/firestore';
import { db, auth } from '../firebase';
import { OperationType } from '../types';
import { errorService, ErrorSeverity } from '../services/errorService';
import { deepCloneSafe, safeStringify } from '../utils';

/**
 * Audit log entry structure
 */
interface AuditLogEntry {
  action: string;
  userId: string;
  userEmail: string;
  userName?: string;
  hotelId: string;
  timestamp: any;
  module: string;
  details: string;
  status: 'success' | 'failure';
  metadata?: any;
}

/**
 * Creates an audit log in Firestore
 */
export async function createAuditLog(
  hotelId: string, 
  module: string, 
  action: string, 
  details: string, 
  status: 'success' | 'failure' = 'success',
  metadata?: any,
  userContext?: { uid?: string; email?: string; role?: string; displayName?: string }
) {
  try {
    const user = auth.currentUser;
    const logData: any = {
      action,
      userId: userContext?.uid || user?.uid || 'system',
      userEmail: userContext?.email || user?.email || 'system',
      userName: userContext?.displayName || user?.displayName || userContext?.email || user?.email || 'System',
      userRole: userContext?.role || 'staff',
      hotelId,
      timestamp: serverTimestamp(),
      module,
      details,
      status,
      metadata: metadata ? deepCloneSafe(metadata) : undefined
    };

    // We use addDoc for append-only logging
    const isSystemLog = hotelId.toLowerCase() === 'system' || hotelId.toLowerCase() === 'global' || hotelId.toLowerCase() === 'none';
    if (isSystemLog) {
      await addDoc(collection(db, 'activityLogs'), logData);
    } else {
      await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), logData);
    }
  } catch (error) {
    // Log failures to create audit logs as system errors
    await errorService.handleError(error, { 
      module: 'AuditLog', 
      severity: ErrorSeverity.MEDIUM, 
      silent: true 
    });
  }
}

/**
 * Safe write utility to prevent accidental overwrites and enforce auditing
 */
export const database = {
  /**
   * Safely updates a document with merge: true
   */
  async safeSet<T extends DocumentData>(
    docRef: DocumentReference<T>, 
    data: Partial<T>, 
    options: { hotelId: string; module: string; action: string; details: string; metadata?: any; userContext?: { uid?: string; email?: string; role?: string } }
  ) {
    try {
      // Production guard: Always default to merge: true to prevent accidental overwrites
      await setDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      const cleanedData = deepCloneSafe(data);
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docPath: docRef.path,
        data: cleanedData,
        ...(options.metadata || {})
      }, options.userContext);
      return { success: true, id: docRef.id };
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        docPath: docRef.path
      }, options.userContext);
      
      await errorService.handleError(error, { 
        module: options.module, 
        severity: ErrorSeverity.HIGH 
      });
      throw error;
    }
  },

  /**
   * Safely updates an existing document
   */
  async safeUpdate<T extends DocumentData>(
    docRef: DocumentReference<T>, 
    data: Partial<T>, 
    options: { hotelId: string; module: string; action: string; details: string; metadata?: any; userContext?: { uid?: string; email?: string; role?: string } }
  ) {
    try {
      // Fetch old values for audit trail
      const oldDoc = await getDoc(docRef);
      const oldData = oldDoc.exists() ? oldDoc.data() : null;

      await updateDoc(docRef, {
        ...(data as any),
        updatedAt: serverTimestamp()
      });
      const cleanedNewData = deepCloneSafe(data);
      const cleanedOldData = oldData ? deepCloneSafe(oldData) : null;
      
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docPath: docRef.path,
        newData: cleanedNewData,
        oldData: cleanedOldData,
        ...(options.metadata || {}),
        changes: oldData && !options.metadata?.changes ? Object.keys(data).reduce((acc: any, key) => {
          const oldVal = oldData[key];
          const newVal = (data as any)[key];
          // Use safeStringify for comparison to handle circular structures
          if (safeStringify(oldVal) !== safeStringify(newVal)) {
            acc[key] = { from: oldVal, to: newVal };
          }
          return acc;
        }, {}) : (options.metadata?.changes || 'New document fields')
      }, options.userContext);
      return { success: true };
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        docPath: docRef.path
      }, options.userContext);

      await errorService.handleError(error, { 
        module: options.module, 
        severity: ErrorSeverity.HIGH 
      });
      throw error;
    }
  },

  /**
   * Safely adds a new document to a collection (append-only)
   */
  async safeAdd<T extends DocumentData>(
    colRef: CollectionReference<T>, 
    data: T, 
    options: { hotelId: string; module: string; action: string; details: string; metadata?: any; userContext?: { uid?: string; email?: string; role?: string } }
  ) {
    try {
      const docRef = await addDoc(colRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      const cleanedData = deepCloneSafe(data);
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docId: docRef.id,
        colPath: colRef.path,
        data: cleanedData,
        ...(options.metadata || {})
      }, options.userContext);
      return docRef;
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        colPath: colRef.path
      }, options.userContext);

      await errorService.handleError(error, { 
        module: options.module, 
        severity: ErrorSeverity.HIGH 
      });
      throw error;
    }
  },

  /**
   * Commits a batch with a unified audit log
   */
  async commitBatch(
    hotelId: string,
    batch: WriteBatch,
    options: { module: string; action: string; details: string; userContext?: { uid?: string; email?: string; role?: string } }
  ) {
    try {
      await batch.commit();
      await createAuditLog(hotelId, options.module, options.action, options.details, 'success', undefined, options.userContext);
      return { success: true };
    } catch (error) {
      await createAuditLog(hotelId, options.module, options.action, options.details, 'failure', { error: String(error) }, options.userContext);
      
      await errorService.handleError(error, { 
        module: options.module, 
        severity: ErrorSeverity.HIGH 
      });
      throw error;
    }
  },

  /**
   * Transactional append (e.g. for financial data)
   */
  async appendTransaction<T extends DocumentData>(
    hotelId: string,
    data: T,
    options: { module: string; action: string; details: string }
  ) {
    const transactionsRef = collection(db, 'hotels', hotelId, 'transactions');
    return this.safeAdd(transactionsRef as any, data, {
      hotelId,
      module: options.module,
      action: options.action || 'TRANSACTION_CREATE',
      details: options.details
    });
  },

  /**
   * Safely deletes a document
   */
  async safeDelete(
    docRef: DocumentReference<any>, 
    options: { hotelId: string; module: string; action: string; details: string; userContext?: { uid?: string; email?: string; role?: string } }
  ) {
    try {
      await deleteDoc(docRef);
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docPath: docRef.path
      }, options.userContext);
      return { success: true };
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        docPath: docRef.path
      }, options.userContext);

      await errorService.handleError(error, { 
        module: options.module, 
        severity: ErrorSeverity.HIGH 
      });
      throw error;
    }
  }
};
