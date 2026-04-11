import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getDocFromServer, doc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { OperationType, FirestoreErrorInfo } from "./types";
import { safeStringify } from "./utils";
import firebaseConfig from "../firebase-applet-config.json";

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Use initializeFirestore with optimized settings for sandboxed environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
  ignoreUndefinedProperties: true,
});
export const storage = getStorage(app);

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
