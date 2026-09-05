import React, { useState } from 'react';
import { useAuth, getClientDeviceInfo } from '../contexts/AuthContext';
import { UserProfile } from '../types';
import { doc } from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { 
  KeyRound, 
  RefreshCw, 
  Copy, 
  Check, 
  Eye, 
  EyeOff, 
  ShieldAlert, 
  Lock, 
  X,
  Printer
} from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  user: UserProfile;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AdminResetPasswordModal({ user, onClose, onSuccess }: Props) {
  const { profile, hotel } = useAuth();
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [showPassword, setShowPassword] = useState(true);
  const [copied, setCopied] = useState(false);

  const generateSecurePassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setTemporaryPassword(pwd);
  };

  React.useEffect(() => {
    generateSecurePassword();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!temporaryPassword || temporaryPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setIsSubmitting(true);
    try {
      const hotelId = user.hotelId || profile?.hotelId || 'system';
      const deviceInfo = getClientDeviceInfo();
      const userRef = doc(db, 'users', user.uid);

      await database.safeUpdate(userRef, {
        temporaryPassword,
        initialPassword: null,
        forcePasswordChange,
        forceLogout: false,
        status: user.status === 'suspended' ? 'active' : user.status,
        updatedAt: new Date().toISOString()
      }, {
        hotelId,
        module: 'Security Administration',
        action: 'ADMIN_PASSWORD_RESET',
        details: `Administrator ${profile?.email} reset password for staff member ${user.email}. Force change on login: ${forcePasswordChange}`,
        metadata: {
          targetUid: user.uid,
          targetEmail: user.email,
          forcePasswordChange,
          adminUid: profile?.uid,
          adminEmail: profile?.email,
          deviceInfo
        }
      });

      setCompleted(true);
      toast.success(`Password reset for ${user.email}`);
      onSuccess?.();
    } catch (err: any) {
      console.error('Password reset error:', err);
      toast.error('Failed to reset password: ' + err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const copyCredentials = async () => {
    const text = [
      `PMS PASSWORD RESET NOTICE`,
      `========================`,
      `Property: ${hotel?.name || 'Hotel'}`,
      `Staff Email: ${user.email}`,
      `Username: ${user.username || user.email}`,
      `Temporary Password: ${temporaryPassword}`,
      `Force Password Change: ${forcePasswordChange ? 'YES' : 'NO'}`,
      `Reset Date: ${new Date().toLocaleString()}`,
      `Authorized By: ${profile?.email || 'Administrator'}`,
      `========================`
    ].join('\n');

    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Credentials copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      toast.error('Failed to copy');
    }
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/90 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-6 bg-gradient-to-r from-amber-500/10 via-zinc-900 to-zinc-900 border-b border-zinc-800 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center border border-amber-500/30">
              <KeyRound size={20} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100">
                {completed ? 'Temporary Password Ready' : 'Admin Password Reset'}
              </h2>
              <p className="text-xs text-zinc-400">
                Target: <span className="text-zinc-200 font-mono">{user.email}</span>
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
          >
            <X size={18} />
          </button>
        </div>

        {!completed ? (
          <form onSubmit={handleReset} className="p-6 space-y-4">
            <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-xs text-zinc-400 flex items-start gap-2.5">
              <ShieldAlert size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <span>
                As an Administrator, you can assign a secure temporary password. Self-service password recovery is disabled.
              </span>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs font-semibold text-zinc-300">
                  Temporary Password
                </label>
                <button
                  type="button"
                  onClick={generateSecurePassword}
                  className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium"
                >
                  <RefreshCw size={12} />
                  Generate New
                </button>
              </div>

              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={temporaryPassword}
                  onChange={(e) => setTemporaryPassword(e.target.value)}
                  required
                  className="w-full pl-10 pr-10 py-2.5 bg-zinc-950 border border-zinc-700/80 rounded-xl text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
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

            <div className="p-3 bg-zinc-950/40 rounded-xl border border-zinc-800/80">
              <label className="flex items-start gap-2.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={forcePasswordChange}
                  onChange={(e) => setForcePasswordChange(e.target.checked)}
                  className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-amber-500 focus:ring-amber-500"
                />
                <div>
                  <span className="text-xs font-semibold text-zinc-200 block">
                    Force Password Change on Next Login
                  </span>
                  <span className="text-[11px] text-zinc-400 block mt-0.5">
                    User will be immediately locked into the change password flow when they sign in.
                  </span>
                </div>
              </label>
            </div>

            <div className="pt-2 flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 text-zinc-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/20"
              >
                {isSubmitting ? (
                  <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                ) : (
                  'Confirm Password Reset'
                )}
              </button>
            </div>
          </form>
        ) : (
          <div className="p-6 space-y-4">
            <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
              <strong className="font-semibold block mb-0.5">Password Successfully Reset</strong>
              This temporary password will not be shown again once you close this window. Please hand it over to the employee securely.
            </div>

            <div className="bg-zinc-950/70 p-4 rounded-xl border border-zinc-800 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-[11px] block">Username</span>
                  <span className="font-mono text-zinc-200 text-xs">{user.username || user.email}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between">
                <div>
                  <span className="text-zinc-500 text-[11px] block">Temporary Password</span>
                  <span className="font-mono font-bold text-amber-400 text-sm">{temporaryPassword}</span>
                </div>
              </div>

              <div className="pt-2 border-t border-zinc-800 text-[11px] text-zinc-400 flex justify-between">
                <span>Force Password Change:</span>
                <span className="font-semibold text-emerald-400">{forcePasswordChange ? 'Enabled' : 'Disabled'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                onClick={copyCredentials}
                className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                Copy Credentials
              </button>
              <button
                onClick={handlePrint}
                className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
              >
                <Printer size={14} />
                Print
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-xs font-bold transition-colors"
              >
                Done
              </button>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
