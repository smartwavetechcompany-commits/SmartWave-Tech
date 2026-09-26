import { doc, setDoc, addDoc, collection, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import { db, firebaseConfig } from '../firebase';
import { UserProfile, UserRole, StaffRole } from '../types';

export interface ProvisionStaffParams {
  hotelId: string;
  hotelName: string;
  newStaff: {
    fullName: string;
    email: string;
    phone?: string;
    department?: string;
    employeeId?: string;
    roleType: 'base' | 'custom';
    baseRole: StaffRole;
    customRoleId?: string;
  };
  permissionsToAssign: string[];
  assignedModules?: string[];
  assignedRoleId?: string;
  roleLabel: string;
  assignedUserRole: UserRole;
  profile: any;
  baseUrl: string;
}

export interface ProvisionStaffResult {
  firebaseUid: string;
  staffProfile: any;
  activationLink: string;
  emailSent: boolean;
}

/**
 * Resilient Staff Account Provisioner
 * Automatically tries full-stack backend server route first;
 * If the environment returns 405 (Method Not Allowed), 404, or fails due to static hosting/proxy,
 * seamlessly falls back to direct Firebase Authentication & Firestore provisioning without interrupting the user.
 */
export async function provisionStaffAccount(params: ProvisionStaffParams): Promise<ProvisionStaffResult> {
  const {
    hotelId,
    hotelName,
    newStaff,
    permissionsToAssign,
    assignedModules = [],
    assignedRoleId,
    roleLabel,
    assignedUserRole,
    profile,
    baseUrl
  } = params;

  const normalizedEmail = newStaff.email.trim().toLowerCase();
  let serverFailureNotice: string | null = null;

  // Path 1: Try full-stack Express API route
  try {
    const resp = await fetch('/api/auth/create-staff', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        hotelId,
        hotelName,
        email: normalizedEmail,
        fullName: newStaff.fullName.trim(),
        phone: newStaff.phone?.trim() || undefined,
        department: newStaff.department || 'General',
        employeeId: newStaff.employeeId?.trim() || undefined,
        roleType: newStaff.roleType,
        baseRole: newStaff.baseRole,
        customRoleId: newStaff.roleType === 'custom' ? assignedRoleId : undefined,
        roleLabel,
        assignedUserRole,
        permissions: permissionsToAssign,
        assignedModules,
        adminEmail: profile?.email || 'Administrator',
        adminName: profile?.displayName || profile?.email || 'Hotel Administrator',
        adminUid: profile?.uid || 'admin',
        baseUrl
      })
    });

    const responseText = await resp.text();
    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }

    if (resp.ok && data?.firebase_uid) {
      return {
        firebaseUid: data.firebase_uid,
        staffProfile: data.user || {},
        activationLink: data.activationLink,
        emailSent: Boolean(data.emailSent)
      };
    }

    if (data?.code === 'auth/email-already-in-use') {
      throw new Error('This email address is already registered in Firebase Authentication. Please use a different email or resend the password reset invitation.');
    }

    // If server returned 405, 404, or 500, record error to allow client fallback
    serverFailureNotice = `Server API responded with status ${resp.status} (${data?.error || resp.statusText || 'Error'})`;
    console.warn(`[Staff Provisioning] ${serverFailureNotice}. Initiating direct Firebase Authentication fallback.`);
  } catch (apiErr: any) {
    if (apiErr.message?.includes('already registered')) {
      throw apiErr;
    }
    serverFailureNotice = apiErr.message || 'Network error reaching server API';
    console.warn(`[Staff Provisioning] API route unreachable: ${serverFailureNotice}. Initiating direct Firebase Authentication fallback.`);
  }

  // Path 2: Resilient Direct Firebase Provisioner (Client-side Identity Toolkit + Firestore)
  if (!firebaseConfig?.apiKey) {
    throw new Error(serverFailureNotice || 'Firebase configuration or API key is missing.');
  }

  // 1. Create User in Firebase Auth via Identity Toolkit REST API
  // Using REST API does NOT sign out the currently logged in admin user!
  const tempPass = 'Pms_' + Math.random().toString(36).substring(2, 10) + '!Z8#' + Math.random().toString(36).substring(2, 6);
  const authResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: normalizedEmail,
      password: tempPass,
      returnSecureToken: true
    })
  });

  const authData = await authResp.json();
  if (!authResp.ok) {
    if (authData?.error?.message === 'EMAIL_EXISTS') {
      const err: any = new Error('This email address is already registered in Firebase Authentication. Please use a different email or resend the password reset invitation.');
      err.code = 'auth/email-already-in-use';
      throw err;
    }
    throw new Error(authData?.error?.message || 'Failed to create user in Firebase Authentication');
  }

  const firebaseUid = authData.localId;
  const tokenId = 'act_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const activationLink = `${cleanBase}/set-password?email=${encodeURIComponent(normalizedEmail)}&token=${tokenId}&tp=${encodeURIComponent(tempPass)}&mode=resetPassword`;
  const nowIso = new Date().toISOString();

  // 2. Persist Profile to Firestore `users/{firebaseUid}`
  const userProfileData: any = {
    uid: firebaseUid,
    firebase_uid: firebaseUid,
    email: normalizedEmail,
    hotelId,
    role: assignedUserRole,
    staffRole: newStaff.baseRole,
    displayName: newStaff.fullName.trim(),
    phoneNumber: newStaff.phone?.trim() || null,
    department: newStaff.department || 'General',
    employeeId: newStaff.employeeId?.trim() || null,
    status: 'pending_activation',
    isLocked: false,
    initialTempPass: tempPass,
    temporaryPassword: tempPass,
    roles: [newStaff.baseRole],
    customRoleId: newStaff.roleType === 'custom' ? assignedRoleId : null,
    permissions: permissionsToAssign,
    assignedModules: assignedModules || [],
    activationToken: tokenId,
    activationLink,
    activationEmailSentAt: nowIso,
    activationEmailSentBy: profile?.displayName || profile?.email || 'Hotel Administrator',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  };

  await setDoc(doc(db, 'users', firebaseUid), userProfileData, { merge: true });

  if (assignedUserRole === 'hotelAdmin') {
    try {
      await updateDoc(doc(db, 'hotels', hotelId), {
        adminUIDs: arrayUnion(firebaseUid)
      });
    } catch (hotelErr) {
      console.warn("[Staff Provisioning] AdminUID arrayUnion notice:", hotelErr);
    }
  }

  // 3. Persist activation token document to both collections for guaranteed lookup
  const tokenDocData = {
    tokenId,
    token: tokenId,
    email: normalizedEmail,
    targetEmail: normalizedEmail,
    uid: firebaseUid,
    targetUid: firebaseUid,
    hotelId,
    tempPass,
    isUsed: false,
    status: 'active',
    type: 'activation',
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdBy: profile?.email || 'Administrator'
  };

  try {
    await Promise.all([
      setDoc(doc(db, 'passwordResetTokens', tokenId), tokenDocData),
      setDoc(doc(db, 'activationTokens', tokenId), tokenDocData)
    ]);
  } catch (tokenErr) {
    console.warn("[Staff Provisioning] Token doc write notice:", tokenErr);
  }

  // 4. Dispatch standard Firebase Password Reset email via Identity Toolkit sendOobCode
  let emailSent = false;
  try {
    const oobResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requestType: 'PASSWORD_RESET',
        email: normalizedEmail,
        continueUrl: activationLink
      })
    });
    if (oobResp.ok) {
      emailSent = true;
    }
  } catch (oobErr) {
    console.warn("[Staff Provisioning] Could not dispatch OobCode email:", oobErr);
  }

  // 5. Write Audit and Activity Logs
  try {
    const logData = {
      action: 'STAFF_CREATED',
      module: 'Staff Management',
      userId: firebaseUid,
      userEmail: normalizedEmail,
      adminEmail: profile?.email || 'Administrator',
      details: `Staff member ${newStaff.fullName.trim()} (${normalizedEmail}) created with role ${roleLabel}. Status: Pending Activation.`,
      timestamp: serverTimestamp(),
      createdAt: nowIso
    };
    await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), logData);
    await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), logData);
  } catch (logErr) {
    console.warn("[Staff Provisioning] Could not write audit log:", logErr);
  }

  return {
    firebaseUid,
    staffProfile: userProfileData,
    activationLink,
    emailSent
  };
}

