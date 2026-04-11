import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, addDoc, collection, query, where, getDocs, setDoc, updateDoc, getDoc } from 'firebase/firestore';
import { db, auth, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { SystemSettings, OperationType, TrackingCode, Hotel, GlobalAuditLog, PlanType } from '../types';
import { 
  AlertCircle, 
  CreditCard, 
  Info, 
  Mail, 
  CheckCircle2, 
  XCircle,
  ArrowLeft,
  Upload
} from 'lucide-react';
import { cn } from '../utils';
import { motion } from 'motion/react';

export function SubscriptionExpiredPage() {
  const { hotel, profile } = useAuth();
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [isRequesting, setIsRequesting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [notification, setNotification] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [formData, setFormData] = useState({
    hotelName: hotel?.name || '',
    email: profile?.email || '',
    message: '',
  });

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const snap = await getDoc(doc(db, 'system', 'settings'));
        if (snap.exists()) {
          setSettings(snap.data() as SystemSettings);
        }
      } catch (err: any) {
        handleFirestoreError(err, OperationType.GET, 'system/settings');
      }
    };
    fetchSettings();
  }, []);

  const showNotification = (message: string, type: 'success' | 'error' = 'success') => {
    setNotification({ message, type });
    setTimeout(() => setNotification(null), 5000);
  };

  const handleRequestRenewal = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      await addDoc(collection(db, 'trackingCodeRequests'), {
        hotelName: formData.hotelName,
        email: formData.email,
        message: formData.message,
        hotelId: hotel?.id || 'unknown',
        status: 'pending',
        timestamp: new Date().toISOString(),
        type: 'renewal'
      });

      showNotification('Renewal request submitted! We will review your payment and issue your renewal code.');
      setIsRequesting(false);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.CREATE, 'trackingCodeRequests');
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  const [trackingCode, setTrackingCode] = useState('');
  const [isRenewing, setIsRenewing] = useState(false);

  const handleRenewWithCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!trackingCode.trim()) return;
    setLoading(true);

    try {
      // 1. Verify Tracking Code
      const tcQuery = query(collection(db, 'trackingCodes'), where('code', '==', trackingCode.trim()));
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

      // 2. Update Hotel
      if (!hotel) throw new Error('Hotel data not found');

      // Define plan features (same as in AuthPage)
      const planFeatures = {
        Standard: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'settings'],
          limits: { rooms: 30, staff: 5 }
        },
        Premium: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'staff', 'reports', 'settings'],
          limits: { rooms: 100, staff: 20 }
        },
        Enterprise: {
          modules: ['dashboard', 'rooms', 'frontDesk', 'housekeeping', 'kitchen', 'finance', 'reports', 'staff', 'settings'],
          limits: { rooms: 1000, staff: 100 }
        }
      };

      const selectedPlan = (tcData.plan as keyof typeof planFeatures) || 'Standard';
      const features = planFeatures[selectedPlan];

      await setDoc(doc(db, 'hotels', hotel.id), {
        ...hotel,
        subscriptionStatus: 'active',
        subscriptionExpiry: tcData.expiryDate,
        plan: selectedPlan,
        modulesEnabled: features.modules,
        limits: features.limits,
        trackingCode: trackingCode.trim()
      }, { merge: true });

      // 3. Update Tracking Code
      await setDoc(doc(db, 'trackingCodes', tcDoc.id), {
        ...tcData,
        hotelId: hotel.id,
        status: 'used',
        usedAt: new Date().toISOString(),
        usedByHotel: hotel.id
      }, { merge: true });

      showNotification('Subscription renewed successfully! Welcome back.');
      // The AuthContext listener will pick up the changes and redirect automatically
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, 'subscription-renewal');
      showNotification(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-950 flex items-center justify-center p-4 relative">
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
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl p-8 shadow-2xl"
      >
        {!isRequesting && !isRenewing ? (
          <div className="text-center space-y-6">
            <div className="w-20 h-20 bg-red-500/10 text-red-500 rounded-full flex items-center justify-center mx-auto">
              <AlertCircle size={40} />
            </div>
            
            <div className="space-y-2">
              <h1 className="text-3xl font-bold text-white tracking-tight">Subscription Expired</h1>
              <p className="text-zinc-400">
                Your access to <strong>{hotel?.name || 'the system'}</strong> has been suspended due to an expired subscription.
              </p>
            </div>

            <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 text-left space-y-4">
              <div className="flex items-center gap-3 text-emerald-500">
                <Info size={20} />
                <h3 className="font-bold uppercase text-xs tracking-widest">How to regain access</h3>
              </div>
              <p className="text-sm text-zinc-400 leading-relaxed">
                To renew your subscription and restore access to your hotel's data, please complete a payment for your chosen plan and submit a renewal request. Once confirmed, your access will be automatically restored.
              </p>
            </div>

            <div className="flex flex-col gap-3 pt-4">
              <button 
                onClick={() => setIsRenewing(true)}
                className="w-full bg-emerald-500 text-black font-bold py-3 rounded-xl hover:bg-emerald-400 transition-all active:scale-95 flex items-center justify-center gap-2"
              >
                <CheckCircle2 size={20} />
                Renew with Tracking Code
              </button>
              <div className="grid grid-cols-2 gap-3">
                <button 
                  onClick={() => setIsRequesting(true)}
                  className="bg-zinc-800 text-white font-bold py-3 rounded-xl hover:bg-zinc-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <CreditCard size={20} />
                  Request Renewal
                </button>
                <button 
                  onClick={() => auth.signOut()}
                  className="bg-zinc-800 text-white font-bold py-3 rounded-xl hover:bg-zinc-700 transition-all active:scale-95 flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={20} />
                  Sign Out
                </button>
              </div>
            </div>

            <div className="pt-4 flex items-center justify-center gap-2 text-zinc-500 text-sm">
              <Mail size={16} />
              <span>Need help? Contact <a href={`mailto:${settings?.supportEmail || 'support@smartwave.com'}`} className="text-emerald-500 hover:underline">{settings?.supportEmail || 'support@smartwave.com'}</a></span>
            </div>
          </div>
        ) : isRenewing ? (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
              <button 
                onClick={() => setIsRenewing(false)}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-2xl font-bold text-white">Renew Subscription</h2>
            </div>

            <p className="text-zinc-400 text-sm">
              Enter the tracking code you received after payment to instantly restore your access.
            </p>

            <form onSubmit={handleRenewWithCode} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Tracking Code</label>
                <input
                  required
                  type="text"
                  placeholder="Enter your tracking code"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-emerald-500 transition-colors"
                  value={trackingCode}
                  onChange={(e) => setTrackingCode(e.target.value.toUpperCase())}
                />
              </div>

              <button
                disabled={loading || !trackingCode.trim()}
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-4 rounded-xl transition-all active:scale-95 mt-4 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {loading ? 'Validating...' : (
                  <>
                    <CheckCircle2 size={20} />
                    Activate Subscription
                  </>
                )}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex items-center gap-4 mb-2">
              <button 
                onClick={() => setIsRequesting(false)}
                className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all"
              >
                <ArrowLeft size={20} />
              </button>
              <h2 className="text-2xl font-bold text-white">Renew Subscription</h2>
            </div>

            <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-6 space-y-4">
              <div className="flex items-center gap-2 text-emerald-500">
                <CreditCard size={18} />
                <h4 className="text-xs font-bold uppercase tracking-widest">Payment Details</h4>
              </div>
              
              <div className="grid grid-cols-1 gap-4 text-sm">
                <div className="space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold">Bank Name</span>
                  <p className="text-white font-medium">{settings?.bankName || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold">Account Number</span>
                  <p className="text-white font-mono text-lg">{settings?.accountNumber || 'N/A'}</p>
                </div>
                <div className="space-y-1">
                  <span className="text-zinc-500 text-[10px] uppercase font-bold">Account Name</span>
                  <p className="text-white font-medium">{settings?.accountName || 'N/A'}</p>
                </div>
              </div>

              <div className="pt-4 border-t border-emerald-500/10">
                <span className="text-zinc-500 text-[10px] uppercase font-bold block mb-2">Instructions</span>
                <p className="text-xs text-zinc-400 leading-relaxed whitespace-pre-wrap">
                  {settings?.paymentInstructions || 'Please transfer the amount for your plan and upload the receipt below.'}
                </p>
              </div>
            </div>

            <form onSubmit={handleRequestRenewal} className="space-y-4">
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
                <label className="block text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-1">Payment Reference / Message</label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-emerald-500 transition-colors h-24 resize-none"
                  placeholder="Enter transaction ID or any other details..."
                  value={formData.message}
                  onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                />
              </div>

              <button
                disabled={loading}
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold py-3 rounded-xl transition-all active:scale-95 mt-4 flex items-center justify-center gap-2"
              >
                {loading ? 'Submitting...' : (
                  <>
                    <Upload size={18} />
                    Submit Renewal Request
                  </>
                )}
              </button>
            </form>
          </div>
        )}
      </motion.div>
    </div>
  );
}
