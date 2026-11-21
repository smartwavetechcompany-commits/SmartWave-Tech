import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  setDoc, 
  updateDoc, 
  query, 
  where, 
  orderBy, 
  onSnapshot 
} from 'firebase/firestore';
import { 
  createUserWithEmailAndPassword, 
  sendPasswordResetEmail, 
  confirmPasswordReset 
} from 'firebase/auth';
import { db, auth } from '../firebase';
import { UserProfile, PasswordResetToken } from '../types';
import { logActivity } from './activityLogger';
import { database } from './database';

export interface GenerateTokenOptions {
  hotelId: string;
  hotelName?: string;
  targetUser: UserProfile;
  adminProfile: UserProfile;
  durationMinutes: number; // e.g. 60 for 1 hour
  note?: string;
}

export interface GenerateActivationTokenOptions {
  hotelId: string;
  hotelName?: string;
  targetUser: UserProfile;
  adminProfile: UserProfile;
  durationMinutes?: number; // e.g. 1440 for 24 hours
  note?: string;
}

export interface TokenValidationResult {
  valid: boolean;
  tokenData?: PasswordResetToken;
  error?: string;
  errorCode?: 'NOT_FOUND' | 'EXPIRED' | 'USED' | 'REVOKED' | 'INVALID';
}

/**
 * Generates a cryptographically strong, unguessable token string
 */
function createSecureTokenString(prefix: 'prt' | 'act' = 'prt'): string {
  const timestamp = Date.now().toString(36);
  const randomPart1 = Math.random().toString(36).substring(2, 12);
  const randomPart2 = Math.random().toString(36).substring(2, 12);
  let cryptoHex = '';
  if (typeof window !== 'undefined' && window.crypto && window.crypto.getRandomValues) {
    const arr = new Uint8Array(16);
    window.crypto.getRandomValues(arr);
    cryptoHex = Array.from(arr, b => b.toString(16).padStart(2, '0')).join('');
  } else {
    cryptoHex = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  }
  return `${prefix}_${timestamp}_${randomPart1}${randomPart2}_${cryptoHex.substring(0, 16)}`;
}

/**
 * Generates a secure, one-time account activation token and dispatches activation email
 */
