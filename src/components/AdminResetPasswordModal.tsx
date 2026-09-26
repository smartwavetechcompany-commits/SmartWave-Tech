import React, { useState, useEffect } from 'react';
import { useAuth, getClientDeviceInfo } from '../contexts/AuthContext';
import { UserProfile, PasswordResetToken } from '../types';
import { doc } from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { 
  KeyRound, 
  Mail, 
  Send, 
  Clock, 
  Copy, 
  Check, 
  ShieldAlert, 
  ShieldCheck, 
  X, 
  AlertCircle, 
  ExternalLink,
  Ban,
  RefreshCw,
  Lock,
  Eye,
  EyeOff
} from 'lucide-react';
import { toast } from 'sonner';
import { 
  generatePasswordResetToken, 
  revokePasswordResetToken, 
  subscribeToUserResetTokens 
} from '../utils/passwordResetService';
import { hasPermission } from '../utils/permissions';

interface Props {
  user: UserProfile;
  onClose: () => void;
  onSuccess?: () => void;
}

export function AdminResetPasswordModal({ user, onClose, onSuccess }: Props) {
  const { profile, hotel } = useAuth();
  const [activeTab, setActiveTab] = useState<'emailLink' | 'manualTemp'>('emailLink');

  // Email reset link configuration
  const [durationMinutes, setDurationMinutes] = useState<number>(1440); // 24 hours default
  const [adminNote, setAdminNote] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedResult, setGeneratedResult] = useState<{
    token: PasswordResetToken;
    resetUrl: string;
    emailSent: boolean;
  } | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  // Active tokens list for this staff member
  const [staffTokens, setStaffTokens] = useState<PasswordResetToken[]>([]);
  const [isRevoking, setIsRevoking] = useState<string | null>(null);

  // Manual fallback states
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [forcePasswordChange, setForcePasswordChange] = useState(true);
  const [showManualPassword, setShowManualPassword] = useState(true);
  const [manualSuccess, setManualSuccess] = useState(false);
  const [copiedManual, setCopiedManual] = useState(false);

  const hotelId = user.hotelId || profile?.hotelId || 'system';

  // Security authorization check
  const isAuthorized = profile && (
    profile.role === 'hotelAdmin' || 
    profile.role === 'superAdmin' || 
    hasPermission(profile, 'reset_passwords') || 
    hasPermission(profile, 'manage_staff')
  );

  // Subscribe to live tokens for this staff member
  useEffect(() => {
    if (!hotelId || !user.email) return;
    const unsubscribe = subscribeToUserResetTokens(hotelId, user.email, (tokens) => {
      setStaffTokens(tokens);
    });
    return () => unsubscribe();
  }, [hotelId, user.email]);

  const generateManualPassword = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%&*';
    let pwd = '';
    for (let i = 0; i < 10; i++) {
      pwd += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    setTemporaryPassword(pwd);
  };

  useEffect(() => {
    generateManualPassword();
  }, []);

  // Handler: Send Email & Generate Secure Token
  const handleGenerateAndSendEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) {
      toast.error('Access Denied: You do not have permission to reset staff passwords.');
      return;
    }

    if (!user.email) {
      toast.error('This user does not have a registered email address.');
      return;
    }

    setIsGenerating(true);
    try {
      const result = await generatePasswordResetToken({
        hotelId,
        hotelName: hotel?.name || 'Hotel Property',
        targetUser: user,
        adminProfile: profile!,
        durationMinutes,
        note: adminNote
      });

      setGeneratedResult(result);
      toast.success(
        result.emailSent 
          ? `Password reset email dispatched to ${user.email}!` 
          : `Secure token generated. Link ready for ${user.email}.`
      );
      onSuccess?.();
    } catch (err: any) {
      console.error('Error initiating password reset:', err);
      toast.error('Failed to generate reset link: ' + (err.message || 'Unknown error'));
    } finally {
      setIsGenerating(false);
    }
  };

  // Handler: Revoke active token
  const handleRevokeToken = async (tokenId: string) => {
    if (!isAuthorized) return;
    setIsRevoking(tokenId);
    try {
      await revokePasswordResetToken(hotelId, tokenId, profile!);
      toast.success('Password reset token revoked immediately.');
    } catch (err: any) {
      toast.error('Failed to revoke token: ' + err.message);
    } finally {
      setIsRevoking(null);
    }
  };

  // Handler: Copy Link
  const handleCopyLink = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopiedLink(true);
      toast.success('Secure reset link copied to clipboard.');
      setTimeout(() => setCopiedLink(false), 2500);
    } catch (err) {
      toast.error('Failed to copy link.');
    }
  };

  // Handler: Manual Fallback Password
  const handleManualReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAuthorized) {
      toast.error('Access Denied');
      return;
    }

    setIsGenerating(true);
    try {
      const deviceInfo = getClientDeviceInfo();
      const userRef = doc(db, 'users', user.uid);

      await database.safeUpdate(userRef, {
        temporaryPassword,
        initialPassword: null,
        forcePasswordChange,
        forceLogout: false,
        status: user.status === 'suspended' ? 'active' : user.status,
        lastPasswordResetRequestedAt: new Date().toISOString(),
        lastPasswordResetRequestedBy: profile?.email,
        updatedAt: new Date().toISOString()
      }, {
        hotelId,
        module: 'Security Administration',
        action: 'ADMIN_MANUAL_PASSWORD_RESET',
        details: `Hotel Admin ${profile?.email} manually assigned temporary password for staff ${user.email}. Force change on login: ${forcePasswordChange}`,
        metadata: {
          targetUid: user.uid,
          targetEmail: user.email,
          forcePasswordChange,
          adminUid: profile?.uid,
          adminEmail: profile?.email,
          deviceInfo
        }
      });

      setManualSuccess(true);
      toast.success(`Temporary password assigned to ${user.email}`);

      // Sync credential to server for authentication lifecycle
      fetch('/api/auth/sync-user-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uid: user.uid,
          email: user.email,
          password: temporaryPassword
        })
      }).catch((syncErr) => console.warn("Password sync notice:", syncErr));

      onSuccess?.();
    } catch (err: any) {
      console.error('Manual reset error:', err);
      toast.error('Failed: ' + err.message);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[9999] bg-zinc-950/85 backdrop-blur-md flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-emerald-500/10 via-zinc-900 to-zinc-900 border-b border-zinc-800 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-emerald-500/15 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <KeyRound size={22} />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-100 flex items-center gap-2">
                <span>Staff Password Reset</span>
                <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                  Admin Action
                </span>
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Staff: <span className="text-zinc-200 font-mono font-medium">{user.displayName || user.email}</span>
                {user.email && user.displayName && (
                  <span className="text-zinc-500 ml-1">({user.email})</span>
                )}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex border-b border-zinc-800 bg-zinc-950/50 px-5 pt-2">
          <button
            type="button"
            onClick={() => setActiveTab('emailLink')}
            className={`pb-2.5 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'emailLink'
                ? 'border-emerald-500 text-emerald-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Mail size={14} />
            <span>Send Reset Email (Recommended)</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manualTemp')}
            className={`pb-2.5 px-3 text-xs font-semibold flex items-center gap-2 border-b-2 transition-all ${
              activeTab === 'manualTemp'
                ? 'border-amber-500 text-amber-400'
                : 'border-transparent text-zinc-400 hover:text-zinc-200'
            }`}
          >
            <Lock size={14} />
            <span>Direct Temporary Password</span>
          </button>
        </div>

        {/* Unauthorized Warning */}
        {!isAuthorized && (
          <div className="p-6">
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 flex items-center gap-2.5">
              <ShieldAlert size={18} className="shrink-0" />
              <span>You do not have the required Administrator permissions to trigger password resets.</span>
            </div>
          </div>
        )}

        {/* TAB 1: Email Reset Link */}
        {isAuthorized && activeTab === 'emailLink' && (
          <div className="p-5 sm:p-6 space-y-5 max-h-[75vh] overflow-y-auto">
            {!generatedResult ? (
              <form onSubmit={handleGenerateAndSendEmail} className="space-y-4">
                <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-xs text-zinc-300 leading-relaxed flex items-start gap-2.5">
                  <ShieldCheck size={16} className="text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    The system will generate a secure, cryptographic single-use token and email an encrypted link to <strong>{user.email}</strong>. The user can create their own password safely without sharing credentials.
                  </span>
                </div>

                {/* Expiration Duration Config */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-300 flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <Clock size={13} className="text-emerald-400" />
                      Link Expiration Time
                    </span>
                    <span className="text-[11px] text-zinc-500">Configurable Security Window</span>
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '30 Mins', value: 30 },
                      { label: '1 Hour', value: 60 },
                      { label: '4 Hours', value: 240 },
                      { label: '24 Hours', value: 1440 },
                    ].map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => setDurationMinutes(opt.value)}
                        className={`py-2 px-2.5 text-xs font-semibold rounded-xl border text-center transition-all ${
                          durationMinutes === opt.value
                            ? 'bg-emerald-500/15 border-emerald-500 text-emerald-400 shadow-sm'
                            : 'bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700'
                        }`}
                      >
                        {opt.label}
                        {opt.value === 1440 && (
                          <span className="block text-[9px] text-emerald-500/80 font-normal">Default</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional Note */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Administrator Note for Staff (Optional)
                  </label>
                  <input
                    type="text"
                    value={adminNote}
                    onChange={(e) => setAdminNote(e.target.value)}
                    placeholder="e.g. As requested during your shift handoff..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors"
                  />
                </div>

                {/* Submit Action */}
                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-zinc-950 font-bold rounded-xl text-xs transition-all flex items-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.99]"
                  >
                    {isGenerating ? (
                      <>
                        <div className="w-3.5 h-3.5 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                        <span>Sending Secure Email...</span>
                      </>
                    ) : (
                      <>
                        <Send size={14} />
                        <span>Send Password Reset Email</span>
                      </>
                    )}
                  </button>
                </div>
              </form>
            ) : (
              /* Generation Success View */
              <div className="space-y-4">
                <div className="p-4 bg-emerald-500/10 border border-emerald-500/30 rounded-xl space-y-2">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs">
                    <Check size={16} />
                    <span>Password Reset Link Active & Dispatched</span>
                  </div>
                  <p className="text-xs text-emerald-200/90 leading-relaxed">
                    A secure password reset email has been sent to <strong>{user.email}</strong>. The link is time-limited to <strong>{durationMinutes >= 60 ? `${durationMinutes / 60} hour(s)` : `${durationMinutes} minutes`}</strong> (expires at {new Date(generatedResult.token.expiresAt).toLocaleTimeString()}).
                  </p>
                </div>

                {/* Reset Link Box with Copy Button */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-zinc-300">
                    Direct Secure Link (For Manual Handoff or Support)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedResult.resetUrl}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs font-mono text-zinc-300 select-all"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopyLink(generatedResult.resetUrl)}
                      className="py-2 px-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-semibold rounded-xl flex items-center gap-1.5 shrink-0 transition-colors"
                    >
                      {copiedLink ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      <span>{copiedLink ? 'Copied' : 'Copy'}</span>
                    </button>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800/80 text-[11px] text-zinc-400 space-y-1">
                  <div className="flex justify-between">
                    <span>Token ID:</span>
                    <span className="font-mono text-zinc-300">{generatedResult.token.id.slice(0, 18)}...</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Status:</span>
                    <span className="text-emerald-400 font-semibold">Active & Single-Use</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Audit Log:</span>
                    <span className="text-zinc-300 font-mono">STAFF_PASSWORD_RESET_GENERATED</span>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setGeneratedResult(null)}
                    className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-xl"
                  >
                    Generate Another
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-xs font-bold rounded-xl shadow-sm"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}

            {/* Live Active Reset Tokens for this user */}
            {staffTokens.length > 0 && (
              <div className="pt-4 border-t border-zinc-800/80 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-300 flex items-center gap-1.5">
                    <Clock size={13} className="text-zinc-400" />
                    Reset Token History & Active Links ({staffTokens.length})
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">Live Sync</span>
                </div>

                <div className="space-y-2 max-h-40 overflow-y-auto pr-1">
                  {staffTokens.slice(0, 5).map((tk) => {
                    const isExpired = new Date(tk.expiresAt).getTime() < Date.now();
                    let badgeColor = 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20';
                    let statusText = 'Active';

                    if (tk.status === 'revoked') {
                      badgeColor = 'bg-red-500/10 text-red-400 border-red-500/20';
                      statusText = 'Revoked';
                    } else if (tk.isUsed || tk.status === 'used') {
                      badgeColor = 'bg-zinc-800 text-zinc-400 border-zinc-700';
                      statusText = 'Used';
                    } else if (isExpired) {
                      badgeColor = 'bg-amber-500/10 text-amber-400 border-amber-500/20';
                      statusText = 'Expired';
                    }

                    return (
                      <div 
                        key={tk.id}
                        className="p-2.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl flex items-center justify-between text-xs"
                      >
                        <div className="space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold border ${badgeColor}`}>
                              {statusText}
                            </span>
                            <span className="text-zinc-300 font-mono text-[11px]">
                              {new Date(tk.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <span className="text-[10px] text-zinc-500 block">
                            By {tk.createdByEmail || 'Admin'} • Expires {new Date(tk.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {statusText === 'Active' && (
                            <>
                              <button
                                type="button"
                                onClick={() => handleCopyLink(tk.resetUrl || '')}
                                title="Copy reset link"
                                className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
                              >
                                <Copy size={13} />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleRevokeToken(tk.id)}
                                disabled={isRevoking === tk.id}
                                title="Revoke link immediately"
                                className="p-1.5 bg-red-500/15 hover:bg-red-500/25 text-red-400 border border-red-500/30 rounded-lg transition-colors"
                              >
                                {isRevoking === tk.id ? (
                                  <div className="w-3 h-3 border border-red-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Ban size={13} />
                                )}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Direct Temporary Password (Fallback) */}
        {isAuthorized && activeTab === 'manualTemp' && (
          <div className="p-5 sm:p-6 space-y-4">
            {!manualSuccess ? (
              <form onSubmit={handleManualReset} className="space-y-4">
                <div className="p-3 bg-amber-500/10 rounded-xl border border-amber-500/20 text-xs text-amber-300/90 flex items-start gap-2.5">
                  <AlertCircle size={16} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    Emergency / Offline Mode: Use this to manually hand off a temporary password to an employee if email delivery is unavailable.
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-zinc-300">
                      Temporary Password
                    </label>
                    <button
                      type="button"
                      onClick={generateManualPassword}
                      className="text-xs text-amber-400 hover:text-amber-300 flex items-center gap-1 font-medium"
                    >
                      <RefreshCw size={12} />
                      Generate New
                    </button>
                  </div>

                  <div className="relative">
                    <input
                      type={showManualPassword ? 'text' : 'password'}
                      value={temporaryPassword}
                      onChange={(e) => setTemporaryPassword(e.target.value)}
                      required
                      className="w-full pl-9 pr-10 py-2.5 bg-zinc-950 border border-zinc-700/80 rounded-xl text-sm font-mono text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                    />
                    <Lock size={15} className="absolute left-3.5 top-3 text-zinc-500" />
                    <button
                      type="button"
                      onClick={() => setShowManualPassword(!showManualPassword)}
                      className="absolute right-3.5 top-3 text-zinc-500 hover:text-zinc-300"
                    >
                      {showManualPassword ? <EyeOff size={15} /> : <Eye size={15} />}
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
                        User will be immediately required to set their permanent password upon logging in.
                      </span>
                    </div>
                  </label>
                </div>

                <div className="pt-2 flex items-center justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isGenerating}
                    className="px-5 py-2.5 bg-amber-500 hover:bg-amber-400 disabled:bg-zinc-800 text-zinc-950 font-bold rounded-xl text-xs transition-colors flex items-center gap-2 shadow-lg shadow-amber-500/20"
                  >
                    {isGenerating ? (
                      <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    ) : (
                      'Set Temporary Password'
                    )}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-xs text-emerald-300">
                  <strong className="font-semibold block mb-0.5">Temporary Password Applied</strong>
                  This temporary password has been stored. Hand it over to {user.email} securely.
                </div>

                <div className="bg-zinc-950/70 p-4 rounded-xl border border-zinc-800 space-y-2 font-mono text-xs">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">Account:</span>
                    <span className="text-zinc-200">{user.email}</span>
                  </div>
                  <div className="flex justify-between border-t border-zinc-800 pt-2">
                    <span className="text-zinc-500">Temporary Password:</span>
                    <span className="font-bold text-amber-400 text-sm">{temporaryPassword}</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-2">
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(`Account: ${user.email}\nTemporary Password: ${temporaryPassword}`);
                      setCopiedManual(true);
                      toast.success('Copied credentials');
                      setTimeout(() => setCopiedManual(false), 2000);
                    }}
                    className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {copiedManual ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    {copiedManual ? 'Copied' : 'Copy Credentials'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-5 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 rounded-xl text-xs font-bold transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
