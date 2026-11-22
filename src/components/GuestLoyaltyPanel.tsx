import React, { useMemo, useState } from 'react';
import {
  Award,
  Sparkles,
  Gift,
  Clock,
  CheckCircle2,
  AlertTriangle,
  PlusCircle,
  History,
  Bell,
  RefreshCw,
  ShieldCheck,
  Info,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  Guest,
  Hotel,
  LedgerEntry,
  LoyaltyAccount,
  LoyaltyTransaction,
  Reservation,
  UserProfile,
} from '../types';
import { cn, formatCurrency } from '../utils';
import { safeFormatDate } from '../utils/dateUtils';
import {
  activateGuestLoyaltyAccount,
  awardAutomaticStayPoints,
  calculateRedemptionMonetaryValue,
  canManageLoyalty,
  evaluateLoyaltyPointsExpiry,
  evaluateStayEligibilityForAutoEarn,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  processExpiredLoyaltyPoints,
  redeemGuestLoyaltyPoints,
  resolveMembershipLevel,
  sendExpiringPointsReminder,
  validatePointsRedemption,
} from '../services/loyaltyService';

interface GuestLoyaltyPanelProps {
  hotel: Hotel;
  profile: UserProfile | null;
  customRoles?: any[];
  guest: Guest;
  account: LoyaltyAccount | null;
  guestTransactions: LoyaltyTransaction[];
  guestReservations: Reservation[];
  allLedgerEntries: LedgerEntry[];
  currency: 'NGN' | 'USD';
  exchangeRate: number;
  onOpenManageModal: (
    guest: Guest,
    action?: 'manual_award' | 'manual_deduct' | 'reversal'
  ) => void;
}

const TX_BADGE_MAP: Record<
  string,
  { label: string; className: string }
> = {
  earn_auto: {
    label: 'Stay Earned',
    className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20',
  },
  manual_award: {
    label: 'Manual Award',
    className: 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  },
  manual_deduct: {
    label: 'Manual Deduct',
    className: 'bg-rose-500/10 text-rose-400 border-rose-500/20',
  },
  redemption: {
    label: 'Redemption',
    className: 'bg-purple-500/10 text-purple-300 border-purple-500/30',
  },
  expiry: {
    label: 'Expired',
    className: 'bg-amber-500/10 text-amber-400 border-amber-500/20',
  },
  reversal: {
    label: 'Reversal',
    className: 'bg-blue-500/10 text-blue-300 border-blue-500/20',
  },
  tier_change: {
    label: 'Tier Upgrade',
    className: 'bg-amber-500/15 text-amber-300 border-amber-500/30',
  },
  account_activation: {
    label: 'Activated',
    className: 'bg-zinc-800 text-zinc-300 border-zinc-700',
  },
};