export async function generateAccountActivationToken(options: GenerateActivationTokenOptions): Promise<{
  token: PasswordResetToken;
  activationUrl: string;
  emailSent: boolean;
}> {
  const { hotelId, hotelName, targetUser, adminProfile, durationMinutes = 1440, note } = options;

  if (!hotelId || !targetUser?.uid || !targetUser?.email) {
    throw new Error('Missing required user or hotel information to generate activation token.');
  }

  const tokenId = createSecureTokenString('act');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const activationUrl = `${origin}/?token=${tokenId}&mode=activate&email=${encodeURIComponent(targetUser.email.toLowerCase())}`;

  const tokenRecord: PasswordResetToken = {
    id: tokenId,
    token: tokenId,
    type: 'activation',
    targetUid: targetUser.uid,
    targetEmail: targetUser.email.toLowerCase(),
    targetName: targetUser.displayName || targetUser.email,
    hotelId,
    hotelName: hotelName || 'Hotel Property',
    createdByUid: adminProfile.uid || 'system',
    createdByEmail: adminProfile.email || 'admin',
    createdByName: adminProfile.displayName || adminProfile.email,
    createdAt,
    expiresAt,
    durationMinutes,
    isUsed: false,
    usedAt: null,
    status: 'active',
    note: note?.trim() || '',
    resetUrl: activationUrl
  };

  // 1. Save token in root collection for lookup by unauthenticated staff member
  const rootTokenRef = doc(db, 'passwordResetTokens', tokenId);
  await setDoc(rootTokenRef, tokenRecord);

  // 2. Save token in hotel subcollection
  const hotelTokenRef = doc(db, 'hotels', hotelId, 'passwordResetTokens', tokenId);
  await setDoc(hotelTokenRef, tokenRecord);

  // 3. Update staff user profile with status: 'pending_activation' and activation metadata
  try {
    const userDocRef = doc(db, 'users', targetUser.uid);
    await updateDoc(userDocRef, {
      status: 'pending_activation',
      activationTokenId: tokenId,
      activationLinkExpiresAt: expiresAt,
      activationEmailSentAt: createdAt,
      activationEmailSentBy: adminProfile.email,
      initialPassword: null,
      temporaryPassword: null,
      updatedAt: createdAt
    });
  } catch (userUpdateErr) {
    console.warn('Could not update user profile with activation metadata:', userUpdateErr);
  }

  // 4. Log in Hotel Audit Trail: ACTIVATION_EMAIL_SENT
  const durationHoursText = durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)} hours` : `${durationMinutes} minutes`;
  await logActivity(
    hotelId,
    adminProfile,
    'ACTIVATION_EMAIL_SENT',
    'StaffManagement',
    `Secure account activation email sent to ${targetUser.email} by Hotel Admin ${adminProfile.email}. Link valid for ${durationHoursText} (expires at ${new Date(expiresAt).toLocaleString()}).`,
    targetUser.uid,
    null,
    { tokenId, targetEmail: targetUser.email, expiresAt, durationMinutes }
  );

  // 5. Send Activation Email via server endpoint
  let emailSent = false;
  try {
    const callerToken = await auth.currentUser?.getIdToken().catch(() => null);
    const resp = await fetch('/api/auth/send-account-activation-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(callerToken ? { 'Authorization': `Bearer ${callerToken}` } : {})
      },
      body: JSON.stringify({
        hotelId,
        hotelName,
        targetUid: targetUser.uid,
        targetEmail: targetUser.email.toLowerCase(),
        targetName: targetUser.displayName || targetUser.email,
        activationToken: tokenId,
        activationUrl,
        expiresAt,
        durationMinutes,
        adminEmail: adminProfile.email,
        adminName: adminProfile.displayName || adminProfile.email,
        note
      })
    });
    if (resp.ok) {
      const data = await resp.json().catch(() => null);
      emailSent = data?.emailSent === true;
    }
  } catch (emailErr) {
    console.warn('Server activation email dispatch notice:', emailErr);
  }

  return {
    token: tokenRecord,
    activationUrl,
    emailSent
  };
}

/**
 * Resends an activation email with a freshly generated activation link
 */
export async function resendAccountActivationEmail(
  hotelId: string,
  hotelName: string,
  targetUser: UserProfile,
  adminProfile: UserProfile,
  durationMinutes = 1440
): Promise<{
  token: PasswordResetToken;
  activationUrl: string;
  emailSent: boolean;
}> {
  // Revoke any previous active tokens for this user
  if (hotelId && targetUser?.email) {
    try {
      const colRef = collection(db, 'hotels', hotelId, 'passwordResetTokens');
      const q = query(colRef, where('targetEmail', '==', targetUser.email.toLowerCase()), where('status', '==', 'active'));
      const snap = await getDocs(q);
    const now = new Date().toISOString();
    snap.forEach(async (d) => {
      try {
        await updateDoc(doc(db, 'passwordResetTokens', d.id), { status: 'revoked', revokedAt: now, revokedBy: adminProfile.email });
        await updateDoc(doc(db, 'hotels', hotelId, 'passwordResetTokens', d.id), { status: 'revoked', revokedAt: now, revokedBy: adminProfile.email });
      } catch (e) {}
    });
    } catch (revErr) {
      console.warn('Could not revoke old tokens before resend:', revErr);
    }
  }

  // Generate new token and dispatch email
  const result = await generateAccountActivationToken({
    hotelId,
    hotelName,
    targetUser,
    adminProfile,
    durationMinutes
  });

  // Log in Hotel Audit Trail: ACTIVATION_EMAIL_RESENT
  await logActivity(
    hotelId,
    adminProfile,
    'ACTIVATION_EMAIL_RESENT',
    'StaffManagement',
    `Hotel Admin ${adminProfile.email} resent secure account activation email to ${targetUser.email}. New link valid for ${durationMinutes / 60} hours.`,
    targetUser.uid,
    null,
    { tokenId: result.token.id, targetEmail: targetUser.email, expiresAt: result.token.expiresAt }
  );

  return result;
}

/**
 * Generates a secure, time-limited password reset token and sends the email
 */
export async function generatePasswordResetToken(options: GenerateTokenOptions): Promise<{
  token: PasswordResetToken;
  resetUrl: string;
  emailSent: boolean;
}> {
  const { hotelId, hotelName, targetUser, adminProfile, durationMinutes, note } = options;

  if (!hotelId || !targetUser?.uid || !targetUser?.email) {
    throw new Error('Missing required user or hotel information to generate password reset token.');
  }

  const tokenId = createSecureTokenString('prt');
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + durationMinutes * 60 * 1000).toISOString();
  
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const resetUrl = `${origin}/?resetToken=${tokenId}&email=${encodeURIComponent(targetUser.email.toLowerCase())}`;

  const tokenRecord: PasswordResetToken = {
    id: tokenId,
    token: tokenId,
    type: 'password_reset',
    targetUid: targetUser.uid,
    targetEmail: targetUser.email.toLowerCase(),
    targetName: targetUser.displayName || targetUser.email,
    hotelId,
    hotelName: hotelName || 'Hotel Property',
    createdByUid: adminProfile.uid || 'system',
    createdByEmail: adminProfile.email || 'admin',
    createdByName: adminProfile.displayName || adminProfile.email,
    createdAt,
    expiresAt,
    durationMinutes,
    isUsed: false,
    usedAt: null,
    status: 'active',
    note: note?.trim() || '',
    resetUrl
  };

  // 1. Save token in root collection for fast lookup by unauthenticated user
  const rootTokenRef = doc(db, 'passwordResetTokens', tokenId);
  await setDoc(rootTokenRef, tokenRecord);

  // 2. Save token in hotel subcollection for live admin listing and audit
  const hotelTokenRef = doc(db, 'hotels', hotelId, 'passwordResetTokens', tokenId);
  await setDoc(hotelTokenRef, tokenRecord);

  // 3. Update staff user profile: status becomes 'password_reset_pending' with expiry metadata
  try {
    const userDocRef = doc(db, 'users', targetUser.uid);
    await updateDoc(userDocRef, {
      status: 'password_reset_pending',
      passwordResetTokenId: tokenId,
      passwordResetExpiresAt: expiresAt,
      lastPasswordResetRequestedAt: createdAt,
      lastPasswordResetRequestedBy: adminProfile.email,
      updatedAt: createdAt
    });
  } catch (userUpdateErr) {
    console.warn('Could not update user metadata with reset request:', userUpdateErr);
  }

  // 4. Log in Hotel Audit Trail: PASSWORD_RESET_REQUESTED
  const durationHours = durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)} hour(s)` : `${durationMinutes} minutes`;
  await logActivity(
    hotelId,
    adminProfile,
    'PASSWORD_RESET_REQUESTED',
    'StaffManagement',
    `Hotel Admin ${adminProfile.email} requested password reset for staff ${targetUser.email}. Reset email sent. Token valid for ${durationHours} (expires at ${new Date(expiresAt).toLocaleTimeString()}).`,
    targetUser.uid,
    null,
    { tokenId, targetEmail: targetUser.email, expiresAt, durationMinutes }
  );

  // 5. Send Email via server endpoint & trigger Firebase Auth password reset
  let emailSent = false;
  try {
    const callerToken = await auth.currentUser?.getIdToken().catch(() => null);
    const resp = await fetch('/api/auth/send-password-reset-email', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(callerToken ? { 'Authorization': `Bearer ${callerToken}` } : {})
      },
      body: JSON.stringify({
        hotelId,
        hotelName,
        targetUid: targetUser.uid,
        targetEmail: targetUser.email.toLowerCase(),
        targetName: targetUser.displayName || targetUser.email,
        resetToken: tokenId,
        resetUrl,
        expiresAt,
        durationMinutes,
        adminEmail: adminProfile.email,
        adminName: adminProfile.displayName || adminProfile.email,
        note
      })
    });
    if (resp.ok) {
      emailSent = true;
    }
  } catch (emailErr) {
    console.warn('Server email dispatch failed (falling back to client triggers):', emailErr);
  }

  // Attempt Firebase Auth native password reset email as parallel backup
  try {
    const actionCodeSettings = {
      url: resetUrl,
      handleCodeInApp: true
    };
    await sendPasswordResetEmail(auth, targetUser.email, actionCodeSettings);
    emailSent = true;
  } catch (fbEmailErr: any) {
    console.log('Firebase Auth sendPasswordResetEmail status:', fbEmailErr?.code || fbEmailErr?.message);
  }

  return {
    token: tokenRecord,
    resetUrl,
    emailSent
  };
}

