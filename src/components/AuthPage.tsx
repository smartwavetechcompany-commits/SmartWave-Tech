import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { auth, db, handleFirestoreError } from '../firebase';
import { motion } from 'motion/react';
import { Hotel, TrackingCode, UserProfile, OperationType, PlanType } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { ExternalLink, CreditCard, Info, Eye, EyeOff, ArrowLeft, CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../utils';

export function AuthPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [isRequesting, setIsRequesting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [resetCooldown, setResetCooldown] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [settings, setSettings] = useState({
    paymentLink: '',
    bankDetails: '',
  });

  const { user, profile } = useAuth();

  useEffect(() => {
    // If user is logged in but has no profile, force registration mode
    if (user && !profile) {
      setIsLogin(false);
      setFormData(prev => ({ ...prev, email: user.email || '' }));
    }
  }, [user, profile]);

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
      await addDoc(collection(db, 'trackingCodeRequests'), {
        hotelName: formData.hotelName,
        email: formData.email,
        phone: formData.phone,
        plan: formData.plan,
        status: 'pending',
        timestamp: new Date().toISOString(),
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
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
        console.log("Login successful in AuthPage");
      } else {
        // Registration Flow
        if (!user && formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        // 1. Check for existing staff profile by email
        const staffQuery = query(collection(db, 'users'), where('email', '==', formData.email.toLowerCase()), where('role', '==', 'staff'));
        const staffSnap = await getDocs(staffQuery);
        let existingStaffProfile: UserProfile | null = null;
        let staffDocId: string | null = null;

        if (!staffSnap.empty) {
          // Found a pre-created staff profile
          const doc = staffSnap.docs[0];
          existingStaffProfile = doc.data() as UserProfile;
          staffDocId = doc.id;
        }

        // 2. Verify Tracking Code (Only if not already a staff member)
        let tcData: TrackingCode | null = null;
        if (!existingStaffProfile) {
          if (!formData.trackingCode) {
            throw new Error('Tracking code is required for new hotel registration');
          }
          try {
            const tcRef = doc(db, 'trackingCodes', formData.trackingCode.toUpperCase());
            const tcDoc = await getDoc(tcRef);
            
            if (!tcDoc.exists()) {
              throw new Error('Invalid tracking code');
            }
            tcData = tcDoc.data() as TrackingCode;
            
            if (tcData.status !== 'active' || new Date(tcData.expiryDate) < new Date()) {
              throw new Error('Tracking code expired or inactive');
            }
            if (tcData.hotelId) {
              throw new Error('Tracking code already used');
            }
          } catch (err: any) {
            if (err.message.includes('Invalid tracking code') || err.message.includes('expired') || err.message.includes('used')) {
              throw err;
            }
            handleFirestoreError(err, OperationType.GET, `trackingCodes/${formData.trackingCode}`);
            throw err;
          }
        }

        // 3. Create User if not already logged in
        let currentUser = user;
        if (!currentUser) {
          const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
          currentUser = userCredential.user;
        }

        // 2.5 Record Registration Attempt
        try {
          await addDoc(collection(db, 'registration'), {
            uid: currentUser.uid,
            email: formData.email,
            hotelName: formData.hotelName || (existingStaffProfile ? 'Staff Registration' : ''),
            trackingCode: formData.trackingCode,
            timestamp: new Date().toISOString(),
            status: 'pending'
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, 'registration');
        }

        // 3. Generate IDs and Prepare Data
        // If it's a staff member, they already have a hotelId from the existing profile
        const hotelId = existingStaffProfile ? existingStaffProfile.hotelId : `hotel_${Math.random().toString(36).substr(2, 9)}`;
        const selectedPlan = (tcData.plan?.toLowerCase() as PlanType) || 'standard';
        
        // Define plan features
        const planFeatures = {
          Standard: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'settings'],
            limits: { rooms: 30, staff: 5 }
          },
          Premium: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'staff', 'reports', 'settings', 'guests', 'maintenance'],
            limits: { rooms: 100, staff: 20 }
          },
          Enterprise: {
            modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'kitchen', 'finance', 'reports', 'staff', 'settings', 'guests', 'maintenance', 'inventory'],
            limits: { rooms: 1000, staff: 100 }
          }
        };

        const features = planFeatures[selectedPlan === 'standard' ? 'Standard' : selectedPlan === 'premium' ? 'Premium' : 'Enterprise'];

        // 4. Create User Profile
        const profileData: UserProfile = existingStaffProfile ? {
          ...existingStaffProfile,
          uid: currentUser.uid, // Update with real UID
          status: 'active',
          displayName: formData.hotelName || existingStaffProfile.displayName || currentUser.displayName || formData.email.split('@')[0]
        } : {
          uid: currentUser.uid,
          email: formData.email,
          hotelId: hotelId,
          role: 'hotelAdmin',
          createdAt: new Date().toISOString(),
          status: 'active',
          displayName: formData.hotelName + ' Admin',
          permissions: ['all'],
          subscriptionExpiry: tcData.expiryDate
        };

        try {
          // If we found an existing staff doc with a different ID (like tempUid), delete it first
          if (staffDocId && staffDocId !== currentUser.uid) {
            await deleteDoc(doc(db, 'users', staffDocId));
          }
          await setDoc(doc(db, 'users', currentUser.uid), profileData);
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
            createdAt: new Date().toISOString(),
            adminUIDs: [currentUser.uid],
          };

          try {
            await setDoc(doc(db, 'hotels', hotelId), hotelData);
          } catch (err) {
            handleFirestoreError(err, OperationType.CREATE, `hotels/${hotelId}`);
            throw err;
          }

          // 6. Update Tracking Code
          try {
            await updateDoc(doc(db, 'trackingCodes', formData.trackingCode.toUpperCase()), { 
              status: 'used',
              usedAt: new Date().toISOString(),
              usedByHotel: hotelId
            });
          } catch (err) {
            handleFirestoreError(err, OperationType.UPDATE, `trackingCodes/${formData.trackingCode}`);
            throw err;
          }
        }

        // 7. Record Registration Attempt
        try {
          await addDoc(collection(db, 'registration'), {
            uid: currentUser.uid,
            email: formData.email,
            hotelName: formData.hotelName,
            trackingCode: formData.trackingCode,
            timestamp: new Date().toISOString(),
            status: 'completed'
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
        if (err.code === 'auth/invalid-credential' || err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password') {
          errorMessage = 'Invalid email or password. Please check your credentials and try again.';
        } else if (err.code === 'auth/too-many-requests') {
          errorMessage = 'Too many failed login attempts. Please try again later or reset your password.';
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
          <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center text-black mx-auto mb-4 font-bold text-xl">
            SW
          </div>
          <h2 className="text-2xl font-bold text-white">SmartWave PMS</h2>
          <p className="text-zinc-400 text-sm mt-2">
            {isResetting
              ? 'Reset your password'
              : isRequesting 
                ? 'Request a tracking code to start' 
                : isLogin 
                  ? 'Welcome back to your hotel management' 
                  : 'Register your hotel organization'}
          </p>
        </div>

        {isResetting ? (
          <form onSubmit={handleResetPassword} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Email Address</label>
              <input
                required
                type="email"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
                value={formData.email}
                onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                placeholder="Enter your registered email"
              />
            </div>

            {error && <p className="text-red-500 text-xs mt-2">{error}</p>}
            {success && <p className="text-emerald-500 text-xs mt-2 font-medium">{success}</p>}

            <button
              disabled={loading || resetCooldown > 0}
              type="submit"
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-lg transition-all active:scale-95 mt-6 disabled:opacity-50"
            >
              {loading ? 'Sending...' : resetCooldown > 0 ? `Resend in ${resetCooldown}s` : 'Send Reset Link'}
            </button>

            <button
              type="button"
              onClick={() => {
                setIsResetting(false);
                setError('');
                setSuccess('');
              }}
              className="w-full flex items-center justify-center gap-2 text-zinc-500 text-sm hover:text-white transition-all mt-4"
            >
              <ArrowLeft size={16} />
              Back to Login
            </button>
          </form>
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
              
              <p className="text-[10px] text-zinc-400 leading-relaxed">
                After submitting, please complete your payment. Include your Hotel Name as reference. 
                Once confirmed, your tracking code will be sent to your email.
              </p>

              {settings.paymentLink && (
                <a 
                  href={settings.paymentLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 w-full bg-emerald-500/10 text-emerald-500 py-2 rounded-lg text-xs font-bold hover:bg-emerald-500/20 transition-all"
                >
                  <ExternalLink size={14} />
                  Pay Online Now
                </a>
              )}

              {settings.bankDetails && (
                <div className="pt-2 border-t border-emerald-500/10">
                  <div className="flex items-center gap-1 text-[10px] font-bold text-zinc-500 uppercase mb-1">
                    <CreditCard size={10} />
                    Bank Transfer Details
                  </div>
                  <pre className="text-[10px] text-zinc-400 font-mono whitespace-pre-wrap bg-black/20 p-2 rounded border border-white/5">
                    {settings.bankDetails}
                  </pre>
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
              onClick={() => auth.signOut()}
              className="block w-full text-zinc-500 text-sm hover:text-white transition-all active:opacity-70"
            >
              Sign out and try another account
            </button>
          )}
          {isLogin && !user && (
            <button
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
