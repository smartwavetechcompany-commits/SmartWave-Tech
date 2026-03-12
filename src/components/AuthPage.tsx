import React, { useEffect, useState } from 'react';
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, onSnapshot } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { motion } from 'motion/react';
import { Hotel, TrackingCode, UserProfile } from '../types';
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

  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'system', 'settings'), (snap) => {
      if (snap.exists()) {
        setSettings(snap.data() as any);
      }
    }, (err) => {
      // Silently fail for public users if permissions aren't set yet
    });
    return () => unsub();
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
        await signInWithEmailAndPassword(auth, formData.email, formData.password);
      } else {
        // Registration Flow
        if (formData.password !== formData.confirmPassword) {
          throw new Error('Passwords do not match');
        }
        // 1. Verify Tracking Code
        const tcQuery = query(collection(db, 'trackingCodes'), where('code', '==', formData.trackingCode));
        const tcSnap = await getDocs(tcQuery);

        if (tcSnap.empty) {
          throw new Error('Invalid tracking code');
        }

        const tcDoc = tcSnap.docs[0];
        const tcData = tcDoc.data() as TrackingCode;

        if (tcData.status !== 'active' || new Date(tcData.expiryDate) < new Date()) {
          throw new Error('Tracking code expired or inactive');
        }

        if (tcData.hotelId) {
          throw new Error('Tracking code already used');
        }

        // 2. Create User
        const userCredential = await createUserWithEmailAndPassword(auth, formData.email, formData.password);
        const user = userCredential.user;

        // 3. Create Hotel
        const hotelId = `hotel_${Math.random().toString(36).substr(2, 9)}`;
        const hotelData: Hotel = {
          id: hotelId,
          name: formData.hotelName,
          trackingCode: formData.trackingCode,
          expiryDate: tcData.expiryDate,
          status: 'active',
          subscriptionType: tcData.type,
          createdAt: new Date().toISOString(),
          adminUIDs: [user.uid],
        };

        await setDoc(doc(db, 'hotels', hotelId), hotelData);

        // 4. Update Tracking Code
        await setDoc(doc(db, 'trackingCodes', tcDoc.id), { ...tcData, hotelId }, { merge: true });

        // 5. Create User Profile
        const profile: UserProfile = {
          uid: user.uid,
          email: formData.email,
          hotelId: hotelId,
          role: 'hotelAdmin',
          permissions: ['all'],
          status: 'active',
          displayName: formData.hotelName + ' Admin',
        };

        await setDoc(doc(db, 'users', user.uid), profile);
        showNotification('Registration successful!');
      }
    } catch (err: any) {
      setError(err.message);
      showNotification(err.message, 'error');
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
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors"
              value={formData.email}
              onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            />
          </div>

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

          {!isLogin && (
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
            {loading ? 'Processing...' : (isLogin ? 'Sign In' : 'Register Hotel')}
          </button>
            </form>

            <div className="mt-6 text-center space-y-2">
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
          {isLogin && (
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