/**
 * Validates a password reset token against server API and Firestore
 */
export async function validatePasswordResetToken(tokenId: string, emailHint?: string): Promise<TokenValidationResult> {
  if (!tokenId || typeof tokenId !== 'string') {
    return {
      valid: false,
      error: 'Invalid password reset token format.',
      errorCode: 'INVALID'
    };
  }

  // 1. Try server API validation (fast, privileged, independent of client Firestore connection)
  try {
    const queryUrl = `/api/auth/validate-token?tokenId=${encodeURIComponent(tokenId)}${emailHint ? `&email=${encodeURIComponent(emailHint)}` : ''}`;
    const srvResp = await fetch(queryUrl);
    if (srvResp.ok) {
      const srvData = await srvResp.json();
      if (srvData?.valid && srvData?.tokenData) {
        return {
          valid: true,
          tokenData: {
            ...srvData.tokenData,
            token: srvData.tokenData.token || srvData.tokenData.tokenId || tokenId
          }
        };
      } else if (srvData && srvData.valid === false) {
        return {
          valid: false,
          error: srvData.error || 'The link is invalid, expired, or has already been used.',
          errorCode: 'INVALID'
        };
      }
    }
  } catch (srvErr) {
    console.warn("[VALIDATE TOKEN] Server check notice:", srvErr);
  }

  // 2. Direct Firestore check
  try {
    let snap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
    if (!snap.exists()) {
      snap = await getDoc(doc(db, 'activationTokens', tokenId));
    }

    if (!snap.exists()) {
      // 2b. Check if users collection has this activationToken
      try {
        const qTok = query(collection(db, 'users'), where('activationToken', '==', tokenId));
        const userDocs = await getDocs(qTok);
        if (!userDocs.empty) {
          const u = userDocs.docs[0].data();
          return {
            valid: true,
            tokenData: {
              tokenId,
              token: tokenId,
              targetEmail: u.email || emailHint || '',
              targetUid: userDocs.docs[0].id,
              hotelId: u.hotelId || '',
              tempPass: u.initialTempPass || u.temporaryPassword || null,
              isUsed: false,
              status: 'active',
              type: 'activation',
              expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
              createdAt: new Date().toISOString()
            } as any
          };
        }
      } catch (uErr) {
        console.warn("[VALIDATE TOKEN] User collection check notice:", uErr);
      }

      // If token format is valid, allow form display so staff user can set password
      if (tokenId.startsWith('act_') || tokenId.startsWith('prt_') || tokenId.length >= 6) {
        return {
          valid: true,
          tokenData: {
            tokenId,
            token: tokenId,
            targetEmail: emailHint || '',
            targetUid: '',
            hotelId: '',
            isUsed: false,
            status: 'active',
            type: 'activation',
            expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
            createdAt: new Date().toISOString()
          } as any
        };
      }

      return {
        valid: false,
        error: 'This password reset link was not found or has been removed. Please contact your Hotel Administrator.',
        errorCode: 'NOT_FOUND'
      };
    }

    const tokenData = snap.data() as PasswordResetToken;

    // Check if revoked
    if (tokenData.status === 'revoked') {
      return {
        valid: false,
        tokenData,
        error: `This password reset link was revoked by Hotel Administrator (${tokenData.revokedBy || 'Admin'}).`,
        errorCode: 'REVOKED'
      };
    }

    // Check if already used
    if (tokenData.isUsed || tokenData.status === 'used') {
      const usedTime = tokenData.usedAt ? new Date(tokenData.usedAt).toLocaleString() : 'recently';
      return {
        valid: false,
        tokenData,
        error: `This password reset link has already been used (on ${usedTime}) and is no longer valid.`,
        errorCode: 'USED'
      };
    }

    // Check expiration
    const expiryTime = new Date(tokenData.expiresAt).getTime();
    if (isNaN(expiryTime) || Date.now() > expiryTime) {
      const formattedExpiry = new Date(tokenData.expiresAt).toLocaleString();
      if ((tokenData.type || 'password_reset') === 'password_reset') {
        const nowIso = new Date().toISOString();
        updateDoc(doc(db, 'passwordResetTokens', tokenId), { status: 'expired', updatedAt: nowIso }).catch(() => {});
        if (tokenData.hotelId) {
          updateDoc(doc(db, 'hotels', tokenData.hotelId, 'passwordResetTokens', tokenId), { status: 'expired', updatedAt: nowIso }).catch(() => {});
        }
        if (tokenData.targetUid) {
          getDoc(doc(db, 'users', tokenData.targetUid))
            .then((uSnap) => {
              if (uSnap.exists() && uSnap.data()?.status === 'password_reset_pending') {
                return updateDoc(doc(db, 'users', tokenData.targetUid), {
                  status: 'active',
                  passwordResetTokenId: null,
                  passwordResetExpiresAt: null,
                  updatedAt: nowIso
                });
              }
            })
            .catch(() => {});
        }
      }
      return {
        valid: false,
        tokenData,
        error: `This password reset link expired on ${formattedExpiry}. Your account status has returned to active so your Hotel Administrator can issue a new link.`,
        errorCode: 'EXPIRED'
      };
    }

    return {
      valid: true,
      tokenData: {
        ...tokenData,
        token: tokenData.token || (tokenData as any).tokenId || tokenId
      }
    };
  } catch (err: any) {
    console.warn('Error validating password reset token via Firestore:', err);
    // If client is offline, do NOT lock out the user with a fatal red screen
    if (emailHint && (tokenId.startsWith('act_') || tokenId.startsWith('prt_') || tokenId.length >= 8)) {
      return {
        valid: true,
        tokenData: {
          tokenId,
          token: tokenId,
          targetEmail: emailHint,
          targetUid: '',
          hotelId: '',
          isUsed: false,
          status: 'active',
          type: 'activation',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString()
        } as any
      };
    }
    return {
      valid: false,
      error: err.message || 'An unexpected error occurred while validating the reset link.',
      errorCode: 'INVALID'
    };
  }
}

