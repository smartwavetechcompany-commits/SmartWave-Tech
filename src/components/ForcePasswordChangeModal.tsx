import React, { useState } from 'react';
import { useAuth, getClientDeviceInfo } from '../contexts/AuthContext';
import { updatePassword } from 'firebase/auth';
import { auth, db } from '../firebase';
import { doc } from 'firebase/firestore';
import { database } from '../utils/database';
import { Lock, KeyRound, Eye, EyeOff, ShieldAlert, CheckCircle2, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export function ForcePasswordChangeModal() {
  const { profile, hotel, signOut } = useAuth();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Password strength checks
  const hasMinLength = newPassword.length >= 8;
  const hasUppercase = /[A-Z]/.test(newPassword);
  const hasLowercase = /[a-z]/.test(newPassword);
  const hasNumber = /[0-9]/.test(newPassword);
  const hasSpecial = /[^A-Za-z0-9]/.test(newPassword);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;
  const isValid = hasMinLength && (hasUppercase || hasLowercase) && hasNumber && passwordsMatch;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || !auth.currentUser || !profile) return;

    setIsSubmitting(true);
    try {
      // 1. Update Firebase Auth password
      await updatePassword(auth.currentUser, newPassword);

      const deviceInfo = getClientDeviceInfo();
      const hotelId = profile.hotelId || 'system';

      // 2. Update Firestore profile
      const userRef = doc(db, 'users', profile.uid);
      await database.safeUpdate(userRef, {
        forcePasswordChange: false,
        temporaryPassword: null,
        initialPassword: null,
        passwordChangedAt: new Date().toISOString(),
        passwordChangedBy: profile.email,
        passwordChangeDeviceInfo: deviceInfo,
        updatedAt: new Date().toISOString()
      }, {
        hotelId,
        module: 'Security Control',
        action: 'FORCE_PASSWORD_CHANGE_COMPLETED',
        details: `User ${profile.email} completed mandatory first-login password change.`,
        metadata: {
          uid: profile.uid,
          email: profile.email,
          deviceInfo
        }
      });

      toast.success('Password updated successfully! Welcome to the PMS.');

      // Synchronize credential to server for authentication lifecycle
      fetch('/api/auth/sync-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: profile.uid,
          email: profile.email,
          password: newPassword
        })
      }).catch((syncErr) => console.warn("Password sync notice:", syncErr));
    } catch (err: any) {
      console.error('Password change error:', err);
      if (err.code === 'auth/requires-recent-login') {
        toast.error('Session expired. Please log in again with your temporary password and retry.');
        await signOut();
      } else {
        toast.error(err.message || 'Failed to update password. Please try again.');
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/95 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        <div className="p-6 bg-gradient-to-b from-amber-500/10 to-transparent border-b border-zinc-800/80">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center">
              <KeyRound size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-zinc-100">Password Change Required</h2>
              <p className="text-xs text-zinc-400">
                Security policy requires you to set a new personal password before accessing the system.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="bg-zinc-950/60 p-3 rounded-xl border border-zinc-800/80 text-xs text-zinc-400 flex items-start gap-2.5">
            <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <span>
              Signed in as <strong className="text-zinc-200">{profile?.email}</strong> ({hotel?.name || 'Hotel Property'}). All modules are locked until your password is updated.
            </span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new strong password"
                required
                className="w-full pl-10 pr-10 py-2.5 bg-zinc-950 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
              <Lock size={16} className="absolute left-3.5 top-3.5 text-zinc-500" />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3.5 top-3.5 text-zinc-500 hover:text-zinc-300"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-300 mb-1.5">
              Confirm New Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Re-enter new password"
                required
                className="w-full pl-10 pr-10 py-2.5 bg-zinc-950 border border-zinc-700/80 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
              />
              <Lock size={16} className="absolute left-3.5 top-3.5 text-zinc-500" />
            </div>
          </div>

          {/* Validation indicators */}
          <div className="bg-zinc-950/40 p-3 rounded-xl border border-zinc-800/60 space-y-1.5 text-xs">
            <div className="flex items-center gap-2 text-zinc-400">
              {hasMinLength ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-zinc-600" />}
              <span className={hasMinLength ? 'text-emerald-400' : ''}>At least 8 characters</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              {hasNumber ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-zinc-600" />}
              <span className={hasNumber ? 'text-emerald-400' : ''}>Contains at least one number</span>
            </div>
            <div className="flex items-center gap-2 text-zinc-400">
              {passwordsMatch ? <CheckCircle2 size={14} className="text-emerald-400" /> : <XCircle size={14} className="text-zinc-600" />}
              <span className={passwordsMatch ? 'text-emerald-400' : ''}>Passwords match</span>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={signOut}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 transition-colors"
            >
              Sign Out
            </button>
            <button
              type="submit"
              disabled={!isValid || isSubmitting}
              className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 disabled:text-zinc-600 text-zinc-950 font-bold rounded-xl text-sm shadow-lg shadow-amber-500/20 transition-all flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <div className="w-5 h-5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
              ) : (
                'Save Password & Continue'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
