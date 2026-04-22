import React, { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, setDoc, addDoc, collection, getDocs, query, writeBatch } from 'firebase/firestore';
import { sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { db, auth } from '../firebase';
import { Tax } from '../types';
import { ConfirmModal } from './ConfirmModal';
import { 
  User, 
  Building2, 
  Shield, 
  Key, 
  Bell, 
  Smartphone,
  Save,
  Lock,
  Mail,
  Calendar,
  CreditCard,
  Eye,
  EyeOff,
  Info,
  Percent,
  Receipt,
  Plus,
  Trash2,
  CheckCircle2,
  XCircle,
  Moon,
  Sun,
  Coins,
  Globe,
  RefreshCw,
  Clock
} from 'lucide-react';
import { cn, safeStringify } from '../utils';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';

import { useTranslation } from 'react-i18next';

export function Settings() {
  const { t, i18n } = useTranslation();
  const { profile, hotel, isSubscriptionActive, systemSettings, theme, setTheme } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'hotel' | 'branding' | 'security' | 'support' | 'taxes' | 'preferences' | 'danger'>('profile');
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  const [showConfirmSystemReset, setShowConfirmSystemReset] = useState(false);
  const [showPasswords, setShowPasswords] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    hotelName: hotel?.name || '',
    defaultCurrency: hotel?.defaultCurrency || 'NGN',
    exchangeRate: hotel?.exchangeRate || 1500,
    defaultCheckInTime: hotel?.defaultCheckInTime || '14:00',
    defaultCheckOutTime: hotel?.defaultCheckOutTime || '12:00',
    overstayChargeTime: hotel?.overstayChargeTime || '14:00',
    autoChargeOverstays: hotel?.autoChargeOverstays ?? true,
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
    branding: {
      logoUrl: hotel?.branding?.logoUrl || '',
      primaryColor: hotel?.branding?.primaryColor || '#10b981',
      secondaryColor: hotel?.branding?.secondaryColor || '#18181b',
      address: hotel?.branding?.address || '',
      phone: hotel?.branding?.phone || '',
      email: hotel?.branding?.email || '',
      footerNotes: hotel?.branding?.footerNotes || '',
      organizationName: hotel?.branding?.organizationName || hotel?.name || '',
      accountNumber: hotel?.branding?.accountNumber || '',
      bankName: hotel?.branding?.bankName || '',
      greeting: hotel?.branding?.greeting || 'Thank you for staying with us!',
      statusColors: hotel?.branding?.statusColors || {
        clean: '#10b981',
        dirty: '#ef4444',
        occupied: '#3b82f6',
        maintenance: '#f59e0b',
        vacant: '#71717a',
        out_of_service: '#18181b'
      }
    }
  });

  useEffect(() => {
    if (hotel) {
      setFormData(prev => ({
        ...prev,
        hotelName: hotel.name || prev.hotelName,
        defaultCurrency: hotel.defaultCurrency || prev.defaultCurrency,
        exchangeRate: hotel.exchangeRate || prev.exchangeRate,
        defaultCheckInTime: hotel.defaultCheckInTime || prev.defaultCheckInTime,
        defaultCheckOutTime: hotel.defaultCheckOutTime || prev.defaultCheckOutTime,
        overstayChargeTime: hotel.overstayChargeTime || prev.overstayChargeTime,
        autoChargeOverstays: hotel.autoChargeOverstays ?? prev.autoChargeOverstays,
        branding: {
          ...prev.branding,
          logoUrl: hotel.branding?.logoUrl || prev.branding.logoUrl,
          primaryColor: hotel.branding?.primaryColor || prev.branding.primaryColor,
          secondaryColor: hotel.branding?.secondaryColor || prev.branding.secondaryColor,
          address: hotel.branding?.address || prev.branding.address,
          phone: hotel.branding?.phone || prev.branding.phone,
          email: hotel.branding?.email || prev.branding.email,
          footerNotes: hotel.branding?.footerNotes || prev.branding.footerNotes,
          organizationName: hotel.branding?.organizationName || hotel.name || prev.branding.organizationName,
          accountNumber: hotel.branding?.accountNumber || prev.branding.accountNumber,
          bankName: hotel.branding?.bankName || prev.branding.bankName,
          greeting: hotel.branding?.greeting || prev.branding.greeting,
          statusColors: hotel.branding?.statusColors || prev.branding.statusColors
        }
      }));
    }
  }, [hotel]);

  const [localTaxes, setLocalTaxes] = useState<Tax[]>(hotel?.taxes || []);

  useEffect(() => {
    if (hotel?.taxes) {
      setLocalTaxes(hotel?.taxes);
    }
  }, [hotel?.taxes]);

  const handleUpdateLocalTax = (index: number, updates: Partial<Tax>) => {
    const updated = [...localTaxes];
    updated[index] = { ...updated[index], ...updates };
    setLocalTaxes(updated);
  };

  const handleSaveTaxes = async () => {
    if (!hotel?.id) return;
    setIsSaving(true);
    try {
      await setDoc(doc(db, 'hotels', hotel.id), {
        taxes: localTaxes
      }, { merge: true });
      toast.success('Taxes updated successfully');
    } catch (err: any) {
      console.error("Save taxes error:", err.message || safeStringify(err));
      toast.error('Failed to update taxes');
    } finally {
      setIsSaving(false);
    }
  };
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!auth.currentUser || !profile) return;
    if (formData.newPassword !== formData.confirmPassword) {
      toast.error('New passwords do not match');
      return;
    }

    setIsSaving(true);
    try {
      // Re-authenticate user first
      const credential = EmailAuthProvider.credential(auth.currentUser.email!, formData.currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
      
      // Update password
      await updatePassword(auth.currentUser, formData.newPassword);
      
      // Log action
      if (profile.hotelId) {
        await addDoc(collection(db, 'hotels', profile.hotelId, 'activityLogs'), {
          timestamp: new Date().toISOString(),
          userId: profile.uid,
          userEmail: profile.email,
          userRole: profile.role,
          action: 'CHANGE_PASSWORD',
          resource: 'User Security',
          hotelId: profile.hotelId,
          module: 'Security'
        });
      }

      toast.success('Password changed successfully!');
      setFormData({ ...formData, currentPassword: '', newPassword: '', confirmPassword: '' });
    } catch (err: any) {
      console.error("Change password error:", err.message || safeStringify(err));
      if (err.code === 'auth/wrong-password') {
        toast.error('Current password is incorrect');
      } else {
        toast.error('Failed to change password. ' + err.message);
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'users', profile.uid), {
        displayName: formData.displayName,
      }, { merge: true });

      // Log action
      if (profile.hotelId) {
        await addDoc(collection(db, 'hotels', profile.hotelId, 'activityLogs'), {
          timestamp: new Date().toISOString(),
          userId: profile.uid,
          userEmail: profile.email,
          userRole: profile.role,
          action: 'UPDATE_PROFILE',
          resource: 'User Profile',
          hotelId: profile.hotelId,
          module: 'Security'
        });
      }

      toast.success('Profile updated successfully!');
    } catch (err: any) {
      console.error("Save profile error:", err.message || safeStringify(err));
      toast.error('Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const fetchExchangeRate = () => {
    // Mock fetching real-time exchange rate
    const mockRate = 1500 + Math.floor(Math.random() * 200);
    setFormData(prev => ({ ...prev, exchangeRate: mockRate }));
    toast.success(`Exchange rate updated to ${mockRate} NGN/USD`);
  };

  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'hotels', hotel.id), {
        name: formData.hotelName,
        defaultCurrency: formData.defaultCurrency,
        exchangeRate: formData.exchangeRate,
        defaultCheckInTime: formData.defaultCheckInTime,
        defaultCheckOutTime: formData.defaultCheckOutTime,
        overstayChargeTime: formData.overstayChargeTime,
        autoChargeOverstays: formData.autoChargeOverstays,
      }, { merge: true });

      // Log action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'UPDATE_HOTEL_SETTINGS',
        resource: `Hotel: ${formData.hotelName} (Currency: ${formData.defaultCurrency}, Rate: ${formData.exchangeRate})`,
        hotelId: hotel.id
      });

      toast.success('Hotel settings updated!');
    } catch (err: any) {
      console.error("Save hotel error:", err.message || safeStringify(err));
      toast.error('Failed to update hotel settings.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveBranding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'hotels', hotel.id), {
        branding: formData.branding,
      }, { merge: true });

      // Log action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'UPDATE_HOTEL_BRANDING',
        resource: `Hotel Branding: ${hotel.name}`,
        hotelId: hotel.id
      });

      toast.success('Hotel branding updated!');
    } catch (err: any) {
      console.error("Save branding error:", err.message || safeStringify(err));
      toast.error('Failed to update hotel branding.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!profile?.email) return;
    try {
      await sendPasswordResetEmail(auth, profile.email);
      toast.success('Password reset link sent to: ' + profile.email);
    } catch (err: any) {
      console.error("Reset password error:", err.message || safeStringify(err));
      toast.error('Failed to send reset email. Please try again later.');
    } finally {
      setShowConfirmReset(false);
    }
  };

  const handleSystemReset = async () => {
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;
    
    setIsSaving(true);
    try {
      const collectionsToClear = [
        'reservations',
        'guests',
        'ledger',
        'finance',
        'activityLogs',
        'auditLogs',
        'maintenance',
        'housekeeping',
        'inventory',
        'purchaseOrders',
        'suppliers',
        'accounts',
        'commissions',
        'corporate_accounts'
      ];

      for (const collName of collectionsToClear) {
        const q = query(collection(db, 'hotels', hotel.id, collName));
        const snap = await getDocs(q);
        
        // Delete in batches of 500 (Firestore limit)
        const batches = [];
        let currentBatch = writeBatch(db);
        let count = 0;

        for (const docSnap of snap.docs) {
          currentBatch.delete(docSnap.ref);
          count++;
          if (count === 500) {
            batches.push(currentBatch.commit());
            currentBatch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) {
          batches.push(currentBatch.commit());
        }
        await Promise.all(batches);
      }

      // Reset room statuses to vacant/clean
      const roomsSnap = await getDocs(collection(db, 'hotels', hotel.id, 'rooms'));
      const roomBatches = [];
      let roomBatch = writeBatch(db);
      let rCount = 0;
      for (const rSnap of roomsSnap.docs) {
        roomBatch.update(rSnap.ref, {
          status: 'dirty',
          housekeepingStatus: 'dirty',
          currentGuestId: null,
          currentReservationId: null,
          assignedTo: null
        });
        rCount++;
        if (rCount === 500) {
          roomBatches.push(roomBatch.commit());
          roomBatch = writeBatch(db);
          rCount = 0;
        }
      }
      if (rCount > 0) {
        roomBatches.push(roomBatch.commit());
      }
      await Promise.all(roomBatches);

      // Log the reset
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'SYSTEM_RESET',
        resource: 'All System Data',
        hotelId: hotel.id
      });

      toast.success('System data cleared successfully!');
      setShowConfirmSystemReset(false);
      // Refresh page to clear local state
      window.location.reload();
    } catch (err: any) {
      console.error("System reset error:", err.message || safeStringify(err));
      toast.error('Failed to reset system data.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">{t('settings.title')}</h1>
        <p className="text-zinc-400">Manage your account and system preferences</p>
      </header>

      <div className="flex gap-8">
        {/* Sidebar Tabs */}
        <aside className="w-64 space-y-2">
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'profile' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <User size={18} />
            {t('settings.profile')}
          </button>
          
          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('hotel')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'hotel' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Building2 size={18} />
              {t('settings.hotelSettings')}
            </button>
          )}

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('branding')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'branding' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Smartphone size={18} />
              {t('settings.branding')}
            </button>
          )}

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('taxes')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'taxes' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
              )}
            >
              <Percent size={18} />
              {t('settings.taxes')}
            </button>
          )}

          <button 
            onClick={() => setActiveTab('preferences')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'preferences' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Moon size={18} />
            {t('settings.preferences')}
          </button>

          <button 
            onClick={() => setActiveTab('security')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'security' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Shield size={18} />
            {t('settings.security')}
          </button>

          <button 
            onClick={() => setActiveTab('support')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'support' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-50"
            )}
          >
            <Mail size={18} />
            {t('settings.support')}
          </button>

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('danger')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'danger' ? "bg-red-500 text-white" : "text-red-500/60 hover:bg-red-500/10 hover:text-red-500"
              )}
            >
              <Shield size={18} />
              {t('settings.dangerZone')}
            </button>
          )}
        </aside>

        {/* Main Content */}
        <main className="flex-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
          {activeTab === 'profile' && (
            <form onSubmit={handleSaveProfile} className="space-y-6">
              <div className="flex items-center gap-4 mb-8">
                <div className="w-20 h-20 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500 border-2 border-zinc-700">
                  <User size={40} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-50">{profile?.displayName || 'User'}</h3>
                  <p className="text-sm text-zinc-500 capitalize">{profile?.role.replace('hotelAdmin', 'Hotel Administrator')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Display Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.displayName}
                    onChange={(e) => setFormData({ ...formData, displayName: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Email Address</label>
                  <div className="flex items-center gap-3 w-full bg-zinc-800/50 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-500 cursor-not-allowed">
                    <Mail size={16} />
                    {profile?.email}
                  </div>
                  <p className="text-[10px] text-zinc-600 mt-1 italic">Email cannot be changed directly for security reasons.</p>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 flex justify-end">
                <button 
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'hotel' && profile?.role === 'hotelAdmin' && (
            <form onSubmit={handleSaveHotel} className="space-y-6">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Hotel Configuration</h3>
                <p className="text-sm text-zinc-500">Manage your property details, general information, and currency settings</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Hotel Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.hotelName}
                    onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.phone}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, phone: e.target.value } 
                    })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Email Address</label>
                  <input 
                    type="email" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.email}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, email: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Address</label>
                  <textarea 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                    value={formData.branding.address}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, address: e.target.value } 
                    })}
                  />
                </div>

                <div className="pt-6 border-t border-zinc-800 md:col-span-2">
                  <h4 className="text-sm font-bold text-zinc-50 mb-4 flex items-center gap-2">
                    <Coins size={18} className="text-emerald-500" />
                    Currency & Exchange Rate
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Currency (Base)</label>
                      <select
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCurrency}
                        onChange={(e) => setFormData({ ...formData, defaultCurrency: e.target.value as 'NGN' | 'USD' })}
                      >
                        <option value="NGN">NGN (Nigerian Naira)</option>
                        <option value="USD">USD (US Dollar)</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Exchange Rate (1 USD = ? NGN)</label>
                      <div className="flex gap-2">
                        <input 
                          type="number" 
                          className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                          value={formData.exchangeRate}
                          onChange={(e) => setFormData({ ...formData, exchangeRate: parseFloat(e.target.value) })}
                        />
                        <button 
                          type="button"
                          onClick={fetchExchangeRate}
                          className="px-3 py-2 bg-zinc-800 text-zinc-300 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all flex items-center gap-2 whitespace-nowrap"
                        >
                          <RefreshCw size={14} />
                          Fetch Rate
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="pt-6 border-t border-zinc-800 md:col-span-2">
                  <h4 className="text-sm font-bold text-zinc-50 mb-4 flex items-center gap-2">
                    <Clock size={18} className="text-blue-500" />
                    Default Stay Times
                  </h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Check-In Time</label>
                      <input 
                        type="time" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCheckInTime}
                        onChange={(e) => setFormData({ ...formData, defaultCheckInTime: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Default Check-Out Time</label>
                      <input 
                        type="time" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.defaultCheckOutTime}
                        onChange={(e) => setFormData({ ...formData, defaultCheckOutTime: e.target.value })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Overstay Charge Trigger Time</label>
                      <input 
                        type="time" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={formData.overstayChargeTime}
                        onChange={(e) => setFormData({ ...formData, overstayChargeTime: e.target.value })}
                      />
                      <p className="text-[10px] text-zinc-500 mt-1 italic">Guests still checked in after this time on their check-out date will be charged for an extra night.</p>
                    </div>
                    <div className="flex items-center gap-3 pt-2">
                      <input 
                        type="checkbox"
                        id="autoChargeOverstays"
                        className="w-4 h-4 rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                        checked={formData.autoChargeOverstays}
                        onChange={(e) => setFormData({ ...formData, autoChargeOverstays: e.target.checked })}
                      />
                      <label htmlFor="autoChargeOverstays" className="text-sm text-zinc-400 font-medium cursor-pointer">
                        Auto-charge extra night for overstays
                      </label>
                    </div>
                  </div>
                </div>
                
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4 md:col-span-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CreditCard size={18} className="text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-zinc-50">Subscription Status</p>
                        <p className="text-xs text-zinc-500">{hotel?.plan} Plan</p>
                      </div>
                    </div>
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      isSubscriptionActive ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {hotel?.subscriptionStatus}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <Calendar size={14} />
                    Expires on {hotel?.subscriptionExpiry ? (
                      isValid(new Date(hotel.subscriptionExpiry)) 
                        ? format(new Date(hotel.subscriptionExpiry), 'MMMM d, yyyy') 
                        : 'N/A'
                    ) : 'N/A'}
                  </div>

                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <Key size={14} />
                    Tracking Code: <span className="font-mono text-zinc-300">{hotel?.trackingCode}</span>
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 flex justify-end">
                <button 
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : 'Update Hotel'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'branding' && profile?.role === 'hotelAdmin' && (
            <form onSubmit={handleSaveBranding} className="space-y-6">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Hotel Branding</h3>
                <p className="text-sm text-zinc-500">Customize your hotel's visual identity and receipt details</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Logo URL</label>
                  <input 
                    type="url" 
                    placeholder="https://example.com/logo.png"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.logoUrl}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, logoUrl: e.target.value } 
                    })}
                  />
                </div>
                
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Primary Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color" 
                      className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-lg p-1 outline-none cursor-pointer"
                      value={formData.branding.primaryColor}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        branding: { ...formData.branding, primaryColor: e.target.value } 
                      })}
                    />
                    <input 
                      type="text" 
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none font-mono text-sm"
                      value={formData.branding.primaryColor}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        branding: { ...formData.branding, primaryColor: e.target.value } 
                      })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Secondary Color</label>
                  <div className="flex gap-2">
                    <input 
                      type="color" 
                      className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-lg p-1 outline-none cursor-pointer"
                      value={formData.branding.secondaryColor}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        branding: { ...formData.branding, secondaryColor: e.target.value } 
                      })}
                    />
                    <input 
                      type="text" 
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none font-mono text-sm"
                      value={formData.branding.secondaryColor}
                      onChange={(e) => setFormData({ 
                        ...formData, 
                        branding: { ...formData.branding, secondaryColor: e.target.value } 
                      })}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Contact Phone</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.phone}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, phone: e.target.value } 
                    })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Contact Email</label>
                  <input 
                    type="email" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.email}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, email: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Organization Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.organizationName}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, organizationName: e.target.value } 
                    })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Bank Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.bankName}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, bankName: e.target.value } 
                    })}
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Account Number</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={formData.branding.accountNumber}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, accountNumber: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Receipt Greeting</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    placeholder="e.g. Thank you for your business!"
                    value={formData.branding.greeting}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, greeting: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Address</label>
                  <textarea 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                    value={formData.branding.address}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, address: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Receipt Footer Notes</label>
                  <textarea 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                    placeholder="Thank you for staying with us!"
                    value={formData.branding.footerNotes}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, footerNotes: e.target.value } 
                    })}
                  />
                </div>

                <div className="md:col-span-2 pt-6 border-t border-zinc-800">
                  <h4 className="text-sm font-bold text-zinc-50 mb-4">Room Status Colors</h4>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    {(['clean', 'dirty', 'occupied', 'maintenance', 'vacant', 'out_of_service'] as const).map((status) => (
                      <div key={status}>
                        <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">
                          {status.replace(/_/g, ' ')}
                        </label>
                        <div className="flex gap-2">
                          <input 
                            type="color" 
                            className="w-10 h-10 bg-zinc-950 border border-zinc-800 rounded-lg p-1 outline-none cursor-pointer"
                            value={formData.branding.statusColors?.[status] || '#71717a'}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { 
                                ...formData.branding, 
                                statusColors: { 
                                  ...formData.branding.statusColors, 
                                  [status]: e.target.value 
                                } 
                              } 
                            })}
                          />
                          <input 
                            type="text" 
                            className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none font-mono text-sm"
                            value={formData.branding.statusColors?.[status] || '#71717a'}
                            onChange={(e) => setFormData({ 
                              ...formData, 
                              branding: { 
                                ...formData.branding, 
                                statusColors: { 
                                  ...formData.branding.statusColors, 
                                  [status]: e.target.value 
                                } 
                              } 
                            })}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="pt-6 border-t border-zinc-800 flex justify-end">
                <button 
                  disabled={isSaving}
                  className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100"
                >
                  <Save size={18} />
                  {isSaving ? 'Saving...' : 'Save Branding'}
                </button>
              </div>
            </form>
          )}

          {activeTab === 'preferences' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">System Preferences</h3>
                <p className="text-sm text-zinc-500">Customize your personal experience and interface settings</p>
              </div>

              <div className="space-y-6">
                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                      theme === 'dark' ? "bg-zinc-800 text-zinc-50" : "bg-zinc-200 text-zinc-900"
                    )}>
                      {theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}
                    </div>
                    <div>
                      <p className="font-bold text-zinc-50">{t('settings.darkMode')}</p>
                      <p className="text-xs text-zinc-500">Switch between light and dark visual themes</p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                    className={cn(
                      "w-14 h-8 rounded-full p-1 transition-all duration-300",
                      theme === 'dark' ? "bg-emerald-500" : "bg-zinc-700"
                    )}
                  >
                    <div className={cn(
                      "w-6 h-6 rounded-full bg-zinc-50 shadow-lg transition-all duration-300 transform",
                      theme === 'dark' ? "translate-x-6" : "translate-x-0"
                    )} />
                  </button>
                </div>

                <div className="flex items-center justify-between p-4 bg-zinc-950 border border-zinc-800 rounded-2xl">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-2xl bg-zinc-800 text-zinc-50 flex items-center justify-center">
                      <Globe size={24} />
                    </div>
                    <div>
                      <p className="font-bold text-zinc-50">{t('settings.language')}</p>
                      <p className="text-xs text-zinc-500">Select your preferred display language</p>
                    </div>
                  </div>
                  <select 
                    className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1 text-sm text-zinc-50 focus:border-emerald-500 outline-none"
                    value={i18n.language}
                    onChange={(e) => {
                      i18n.changeLanguage(e.target.value);
                      toast.success(`Language changed to ${e.target.value === 'en' ? 'English' : e.target.value === 'fr' ? 'French' : 'Spanish'}`);
                    }}
                  >
                    <option value="en">English</option>
                    <option value="fr">French</option>
                    <option value="es">Spanish</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'security' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Lock size={20} className="text-emerald-500" />
                  Change Password
                </h3>
                <form onSubmit={handleChangePassword} className="space-y-4 max-w-md">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Current Password</label>
                    <div className="relative">
                      <input 
                        required
                        type={showPasswords ? "text" : "password"}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none pr-10"
                        value={formData.currentPassword}
                        onChange={(e) => setFormData({ ...formData, currentPassword: e.target.value })}
                      />
                      <button 
                        type="button"
                        onClick={() => setShowPasswords(!showPasswords)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-50"
                      >
                        {showPasswords ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">New Password</label>
                    <input 
                      required
                      type={showPasswords ? "text" : "password"}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={formData.newPassword}
                      onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Confirm New Password</label>
                    <input 
                      required
                      type={showPasswords ? "text" : "password"}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={formData.confirmPassword}
                      onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    />
                  </div>
                  <button 
                    disabled={isSaving}
                    type="submit"
                    className="bg-emerald-500 text-black px-6 py-2 rounded-lg font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </form>
              </div>

              <div className="pt-8 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Mail size={20} className="text-emerald-500" />
                  Email Password Reset
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Alternatively, we can send a reset link to your registered email address.
                </p>
                <button 
                  className="px-6 py-2 rounded-lg border border-zinc-800 text-zinc-50 hover:bg-zinc-800 transition-all active:scale-95 font-medium disabled:opacity-50"
                  onClick={() => setShowConfirmReset(true)}
                >
                  Request Password Reset Link
                </button>
              </div>

              <ConfirmModal
                isOpen={showConfirmReset}
                title="Reset Password"
                message={`Are you sure you want to request a password reset link? It will be sent to ${profile?.email}.`}
                onConfirm={handleResetPassword}
                onCancel={() => setShowConfirmReset(false)}
                type="warning"
                confirmText="Send Reset Link"
              />

              <div className="pt-8 border-t border-zinc-800">
                <h3 className="text-lg font-bold text-zinc-50 mb-4 flex items-center gap-2">
                  <Smartphone size={20} className="text-emerald-500" />
                  Two-Factor Authentication
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Add an extra layer of security to your account by enabling 2FA.
                </p>
                <button className="px-6 py-2 rounded-lg bg-zinc-800 text-zinc-500 cursor-not-allowed font-medium">
                  Enable 2FA (Coming Soon)
                </button>
              </div>
            </div>
          )}
          {activeTab === 'taxes' && (
            <div className="space-y-8">
              <div className="flex items-center justify-between mb-8">
                <div>
                  <h3 className="text-lg font-bold text-zinc-50 mb-1">Tax Management</h3>
                  <p className="text-sm text-zinc-500">Configure taxes that apply to reservations and services.</p>
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => {
                      const newTax: Tax = {
                        id: Math.random().toString(36).substr(2, 9),
                        name: '',
                        percentage: 0,
                        isInclusive: false,
                        showOnReceipt: true,
                        showOnFolio: true,
                        status: 'active',
                        category: 'all'
                      };
                      setLocalTaxes([...localTaxes, newTax]);
                    }}
                    className="bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
                  >
                    <Plus size={18} />
                    Add Tax
                  </button>
                  <button 
                    onClick={handleSaveTaxes}
                    disabled={isSaving}
                    className="bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold text-sm flex items-center gap-2 hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50"
                  >
                    <Save size={18} />
                    {isSaving ? 'Saving...' : 'Save All Taxes'}
                  </button>
                </div>
              </div>

              <div className="space-y-4">
                {localTaxes.length === 0 ? (
                  <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-12 text-center">
                    <Percent size={40} className="text-zinc-700 mx-auto mb-4" />
                    <p className="text-zinc-500">No taxes configured yet.</p>
                  </div>
                ) : (
                  localTaxes.map((tax, index) => (
                    <div key={tax.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Tax Name</label>
                          <input 
                            type="text" 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.name}
                            placeholder="e.g. VAT, Service Charge"
                            onChange={(e) => handleUpdateLocalTax(index, { name: e.target.value })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Percentage (%)</label>
                          <input 
                            type="number" 
                            step="0.01"
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.percentage}
                            onChange={(e) => handleUpdateLocalTax(index, { percentage: Number(e.target.value) })}
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Category</label>
                          <select 
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                            value={tax.category}
                            onChange={(e) => handleUpdateLocalTax(index, { category: e.target.value as any })}
                          >
                            <option value="all">All Services</option>
                            <option value="room">Rooms Only</option>
                            <option value="restaurant">Restaurant Only</option>
                            <option value="service">Services Only</option>
                          </select>
                        </div>
                        <div className="flex items-center justify-end pt-6">
                          <button 
                            onClick={() => {
                              const updated = localTaxes.filter(t => t.id !== tax.id);
                              setLocalTaxes(updated);
                            }}
                            className="p-2 text-zinc-500 hover:text-red-500 transition-all"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-4 pt-2">
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { isInclusive: !tax.isInclusive })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.isInclusive ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.isInclusive ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Inclusive Tax
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { showOnReceipt: !tax.showOnReceipt })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.showOnReceipt ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.showOnReceipt ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Show on Receipt
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { showOnFolio: !tax.showOnFolio })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                            tax.showOnFolio ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-800 text-zinc-500"
                          )}
                        >
                          {tax.showOnFolio ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                          Show on Folio
                        </button>
                        <button 
                          onClick={() => handleUpdateLocalTax(index, { status: tax.status === 'active' ? 'inactive' : 'active' })}
                          className={cn(
                            "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-bold transition-all ml-auto",
                            tax.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                          )}
                        >
                          {tax.status === 'active' ? 'Active' : 'Inactive'}
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'support' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Help & Support</h3>
                <p className="text-sm text-zinc-500">Need assistance? Our team is here to help you.</p>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 text-emerald-500 rounded-xl flex items-center justify-center">
                    <Mail size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-50">Email Support</h4>
                    <p className="text-sm text-zinc-500">Send us an email and we'll get back to you within 24 hours.</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800">
                  <a 
                    href={`mailto:${systemSettings?.supportEmail || 'support@smartwave.com'}`}
                    className="flex items-center justify-center gap-2 w-full bg-emerald-500 text-black font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                  >
                    <Mail size={18} />
                    {systemSettings?.supportEmail || 'support@smartwave.com'}
                  </a>
                </div>
              </div>

              <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 text-blue-500 rounded-xl flex items-center justify-center">
                    <Info size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-zinc-50">System Information</h4>
                    <p className="text-sm text-zinc-500">Details about your current hotel and plan.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-zinc-800">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Hotel ID</span>
                    <p className="text-sm text-zinc-50 font-mono">{hotel?.id}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Current Plan</span>
                    <p className="text-sm text-zinc-50 capitalize">{hotel?.plan}</p>
                  </div>
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase">Subscription Expiry</span>
                    <p className="text-sm text-zinc-50">
                      {hotel?.subscriptionExpiry ? format(new Date(hotel.subscriptionExpiry), 'MMM d, yyyy') : 'N/A'}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'danger' && profile?.role === 'hotelAdmin' && (
            <div className="space-y-8">
              <div className="mb-8">
                <h3 className="text-lg font-bold text-zinc-50 mb-1">Danger Zone</h3>
                <p className="text-sm text-zinc-500">Highly sensitive actions that can permanently affect your data.</p>
              </div>

              <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-6 space-y-6">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-500/10 text-red-500 rounded-xl flex items-center justify-center">
                    <Trash2 size={24} />
                  </div>
                  <div>
                    <h4 className="font-bold text-red-500">System Reset</h4>
                    <p className="text-sm text-zinc-500">Permanently delete all reservations, transactions, and guest data. This action cannot be undone.</p>
                  </div>
                </div>

                <div className="pt-4 border-t border-red-500/10">
                  <button 
                    onClick={() => setShowConfirmSystemReset(true)}
                    className="flex items-center justify-center gap-2 w-full bg-red-500 text-white font-bold py-3 rounded-lg hover:bg-red-600 transition-all active:scale-95"
                  >
                    <RefreshCw size={18} />
                    Reset All System Data
                  </button>
                </div>
              </div>

              <ConfirmModal
                isOpen={showConfirmSystemReset}
                title="CRITICAL: System Reset"
                message="Are you sure you want to clear ALL system data? This will delete all reservations, guest history, financial records, and reset all rooms. This action is PERMANENT and cannot be undone."
                onConfirm={handleSystemReset}
                onCancel={() => setShowConfirmSystemReset(false)}
                type="danger"
                confirmText="Yes, Reset Everything"
              />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