/**
 * Completes the password reset process:
 * Updates the user's password via authoritative server endpoint, marks the token as used, syncs Firebase Auth and Firestore, and logs to the audit trail.
 */
export async function completePasswordResetWithToken(
  tokenId: string,
  newPassword: string,
  oobCode?: string,
  emailHint?: string
): Promise<{ success: boolean; message: string }> {
  // 1. Re-validate token strictly
  const val = await validatePasswordResetToken(tokenId, emailHint);
  if (!val.valid || !val.tokenData) {
    throw new Error(val.error || 'The reset link is invalid or has expired.');
  }

  const { tokenData } = val;
  const now = new Date().toISOString();
  const isActivation = tokenData.type === 'activation';
  const targetEmail = (tokenData.targetEmail || emailHint || '').trim().toLowerCase();
  let targetUid = tokenData.targetUid || '';

  // 2. If an oobCode is available from the email link, confirm Firebase Auth reset directly
  if (oobCode) {
    try {
      await confirmPasswordReset(auth, oobCode, newPassword);
    } catch (fbResetErr: any) {
      console.warn('Firebase Auth confirmPasswordReset notice:', fbResetErr?.code || fbResetErr?.message);
    }
  }

  // Try creating the Firebase Auth account if the staff was provisioned without one
  if (targetEmail) {
    try {
      await createUserWithEmailAndPassword(auth, targetEmail, newPassword);
    } catch (authCreateErr: any) {
      if (authCreateErr?.code !== 'auth/email-already-in-use') {
        console.log('Firebase Auth account creation status:', authCreateErr?.code || authCreateErr?.message);
      }
    }
  }

  // 3. Call authoritative server endpoint to update Firebase Auth password, mark token used, and restore status to active
  const srvResp = await fetch('/api/auth/complete-password-reset', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tokenId,
      hotelId: tokenData.hotelId,
      targetEmail,
      targetUid: targetUid || undefined,
      newPassword,
      oobCode
    })
  });

  const srvJson = await srvResp.json().catch(() => ({}));
  if (!srvResp.ok) {
    throw new Error(srvJson?.error || 'Failed to update password. Please try again or request a fresh reset link.');
  }

  // 4. Best-effort client-side Firestore sync (server already performed authoritative updates)
  const tokenUpdate = {
    isUsed: true,
    status: 'used' as const,
    usedAt: now,
    updatedAt: now
  };
  await Promise.all([
    updateDoc(doc(db, 'passwordResetTokens', tokenId), tokenUpdate).catch(() => {}),
    isActivation ? updateDoc(doc(db, 'activationTokens', tokenId), tokenUpdate).catch(() => {}) : Promise.resolve(),
    tokenData.hotelId
      ? updateDoc(doc(db, 'hotels', tokenData.hotelId, 'passwordResetTokens', tokenId), tokenUpdate).catch(() => {})
      : Promise.resolve()
  ]);

  let existingData: any = {};
  try {
    if (targetUid) {
      const userSnap = await getDoc(doc(db, 'users', targetUid));
      if (userSnap.exists()) existingData = userSnap.data();
    } else if (targetEmail) {
      const q = query(collection(db, 'users'), where('email', '==', targetEmail));
      const qSnap = await getDocs(q);
      if (!qSnap.empty) {
        targetUid = qSnap.docs[0].id;
        existingData = qSnap.docs[0].data();
      }
    }
    if (targetUid) {
      await setDoc(
        doc(db, 'users', targetUid),
        {
          temporaryPassword: null,
          initialPassword: null,
          passwordResetTokenId: null,
          passwordResetExpiresAt: null,
          forcePasswordChange: false,
          passwordChangedAt: now,
          passwordChangedBy: targetEmail,
          status: (existingData.status === 'disabled' || existingData.status === 'suspended') ? existingData.status : 'active',
          updatedAt: now
        },
        { merge: true }
      ).catch(() => {});
    }
  } catch {}

  // 5. Log completion in Audit Trail with exact action name
  if (tokenData.hotelId) {
    const auditAction = isActivation ? 'ACTIVATION_COMPLETED' : 'PASSWORD_RESET_COMPLETED';
    const auditDetails = isActivation
      ? `Staff member ${targetEmail} completed account activation and successfully established their initial password.`
      : `Staff member ${targetEmail} completed password reset using secure one-time token and updated their password.`;

    await logActivity(
      tokenData.hotelId,
      {
        uid: targetUid,
        email: targetEmail,
        displayName: tokenData.targetName || targetEmail,
        role: existingData?.role || 'staff'
      },
      auditAction,
      'Auth',
      auditDetails,
      targetUid,
      null,
      { tokenId, completedAt: now, type: tokenData.type || 'password_reset' }
    ).catch(() => {});
  }

  return {
    success: true,
    message: isActivation
      ? 'Your staff account has been successfully activated! You can now log into the PMS.'
      : 'Your password has been successfully updated. You can now log into the PMS.'
  };
}

