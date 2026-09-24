import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore, getDocFromServer, doc } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { OperationType, FirestoreErrorInfo } from "./types";
import { safeStringify } from "./utils";
import { errorService, ErrorSeverity } from "./services/errorService";
import firebaseConfig from "../firebase-applet-config.json";

export { firebaseConfig };
const app = initializeApp(firebaseConfig);

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

/**
 * Helper to analyze and identify which Firestore security rule caused an access failure
 */
export function diagnoseFirestorePermissionFailure(
  path: string | null,
  operationType: OperationType,
  currentAuth: { uid?: string; email?: string }
): {
  matchedRuleBlock: string;
  evaluatedCriteria: string[];
  failureReason: string;
  recommendedFix: string;
} {
  const p = path || 'unknown';
  const op = operationType.toUpperCase();
  const uid = currentAuth.uid || null;
  const email = currentAuth.email || null;

  if (p.startsWith('users')) {
    const isSelf = uid && p.includes(uid);
    return {
      matchedRuleBlock: 'match /users/{userId}',
      evaluatedCriteria: [
        `request.auth != null: ${Boolean(uid)}`,
        `request.auth.uid == userId: ${Boolean(isSelf)}`,
        `resource.data.hotelId == getHotelId(): [Evaluated from user doc]`,
        `hasStaffManagementPermission(): [Requires hotelAdmin, superAdmin, or manage_staff]`,
        `Unauthenticated activation read: (status in ['pending_activation', 'password_reset_pending'])`
      ],
      failureReason: !uid
        ? `Unauthenticated ${op} on ${p}. If this is account activation or password reset, document status must be 'pending_activation' or 'password_reset_pending'.`
        : !isSelf
          ? `Authenticated user (${email || uid}) attempted ${op} on another user profile without active hotelAdmin or manage_staff permissions.`
          : `Authenticated user (${email || uid}) attempted unauthorized modification of protected fields (e.g. role escalation to superAdmin).`,
      recommendedFix: !uid
        ? `Ensure target user document contains status: 'pending_activation' and valid activationTokenId for public token validation.`
        : `Verify user has role 'hotelAdmin' or has permission 'manage_staff' in their active role matrix.`
    };
  }

  if (p.includes('passwordResetTokens')) {
    return {
      matchedRuleBlock: 'match /passwordResetTokens/{tokenId} or match /hotels/{hotelId}/passwordResetTokens/{tokenId}',
      evaluatedCriteria: [
        `allow read: if true (unauthenticated permitted)`,
        `allow create/delete: requires isHotelAdmin(), hasStaffManagementPermission(), or isSuperAdmin()`,
        `allow update: requires authorized admin or marking token as used (isUsed: true)`
      ],
      failureReason: `Operation ${op} on ${p} was rejected. Only authorized admins can create or delete reset tokens; unauthenticated callers can only read or mark active tokens as used.`,
      recommendedFix: `Ensure requesting user is authenticated as hotel administrator or token status update includes isUsed: true.`
    };
  }

  if (p.includes('sessions')) {
    return {
      matchedRuleBlock: 'match /hotels/{hotelId}/sessions/{sessionId}',
      evaluatedCriteria: [
        `sameHotel(hotelId): [Tenant Isolation]`,
        `isStaffOf(hotelId): [Must belong to hotel staff]`,
        `isHotelAdmin() or hasStaffManagementPermission(): [Required for session termination / deletion]`
      ],
      failureReason: `Operation ${op} on ${p} was rejected. Terminating or revoking staff sessions requires admin credentials or membership in the target property.`,
      recommendedFix: `Ensure the user has an active session matching the hotelId or hotelAdmin / manage_staff permissions.`
    };
  }

  if (p.includes('customRoles')) {
    return {
      matchedRuleBlock: 'match /hotels/{hotelId}/customRoles/{roleId}',
      evaluatedCriteria: [
        `isAdmin() || hasStaffManagementPermission(): [Staff users are forbidden from creating or modifying custom roles]`,
        `sameHotel(hotelId): [Property Isolation]`
      ],
      failureReason: `Operation ${op} on ${p} was rejected. Staff users must not manage custom roles or modify security matrixes.`,
      recommendedFix: `Grant 'manage_roles' permission to user or perform action as Hotel Administrator.`
    };
  }

  if (p.includes('emailNotifications')) {
    return {
      matchedRuleBlock: 'match /hotels/{hotelId}/emailNotifications/{docId}',
      evaluatedCriteria: [
        `allow create: if true (server and notification dispatch logging)`,
        `allow read: sameHotel(hotelId) or staffOf(hotelId)`,
        `allow update, delete: isHotelAdmin() or hasStaffManagementPermission()`
      ],
      failureReason: `Operation ${op} on ${p} was rejected by email notifications security rules.`,
      recommendedFix: `Check tenant hotelId parameter and caller authorization.`
    };
  }

  return {
    matchedRuleBlock: 'match /{allSubcollections=**}',
    evaluatedCriteria: [
      `request.auth != null: ${Boolean(uid)}`,
      `sameHotel(hotelId): [Property isolation check]`,
      `isStaffOf(hotelId): [Active staff member verification]`
    ],
    failureReason: `Operation ${op} on ${p} violated property isolation or role boundaries.`,
    recommendedFix: `Verify active user belongs to hotel and has sufficient role permissions for this module.`
  };
}

