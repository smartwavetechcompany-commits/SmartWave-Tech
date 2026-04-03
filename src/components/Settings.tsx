import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, setDoc, addDoc, collection } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
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
  CreditCard
} from 'lucide-react';
import { cn } from '../utils';
import { toast } from 'sonner';
import { format, isValid } from 'date-fns';

export function Settings() {
  const { profile, hotel, isSubscriptionActive } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'hotel' | 'branding' | 'security'>('profile');
  const [showConfirmReset, setShowConfirmReset] = useState(false);
  
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    hotelName: hotel?.name || '',
    branding: {
      logoUrl: hotel?.branding?.logoUrl || '',
      primaryColor: hotel?.branding?.primaryColor || '#10b981',
      secondaryColor: hotel?.branding?.secondaryColor || '#18181b',
      address: hotel?.branding?.address || '',
      phone: hotel?.branding?.phone || '',
      email: hotel?.branding?.email || '',
      footerNotes: hotel?.branding?.footerNotes || '',
    }
  });

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.uid) return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'users', profile.uid), {
        displayName: formData.displayName,
      }, { merge: true });

      // Log action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'UPDATE_PROFILE',
        resource: 'User Profile',
        hotelId: profile.hotelId
      });

      toast.success('Profile updated successfully!');
    } catch (err) {
      console.error(err);
      toast.error('Failed to update profile.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveHotel = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || profile?.role !== 'hotelAdmin') return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, 'hotels', hotel.id), {
        name: formData.hotelName,
      }, { merge: true });

      // Log action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'UPDATE_HOTEL_SETTINGS',
        resource: `Hotel: ${formData.hotelName}`,
        hotelId: hotel.id
      });

      toast.success('Hotel settings updated!');
    } catch (err) {
      console.error(err);
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
        action: 'UPDATE_HOTEL_BRANDING',
        resource: `Hotel Branding: ${hotel.name}`,
        hotelId: hotel.id
      });

      toast.success('Hotel branding updated!');
    } catch (err) {
      console.error(err);
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
    } catch (err) {
      console.error(err);
      toast.error('Failed to send reset email. Please try again later.');
    } finally {
      setShowConfirmReset(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto space-y-8">
      <header>
        <h1 className="text-3xl font-bold text-white tracking-tight">Settings</h1>
        <p className="text-zinc-400">Manage your account and system preferences</p>
      </header>

      <div className="flex gap-8">
        {/* Sidebar Tabs */}
        <aside className="w-64 space-y-2">
          <button 
            onClick={() => setActiveTab('profile')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'profile' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
            )}
          >
            <User size={18} />
            Profile
          </button>
          
          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('hotel')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'hotel' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              )}
            >
              <Building2 size={18} />
              Hotel Settings
            </button>
          )}

          {profile?.role === 'hotelAdmin' && (
            <button 
              onClick={() => setActiveTab('branding')}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
                activeTab === 'branding' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
              )}
            >
              <Smartphone size={18} />
              Branding
            </button>
          )}

          <button 
            onClick={() => setActiveTab('security')}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              activeTab === 'security' ? "bg-emerald-500 text-black" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
            )}
          >
            <Shield size={18} />
            Security
          </button>
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
                  <h3 className="text-lg font-bold text-white">{profile?.displayName || 'User'}</h3>
                  <p className="text-sm text-zinc-500 capitalize">{profile?.role.replace('hotelAdmin', 'Hotel Administrator')}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Display Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                <h3 className="text-lg font-bold text-white mb-1">Hotel Configuration</h3>
                <p className="text-sm text-zinc-500">Manage your property details and subscription</p>
              </div>

              <div className="grid grid-cols-1 gap-6">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Hotel Name</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={formData.hotelName}
                    onChange={(e) => setFormData({ ...formData, hotelName: e.target.value })}
                  />
                </div>
                
                <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <CreditCard size={18} className="text-emerald-500" />
                      <div>
                        <p className="text-sm font-medium text-white">Subscription Status</p>
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
                <h3 className="text-lg font-bold text-white mb-1">Hotel Branding</h3>
                <p className="text-sm text-zinc-500">Customize your hotel's visual identity and receipt details</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="md:col-span-2">
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-2">Logo URL</label>
                  <input 
                    type="url" 
                    placeholder="https://example.com/logo.png"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none font-mono text-sm"
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
                      className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none font-mono text-sm"
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
                    placeholder="Thank you for staying with us!"
                    value={formData.branding.footerNotes}
                    onChange={(e) => setFormData({ 
                      ...formData, 
                      branding: { ...formData.branding, footerNotes: e.target.value } 
                    })}
                  />
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

          {activeTab === 'security' && (
            <div className="space-y-8">
              <div>
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                  <Lock size={20} className="text-emerald-500" />
                  Password & Security
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  To change your password, we will send a reset link to your registered email address.
                </p>
                <button 
                  className="px-6 py-2 rounded-lg border border-zinc-800 text-white hover:bg-zinc-800 transition-all active:scale-95 font-medium disabled:opacity-50"
                  onClick={() => setShowConfirmReset(true)}
                >
                  Request Password Reset
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
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
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
        </main>
      </div>
    </div>
  );
}
