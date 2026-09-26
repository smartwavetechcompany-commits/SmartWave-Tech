import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { motion } from 'motion/react';
import { Hotel, TrackingCode, UserProfile, OperationType, PlanType, HotelSettings } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { DEFAULT_SETTINGS } from '../constants';
import { ExternalLink, CreditCard, Info, Eye, EyeOff, ArrowLeft, CheckCircle2, XCircle, Mail, ShieldAlert } from 'lucide-react';
import { cn } from '../utils';

interface AuthPageProps {
  initialEmail?: string;
  initialSuccessMessage?: string;
}

export function AuthPage({ initialEmail, initialSuccessMessage }: AuthPageProps = {}) {
  const [isLogin, setIsLogin] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(initialSuccessMessage || '');
  const [settings, setSettings] = useState({
    paymentInstructions: '',
    supportEmail: '',
    bankName: '',
    accountNumber: '',
    accountName: '',
  });

  const { user, profile } = useAuth();

  useEffect(() => {
    if (initialEmail) {
      setFormData(prev => ({ ...prev, email: initialEmail }));
    }
    if (initialSuccessMessage) {
      showNotification(initialSuccessMessage, 'success');
    }
  }, [initialEmail, initialSuccessMessage]);

  useEffect(() => {
    // If user is logged in but has no profile, force registration mode
    if (user && !profile) {
      setIsLogin(false);
      setFormData(prev => ({ ...prev, email: user.email || '' }));
    }
  }, [user, profile]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const urlCode = searchParams.get('trackingCode') || searchParams.get('code');
      const urlEmail = searchParams.get('email');
      const urlHotelName = searchParams.get('hotelName') || searchParams.get('hotel');
      const urlMode = searchParams.get('mode') || searchParams.get('action');

      if (urlCode || urlMode === 'register' || urlMode === 'signup') {
        setIsLogin(false);
      }
      if (urlCode) {
        const cleanCode = urlCode.trim().toUpperCase();
        setFormData(prev => ({ ...prev, trackingCode: cleanCode }));
        showNotification(`Tracking code ${cleanCode} applied! Fill in details below to create your Administrator account.`, 'success');
      }
      if (urlEmail) {
        setFormData(prev => ({ ...prev, email: urlEmail.trim().toLowerCase() }));
      }
      if (urlHotelName) {
        setFormData(prev => ({ ...prev, hotelName: decodeURIComponent(urlHotelName) }));
      }
    } catch (e) {
      console.warn("Could not read url params:", e);
    }
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'system', 'settings'));
        if (snap.exists()) {
          setSettings(snap.data() as any);
        }
      } catch (err) {
        // Silently fail for public users if permissions aren't set yet
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    let timer: any;
    if (resetCooldown > 0) {
      timer = setInterval(() => {
        setResetCooldown((prev) => prev - 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [resetCooldown]);

  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (resetCooldown > 0) return;
    
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await sendPasswordResetEmail(auth, formData.email);
      showNotification('Password reset email sent! Please check your inbox.');
      setResetCooldown(60);
    } catch (err: any) {
      setError(err.message);
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const [formData, setFormData] = useState({
    email: '',
    password: '',
    confirmPassword: '',
    hotelName: '',
    trackingCode: '',
    phone: '',
    plan: 'Standard',
  });

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      await database.safeAdd(collection(db, 'trackingCodeRequests'), {
        hotelName: formData.hotelName,
        email: formData.email,
        phone: formData.phone,
        plan: formData.plan,
        status: 'pending',
        timestamp: new Date().toISOString(),
      }, {
        hotelId: 'SYSTEM',
        module: 'Auth',
        action: 'CODE_REQUEST',
        details: `New tracking code request for ${formData.hotelName}`
      });
      showNotification('Request submitted! Our team will contact you with payment instructions shortly.');
      
      setFormData({ ...formData, hotelName: '', email: '', phone: '' });
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'trackingCodeRequests');
      setError(err.message);
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      if (isLogin) {
        console.log("Attempting login for:", formData.email);
        
        // 1. Check account status prior to authentication (suspended check)
        try {
          const staffPreQuery = query(
            collection(db, 'users'),
            where('email', '==', formData.email.trim().toLowerCase())
          );
          const staffPreSnap = await getDocs(staffPreQuery);
          if (!staffPreSnap.empty) {
            const matchedProfile = staffPreSnap.docs[0].data() as UserProfile;
            if (matchedProfile.status === 'suspended') {
              throw new Error('Your account has been suspended. Please contact your Hotel Administrator for assistance.');
            }
          }
        } catch (preCheckErr: any) {
          if (preCheckErr.message?.includes('suspended')) {
            throw preCheckErr;
          }
          console.warn("Pre-auth status check bypassed:", preCheckErr?.message);
        }

        try {
          const userCredential = await signInWithEmailAndPassword(auth, formData.email, formData.password);
          const loggedInUser = userCredential.user;
          console.log("Login successful in AuthPage for UID:", loggedInUser.uid);

          // Phase 3: Retrieve Firebase ID Token and verify session / permissions with backend
          try {
            const idToken = await loggedInUser.getIdToken();
            const verifyResp = await fetch('/api/auth/verify-token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${idToken}`
              },
              body: JSON.stringify({ idToken })
            });
            if (verifyResp.status === 403) {
              const errData = await verifyResp.json();
              if (errData.error?.includes('suspended')) {
                await auth.signOut();
                throw new Error(errData.error);
              }
            }
          } catch (tokenVerifyErr: any) {
            if (tokenVerifyErr.message?.includes('suspended')) {
              throw tokenVerifyErr;
            }
            console.warn("Backend ID token check notice:", tokenVerifyErr?.message);
          }

          // Auto-healing migration during successful login:
          // Check if a profile document exists for this user's UID
          const profileDocRef = doc(db, 'users', loggedInUser.uid);
          const profileSnap = await getDoc(profileDocRef);

          if (!profileSnap.exists() && loggedInUser.email) {
            console.log("No profile found for logged-in user UID, searching for temporary/unlinked profile by email:", loggedInUser.email);
            const staffQuery = query(
              collection(db, 'users'),
              where('email', '==', loggedInUser.email.toLowerCase())
            );
            const staffSnap = await getDocs(staffQuery);
            if (!staffSnap.empty) {
              const staffDoc = staffSnap.docs[0];
              const staffData = staffDoc.data() as UserProfile;

              if (staffDoc.id !== loggedInUser.uid) {
                console.log(`Migrating profile from ${staffDoc.id} to ${loggedInUser.uid}`);
                await database.safeSet(profileDocRef, {
                  ...staffData,
                  uid: loggedInUser.uid,
                  initialPassword: null,
                  temporaryPassword: null,
                  initialTempPass: null,
                  forcePasswordChange: false,
                  status: 'active',
                  isVerified: true,
                  emailVerified: true,
                  updatedAt: new Date().toISOString()
                }, {
                  hotelId: staffData.hotelId || 'SYSTEM',
                  module: 'Auth',
                  action: 'STAFF_ACTIVATION_MIGRATION',
                  details: `Migrated staff profile during successful login for ${loggedInUser.email}`
                });

                // Delete temporary staff profile
                await database.safeDelete(doc(db, 'users', staffDoc.id), {
                  hotelId: staffData.hotelId || 'SYSTEM',
                  module: 'Auth',
                  action: 'STAFF_TEMP_DELETE',
                  details: `Removed temporary staff document for ${loggedInUser.email}`
                });
                console.log(`Migration completed successfully in AuthPage!`);
              } else {
                // Same doc id: activate it
                await updateDoc(profileDocRef, {
                  status: 'active',
                  isVerified: true,
                  emailVerified: true,
                  forcePasswordChange: false,
                  temporaryPassword: null,
                  initialTempPass: null,
                  updatedAt: new Date().toISOString()
                }).catch(() => {});
              }
            }
          } else if (profileSnap.exists()) {
            const profileData = profileSnap.data() as UserProfile;
            if (profileData.status === 'pending_activation') {
              console.log("Staff member successfully signed in. Transitioning status to 'active'.");
              await updateDoc(profileDocRef, {
                status: 'active',
                isVerified: true,
                emailVerified: true,
                forcePasswordChange: false,
                temporaryPassword: null,
                initialTempPass: null,
                updatedAt: new Date().toISOString()
              }).catch(() => {});
            }
            if (profileData.status === 'suspended') {
              await auth.signOut();
              throw new Error('Your account has been suspended. Please contact your Hotel Administrator.');
            }
          }
        } catch (authErr: any) {
          throw authErr;
        }
      } else {
        // Registration Flow
        if (!user && formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        // 1. Check for existing staff profile by email (only if no tracking code provided for hotel registration)
        let existingStaffProfile: UserProfile | null = null;
        let staffDocId: string | null = null;

        if (!formData.trackingCode && formData.email) {
          try {
            const staffQuery = query(collection(db, 'users'), where('email', '==', formData.email.toLowerCase()), where('role', '==', 'staff'));
            const staffSnap = await getDocs(staffQuery);
            if (!staffSnap.empty) {
              // Found a pre-created staff profile
              const doc = staffSnap.docs[0];
              existingStaffProfile = doc.data() as UserProfile;
              staffDocId = doc.id;
            }
          } catch (staffQueryErr) {
            console.warn("Staff profile check skipped or denied:", staffQueryErr);
          }
        }

        // 2. Verify Tracking Code (Only if not already a staff member)
        let tcData: TrackingCode | null = null;
        if (!existingStaffProfile) {
          if (!formData.trackingCode) {
            throw new Error('Tracking code is required for new hotel registration');
          }
          try {
            const normalizedCode = formData.trackingCode.trim().toUpperCase();
            const tcRef = doc(db, 'trackingCodes', normalizedCode);
            const tcDoc = await getDoc(tcRef);
            
            if (!tcDoc.exists()) {
              throw new Error('Invalid tracking code');
            }
            tcData = tcDoc.data() as TrackingCode;
            
            if (tcData.status === 'used' || tcData.hotelId) {
              throw new Error('This tracking code has already been used to register a hotel.');
            }

            const tcExpiryTime = new Date(tcData.expiryDate).getTime();
            if ((!isNaN(tcExpiryTime) && tcExpiryTime <= Date.now() - 3600000) || tcData.status === 'expired') {
              throw new Error('This tracking code has expired.');
            }

            if (tcData.status !== 'active') {
              throw new Error('This tracking code is inactive.');
            }

            if (tcData.targetEmail && tcData.targetEmail.trim().toLowerCase() !== formData.email.trim().toLowerCase()) {
              throw new Error(`This tracking code is uniquely assigned to ${tcData.targetEmail}. Please use the correct email address to register.`);
            }
          } catch (err: any) {
            if (err.message.includes('Invalid tracking code') || err.message.includes('expired') || err.message.includes('used') || err.message.includes('assigned')) {
              throw err;
            }
            handleFirestoreError(err, OperationType.GET, `trackingCodes/${formData.trackingCode}`);
            throw err;
          }
        }

        // 3. Create User if not already logged in
        let currentUser = user;
        if (!currentUser) {
          const userCredential = await createUserWithEmailAndPassword(auth, formData.email.trim().toLowerCase(), formData.password);
          currentUser = userCredential.user;
        }

        // 2.5 Record Registration Attempt
        try {
          await database.safeAdd(collection(db, 'registration'), {
            uid: currentUser.uid,
            email: formData.email.trim().toLowerCase(),
            hotelName: formData.hotelName || (existingStaffProfile ? 'Staff Registration' : ''),
            trackingCode: formData.trackingCode,
            timestamp: new Date().toISOString(),
            status: 'pending'
          }, {
            hotelId: existingStaffProfile?.hotelId || 'SYSTEM',
            module: 'Auth',
            action: 'REGISTRATION_START',
            details: `Started registration for ${formData.email}`
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'registration');
        }

        // 3. Generate IDs and Prepare Data
        // If it's a staff member, they already have a hotelId from the existing profile
        const hotelId = existingStaffProfile ? existingStaffProfile.hotelId : `hotel_${Math.random().toString(36).substr(2, 9)}`;
        const selectedPlan = (tcData?.plan?.toLowerCase() as PlanType) || 'standard';
        
        // Define plan features
        const planFeatures = {
          standard: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'guests', 'settings', 'reports'],
            limits: { rooms: 30, staff: 10 }
          },
          premium: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'guests', 'settings', 'reports', 'kitchen', 'inventory', 'maintenance', 'staff'],
            limits: { rooms: 150, staff: 50 }
          },
          enterprise: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'guests', 'settings', 'reports', 'kitchen', 'inventory', 'maintenance', 'finance', 'staff', 'corporate'],
            limits: { rooms: 5000, staff: 1000 }
          }
        };

        const features = planFeatures[selectedPlan] || planFeatures.standard;

        // 4. Create User Profile
        const profileData: UserProfile = existingStaffProfile ? {
          ...existingStaffProfile,
          uid: currentUser.uid, // Update with real UID
          status: 'active',
          isVerified: true,
          emailVerified: true,
          forcePasswordChange: false,
          displayName: formData.hotelName || existingStaffProfile.displayName || currentUser.displayName || formData.email.split('@')[0]
        } : {
          uid: currentUser.uid,
          email: formData.email.trim().toLowerCase(),
          hotelId: hotelId,
          role: 'hotelAdmin',
          roles: ['admin', 'hotelAdmin'],
          staffRole: 'admin',
          createdAt: new Date().toISOString(),
          status: 'active',
          isVerified: true,
          emailVerified: true,
          forcePasswordChange: false,
          displayName: formData.hotelName + ' Admin',
          permissions: ['all'],
          systemAuthSecret: formData.password || undefined,
          subscriptionExpiry: tcData?.expiryDate || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        };

        try {
          // If we found an existing staff doc with a different ID (like tempUid), delete it first
          if (staffDocId && staffDocId !== currentUser.uid) {
            await database.safeDelete(doc(db, 'users', staffDocId), {
              hotelId: hotelId || 'SYSTEM',
              module: 'Auth',
              action: 'PROFILE_TEMP_CLEANUP',
              details: `Cleanup of temporary profile during registration`
            });
          }
          await database.safeSet(doc(db, 'users', currentUser.uid), profileData, {
            hotelId: hotelId || 'SYSTEM',
            module: 'Auth',
            action: 'PROFILE_CREATE',
            details: `Created/Updated user profile during registration`
          });

          // Synchronize credential to server for authentication lifecycle
          fetch('/api/auth/sync-user-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              uid: currentUser.uid,
              email: currentUser.email,
              password: formData.password
            })
          }).catch(() => {});
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `users/${currentUser.uid}`);
          throw err;
        }

        // 5. Create Hotel (Only if not staff)
        if (!existingStaffProfile) {
          const hotelData: Hotel = {
            id: hotelId,
            name: formData.hotelName,
            trackingCode: formData.trackingCode,
            subscriptionStatus: 'active',
            subscriptionExpiry: tcData.expiryDate,
            plan: selectedPlan,
            modulesEnabled: features.modules,
            limits: features.limits,
            roomLimit: features.limits.rooms,
            staffLimit: features.limits.staff,
            settings: DEFAULT_SETTINGS,
            createdAt: new Date().toISOString(),
            adminUIDs: [currentUser.uid],
          };

          try {
            await database.safeSet(doc(db, 'hotels', hotelId), hotelData, {
              hotelId: hotelId,
              module: 'Auth',
              action: 'HOTEL_CREATE',
              details: `Created new hotel organization: ${formData.hotelName}`
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `hotels/${hotelId}`);
            throw err;
          }

          // 6. Update Tracking Code
          try {
            const normalizedCode = formData.trackingCode.trim().toUpperCase();
            await database.safeUpdate(doc(db, 'trackingCodes', normalizedCode), { 
              status: 'used',
              usedAt: new Date().toISOString(),
              usedByHotel: hotelId
            }, {
              hotelId: hotelId,
              module: 'Auth',
              action: 'CODE_USE',
              details: `Marked tracking code ${normalizedCode} as used`
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `trackingCodes/${formData.trackingCode}`);
            throw err;
          }
        }

        // 7. Record Registration Attempt
        try {
          await database.safeAdd(collection(db, 'registration'), {
            uid: currentUser.uid,
            email: formData.email,
            hotelName: formData.hotelName,
            trackingCode: formData.trackingCode,
            timestamp: new Date().toISOString(),
            status: 'completed'
          }, {
            hotelId: hotelId || 'SYSTEM',
            module: 'Auth',
            action: 'REGISTRATION_FINISH',
            details: `Completed registration for ${formData.email}`
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'registration');
        }
        
        showNotification('Registration successful!');
      }
    } catch (err: any) {
      // If the error is already a JSON string from handleFirestoreError, use it directly
      let errorMessage = err.message;
      try {
        const parsed = JSON.parse(err.message);
        if (parsed.error) errorMessage = parsed.error;
      } catch (e) {
        // Not a JSON error, use raw message
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-email') {
          errorMessage = 'The email or password you entered is incorrect. Please try again.';
        } else if (err.code === 'auth/too-many-requests') {
          errorMessage = 'Too many failed login attempts. Your account has been temporarily locked for security. Please try again later or reset your password.';
        } else if (err.code === 'auth/network-request-failed') {
          errorMessage = 'Network error. Please check your internet connection and try again.';
        } else if (err.code === 'auth/email-already-in-use') {
          errorMessage = 'This email address is already registered. Please sign in instead.';
        } else if (err.code === 'auth/weak-password') {
          errorMessage = 'Password is too weak. Please use at least 6 characters.';
        }
      }
      
      setError(errorMessage);
      showNotification(errorMessage, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative">
      {/* Notification Toast */}
      {notification && (
        <div className={cn(
          "fixed top-4 right-4 z-[100] px-6 py-3 rounded-xl shadow-2xl flex items-center gap-3 animate-in fade-in slide-in-from-top-4 duration-300",
          notification.type === 'success' ? "bg-emerald-500 text-black" : "bg-red-500 text-white"
        )}>
          {notification.type === 'success' ? <CheckCircle2 size={20} /> : <XCircle size={20} />}
          <span className="font-bold">{notification.message}</span>
        </div>
      )}

      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl"
      >
        <div className="text-center mb-8">
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-black mx-auto mb-4 font-black text-xl">
            TT
          </div>
          <h2 className="text-2xl font-bold text-white">Tyyl Tech PMS</h2>
          <p className="text-zinc-400 text-sm mt-2">
            {isResetting
              ? 'Security Policy Notice'
              : isRequesting 
                ? 'Request a tracking code to start' 
                : isLogin 
                  ? 'Welcome back to your hotel management' 
                  : 'Register your hotel organization'}
          </p>
        </div>

        {isResetting ? (
          <div className="space-y-5">
            <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-2">
              <div className="flex items-center gap-2 text-amber-400 font-bold text-sm">
                <ShieldAlert size={18} />
                <span>Admin-Only Password Reset Policy</span>
              </div>
              <p className="text-xs text-amber-200/90 leading-relaxed">
                Self-service password reset is disabled for security. Please contact your Hotel Administrator to reset your password.
              </p>
            </div>

            <div className="bg-zinc-950/60 p-4 rounded-xl border border-zinc-800 text-xs text-zinc-400 space-y-2">
              <p>For PCI-DSS and hotel audit compliance:</p>
              <ul className="list-disc list-inside space-y-1 text-zinc-300">
                <li>Only authorized Hotel Administrators can issue temporary credentials</li>
                <li>You will be required to choose a new password upon your next sign-in</li>
                <li>Contact your supervisor, general manager, or IT team for assistance</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsResetting(false);
                setError('');
                setSuccess('');
              }}
              className="w-full bg-zinc-800 hover:bg-zinc-700 text-white font-semibold py-2.5 rounded-lg transition-all text-sm flex items-center justify-center gap-2"
            >
              <ArrowLeft size={16} />
              Back to Sign In
            </button>
          </div>
        ) : isRequesting ? (
          <form onSubmit={handleRequestCode} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Hotel Name</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                value={formData.hotelName}
                onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Email Address</label>
              <input
                required
                type="email"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Phone Number</label>
              <input
                required
                type="tel"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                value={formData.phone}
                onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Select Plan</label>
              <select
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                value={formData.plan}
                onChange={(e) => setFormData({ ...formData, plan: e.target.value })}
              >
                <option>Standard</option>
                <option>Premium</option>
                <option>Enterprise</option>
              </select>
            </div>

            <div className="p-4 bg-emerald-500/5 border border-emerald-500/20 rounded-lg space-y-3">
              <div className="flex items-center gap-2 text-emerald-500">
                <Info size={14} />
                <h4 className="text-xs font-bold uppercase">Payment Instructions</h4>
              </div>
              
              {settings.paymentInstructions ? (
                <p className="text-[10px] text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {settings.paymentInstructions}
                </p>
              ) : (
                <p className="text-[10px] text-zinc-400 leading-relaxed">
                  After submitting, please complete your payment. Include your Hotel Name as reference. 
                  Once confirmed, your tracking code will be sent to your email.
                </p>
              )}

              {(settings.bankName || settings.accountNumber || settings.accountName) && (
                <div className="pt-2 border-t border-emerald-500/10">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-500 uppercase mb-1">
                    <CreditCard size={10} />
                    Bank Transfer Details
                  </div>
                  <div className="text-[10px] text-zinc-400 font-mono bg-black/20 p-2 rounded border border-white/5 space-y-1">
                    {settings.bankName && <div>Bank: {settings.bankName}</div>}
                    {settings.accountNumber && <div>Account: {settings.accountNumber}</div>}
                    {settings.accountName && <div>Name: {settings.accountName}</div>}
                  </div>
                </div>
              )}

              {settings.supportEmail && (
                <div className="pt-2 border-t border-emerald-500/10">
                  <a 
                    href={`mailto:${settings.supportEmail}`}
                    className="flex items-center justify-center gap-2 w-full bg-zinc-800 text-zinc-400 py-2 rounded-lg text-[10px] font-bold hover:bg-zinc-700 hover:text-white transition-all"
                  >
                    <Mail size={12} />
                    Contact Support: {settings.supportEmail}
                  </a>
                </div>
              )}
            </div>

            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            {success && <p className="text-emerald-500 text-xs mt-2 font-medium">{success}</p>}

            <button
              disabled={loading}
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-all active:scale-95 mt-6 disabled:opacity-50"
            >
              {loading ? 'Submitting...' : 'Request Code'}
            </button>

            <button
              type="button"
              onClick={() => setIsRequesting(false)}
              className="w-full text-zinc-500 text-sm hover:text-white transition-all mt-2"
            >
              Back to Login
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
            <>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Hotel Name</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  value={formData.hotelName}
                  onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Tracking Code</label>
                <input
                  required
                  type="text"
                  placeholder="Enter your tracking code"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                  value={formData.trackingCode}
                  onChange={(e) => setFormData({ ...formData, trackingCode: e.target.value })}
                />
              </div>
            </>
          )}

          <div>
            <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Email Address</label>
            <input
              required
              type="email"
              disabled={!!user}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors disabled:opacity-50"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

          {!user && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Password</label>
              <div className="relative">
                <input
                  required
                  type={showPassword ? "text" : "password"}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors pr-10"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          )}

          {!isLogin && !user && (
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Confirm Password</label>
              <div className="relative">
                <input
                  required
                  type={showConfirmPassword ? "text" : "password"}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors pr-10"
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
                >
                  {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
          )}

          {isLogin && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setIsResetting(true);
                  setError('');
                  setSuccess('');
                }}
                className="text-xs text-emerald-500 hover:text-emerald-400 transition-colors font-medium"
              >
                Forgot Password?
              </button>
            </div>
          )}

          {error && <p className="text-red-500 text-xs mt-2">{error}</p>}

          <button
            disabled={loading}
            type="submit"
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-all active:scale-95 mt-6 disabled:opacity-50 disabled:active:scale-100"
          >
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : (user ? 'Complete Registration' : 'Register Hotel'))}
          </button>
            </form>

            <div className="mt-6 text-center space-y-2">
          {!user && (
            <button
              type="button"
              onClick={() => {
                setIsLogin(!isLogin);
                setIsResetting(false);
                setError('');
                setSuccess('');
              }}
              className="block w-full text-zinc-500 text-sm hover:text-white transition-all active:opacity-70"
            >
              {isLogin ? "Don't have an account? Register" : "Already have an account? Sign in"}
            </button>
          )}
          {user && (
            <button
              type="button"
              onClick={() => auth.signOut()}
              className="block w-full text-zinc-500 text-sm hover:text-white transition-all active:opacity-70"
            >
              Sign out and try another account
            </button>
          )}
          {isLogin && !user && (
            <button
              type="button"
              onClick={() => setIsRequesting(true)}
              className="block w-full text-emerald-500/80 text-xs font-bold uppercase tracking-widest hover:text-emerald-400 transition-all active:opacity-70"
            >
              Request Tracking Code
            </button>
          )}
        </div>
      </>
    )}
  </motion.div>
</div>
  );
}
