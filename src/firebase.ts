import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getDocFromServer, doc, collection, addDoc, serverTimestamp, setDoc, getDoc, increment, deleteDoc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { OperationType, FirestoreErrorInfo } from "./types";
import { safeStringify } from "./utils";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);

export { serverTimestamp, increment };

export const auth = getAuth(app);
// Use initializeFirestore with optimized settings for sandboxed environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  ignoreUndefinedProperties: true,
});
export const storage = getStorage(app);

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
    console.log("Firestore connection successful");
  } catch (error) {
    if (error instanceof Error && (error.message.includes('the client is offline') || error.message.includes('Could not reach Cloud Firestore backend'))) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  // Extract a clean error message
  const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown Firestore error');
  
  // Check if it's an offline error to avoid excessive logging
  const isOfflineError = errorMessage.toLowerCase().includes('offline') || 
                        error?.code === 'unavailable' || 
                        error?.code === 'network-request-failed';

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName || '',
        email: provider.email || '',
        photoUrl: provider.photoURL || ''
      })) || []
    },
    operationType,
    path
  }
  
  const stringifiedErr = safeStringify(errInfo);
  
  if (isOfflineError) {
    console.warn('Firestore Offline:', errorMessage, path);
  } else {
    console.error('Firestore Error:', stringifiedErr);
  }
  
  // Create a clean error object to avoid circular references in the error itself
  const cleanError = new Error(errorMessage);
  (cleanError as any).details = stringifiedErr;
  (cleanError as any).code = error?.code;
  
  throw cleanError;
}

/**
 * Creates an audit log entry for any database write.
 */
export async function createAuditLog(hotelId: string, action: string, details: any) {
  if (!hotelId || !db) return;
  const user = auth.currentUser;
  try {
    await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
      action,
      userId: user?.uid || 'system',
      userEmail: user?.email || 'system',
      timestamp: serverTimestamp(),
      details,
      createdAt: serverTimestamp()
    });
  } catch (error) {
    console.error("Failed to create audit log:", error);
  }
}

/**
 * Ensures data is added safely to a collection with auditing and timestamps.
 */
export async function safeAdd(
  colRef: any,
  data: any,
  hotelId: string,
  actionName: string
) {
  try {
    const dataWithTimestamp = {
      ...data,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };

    const docRef = await addDoc(colRef, dataWithTimestamp);
    
    // Audit Logging
    await createAuditLog(hotelId, actionName, { 
      path: docRef.path,
      fields: Object.keys(data) 
    });

    return docRef;
  } catch (error) {
    console.error(`SafeAdd Error [${actionName}]:`, error);
    handleFirestoreError(error, OperationType.CREATE, colRef.path);
    throw error;
  }
}

/**
 * Ensures data is written safely using merge:true or updateDoc
 * and verifies persistence.
 */
export async function safeWrite(
  docRef: any,
  data: any,
  hotelId: string,
  actionName: string,
  options: { isNew?: boolean } = {}
) {
  try {
    const dataWithTimestamp = {
      ...data,
      updatedAt: serverTimestamp(),
      ...(options.isNew ? { createdAt: serverTimestamp() } : {})
    };

    if (options.isNew) {
      await setDoc(docRef, dataWithTimestamp);
    } else {
      await setDoc(docRef, dataWithTimestamp, { merge: true });
    }

    // Verification check (debounced or minor delay might be needed in some environments, 
    // but for Cloud Firestore immediate getDoc normally sees the local cache update)
    const verifyDoc = await getDoc(docRef);
    if (!verifyDoc.exists()) {
      throw new Error(`Data persistence verification failed for: ${actionName}`);
    }

    // Audit Logging
    await createAuditLog(hotelId, actionName, { 
      path: docRef.path || 'unknown',
      fields: Object.keys(data).filter(k => k !== 'createdAt' && k !== 'updatedAt') 
    });

    return true;
  } catch (error) {
    console.error(`SafeWrite Error [${actionName}]:`, error);
    handleFirestoreError(error, options.isNew ? OperationType.CREATE : OperationType.UPDATE, docRef.path);
    throw error;
  }
}

/**
 * Ensures a document is deleted safely with auditing.
 */
export async function safeDelete(
  docRef: any,
  hotelId: string,
  actionName: string
) {
  try {
    const path = docRef.path;
    await deleteDoc(docRef);
    
    // Audit Logging
    await createAuditLog(hotelId, actionName, { 
      path,
      action: 'DELETED'
    });

    return true;
  } catch (error) {
    console.error(`SafeDelete Error [${actionName}]:`, error);
    handleFirestoreError(error, OperationType.DELETE, docRef.path);
    throw error;
  }
}