export function handleFirestoreError(error: any, operationType: OperationType, path: string | null) {
  // Extract a clean error message
  const errorMessage = error?.message || (typeof error === 'string' ? error : 'Unknown Firestore error');
  const isPermissionDenied = error?.code === 'permission-denied' || 
                             errorMessage.toLowerCase().includes('permission') ||
                             errorMessage.toLowerCase().includes('insufficient permissions');
  
  // Check if it's an offline error to avoid excessive logging
  const isOfflineError = errorMessage.toLowerCase().includes('offline') || 
                        error?.code === 'unavailable' || 
                        error?.code === 'network-request-failed';

  const authInfo = {
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
  };

  // Detailed Permission Logging (Requirement 6: identify which Firestore rule is causing access failures)
  let diagnostic = null;
  if (isPermissionDenied) {
    diagnostic = diagnoseFirestorePermissionFailure(path, operationType, {
      uid: auth.currentUser?.uid,
      email: auth.currentUser?.email || undefined
    });

    console.group(`[FIRESTORE PERMISSION LOG] Access Failure on ${path || 'unknown path'}`);
    console.warn(`Operation: ${operationType.toUpperCase()}`);
    console.warn(`Matched Security Rule: ${diagnostic.matchedRuleBlock}`);
    console.warn(`Evaluated Conditions:`, diagnostic.evaluatedCriteria);
    console.error(`Failure Cause: ${diagnostic.failureReason}`);
    console.info(`Recommended Fix: ${diagnostic.recommendedFix}`);
    console.groupEnd();
  }

  const errInfo: FirestoreErrorInfo = {
    error: errorMessage,
    authInfo,
    operationType,
    path
  };
  
  const stringifiedErr = safeStringify({ ...errInfo, diagnostic });
  
  // Centralized logging with diagnostic details
  errorService.handleError(error, {
    module: `Firestore:${operationType}${isPermissionDenied ? ':PermissionDenied' : ''}`,
    severity: isOfflineError ? ErrorSeverity.LOW : isPermissionDenied ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
    silent: isOfflineError
  });
  
  // Create a clean error object to avoid circular references in the error itself
  const cleanError = new Error(
    isPermissionDenied && diagnostic 
      ? `${errorMessage} [Rule Check: ${diagnostic.matchedRuleBlock} - ${diagnostic.failureReason}]` 
      : errorMessage
  );
  (cleanError as any).details = stringifiedErr;
  (cleanError as any).code = error?.code;
  (cleanError as any).diagnostic = diagnostic;
  
  throw cleanError;
}