export interface ResendActivationParams {
  hotelId: string;
  hotelName: string;
  member: UserProfile;
  profile: any;
  baseUrl: string;
}

export interface ResendActivationResult {
  activationLink: string;
  emailSent: boolean;
}

/**
 * Resilient Staff Activation Link Regenerator
 * Tries server endpoint first; on 405/404/network error, regenerates link and updates Firestore directly.
 */
export async function resendStaffActivation(params: ResendActivationParams): Promise<ResendActivationResult> {
  const { hotelId, hotelName, member, profile, baseUrl } = params;
  const targetEmail = member.email?.trim().toLowerCase();
  if (!targetEmail) throw new Error('Member email is missing');

  // Path 1: Try server API route
  try {
    const resp = await fetch('/api/auth/resend-activation-link', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        hotelId,
        hotelName,
        targetUid: member.uid || member.firebase_uid,
        targetEmail,
        targetName: member.displayName || targetEmail,
        adminEmail: profile?.email || 'Administrator',
        adminName: profile?.displayName || profile?.email || 'Hotel Administrator',
        adminUid: profile?.uid,
        baseUrl
      })
    });

    const responseText = await resp.text();
    let data: any = {};
    try {
      data = responseText ? JSON.parse(responseText) : {};
    } catch {
      data = {};
    }

    if (resp.ok && data?.activationLink) {
      return {
        activationLink: data.activationLink,
        emailSent: Boolean(data.emailSent)
      };
    }

    console.warn(`[Resend Activation] Server API returned status ${resp.status}. Using direct client fallback.`);
  } catch (err: any) {
    console.warn("[Resend Activation] Server API unreachable. Using direct client fallback.", err);
  }

  // Path 2: Direct Client Fallback
  const tokenId = 'act_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
  const cleanBase = baseUrl.replace(/\/+$/, '');
  const tempPass = member.initialTempPass || member.temporaryPassword || ('Pms_' + Math.random().toString(36).substring(2, 10) + '!Z8#' + Math.random().toString(36).substring(2, 6));
  const activationLink = `${cleanBase}/set-password?email=${encodeURIComponent(targetEmail)}&token=${tokenId}&tp=${encodeURIComponent(tempPass)}&mode=resetPassword`;
  const nowIso = new Date().toISOString();

  const targetUid = member.uid || member.firebase_uid;
  if (targetUid) {
    await setDoc(doc(db, 'users', targetUid), {
      activationToken: tokenId,
      activationLink,
      initialTempPass: tempPass,
      temporaryPassword: tempPass,
      activationEmailSentAt: nowIso,
      activationEmailSentBy: profile?.displayName || profile?.email || 'Hotel Administrator',
      updatedAt: serverTimestamp()
    }, { merge: true });
  }

  // Persist token doc in both collections
  const resendDocData = {
    tokenId,
    token: tokenId,
    email: targetEmail,
    targetEmail,
    uid: targetUid,
    targetUid,
    hotelId,
    tempPass,
    isUsed: false,
    status: 'active',
    type: 'activation',
    createdAt: serverTimestamp(),
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    createdBy: profile?.email || 'Administrator'
  };

  try {
    await Promise.all([
      setDoc(doc(db, 'passwordResetTokens', tokenId), resendDocData),
      setDoc(doc(db, 'activationTokens', tokenId), resendDocData)
    ]);
  } catch (e) {
    console.warn("Could not save activation token docs:", e);
  }

  // Dispatch reset email
  let emailSent = false;
  if (firebaseConfig?.apiKey) {
    try {
      const oobResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requestType: 'PASSWORD_RESET',
          email: targetEmail,
          continueUrl: activationLink
        })
      });
      emailSent = oobResp.ok;
    } catch (e) {
      console.warn("Could not dispatch oob code email:", e);
    }
  }

  return {
    activationLink,
    emailSent
  };
}
