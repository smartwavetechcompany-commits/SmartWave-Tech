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
  UserCheck
} from 'lucide-react';
import { 
  validatePasswordResetToken, 
  completePasswordResetWithToken 
} from '../utils/passwordResetService';
import { PasswordResetToken } from '../types';

interface Props {
  tokenParam?: string;
  emailParam?: string;
  onNavigateToLogin: (prefilledEmail?: string, successMessage?: string) => void;
}

export function ResetPasswordPage({ tokenParam, emailParam, onNavigateToLogin }: Props) {
  const [tokenInput, setTokenInput] = useState(tokenParam || '');
  const [tokenData, setTokenData] = useState<PasswordResetToken | null>(null);
  const [isValidating, setIsValidating] = useState(true);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Form states
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitSuccess, setSubmitSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Live countdown timer state
  const [timeLeft, setTimeLeft] = useState<{ minutes: number; seconds: number } | null>(null);

  const isActivation = tokenData?.type === 'activation';

  // Read URL params if not passed in props
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const activeToken = tokenParam || params.get('resetToken') || params.get('token');
    if (activeToken) {
      setTokenInput(activeToken);
      performValidation(activeToken);
    } else {
      setIsValidating(false);
      setValidationError('No security token was provided. Please use the activation or password reset link sent to your email, or contact your Hotel Administrator.');
    }
  }, [tokenParam]);

  // Validate the token
  const performValidation = async (tokenId: string) => {
    setIsValidating(true);
    setValidationError(null);
    try {
      const result = await validatePasswordResetToken(tokenId);
      if (result.valid && result.tokenData) {
        setTokenData(result.tokenData);
      } else {
        setValidationError(result.error || 'The link is invalid, expired, or has already been used.');
      }
    } catch (err: any) {
      setValidationError(err.message || 'Unable to validate the security link.');
    } finally {
      setIsValidating(false);
    }
  };

  // Live expiration timer
  useEffect(() => {
    if (!tokenData?.expiresAt || tokenData.isUsed) return;

    const calculateTimeLeft = () => {
      const diff = new Date(tokenData.expiresAt).getTime() - Date.now();
      if (diff <= 0) {
        setTimeLeft(null);
        setValidationError(`This link expired at ${new Date(tokenData.expiresAt).toLocaleTimeString()}. Please request a new link from your Hotel Administrator.`);
        return;
      }
      const minutes = Math.floor(diff / 60000);
      const seconds = Math.floor((diff % 60000) / 1000);
      setTimeLeft({ minutes, seconds });
    };

    calculateTimeLeft();
    const timer = setInterval(calculateTimeLeft, 1000);
    return () => clearInterval(timer);
  }, [tokenData]);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!tokenData?.token) return;

    if (!isPasswordValid) {
      setSubmitError('Please satisfy all password security requirements before proceeding.');
      return;
    }

    if (!passwordsMatch) {
      setSubmitError('The entered passwords do not match.');
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const params = new URLSearchParams(window.location.search);
      const oobCode = params.get('oobCode') || undefined;

      await completePasswordResetWithToken(tokenData.token, newPassword, oobCode);
      setSubmitSuccess(true);
    } catch (err: any) {
      setSubmitError(err.message || 'Failed to update password. Please try again or contact your administrator.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Clean URL when returning to login
  const handleBackToLogin = (withSuccessMsg = false) => {
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.delete('resetToken');
      url.searchParams.delete('token');
      url.searchParams.delete('oobCode');
      url.searchParams.delete('mode');
      url.searchParams.delete('apiKey');
      window.history.replaceState({}, document.title, url.pathname);
    }
    const targetEmail = tokenData?.targetEmail || emailParam;
    const msg = withSuccessMsg 
      ? (isActivation 
          ? 'Account successfully activated! You can now log into the PMS.' 
          : 'Password successfully updated! You can now log into the PMS.')
      : undefined;
    onNavigateToLogin(targetEmail, msg);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center p-4 selection:bg-emerald-500 selection:text-zinc-950">
      <div className="w-full max-w-md">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-zinc-900 border border-zinc-800 text-emerald-400 mb-4 shadow-xl">
            {isActivation ? <UserCheck size={28} /> : <KeyRound size={28} />}
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-white">
            {isActivation ? 'Staff Account Activation' : 'Staff Password Reset'}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            {isActivation 
              ? 'Create your password to activate your Hotel PMS account' 
              : 'Enterprise Hotel Property Management System'}
          </p>
        </div>

        {/* Content Box */}
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-xl">
          {/* Loading State */}
          {isValidating && (
            <div className="py-12 text-center space-y-4">
              <div className="w-10 h-10 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-zinc-400 font-medium">
                Verifying secure security token with hotel directory...
              </p>
            </div>
          )}

          {/* Invalid / Expired / Used Error State */}
          {!isValidating && validationError && (
            <div className="space-y-6">
              <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl space-y-3">
                <div className="flex items-center gap-2.5 text-red-400 font-bold text-sm">
                  <AlertTriangle size={18} className="shrink-0" />
                  <span>Invalid or Expired Link</span>
                </div>
                <p className="text-xs text-red-200/90 leading-relaxed">
                  {validationError}
                </p>
              </div>

              <div className="p-4 bg-zinc-950/60 border border-zinc-800/80 rounded-xl space-y-2 text-xs text-zinc-400">
                <p className="font-semibold text-zinc-300">Why did this happen?</p>
                <ul className="list-disc list-inside space-y-1 text-zinc-400">
                  <li>Activation links are valid for 24 hours; password reset links are valid for the configured period.</li>
                  <li>Each security link is single-use and deactivates immediately after password creation.</li>
                  <li>Your Hotel Administrator can resend an activation email or issue a new reset link.</li>
                </ul>
              </div>

              <div className="pt-2">
                <button
                  onClick={() => handleBackToLogin(false)}
                  className="w-full py-3 px-4 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-white text-sm font-semibold transition-all flex items-center justify-center gap-2"
                >
                  <ArrowLeft size={16} />
                  Return to Sign In
                </button>
              </div>
            </div>
          )}

          {/* Success State */}
          {!isValidating && submitSuccess && (
            <div className="py-6 text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center mx-auto shadow-inner">
                <CheckCircle2 size={36} />
              </div>
              
              <div className="space-y-2">
                <h2 className="text-xl font-bold text-white">
                  {isActivation ? 'Account Activated Successfully!' : 'Password Successfully Set!'}
                </h2>
                <p className="text-xs text-zinc-400 leading-relaxed max-w-sm mx-auto">
                  {isActivation 
                    ? 'Your staff account is now active and verified. You can now log into the PMS using your registered email and new password.' 
                    : 'Your new staff password has been encrypted and applied across the Hotel PMS. You can now log into your account.'}
                </p>
              </div>

              <div className="p-3 bg-zinc-950/50 border border-zinc-800/80 rounded-xl text-left text-xs space-y-1.5">
                <div className="flex justify-between text-zinc-400">
                  <span>Account:</span>
                  <span className="font-semibold text-zinc-200">{tokenData?.targetEmail}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Property:</span>
                  <span className="font-semibold text-zinc-200">{tokenData?.hotelName}</span>
                </div>
                <div className="flex justify-between text-zinc-400">
                  <span>Account Status:</span>
                  <span className="text-emerald-400 font-semibold">Active & Verified</span>
                </div>
              </div>

              <button
                onClick={() => handleBackToLogin(true)}
                className="w-full py-3.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-bold shadow-lg shadow-emerald-500/20 transition-all flex items-center justify-center gap-2"
              >
                <span>Proceed to Sign In</span>
                <Sparkles size={16} />
              </button>
            </div>
          )}

          {/* Active Reset / Activation Form */}
          {!isValidating && !validationError && !submitSuccess && tokenData && (
            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Account Context Badge */}
              <div className="p-3.5 bg-zinc-950/60 border border-zinc-800 rounded-xl space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Hotel Property:</span>
                  <span className="font-bold text-zinc-200 flex items-center gap-1.5">
                    <Building2 size={13} className="text-emerald-400" />
                    {tokenData.hotelName || 'Hotel PMS'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-500 font-medium">Staff Account:</span>
                  <span className="font-semibold text-zinc-300 flex items-center gap-1.5">
                    <User size={13} className="text-zinc-400" />
                    {tokenData.targetEmail}
                  </span>
                </div>
                
                {/* Live Countdown */}
                {timeLeft && (
                  <div className="pt-2 border-t border-zinc-800/80 flex items-center justify-between text-xs">
                    <span className="text-amber-400/90 font-medium flex items-center gap-1.5">
                      <Clock size={13} className="text-amber-400" />
                      Link Expiration:
                    </span>
                    <span className="font-mono font-bold text-amber-300 bg-amber-500/10 px-2 py-0.5 rounded border border-amber-500/20">
                      {String(timeLeft.minutes).padStart(2, '0')}m {String(timeLeft.seconds).padStart(2, '0')}s
                    </span>
                  </div>
                )}
              </div>

              {isActivation && (
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-xs text-emerald-300/90 leading-relaxed">
                  <span className="font-bold text-emerald-400 block mb-0.5">Welcome to the Team!</span>
                  Default passwords are not provided for security compliance. Please establish your personal password below to activate your account.
                </div>
              )}

              {submitError && (
                <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-xs text-red-400 font-medium">
                  {submitError}
                </div>
              )}

              {/* New Password Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-300">
                  {isActivation ? 'Create Your Password' : 'New Staff Password'}
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter strong password"
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 pr-10 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
              </div>

              {/* Password Checklist */}
              <div className="p-3 bg-zinc-950/40 border border-zinc-800/80 rounded-xl space-y-1.5 text-[11px]">
                <div className="font-semibold text-zinc-400 mb-1">Security Criteria:</div>
                <div className="grid grid-cols-2 gap-x-2 gap-y-1">
                  <div className={`flex items-center gap-1.5 ${rules.length ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <span>{rules.length ? '✓' : '•'}</span> 8+ Characters
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasUpper ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <span>{rules.hasUpper ? '✓' : '•'}</span> Uppercase (A-Z)
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasLower ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <span>{rules.hasLower ? '✓' : '•'}</span> Lowercase (a-z)
                  </div>
                  <div className={`flex items-center gap-1.5 ${rules.hasNumber ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <span>{rules.hasNumber ? '✓' : '•'}</span> Number (0-9)
                  </div>
                  <div className={`flex items-center gap-1.5 col-span-2 ${rules.hasSpecial ? 'text-emerald-400 font-medium' : 'text-zinc-500'}`}>
                    <span>{rules.hasSpecial ? '✓' : '•'}</span> Special Symbol (!@#$%^&*)
                  </div>
                </div>
              </div>

              {/* Confirm Password Field */}
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-zinc-300">
                  Confirm Password
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Re-enter password"
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 pr-10 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
                  >
                    {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {confirmPassword && (
                  <p className={`text-[11px] font-medium ${passwordsMatch ? 'text-emerald-400' : 'text-red-400'}`}>
                    {passwordsMatch ? '✓ Passwords match perfectly' : '✗ Passwords do not match'}
                  </p>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting || !isPasswordValid || !passwordsMatch}
                className={`w-full py-3.5 px-4 rounded-xl text-sm font-bold transition-all shadow-lg flex items-center justify-center gap-2 ${
                  isSubmitting || !isPasswordValid || !passwordsMatch
                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700/50'
                    : 'bg-emerald-500 hover:bg-emerald-400 text-zinc-950 shadow-emerald-500/20 active:scale-[0.99]'
                }`}
              >
                {isSubmitting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-zinc-950 border-t-transparent rounded-full animate-spin" />
                    <span>{isActivation ? 'Activating Account...' : 'Updating Password...'}</span>
                  </>
                ) : (
                  <>
                    <Lock size={16} />
                    <span>{isActivation ? 'Activate Account & Set Password' : 'Set New Password & Continue'}</span>
                  </>
                )}
              </button>

              <div className="text-center pt-2">
                <button
                  type="button"
                  onClick={() => handleBackToLogin(false)}
                  className="text-xs text-zinc-400 hover:text-zinc-200 transition-colors inline-flex items-center gap-1.5"
                >
                  <ArrowLeft size={13} />
                  <span>Return to Sign In</span>
                </button>
              </div>
            </form>
          )}
        </div>

        {/* Security Footnote */}
        <div className="mt-8 text-center text-xs text-zinc-600 flex items-center justify-center gap-1.5">
          <ShieldCheck size={14} className="text-zinc-500" />
          <span>Protected by Enterprise PMS Role-Based Access Control</span>
        </div>
      </div>
    </div>
  );
}
