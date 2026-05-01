import { 
  doc, 
  setDoc, 
  updateDoc, 
  addDoc, 
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

/**
 * Audit log entry structure
 */
interface AuditLogEntry {
  action: string;
  userId: string;
  userEmail: string;
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
  metadata?: any
) {
  try {
    const user = auth.currentUser;
    const logData: AuditLogEntry = {
      action,
      userId: user?.uid || 'system',
      userEmail: user?.email || 'system',
      hotelId,
      timestamp: serverTimestamp(),
      module,
      details,
      status,
      metadata
    };

    // We use addDoc for append-only logging
    await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), logData);
  } catch (error) {
    console.error('Audit logging failed:', error);
    // We don't throw here to avoid breaking the main operation, 
    // but in a real production system we might want higher guarantees.
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
    options: { hotelId: string; module: string; action: string; details: string }
  ) {
    try {
      // Production guard: Always default to merge: true to prevent accidental overwrites
      await setDoc(docRef, {
        ...data,
        updatedAt: serverTimestamp()
      }, { merge: true });
      
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docPath: docRef.path
      });
      return { success: true, id: docRef.id };
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        docPath: docRef.path
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
    options: { hotelId: string; module: string; action: string; details: string }
  ) {
    try {
      await updateDoc(docRef, {
        ...(data as any),
        updatedAt: serverTimestamp()
      });
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docPath: docRef.path
      });
      return { success: true };
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        docPath: docRef.path
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
    options: { hotelId: string; module: string; action: string; details: string }
  ) {
    try {
      const docRef = await addDoc(colRef, {
        ...data,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'success', {
        docId: docRef.id,
        colPath: colRef.path
      });
      return docRef;
    } catch (error) {
      await createAuditLog(options.hotelId, options.module, options.action, options.details, 'failure', { 
        error: String(error),
        colPath: colRef.path
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
    options: { module: string; action: string; details: string }
  ) {
    try {
      await batch.commit();
      await createAuditLog(hotelId, options.module, options.action, options.details, 'success');
      return { success: true };
    } catch (error) {
      await createAuditLog(hotelId, options.module, options.action, options.details, 'failure', { error: String(error) });
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
  }
};
