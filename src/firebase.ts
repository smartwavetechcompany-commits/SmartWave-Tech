import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { OperationType, FirestoreErrorInfo } from "./types";

const firebaseConfig = {
  apiKey: "AIzaSyD9h2RSDPEajh6tTrsIC0LvX5mRoqpb9JQ",
  authDomain: "smartwave-pms.firebaseapp.com",
  projectId: "smartwave-pms",
  storageBucket: "smartwave-pms.firebasestorage.app",
  messagingSenderId: "622309837824",
  appId: "1:622309837824:web:6ca9cf2628c4dce5801ce5"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
// Use initializeFirestore to enable experimentalForceLongPolling
// This helps prevent "INTERNAL ASSERTION FAILED" errors in certain environments
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
});
export const storage = getStorage(app);

export function safeStringify(obj: any): string {
  const cache = new Set();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (cache.has(value)) {
        return '[Circular]';
      }
      cache.add(value);
    }
    return value;
  });
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', safeStringify(errInfo));
  throw new Error(safeStringify(errInfo));
}