export function GuestLoyaltyPanel({
  hotel,
  profile,
  customRoles = [],
  guest,
  account,
  guestTransactions,
  guestReservations,
  allLedgerEntries,
  currency,
  exchangeRate,
  onOpenManageModal,
}: GuestLoyaltyPanelProps) {
  const policy = useMemo(() => getLoyaltyPolicy(hotel), [hotel]);
  const isManager = useMemo(() => canManageLoyalty(profile, customRoles), [profile, customRoles]);

  const [isActivating, setIsActivating] = useState(false);
  const [isSyncingStays, setIsSyncingStays] = useState(false);
  const [isProcessingExpiry, setIsProcessingExpiry] = useState(false);
  const [isSendingReminder, setIsSendingReminder] = useState(false);

  // Redemption panel state
  const [showRedeemBox, setShowRedeemBox] = useState(false);
  const [redeemPointsInput, setRedeemPointsInput] = useState('');
  const [redeemReason, setRedeemReason] = useState('');
  const [redeemReservationId, setRedeemReservationId] = useState('');
  const [isRedeeming, setIsRedeeming] = useState(false);

  const availablePoints = account?.availablePoints ?? 0;
  const lifetimeEarned = account?.lifetimePointsEarned ?? 0;
  const totalRedeemed = account?.totalPointsRedeemed ?? 0;
  const totalManuallyAdjusted = account?.totalPointsManuallyAdjusted ?? 0;
  const totalExpired = account?.totalPointsExpired ?? 0;

  const currentLevel = useMemo(
    () => resolveMembershipLevel(lifetimeEarned, policy.membershipLevels),
    [lifetimeEarned, policy.membershipLevels]
  );

  const { nextLevel, pointsNeeded } = useMemo(
    () => getNextMembershipLevel(lifetimeEarned, policy.membershipLevels),
    [lifetimeEarned, policy.membershipLevels]
  );

  const tierProgressPct = useMemo(() => {
    if (!nextLevel) return 100;
    const base = currentLevel.minPoints || 0;
    const span = Math.max(1, (nextLevel.minPoints || 0) - base);
    return Math.min(100, Math.max(0, Math.round(((lifetimeEarned - base) / span) * 100)));
  }, [currentLevel, nextLevel, lifetimeEarned]);

  const availableMonetaryValue = useMemo(
    () => calculateRedemptionMonetaryValue(availablePoints, policy),
    [availablePoints, policy]
  );

  const expirySummary = useMemo(
    () => evaluateLoyaltyPointsExpiry(guestTransactions, policy.expiryReminderDays),
    [guestTransactions, policy.expiryReminderDays]
  );

  // Evaluate eligible completed & settled stays (read-only against existing reservations/ledger)
  const stayEvaluations = useMemo(() => {
    return guestReservations.map((res) => {
      const resLedger = allLedgerEntries.filter(
        (l) => l.reservationId === res.id || (l as any).bookingId === res.id
      );
      return {
        reservation: res,
        evaluation: evaluateStayEligibilityForAutoEarn(res, hotel, resLedger, guestTransactions),
      };
    });
  }, [guestReservations, allLedgerEntries, hotel, guestTransactions]);

  const eligibleStays = useMemo(
    () => stayEvaluations.filter((item) => item.evaluation.eligible),
    [stayEvaluations]
  );

  const redeemPtsNumber = Number(redeemPointsInput);
  const redeemValidation = useMemo(
    () => validatePointsRedemption(redeemPtsNumber, policy, availablePoints),
    [redeemPtsNumber, policy, availablePoints]
  );

  const handleActivate = async () => {
    if (!profile || isActivating) return;
    setIsActivating(true);
    try {
      const res = await activateGuestLoyaltyAccount(hotel, guest, profile);
      if (res.success) {
        toast.success(
          res.duplicate
            ? 'Guest loyalty account is already active.'
            : `Loyalty account activated for ${guest.name}`
        );
      } else {
        toast.error(res.error || 'Could not activate loyalty account.');
      }
    } finally {
      setIsActivating(false);
    }
  };

  const handleAwardEligibleStays = async () => {
    if (!profile || isSyncingStays || eligibleStays.length === 0) return;
    setIsSyncingStays(true);
    let awardedCount = 0;
    let totalAwardedPts = 0;
    try {
      for (const item of eligibleStays) {
        const resLedger = allLedgerEntries.filter(
          (l) => l.reservationId === item.reservation.id || (l as any).bookingId === item.reservation.id
        );
        const result = await awardAutomaticStayPoints(
          hotel,
          guest,
          item.reservation,
          resLedger,
          profile
        );
        if (result.success && !result.duplicate && result.transaction) {
          awardedCount++;
          totalAwardedPts += result.transaction.points;
        }
      }
      if (awardedCount > 0) {
        toast.success(
          `Awarded ${totalAwardedPts.toLocaleString()} pts across ${awardedCount} settled stay(s).`
        );
      } else {
        toast.info('All eligible settled stays have already been awarded.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Error awarding eligible stay points.');
    } finally {
      setIsSyncingStays(false);
    }
  };

  const handleProcessExpired = async () => {
    if (!profile || isProcessingExpiry || expirySummary.expiredPointsUnprocessed <= 0) return;
    setIsProcessingExpiry(true);
    try {
      const res = await processExpiredLoyaltyPoints(hotel, guest, guestTransactions, profile);
      if (res.success && !res.duplicate && res.transaction) {
        toast.success(
          `Expired ${res.transaction.points.toLocaleString()} unused loyalty points per policy.`
        );
      } else if (res.duplicate) {
        toast.info('Expired points were already processed.');
      } else {
        toast.error(res.error || 'Unable to process expired points.');
      }
    } finally {
      setIsProcessingExpiry(false);
    }
  };

  const handleSendExpiryReminder = async () => {
    if (!account || isSendingReminder || !expirySummary.earliestExpiringDate) return;
    setIsSendingReminder(true);
    try {
      const res = await sendExpiringPointsReminder(
        hotel,
        guest,
        account,
        expirySummary.expiringSoonPoints,
        expirySummary.earliestExpiringDate
      );
      if (res.sent) {
        toast.success(`Expiry reminder queued for ${guest.email || guest.name}.`);
      } else {
        toast.info(res.reason || 'No expiring points to notify.');
      }
    } finally {
      setIsSendingReminder(false);
    }
  };

  const handleRedeemSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || isRedeeming) return;
    if (!redeemValidation.valid) {
      toast.error(redeemValidation.error || 'Invalid redemption request.');
      return;
    }
    if (!redeemReason.trim()) {
      toast.error('Please enter a redemption reason or reference.');
      return;
    }
    setIsRedeeming(true);
    try {
      const key = `redeem_${guest.id}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const res = await redeemGuestLoyaltyPoints(
        hotel,
        guest,
        {
          points: Math.floor(redeemPtsNumber),
          reason: redeemReason.trim(),
          reservationId: redeemReservationId || undefined,
          idempotencyKey: key,
        },
        profile
      );
      if (res.success && !res.duplicate) {
        toast.success(
          `Redeemed ${Math.floor(redeemPtsNumber).toLocaleString()} pts (${formatCurrency(
            redeemValidation.monetaryValue,
            currency,
            exchangeRate
          )} value) for ${guest.name}.`
        );
        setRedeemPointsInput('');
        setRedeemReason('');
        setRedeemReservationId('');
        setShowRedeemBox(false);
      } else if (res.duplicate) {
        toast.info('This redemption was already recorded.');
      } else {
        toast.error(res.error || 'Failed to redeem loyalty points.');
      }
    } finally {
      setIsRedeeming(false);
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 sm:p-6 shadow-md space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
            <Award size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base font-bold text-zinc-100">Loyalty &amp; Rewards</h3>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold border"
                style={{
                  borderColor: `${currentLevel.color || '#f59e0b'}55`,
                  backgroundColor: `${currentLevel.color || '#f59e0b'}18`,
                  color: currentLevel.color || '#fbbf24',
                }}
              >
                {currentLevel.name}
              </span>
              {!policy.enabled && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-zinc-800 text-zinc-400 border border-zinc-700">
                  Programme Disabled
                </span>
              )}
              {policy.enabled && !account && (
                <span className="px-2 py-0.5 rounded text-[9px] font-bold uppercase bg-blue-500/10 text-blue-300 border border-blue-500/20">
                  Not Yet Activated
                </span>
              )}
            </div>
            <p className="text-xs text-zinc-400">
              Independent guest rewards ledger linked to this guest profile
            </p>
          </div>
        </div>

        {isManager && policy.enabled && (
          <div className="flex flex-wrap items-center gap-2">
            {!account && (
              <button
                type="button"
                onClick={handleActivate}
                disabled={isActivating}
                className="px-3 py-1.5 rounded-xl bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-100 text-xs font-bold flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Sparkles size={13} className="text-amber-400" />
                <span>{isActivating ? 'Activating...' : 'Activate Loyalty'}</span>
              </button>
            )}
            {policy.allowManualAllocation && (
              <button
                type="button"
                onClick={() => onOpenManageModal(guest, 'manual_award')}
                className="px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold flex items-center gap-1.5 transition-all"
              >
                <PlusCircle size={13} />
                <span>Manage Loyalty Points</span>
              </button>
            )}
            {policy.enableRedemption && account && availablePoints > 0 && (
              <button
                type="button"
                onClick={() => setShowRedeemBox((prev) => !prev)}
                className="px-3 py-1.5 rounded-xl bg-purple-500/15 hover:bg-purple-500/25 border border-purple-500/30 text-purple-300 text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Gift size={13} />
                <span>Redeem Points</span>
              </button>
            )}
          </div>
        )}
      </div>

      {/* KPI Summary Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="p-3.5 rounded-xl bg-zinc-950 border border-amber-500/25">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            Available Points
          </div>
          <div className="text-xl font-bold font-mono text-amber-400 mt-0.5">
            {availablePoints.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {policy.redemptionPointValue > 0
              ? `≈ ${formatCurrency(availableMonetaryValue, currency, exchangeRate)}`
              : 'Current redeemable balance'}
          </div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            Lifetime Earned
          </div>
          <div className="text-xl font-bold font-mono text-emerald-400 mt-0.5">
            {lifetimeEarned.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Qualifies membership level</div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            Total Redeemed
          </div>
          <div className="text-xl font-bold font-mono text-purple-400 mt-0.5">
            {totalRedeemed.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Points claimed</div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            Manual Net Adj.
          </div>
          <div className="text-xl font-bold font-mono text-zinc-200 mt-0.5">
            {totalManuallyAdjusted > 0 ? `+${totalManuallyAdjusted.toLocaleString()}` : totalManuallyAdjusted.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">Admin awards &amp; deductions</div>
        </div>

        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800">
          <div className="text-[9px] font-bold uppercase tracking-wider text-zinc-400">
            Expired Points
          </div>
          <div className="text-xl font-bold font-mono text-zinc-400 mt-0.5">
            {totalExpired.toLocaleString()}
          </div>
          <div className="text-[10px] text-zinc-500 mt-0.5">
            {expirySummary.expiringSoonPoints > 0
              ? `${expirySummary.expiringSoonPoints.toLocaleString()} expiring soon`
              : 'No pending expiry'}
          </div>
        </div>
      </div>

      {/* Membership Level Progress & Benefits */}
      <div className="p-4 rounded-xl bg-zinc-950/70 border border-zinc-800 space-y-2.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-xs">
          <div className="flex items-center gap-2">
            <span className="font-bold text-zinc-200">Membership Tier: {currentLevel.name}</span>
            <span className="text-[10px] text-zinc-500">
              ({currentLevel.minPoints.toLocaleString()}+ lifetime pts)
            </span>
          </div>
          <div className="text-[11px] text-zinc-400">
            {nextLevel ? (
              <>
                <strong className="text-amber-400">{pointsNeeded.toLocaleString()} pts</strong> to
                reach <strong className="text-zinc-200">{nextLevel.name}</strong>
              </>
            ) : (
              <span className="text-emerald-400 font-semibold">Highest Configured Level Reached</span>
            )}
          </div>
        </div>
        <div className="w-full h-2 rounded-full bg-zinc-900 overflow-hidden border border-zinc-800">
          <div
            className="h-full rounded-full transition-all duration-500"
            style={{
              width: `${tierProgressPct}%`,
              backgroundColor: currentLevel.color || '#f59e0b',
            }}
          />
        </div>
        {currentLevel.benefits && currentLevel.benefits.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {currentLevel.benefits.map((b, idx) => (
              <span
                key={idx}
                className="px-2 py-0.5 rounded-md bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300"
              >
                {b}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Automatic Stay Points Eligibility Banner (Read-Only against verified financial records) */}
      {policy.enabled && policy.enableAutoEarning && isManager && eligibleStays.length > 0 && (
        <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 size={18} className="text-emerald-400 shrink-0 mt-0.5" />
            <div className="text-xs">
              <div className="font-bold text-emerald-300">
                {eligibleStays.length} Completed &amp; Settled Stay(s) Eligible for Automatic Points
              </div>
              <p className="text-emerald-200/80 mt-0.5">
                Ready to award{' '}
                <strong>
                  {eligibleStays
                    .reduce((acc, s) => acc + s.evaluation.pointsToAward, 0)
                    .toLocaleString()}{' '}
                  pts
                </strong>{' '}
                from verified settled stays (No-Show, Cancelled, and unpaid stays are automatically
                excluded).
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleAwardEligibleStays}
            disabled={isSyncingStays}
            className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold flex items-center gap-1.5 shrink-0 disabled:opacity-50"
          >
            <RefreshCw size={13} className={cn(isSyncingStays && 'animate-spin')} />
            <span>{isSyncingStays ? 'Awarding...' : 'Award Eligible Stays'}</span>
          </button>
        </div>
      )}

      {/* Expiry Action Alerts */}
      {policy.enabled &&
        isManager &&
        (expirySummary.expiredPointsUnprocessed > 0 || expirySummary.expiringSoonPoints > 0) && (
          <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-start gap-2.5 text-xs">
              <Clock size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {expirySummary.expiredPointsUnprocessed > 0 && (
                  <p className="text-amber-200">
                    <strong>{expirySummary.expiredPointsUnprocessed.toLocaleString()} pts</strong>{' '}
                    have passed their expiry date and are ready to be expired.
                  </p>
                )}
                {expirySummary.expiringSoonPoints > 0 && expirySummary.earliestExpiringDate && (
                  <p className="text-amber-200/80">
                    <strong>{expirySummary.expiringSoonPoints.toLocaleString()} pts</strong> are
                    approaching expiry on{' '}
                    {safeFormatDate(expirySummary.earliestExpiringDate, 'MMM d, yyyy')}.
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 shrink-0">
              {expirySummary.expiredPointsUnprocessed > 0 && (
                <button
                  type="button"
                  onClick={handleProcessExpired}
                  disabled={isProcessingExpiry}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold disabled:opacity-50"
                >
                  {isProcessingExpiry ? 'Processing...' : 'Expire Due Points'}
                </button>
              )}
              {expirySummary.expiringSoonPoints > 0 && account && (
                <button
                  type="button"
                  onClick={handleSendExpiryReminder}
                  disabled={isSendingReminder}
                  className="px-3 py-1.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-amber-500/40 text-amber-300 text-xs font-bold flex items-center gap-1.5 disabled:opacity-50"
                >
                  <Bell size={12} />
                  <span>{isSendingReminder ? 'Sending...' : 'Send Expiry Email'}</span>
                </button>
              )}
            </div>
          </div>
        )}

      {/* Inline Redemption Drawer */}
      {showRedeemBox && policy.enabled && policy.enableRedemption && isManager && (
        <form
          onSubmit={handleRedeemSubmit}
          className="p-4 rounded-xl bg-purple-950/20 border border-purple-500/30 space-y-3"
        >
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-purple-200 flex items-center gap-1.5">
              <Gift size={14} className="text-purple-400" />
              Redeem Guest Loyalty Points
            </h4>
            <span className="text-[10px] text-purple-300/80">
              Min: {policy.minimumRedemptionPoints.toLocaleString()} pts • Max:{' '}
              {policy.maximumRedemptionPointsPerBooking > 0
                ? `${policy.maximumRedemptionPointsPerBooking.toLocaleString()} pts`
                : 'No cap'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                Points to Redeem *
              </label>
              <input
                type="number"
                min={1}
                step={1}
                required
                value={redeemPointsInput}
                onChange={(e) => setRedeemPointsInput(e.target.value)}
                placeholder={`Up to ${availablePoints}`}
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono font-bold text-zinc-100 focus:outline-none focus:border-purple-500/60"
              />
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                Reference Booking (Optional)
              </label>
              <select
                value={redeemReservationId}
                onChange={(e) => setRedeemReservationId(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-purple-500/60"
              >
                <option value="">General Reward Redemption</option>
                {guestReservations.map((r) => (
                  <option key={r.id} value={r.id}>
                    Room {r.roomNumber || 'N/A'} ({safeFormatDate(r.checkIn, 'MMM d, yyyy')})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
                Redemption Value
              </label>
              <div className="px-3 py-2 rounded-lg bg-zinc-950/60 border border-zinc-800 text-xs font-mono font-bold text-emerald-400">
                {formatCurrency(
                  calculateRedemptionMonetaryValue(Math.max(0, redeemPtsNumber || 0), policy),
                  currency,
                  exchangeRate
                )}
              </div>
            </div>
          </div>

          <div>
            <label className="text-[10px] font-bold uppercase text-zinc-400 block mb-1">
              Redemption Description / Voucher Note *
            </label>
            <input
              type="text"
              required
              value={redeemReason}
              onChange={(e) => setRedeemReason(e.target.value)}
              placeholder="e.g. Complimentary dining voucher or stay reward redemption"
              className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-purple-500/60"
            />
          </div>

          {redeemPointsInput !== '' && !redeemValidation.valid && (
            <div className="text-xs text-rose-300 flex items-center gap-1.5">
              <AlertTriangle size={13} />
              <span>{redeemValidation.error}</span>
            </div>
          )}

          <div className="p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800 text-[10px] text-zinc-400 flex items-start gap-2">
            <Info size={13} className="text-zinc-400 shrink-0 mt-0.5" />
            <span>
              Redemption is recorded atomically in the isolated loyalty ledger and emailed to the
              guest without modifying room pricing, taxes, or folio accounting formulas.
            </span>
          </div>

          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowRedeemBox(false)}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-300 text-xs font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isRedeeming || !redeemValidation.valid || !redeemReason.trim()}
              className="px-4 py-1.5 rounded-lg bg-purple-500 hover:bg-purple-400 disabled:opacity-40 text-white text-xs font-bold"
            >
              {isRedeeming ? 'Redeeming...' : 'Confirm Redemption'}
            </button>
          </div>
        </form>
      )}

      {/* Immutable Per-Guest Loyalty Transaction History */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
            <History size={13} className="text-amber-400" />
            Guest Loyalty Transaction History (Immutable)
          </h4>
          <span className="text-[10px] text-zinc-500 flex items-center gap-1">
            <ShieldCheck size={12} className="text-emerald-500" />
            {guestTransactions.length} record{guestTransactions.length === 1 ? '' : 's'}
          </span>
        </div>

        {guestTransactions.length === 0 ? (
          <div className="py-8 text-center text-zinc-500 bg-zinc-950/40 rounded-xl border border-dashed border-zinc-800 text-xs">
            No loyalty point transactions recorded for this guest yet.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="py-2.5 px-3">Date</th>
                  <th className="py-2.5 px-3">Type</th>
                  <th className="py-2.5 px-3 text-right">Points</th>
                  <th className="py-2.5 px-3 text-right">Balance</th>
                  <th className="py-2.5 px-3">Reason / Reference</th>
                  <th className="py-2.5 px-3">Authorized By</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/60">
                {guestTransactions.slice(0, 15).map((tx) => {
                  const badge = TX_BADGE_MAP[tx.transactionType] || {
                    label: tx.transactionType,
                    className: 'bg-zinc-800 text-zinc-300 border-zinc-700',
                  };
                  return (
                    <tr key={tx.id} className="hover:bg-zinc-900/50">
                      <td className="py-2.5 px-3 whitespace-nowrap text-zinc-400 text-[11px]">
                        <div>{safeFormatDate(tx.timestamp || tx.createdAt, 'MMM d, yyyy')}</div>
                        <div className="text-[9px] text-zinc-500">
                          {safeFormatDate(tx.timestamp || tx.createdAt, 'h:mm a')}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={cn(
                            'px-2 py-0.5 rounded text-[9px] font-bold uppercase border',
                            badge.className
                          )}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td
                        className={cn(
                          'py-2.5 px-3 text-right font-mono font-bold whitespace-nowrap',
                          tx.pointsDelta > 0
                            ? 'text-emerald-400'
                            : tx.pointsDelta < 0
                              ? 'text-rose-400'
                              : 'text-zinc-400'
                        )}
                      >
                        {tx.pointsDelta > 0
                          ? `+${tx.pointsDelta.toLocaleString()}`
                          : tx.pointsDelta.toLocaleString()}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-zinc-200 whitespace-nowrap">
                        {tx.updatedBalance.toLocaleString()} pts
                      </td>
                      <td className="py-2.5 px-3 text-zinc-300 max-w-xs">
                        <div className="truncate" title={tx.reason}>
                          {tx.reason}
                        </div>
                        {tx.monetaryValue ? (
                          <div className="text-[10px] text-purple-300">
                            Value: {formatCurrency(tx.monetaryValue, currency, exchangeRate)}
                          </div>
                        ) : null}
                        {tx.expiresAt ? (
                          <div className="text-[10px] text-zinc-500">
                            Expires: {safeFormatDate(tx.expiresAt, 'MMM d, yyyy')}
                          </div>
                        ) : null}
                      </td>
                      <td className="py-2.5 px-3 text-zinc-400 text-[11px] whitespace-nowrap">
                        {tx.adminName || 'System'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
