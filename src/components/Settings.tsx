import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { doc, setDoc, addDoc, collection } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth } from '../firebase';
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
import { format, isValid } from 'date-fns';

export function Settings() {
  const { profile, hotel, isSubscriptionActive } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const [activeTab, setActiveTab] = useState<'profile' | 'hotel' | 'security'>('profile');
  
  const [formData, setFormData] = useState({
    displayName: profile?.displayName || '',
    hotelName: hotel?.name || '',
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

      alert('Profile updated successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to update profile.');
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

      alert('Hotel settings updated!');
    } catch (err) {
      console.error(err);
      alert('Failed to update hotel settings.');
    } finally {
      setIsSaving(false);
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
                  onClick={async () => {
                    if (!profile?.email) return;
                    try {
                      await sendPasswordResetEmail(auth, profile.email);
                      alert('Password reset link sent to: ' + profile.email);
                    } catch (err) {
                      console.error(err);
                      alert('Failed to send reset email. Please try again later.');
                    }
                  }}
                >
                  Request Password Reset
                </button>
              </div>

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