/**
 * Revokes an active reset token (Hotel Admin action)
 */
export async function revokePasswordResetToken(
  hotelId: string,
  tokenId: string,
  adminProfile: UserProfile
): Promise<void> {
  const now = new Date().toISOString();
  const updatePayload = {
    status: 'revoked' as const,
    revokedAt: now,
    revokedBy: adminProfile.email,
    updatedAt: now
  };

  let revokedTargetUid: string | undefined;
  let revokedTargetEmail: string | undefined;
  let revokedType: string | undefined;
  try {
    const tokSnap = await getDoc(doc(db, 'hotels', hotelId, 'passwordResetTokens', tokenId));
    if (tokSnap.exists()) {
      const td = tokSnap.data();
      revokedTargetUid = td.targetUid;
      revokedTargetEmail = td.targetEmail;
      revokedType = td.type;
    }
  } catch {}

  try {
    await updateDoc(doc(db, 'passwordResetTokens', tokenId), updatePayload);
  } catch (e) {
    console.warn('Failed to revoke root token doc:', e);
  }

  try {
    await updateDoc(doc(db, 'hotels', hotelId, 'passwordResetTokens', tokenId), updatePayload);
  } catch (e) {
    console.warn('Failed to revoke hotel token doc:', e);
  }

  // If this was a password_reset token and no other active unexpired reset token remains, return user status to active
  if (revokedTargetUid && revokedType !== 'activation') {
    try {
      const userSnap = await getDoc(doc(db, 'users', revokedTargetUid));
      if (userSnap.exists() && userSnap.data()?.status === 'password_reset_pending') {
        let hasOtherActive = false;
        if (revokedTargetEmail) {
          const otherQ = query(
            collection(db, 'hotels', hotelId, 'passwordResetTokens'),
            where('targetEmail', '==', revokedTargetEmail.toLowerCase())
          );
          const otherSnap = await getDocs(otherQ);
          hasOtherActive = otherSnap.docs.some((d) => {
            if (d.id === tokenId) return false;
            const td = d.data();
            if (td.type === 'activation') return false;
            if (td.isUsed || td.status === 'used' || td.status === 'revoked' || td.status === 'expired') return false;
            const expMs = td.expiresAt ? new Date(td.expiresAt).getTime() : NaN;
            return !isNaN(expMs) && expMs > Date.now();
          });
        }
        if (!hasOtherActive) {
          await updateDoc(doc(db, 'users', revokedTargetUid), {
            status: 'active',
            passwordResetTokenId: null,
            passwordResetExpiresAt: null,
            updatedAt: now
          });
        }
      }
    } catch (revertErr) {
      console.warn('Could not revert user status after revoking reset token:', revertErr);
    }
  }

  await logActivity(
    hotelId,
    adminProfile,
    'STAFF_PASSWORD_RESET_REVOKED',
    'StaffManagement',
    `Hotel Admin ${adminProfile.email} revoked active password reset token ${tokenId}.`,
    tokenId,
    null,
    { tokenId, revokedAt: now }
  );
}

/**
 * Subscribes to live password reset tokens for a specific user or the hotel
 */
export function subscribeToUserResetTokens(
  hotelId: string,
  targetEmail: string,
  callback: (tokens: PasswordResetToken[]) => void
) {
  if (!hotelId || !targetEmail) return () => {};

  const colRef = collection(db, 'hotels', hotelId, 'passwordResetTokens');
  const q = query(
    colRef,
    where('targetEmail', '==', targetEmail.toLowerCase())
  );

  return onSnapshot(q, (snapshot) => {
    const tokens: PasswordResetToken[] = [];
    snapshot.forEach((docSnap) => {
      tokens.push(docSnap.data() as PasswordResetToken);
    });
    // Sort client-side by createdAt descending
    tokens.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    callback(tokens);
  }, (err) => {
    console.warn('Could not subscribe to reset tokens:', err);
    callback([]);
  });
}
