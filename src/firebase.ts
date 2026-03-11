import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";

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
// Note: experimentalForceLongPolling and experimentalAutoDetectLongPolling are mutually exclusive.
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
  experimentalAutoDetectLongPolling: false,
});
export const storage = getStorage(app);
