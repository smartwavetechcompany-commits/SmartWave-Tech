import React, { useEffect, useMemo, useState } from 'react';
import {
  Award,
  Search,
  PlusCircle,
  MinusCircle,
  RotateCcw,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  X,
  ShieldCheck,
  Mail,
  ArrowRight,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { Guest, Hotel, LoyaltyAccount, UserProfile } from '../types';
import { cn, formatCurrency } from '../utils';
import {
  adjustGuestLoyaltyPoints,
  calculateRedemptionMonetaryValue,
  getLoyaltyPolicy,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
} from '../services/loyaltyService';

interface ManageLoyaltyPointsModalProps {
  isOpen: boolean;
  onClose: () => void;
  hotel: Hotel;
  profile: UserProfile;
  guests: Guest[];
  loyaltyAccountsMap: Record<string, LoyaltyAccount>;
  initialGuest?: Guest | null;
  initialAction?: 'manual_award' | 'manual_deduct' | 'reversal';
  currency: 'NGN' | 'USD';
  exchangeRate: number;
}

export function ManageLoyaltyPointsModal({
  isOpen,
  onClose,
  hotel,
  profile,
  guests,
  loyaltyAccountsMap,
  initialGuest = null,
  initialAction = 'manual_award',
  currency,
  exchangeRate,
}: ManageLoyaltyPointsModalProps) {
  const policy = useMemo(() => getLoyaltyPolicy(hotel), [hotel]);

  const [step, setStep] = useState<'form' | 'confirm'>('form');
  const [guestSearch, setGuestSearch] = useState('');
  const [selectedGuestId, setSelectedGuestId] = useState<string>(initialGuest?.id || '');
  const [action, setAction] = useState<'manual_award' | 'manual_deduct' | 'reversal'>(initialAction);
  const [pointsInput, setPointsInput] = useState('');
  const [reason, setReason] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [idempotencyKey, setIdempotencyKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep('form');
      setSelectedGuestId(initialGuest?.id || '');
      setAction(initialAction || 'manual_award');
      setPointsInput('');
      setReason('');
      setExpiresAt('');
      setGuestSearch('');
      setIdempotencyKey('');
      setIsSubmitting(false);
    }
  }, [isOpen, initialGuest?.id, initialAction]);

  const selectedGuest = useMemo(
    () => guests.find((g) => g.id === selectedGuestId) || initialGuest || null,
    [guests, selectedGuestId, initialGuest]
  );

  const selectedAccount = useMemo(
    () => (selectedGuest ? loyaltyAccountsMap[selectedGuest.id] || null : null),
    [selectedGuest, loyaltyAccountsMap]
  );

  const filteredGuests = useMemo(() => {
    const q = guestSearch.trim().toLowerCase();
    if (!q) return guests.slice(0, 30);
    return guests
      .filter(
        (g) =>
          (g.name || '').toLowerCase().includes(q) ||
          (g.email || '').toLowerCase().includes(q) ||
          (g.phone || '').toLowerCase().includes(q) ||
          g.id.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [guests, guestSearch]);

  if (!isOpen) return null;

  const currentAvailable = selectedAccount?.availablePoints ?? 0;
  const currentLifetime = selectedAccount?.lifetimePointsEarned ?? 0;
  const parsedPoints = Number(pointsInput);
  const isDeduction = action === 'manual_deduct';

  const validation = selectedGuest
    ? validateManualPointsAdjustment(
        {
          action,
          points: parsedPoints,
          reason,
          expiresAt: !isDeduction && expiresAt ? expiresAt : null,
        },
        policy,
        currentAvailable
      )
    : { valid: false, error: 'Please select an existing guest profile.' };

  const previewUpdatedBalance = Number.isInteger(parsedPoints) && parsedPoints > 0
    ? currentAvailable + (isDeduction ? -parsedPoints : parsedPoints)
    : currentAvailable;

  const previewLifetime = Number.isInteger(parsedPoints) && parsedPoints > 0
    ? isDeduction
      ? currentLifetime
      : currentLifetime + parsedPoints
    : currentLifetime;

  const currentLevel = resolveMembershipLevel(currentLifetime, policy.membershipLevels);
  const nextLevel = resolveMembershipLevel(previewLifetime, policy.membershipLevels);
  const willUpgradeTier =
    Boolean(selectedAccount) &&
    nextLevel.name !== currentLevel.name &&
    nextLevel.minPoints > currentLevel.minPoints;

  const monetaryEstimate = calculateRedemptionMonetaryValue(
    Math.max(0, previewUpdatedBalance),
    policy
  );

  const handleProceedToConfirm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGuest) {
      toast.error('Please select an existing guest profile.');
      return;
    }
    if (!validation.valid) {
      toast.error(validation.error || 'Please correct the form fields before continuing.');
      return;
    }
    // Generate one idempotency key per review session to prevent duplicate submissions
    const nonce = Math.random().toString(36).slice(2, 8);
    setIdempotencyKey(`manual_${selectedGuest.id}_${Date.now()}_${nonce}`);
    setStep('confirm');
  };

  const handleConfirmSubmit = async () => {
    if (!selectedGuest || isSubmitting) return;
    setIsSubmitting(true);
    try {
      const res = await adjustGuestLoyaltyPoints(
        hotel,
        selectedGuest,
        {
          action,
          points: Math.floor(parsedPoints),
          reason: reason.trim(),
          expiresAt: !isDeduction && expiresAt ? new Date(`${expiresAt}T23:59:59`).toISOString() : null,
          idempotencyKey: idempotencyKey || `manual_${selectedGuest.id}_${Date.now()}`,
        },
        profile
      );

      if (!res.success) {
        toast.error(res.error || 'Failed to update loyalty points.');
        setIsSubmitting(false);
        return;
      }

      if (res.duplicate) {
        toast.info('This loyalty adjustment was already recorded.');
      } else {
        const label =
          action === 'manual_deduct'
            ? `Deducted ${parsedPoints.toLocaleString()} pts from ${selectedGuest.name}`
            : action === 'reversal'
              ? `Recorded reversal adjustment (+${parsedPoints.toLocaleString()} pts) for ${selectedGuest.name}`
              : `Awarded ${parsedPoints.toLocaleString()} pts to ${selectedGuest.name}`;
        toast.success(label);
        if (res.tierUpgraded) {
          toast.success(
            `Membership level upgraded: ${res.tierUpgraded.previousTier} → ${res.tierUpgraded.newTier}`
          );
        }
      }
      onClose();
    } catch (err: any) {
      toast.error(err?.message || 'Unexpected error updating loyalty points.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm overflow-y-auto p-3 sm:p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !isSubmitting) onClose();
      }}
    >
      <div className="min-h-full flex items-center justify-center">
        <div className="w-full max-w-xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="px-6 py-4 bg-zinc-950 border-b border-zinc-800 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                <Award size={18} />
              </div>
              <div>
                <h2 className="text-base font-bold text-zinc-50">Manage Loyalty Points</h2>
                <p className="text-xs text-zinc-400">
                  {step === 'form'
                    ? 'Award, deduct, or post a corrective adjustment for an existing guest'
                    : 'Review & confirm before committing immutable loyalty ledger entry'}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {!policy.enabled || !policy.allowManualAllocation ? (
            <div className="p-6 space-y-4">
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-start gap-3">
                <AlertTriangle size={18} className="text-amber-400 shrink-0 mt-0.5" />
                <div className="text-xs text-amber-200 space-y-1">
                  <p className="font-bold text-amber-300">
                    {!policy.enabled
                      ? 'Loyalty Programme is Disabled'
                      : 'Manual Points Allocation is Disabled'}
                  </p>
                  <p className="text-amber-200/80">
                    Enable the Guest Loyalty Programme and Manual Points Allocation in{' '}
                    <span className="font-semibold text-amber-100">
                      Admin Controls → Loyalty &amp; Rewards
                    </span>{' '}
                    to allocate or deduct guest loyalty points.
                  </p>
                </div>
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-bold"
                >
                  Close
                </button>
              </div>
            </div>
          ) : step === 'form' ? (
            <form onSubmit={handleProceedToConfirm} className="p-6 space-y-5">
              {/* Guest Selection */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Existing Guest Profile *
                </label>
                {selectedGuest ? (
                  <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-zinc-100 truncate">
                        {selectedGuest.name}
                      </div>
                      <div className="text-[11px] text-zinc-400 truncate">
                        {selectedGuest.email || 'No email'} • {selectedGuest.phone || 'No phone'}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[10px]">
                        <span className="px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 font-bold">
                          Balance: {currentAvailable.toLocaleString()} pts
                        </span>
                        <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-semibold">
                          Level: {currentLevel.name}
                        </span>
                        {!selectedAccount && (
                          <span className="px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20 font-semibold">
                            Will activate loyalty account
                          </span>
                        )}
                      </div>
                    </div>
                    {!initialGuest && (
                      <button
                        type="button"
                        onClick={() => setSelectedGuestId('')}
                        className="text-xs font-bold text-zinc-400 hover:text-zinc-100 px-2.5 py-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 shrink-0"
                      >
                        Change
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="relative">
                      <Search
                        size={14}
                        className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
                      />
                      <input
                        type="text"
                        value={guestSearch}
                        onChange={(e) => setGuestSearch(e.target.value)}
                        placeholder="Search existing guest by name, email, or phone..."
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-amber-500/50"
                      />
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded-xl border border-zinc-800 bg-zinc-950 divide-y divide-zinc-800/70">
                      {filteredGuests.length === 0 ? (
                        <div className="p-4 text-center text-xs text-zinc-500">
                          No matching guest profiles found.
                        </div>
                      ) : (
                        filteredGuests.map((g) => {
                          const acc = loyaltyAccountsMap[g.id];
                          return (
                            <button
                              key={g.id}
                              type="button"
                              onClick={() => setSelectedGuestId(g.id)}
                              className="w-full px-3.5 py-2.5 text-left hover:bg-zinc-900 flex items-center justify-between gap-2 transition-colors"
                            >
                              <div className="min-w-0">
                                <div className="text-xs font-bold text-zinc-100 truncate">
                                  {g.name}
                                </div>
                                <div className="text-[10px] text-zinc-500 truncate">
                                  {g.email || g.phone || g.id}
                                </div>
                              </div>
                              <div className="text-right shrink-0">
                                <div className="text-[11px] font-mono font-bold text-amber-400">
                                  {(acc?.availablePoints ?? 0).toLocaleString()} pts
                                </div>
                                <div className="text-[9px] text-zinc-500">
                                  {acc?.membershipLevelName || 'Not activated'}
                                </div>
                              </div>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Selector */}
              <div className="space-y-2">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Adjustment Type *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => setAction('manual_award')}
                    className={cn(
                      'p-3 rounded-xl border text-left transition-all flex flex-col gap-1',
                      action === 'manual_award'
                        ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    )}
                  >
                    <PlusCircle size={16} />
                    <span className="text-xs font-bold">Award Points</span>
                    <span className="text-[10px] opacity-75">Credit guest balance</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('manual_deduct')}
                    className={cn(
                      'p-3 rounded-xl border text-left transition-all flex flex-col gap-1',
                      action === 'manual_deduct'
                        ? 'bg-rose-500/10 border-rose-500/40 text-rose-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    )}
                  >
                    <MinusCircle size={16} />
                    <span className="text-xs font-bold">Deduct Points</span>
                    <span className="text-[10px] opacity-75">Debit available points</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setAction('reversal')}
                    className={cn(
                      'p-3 rounded-xl border text-left transition-all flex flex-col gap-1',
                      action === 'reversal'
                        ? 'bg-blue-500/10 border-blue-500/40 text-blue-300'
                        : 'bg-zinc-950 border-zinc-800 text-zinc-400 hover:border-zinc-700'
                    )}
                  >
                    <RotateCcw size={16} />
                    <span className="text-xs font-bold">Reversal Credit</span>
                    <span className="text-[10px] opacity-75">Correct prior entry</span>
                  </button>
                </div>
              </div>

              {/* Points & Optional Expiry */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                    Points Amount (Whole Number) *
                  </label>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    required
                    value={pointsInput}
                    onChange={(e) => setPointsInput(e.target.value)}
                    placeholder="e.g. 250"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-sm font-mono font-bold text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
                  />
                  {selectedGuest && isDeduction && (
                    <p className="text-[10px] text-zinc-500">
                      Max deductible: <strong className="text-zinc-300">{currentAvailable.toLocaleString()} pts</strong>
                    </p>
                  )}
                </div>

                {!isDeduction && (
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
                      <Calendar size={12} />
                      Expiry Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={expiresAt}
                      min={new Date().toISOString().slice(0, 10)}
                      onChange={(e) => setExpiresAt(e.target.value)}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-amber-500/50"
                    />
                    <p className="text-[10px] text-zinc-500">
                      {policy.pointsExpiryEnabled
                        ? `Leave blank to apply default ${policy.pointsExpiryDays}-day expiry policy.`
                        : 'Leave blank for non-expiring points.'}
                    </p>
                  </div>
                )}
              </div>

              {/* Mandatory Reason */}
              <div className="space-y-1.5">
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">
                  Reason / Audit Note *
                </label>
                <textarea
                  rows={3}
                  required
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={
                    isDeduction
                      ? 'Explain why points are being deducted (e.g. correction of duplicate manual award)...'
                      : 'Explain why points are being awarded (e.g. VIP hospitality gesture, anniversary bonus)...'
                  }
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50 resize-none"
                />
              </div>

              {/* Inline Validation Warning */}
              {selectedGuest && pointsInput !== '' && !validation.valid && (
                <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center gap-2 text-xs text-rose-300">
                  <AlertTriangle size={15} className="shrink-0" />
                  <span>{validation.error}</span>
                </div>
              )}

              {/* Actions */}
              <div className="pt-2 flex items-center justify-end gap-2.5 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedGuest || !validation.valid}
                  className="px-5 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-black text-xs font-bold flex items-center gap-1.5 transition-all"
                >
                  <span>Review Adjustment</span>
                  <ArrowRight size={14} />
                </button>
              </div>
            </form>
          ) : (
            /* Step 2: Review & Confirm */
            <div className="p-6 space-y-5">
              <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800 space-y-3">
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Guest</span>
                  <span className="font-bold text-zinc-100">{selectedGuest?.name}</span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Action</span>
                  <span
                    className={cn(
                      'font-bold uppercase text-[11px] px-2 py-0.5 rounded border',
                      isDeduction
                        ? 'bg-rose-500/10 text-rose-300 border-rose-500/30'
                        : action === 'reversal'
                          ? 'bg-blue-500/10 text-blue-300 border-blue-500/30'
                          : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    )}
                  >
                    {action === 'manual_deduct'
                      ? 'Manual Deduction'
                      : action === 'reversal'
                        ? 'Reversal Adjustment'
                        : 'Manual Award'}
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Previous Balance</span>
                  <span className="font-mono text-zinc-300">{currentAvailable.toLocaleString()} pts</span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Points Delta</span>
                  <span
                    className={cn(
                      'font-mono font-bold text-sm',
                      isDeduction ? 'text-rose-400' : 'text-emerald-400'
                    )}
                  >
                    {isDeduction ? '-' : '+'}
                    {Math.floor(parsedPoints).toLocaleString()} pts
                  </span>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Updated Available Balance</span>
                  <div className="text-right">
                    <div className="font-mono font-bold text-amber-400 text-sm">
                      {previewUpdatedBalance.toLocaleString()} pts
                    </div>
                    {policy.redemptionPointValue > 0 && (
                      <div className="text-[10px] text-zinc-500">
                        Est. value {formatCurrency(monetaryEstimate, currency, exchangeRate)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                  <span className="text-zinc-400">Membership Level</span>
                  <span className="font-bold text-zinc-100">
                    {willUpgradeTier ? (
                      <span className="text-emerald-400">
                        {currentLevel.name} → {nextLevel.name} (Upgrade)
                      </span>
                    ) : (
                      nextLevel.name
                    )}
                  </span>
                </div>
                {!isDeduction && (expiresAt || policy.pointsExpiryEnabled) && (
                  <div className="flex items-center justify-between text-xs border-b border-zinc-800/80 pb-2.5">
                    <span className="text-zinc-400">Points Expiry</span>
                    <span className="text-zinc-200 font-medium">
                      {expiresAt
                        ? new Date(`${expiresAt}T00:00:00`).toLocaleDateString('en-US', {
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                          })
                        : `${policy.pointsExpiryDays} days from commit`}
                    </span>
                  </div>
                )}
                <div className="text-xs space-y-1">
                  <span className="text-zinc-400 block">Audit Reason</span>
                  <p className="text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg p-2.5">
                    {reason.trim()}
                  </p>
                </div>
              </div>

              {/* Email & Immutability Notices */}
              <div className="space-y-2">
                <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-start gap-2.5 text-[11px] text-zinc-400">
                  <ShieldCheck size={15} className="text-emerald-400 shrink-0 mt-0.5" />
                  <span>
                    This transaction is <strong className="text-zinc-200">immutable</strong> once
                    committed and isolated from room pricing, folios, and financial ledger entries.
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 flex items-start gap-2.5 text-[11px] text-zinc-400">
                  <Mail size={15} className="text-amber-400 shrink-0 mt-0.5" />
                  <span>
                    {policy.notifyGuestsByEmail !== false && selectedGuest?.email
                      ? `A branded notification email will be sent to ${selectedGuest.email} via the hotel email service after commit.`
                      : !selectedGuest?.email
                        ? 'Guest has no email on file; points will be recorded without sending email.'
                        : 'Loyalty email notifications are currently muted in Admin Controls.'}
                  </span>
                </div>
              </div>

              {/* Confirm Actions */}
              <div className="pt-2 flex items-center justify-between border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setStep('form')}
                  disabled={isSubmitting}
                  className="px-4 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold flex items-center gap-1.5"
                >
                  <ArrowLeft size={14} />
                  <span>Edit</span>
                </button>
                <button
                  type="button"
                  onClick={handleConfirmSubmit}
                  disabled={isSubmitting}
                  className={cn(
                    'px-5 py-2.5 rounded-xl text-xs font-bold flex items-center gap-2 transition-all disabled:opacity-50',
                    isDeduction
                      ? 'bg-rose-500 hover:bg-rose-400 text-white'
                      : 'bg-emerald-500 hover:bg-emerald-400 text-black'
                  )}
                >
                  {isSubmitting ? (
                    <>
                      <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
                      <span>Committing...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 size={15} />
                      <span>Confirm &amp; Commit</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
