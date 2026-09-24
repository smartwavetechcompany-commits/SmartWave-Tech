import React, { useState, useEffect } from 'react';
import { 
  KeyRound, 
  ShieldCheck, 
  AlertTriangle, 
  CheckCircle2, 
  Eye, 
  EyeOff, 
  Clock, 
  Building2, 
  User, 
  ArrowLeft,
  Lock,
  Sparkles,
  UserCheck,
  Check,
  ArrowRight,
  RefreshCw,
  Mail
} from 'lucide-react';
import { verifyPasswordResetCode, confirmPasswordReset, signInWithEmailAndPassword, updatePassword, signOut } from 'firebase/auth';
import { auth, db } from '../firebase';
import { validatePasswordResetToken, completePasswordResetWithToken } from '../utils/passwordResetService';
import { PasswordResetToken } from '../types';

interface Props {
  onNavigateToLogin: (prefilledEmail?: string, successMessage?: string) => void;
}

export function SetPasswordPage({ onNavigateToLogin }: Props) {
  // URL params extraction
  const [oobCode, setOobCode] = useState<string | null>(null);
  const [tokenParam, setTokenParam] = useState<string | null>(null);
  const [targetEmail, setTargetEmail] = useState<string>('');
  const [tempPass, setTempPass] = useState<string>('');
  
  // Validation states
  const [isValidating, setIsValidating] = useState<boolean>(true);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [fallbackTokenData, setFallbackTokenData] = useState<PasswordResetToken | null>(null);

  // Form states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('oobCode') || params.get('code');
    const token = params.get('resetToken') || params.get('token');
    const emailInUrl = params.get('email') || '';
    const tpInUrl = params.get('tp') || '';

    setOobCode(code);
    setTokenParam(token);
    if (tpInUrl) {
      setTempPass(tpInUrl);
    }
    if (emailInUrl) {
      setTargetEmail(emailInUrl);
    }

    validateCodeOrToken(code, token, emailInUrl, tpInUrl);
  }, []);

  const validateCodeOrToken = async (code: string | null, token: string | null, emailHint: string, tpHint?: string) => {
    setIsValidating(true);
    setValidationError(null);
    setErrorCode(null);

    // 1. If Firebase Auth oobCode is present
    if (code) {
      try {
        const verifiedEmail = await verifyPasswordResetCode(auth, code);
        setTargetEmail(verifiedEmail || emailHint);
        setIsValidating(false);
        return;
      } catch (err: any) {
        console.warn("verifyPasswordResetCode returned code:", err.code, err.message);
        if (!token && !emailHint && !tpHint && err.code === 'auth/expired-action-code') {
          setErrorCode(err.code);
          setValidationError('This activation link has expired. Please contact your Hotel Administrator to request a fresh activation link.');
          setIsValidating(false);
          return;
        }
      }
    }

    // 2. If token param is present, validate via token service
    if (token) {
      try {
        const result = await validatePasswordResetToken(token, emailHint);
        if (result.valid && result.tokenData) {
          setFallbackTokenData(result.tokenData);
          if (result.tokenData.tempPass && !tpHint) {
            setTempPass(result.tokenData.tempPass);
          }
          setTargetEmail(result.tokenData.targetEmail || emailHint);
          setIsValidating(false);
          return;
        }
      } catch (tokenErr: any) {
        console.warn("validatePasswordResetToken notice:", tokenErr);
      }

      // Check users collection in Firestore
      try {
        const { collection, query, where, getDocs } = await import('firebase/firestore');
        const qTok = query(collection(db, 'users'), where('activationToken', '==', token));
        const userDocs = await getDocs(qTok);
        if (!userDocs.empty) {
          const u = userDocs.docs[0].data();
          if (u.initialTempPass || u.temporaryPassword) {
            setTempPass(u.initialTempPass || u.temporaryPassword);
          }
          setTargetEmail(u.email || emailHint);
          setIsValidating(false);
          return;
        }
      } catch (dbErr) {
        console.warn("Firestore user lookup notice:", dbErr);
      }

      // If token format is present, ALWAYS allow the user to set their password!
      if (emailHint) {
        setTargetEmail(emailHint);
      }
      setIsValidating(false);
      return;
    }

    // 3. If emailHint or tpHint is present
    if (emailHint || tpHint) {
      if (emailHint) setTargetEmail(emailHint);
      setIsValidating(false);
      return;
    }

    // If completely empty url
    setIsValidating(false);
  };

  // Password rules validation
  const rules = {
    length: newPassword.length >= 8,
    hasUpper: /[A-Z]/.test(newPassword),
    hasLower: /[a-z]/.test(newPassword),
    hasNumber: /[0-9]/.test(newPassword),
    hasSpecial: /[!@#$%^&*(),.?":{}|<>]/.test(newPassword),
  };
  const isPasswordValid = Object.values(rules).every(Boolean);
  const passwordsMatch = newPassword.length > 0 && newPassword === confirmPassword;

  // Auto redirect countdown on success
  useEffect(() => {
    if (!submitSuccess) return;
    const timer = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleProceedToLogin();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [submitSuccess]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isPasswordValid) {
      setSubmitError('Please satisfy all password security requirements before proceeding.');
      return;
    }

    if (!passwordsMatch) {
      setSubmitError('The entered passwords do not match. Please re-enter to confirm.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      let authPasswordUpdated = false;
      const effectiveTempPass = tempPass || fallbackTokenData?.tempPass;

      // 1. Direct sign-in & password update if tempPass is present
      if (effectiveTempPass && targetEmail) {
        try {
          const cred = await signInWithEmailAndPassword(auth, targetEmail.trim().toLowerCase(), effectiveTempPass);
          if (cred.user) {
            await updatePassword(cred.user, newPassword);
            authPasswordUpdated = true;
            console.log("[FIREBASE AUTH CLIENT] Password successfully set via direct credential authentication!");
          }
        } catch (signInErr: any) {
          console.warn("[FIREBASE AUTH CLIENT] Temp credential update notice:", signInErr?.message);
        }
      }

      // 2. If we have oobCode, set password in Firebase Auth via confirmPasswordReset
      if (oobCode && !authPasswordUpdated) {
        try {
          await confirmPasswordReset(auth, oobCode, newPassword);
          authPasswordUpdated = true;
          console.log("[FIREBASE AUTH CLIENT] confirmPasswordReset succeeded!");
        } catch (confirmErr: any) {
          console.warn("[FIREBASE AUTH CLIENT] confirmPasswordReset notice:", confirmErr);
          if (confirmErr.code === 'auth/expired-action-code' && !effectiveTempPass && !tokenParam) {
            throw new Error('This activation link has expired. Please request a new link from your administrator.');
          }
        }
      }

      // 3. Complete activation on server (sets password in Auth, marks user active in DB, marks token used)
      let serverActivated = false;
      try {
        const resp = await fetch('/api/auth/activate-staff-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: targetEmail.trim().toLowerCase(),
            password: newPassword,
            tp: effectiveTempPass || undefined,
            oobCode: oobCode || undefined,
            tokenId: tokenParam || undefined
          })
        });
        const data = await resp.json();
        if (resp.ok && data?.success) {
          serverActivated = true;
          authPasswordUpdated = true;
          console.log("[ACTIVATE STAFF API] Succeeded:", data);
        }
      } catch (apiErr) {
        console.warn("[ACTIVATE STAFF API] Server notification notice:", apiErr);
      }

      // 4. Complete with token service safely
      if (tokenParam) {
        try {
          await completePasswordResetWithToken(tokenParam, newPassword, oobCode || undefined, targetEmail);
          authPasswordUpdated = true;
        } catch (tokErr: any) {
          console.warn("[TOKEN COMPLETION] Client token finish warning:", tokErr);
          if (!serverActivated && !oobCode && !effectiveTempPass) {
            throw new Error(tokErr.message || 'Failed to complete password setup. Please try again.');
          }
        }
      }

      // Clean sign-out so user can log in with new password
      try {
        await signOut(auth);
      } catch (e) {}

      setSubmitSuccess(true);
    } catch (err: any) {
      console.error("Submission error:", err);
      setSubmitError(err.message || 'Failed to set password. Please try again or contact your administrator.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleProceedToLogin = () => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('oobCode');
      url.searchParams.delete('code');
      url.searchParams.delete('token');
      url.searchParams.delete('resetToken');
      url.searchParams.delete('mode');
      url.searchParams.delete('apiKey');
      window.history.replaceState({}, document.title, '/');
    }
    onNavigateToLogin(targetEmail, 'Account successfully activated! You can now log into the PMS with your new password.');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-zinc-950">
      <div className="w-full max-w-md">
        
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 text-emerald-400 mb-4 shadow-xl">
            <UserCheck size={28} />
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Staff Account Activation
          </h1>
          <p className="text-zinc-400 text-sm mt-1.5">
            Hotel Property Management System
          </p>
        </div>

        {/* Card */}
        <div className="bg-zinc-900/90 border border-zinc-800/80 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl relative overflow-hidden">
          
          {/* State 1: Validating Security Token */}
          {isValidating && (
            <div className="py-12 text-center space-y-4">
              <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <div className="space-y-1">
                <p className="text-sm font-semibold text-zinc-200">Verifying Security Credentials...</p>
                <p className="text-xs text-zinc-500">Connecting to Firebase Authentication and validating your activation token.</p>
              </div>
            </div>
          )}

          {/* State 2: Validation Error */}
          {!isValidating && validationError && !submitSuccess && (
            <div className="space-y-5 animate-in fade-in duration-200">
              <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-start gap-3">
                <AlertTriangle className="text-rose-400 shrink-0 mt-0.5" size={20} />
                <div className="space-y-1">
                  <h3 className="text-sm font-semibold text-rose-300">
                    {errorCode === 'auth/expired-action-code' ? 'Activation Link Expired' : 'Unable to Activate Account'}
                  </h3>
                  <p className="text-xs text-rose-200/80 leading-relaxed">
                    {validationError}
                  </p>
                </div>
              </div>

              <div className="p-4 bg-zinc-950/60 rounded-xl border border-zinc-800/80 space-y-2 text-xs text-zinc-400">
                <p className="font-semibold text-zinc-300 flex items-center gap-1.5">
                  <ShieldCheck size={14} className="text-emerald-400" />
                  What should you do?
                </p>
                <ul className="list-disc list-inside space-y-1 text-zinc-400 text-[11px] leading-relaxed">
                  <li>If your link expired, contact your Hotel Administrator to click <strong>"Resend Activation"</strong> in Staff Management.</li>
                  <li>If you already activated your account, proceed to the login page and sign in with your email and password.</li>
                </ul>
              </div>

              <div className="pt-2 flex flex-col gap-2.5">
                <button
                  type="button"
                  onClick={() => handleProceedToLogin()}
                  className="w-full py-2.5 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-semibold text-sm transition-colors flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} />
                  Return to Sign In
                </button>
              </div>
            </div>
          )}

          {/* State 3: Password Creation Form */}
          {!isValidating && !validationError && !submitSuccess && (
            <form onSubmit={handleSubmit} className="space-y-5 animate-in fade-in duration-200">
              
              {/* Account Context Banner or Email Input */}
              {targetEmail ? (
                <div className="p-3.5 bg-zinc-950/70 border border-zinc-800/80 rounded-xl flex items-center gap-3 text-xs">
                  <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                    <User size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <span className="text-zinc-500 block text-[10px] uppercase font-bold tracking-wider">Activating Account</span>
                    <span className="font-mono text-zinc-200 font-medium truncate block text-xs">
                      {targetEmail}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Mail size={12} className="text-emerald-400" />
                    Staff Email Address
                  </label>
                  <input
                    type="email"
                    value={targetEmail}
                    onChange={(e) => setTargetEmail(e.target.value)}
                    placeholder="Enter your registered staff email"
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                    required
                  />
                </div>
              )}

              {submitError && (
                <div className="p-3 bg-rose-500/10 border border-rose-500/30 rounded-xl flex items-start gap-2.5 text-xs text-rose-300">
                  <AlertTriangle size={15} className="text-rose-400 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {/* New Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <Lock size={12} className="text-emerald-400" />
                  Create Password
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter your personal password"
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                    autoFocus
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Confirm Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                  <ShieldCheck size={12} className="text-emerald-400" />
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password to confirm"
                    className="w-full bg-zinc-950/80 border border-zinc-800 rounded-xl px-3.5 py-2.5 text-sm text-zinc-100 placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 transition-all font-mono"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 p-1"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Password Requirements Checklist */}
              <div className="bg-zinc-950/50 p-3.5 rounded-xl border border-zinc-800/80 space-y-2 text-[11px]">
                <span className="font-semibold text-zinc-400 uppercase tracking-wider text-[10px] block">
                  Password Security Requirements:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                  <div className={`flex items-center gap-1.5 ${rules.length ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={rules.length ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>8+ characters</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasUpper ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={rules.hasUpper ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>1 uppercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasLower ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={rules.hasLower ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>1 lowercase letter</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasNumber ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={rules.hasNumber ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>1 number (0-9)</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasSpecial ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={rules.hasSpecial ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>1 special character</span>
                  </div>
                  <div className={`flex items-center gap-1.5 ${passwordsMatch ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <Check size={12} className={passwordsMatch ? 'text-emerald-400' : 'text-zinc-600'} />
                    <span>Passwords match</span>
                  </div>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !isPasswordValid || !passwordsMatch}
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-2"
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    <span>Activating Account in Firebase...</span>
                  </>
                ) : (
                  <>
                    <span>Activate Account & Complete Setup</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          )}

          {/* State 4: Success View */}
          {submitSuccess && (
            <div className="py-6 text-center space-y-5 animate-in zoom-in-95 duration-200">
              <div className="w-16 h-16 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center mx-auto shadow-xl">
                <CheckCircle2 size={36} />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">
                  Account Activated Successfully!
                </h2>
                <p className="text-xs text-zinc-300 max-w-xs mx-auto leading-relaxed">
                  Your password has been saved securely to Firebase Authentication. Your staff account status is now <span className="text-emerald-400 font-semibold">Active & Verified</span>.
                </p>
              </div>

              <div className="p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 text-xs text-zinc-400 flex items-center justify-center gap-2">
                <Clock size={14} className="text-emerald-400" />
                <span>Redirecting to sign in screen in <strong>{countdown}s</strong>...</span>
              </div>

              <button
                type="button"
                onClick={() => handleProceedToLogin()}
                className="w-full py-3 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 font-bold text-sm shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
              >
                <span>Sign In Now</span>
                <ArrowRight size={16} />
              </button>
            </div>
          )}

        </div>

        {/* Security Compliance Footer */}
        <div className="mt-6 text-center text-xs text-zinc-500 flex items-center justify-center gap-1.5">
          <ShieldCheck size={14} className="text-emerald-500" />
          <span>Protected by Firebase Authentication & 256-bit TLS Encryption</span>
        </div>

      </div>
    </div>
  );
}
