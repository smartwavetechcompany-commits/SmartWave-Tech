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
});
export const storage = getStorage(app);

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error?.message || String(error),
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
  console.error('Firestore Error:', stringifiedErr);
  throw new Error(stringifiedErr);
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if(error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();
