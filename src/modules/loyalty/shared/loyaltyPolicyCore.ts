/**
 * Node-22 Strip-Only Compatible Pure Loyalty Policy & Validation Core.
 *
 * CRITICAL: This module MUST contain ZERO runtime imports of browser/Vite modules or TypeScript `enum`s
 * (only `import type` is allowed) so `node server.ts` boots cleanly in production without `tsx`.
 */

import type {
  Hotel,
  LedgerEntry,
  LoyaltyCanonicalTransactionType,
  LoyaltyMembershipLevel,
  LoyaltySettings,
  LoyaltyTransaction,
  LoyaltyTransactionType,
  Reservation,
} from '../../../types.ts';

export const HARD_MIN_REDEMPTION_POINTS = 100;
export const HARD_MAX_REDEMPTION_POINTS_PER_BOOKING = 5000;

export const SERVER_DEFAULT_LOYALTY_LEVELS: LoyaltyMembershipLevel[] = [
  {
    id: 'level-standard',
    name: 'Standard',
    minPoints: 0,
    color: '#71717a',
    benefits: ['Earn points on eligible settled stays', 'Member-only seasonal updates'],
  },
  {
    id: 'level-silver',
    name: 'Silver',
    minPoints: 500,
    color: '#a1a1aa',
    benefits: ['Priority check-in assistance', 'Complimentary welcome drink'],
  },
  {
    id: 'level-gold',
    name: 'Gold',
    minPoints: 2000,
    color: '#f59e0b',
    benefits: ['Late check-out subject to availability', 'Room upgrade priority', 'Welcome amenity'],
  },
  {
    id: 'level-platinum',
    name: 'Platinum',
    minPoints: 5000,
    color: '#38bdf8',
    benefits: ['Guaranteed priority upgrade request', 'Dedicated concierge support', 'Complimentary breakfast perk'],
  },
];

export const SERVER_DEFAULT_LOYALTY_SETTINGS: LoyaltySettings = {
  enabled: false,
  allowManualAllocation: false,
  enableAutoEarning: false,
  enableRedemption: false,
  earningRateAmount: 1000,
  earningRatePoints: 1,
  redemptionPointValue: 10,
  minimumRedemptionPoints: HARD_MIN_REDEMPTION_POINTS,
  maximumRedemptionPointsPerBooking: HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  pointsExpiryEnabled: false,
  pointsExpiryDays: 365,
  expiryReminderDays: 30,
  notifyGuestsByEmail: true,
  membershipLevels: SERVER_DEFAULT_LOYALTY_LEVELS,
};

export function mapToCanonicalLoyaltyTransactionType(
  txType: LoyaltyTransactionType,
  pointsDelta?: number
): LoyaltyCanonicalTransactionType {
  switch (txType) {
    case 'earn_auto':
      return 'EARNING';
    case 'redemption':
      return 'REDEMPTION';
    case 'manual_award':
      return 'MANUAL_CREDIT';
    case 'manual_deduct':
      return 'MANUAL_DEBIT';
    case 'expiry':
      return 'EXPIRY';
    case 'reversal':
      return 'REVERSAL';
    case 'account_activation':
      return 'ACCOUNT_ACTIVATION';
    case 'tier_change':
      return 'TIER_CHANGE';
    default:
      return (pointsDelta ?? 0) >= 0 ? 'ADJUSTMENT' : 'MANUAL_DEBIT';
  }
}

export function getLoyaltyPolicy(hotel?: Hotel | null): LoyaltySettings {
  const defaults = SERVER_DEFAULT_LOYALTY_SETTINGS;
  const raw = hotel?.settings?.loyalty;
  if (!raw) {
    return {
      ...defaults,
      minimumRedemptionPoints: HARD_MIN_REDEMPTION_POINTS,
      maximumRedemptionPointsPerBooking: HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
      membershipLevels: [...SERVER_DEFAULT_LOYALTY_LEVELS],
    };
  }
  const levels =
    Array.isArray(raw.membershipLevels) && raw.membershipLevels.length > 0
      ? raw.membershipLevels
      : [...SERVER_DEFAULT_LOYALTY_LEVELS];

  const rawMin = Math.floor(Number(raw.minimumRedemptionPoints) || 0);
  const effectiveMin = Math.min(
    HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
    Math.max(HARD_MIN_REDEMPTION_POINTS, rawMin || HARD_MIN_REDEMPTION_POINTS)
  );

  const rawMax = Math.floor(Number(raw.maximumRedemptionPointsPerBooking) || 0);
  const clampedMax =
    rawMax > 0
      ? Math.min(HARD_MAX_REDEMPTION_POINTS_PER_BOOKING, rawMax)
      : HARD_MAX_REDEMPTION_POINTS_PER_BOOKING;
  const effectiveMax = Math.max(effectiveMin, clampedMax);

  return {
    ...defaults,
    ...raw,
    earningRateAmount:
      Number(raw.earningRateAmount) > 0 ? Number(raw.earningRateAmount) : defaults.earningRateAmount,
    earningRatePoints:
      Number(raw.earningRatePoints) >= 0 ? Number(raw.earningRatePoints) : defaults.earningRatePoints,
    redemptionPointValue:
      Number(raw.redemptionPointValue) >= 0 ? Number(raw.redemptionPointValue) : defaults.redemptionPointValue,
    minimumRedemptionPoints: effectiveMin,
    maximumRedemptionPointsPerBooking: effectiveMax,
    pointsExpiryDays: Math.max(1, Math.floor(Number(raw.pointsExpiryDays) || defaults.pointsExpiryDays)),
    expiryReminderDays: Math.max(1, Math.floor(Number(raw.expiryReminderDays) || defaults.expiryReminderDays)),
    membershipLevels: levels,
  };
}

export function resolveMembershipLevel(
  lifetimePointsEarned: number,
  levels: LoyaltyMembershipLevel[] = SERVER_DEFAULT_LOYALTY_LEVELS
): LoyaltyMembershipLevel {
  const safeLevels =
    Array.isArray(levels) && levels.length > 0 ? levels : SERVER_DEFAULT_LOYALTY_LEVELS;
  const sortedAsc = [...safeLevels].sort((a, b) => (a.minPoints || 0) - (b.minPoints || 0));
  const safePoints = Math.max(0, Number(lifetimePointsEarned) || 0);

  let matched = sortedAsc[0];
  for (const level of sortedAsc) {
    if (safePoints >= (Number(level.minPoints) || 0)) {
      matched = level;
    }
  }
  return matched;
}

export function getNextMembershipLevel(
  lifetimePointsEarned: number,
  levels: LoyaltyMembershipLevel[] = SERVER_DEFAULT_LOYALTY_LEVELS
): { nextLevel: LoyaltyMembershipLevel | null; pointsNeeded: number } {
  const safeLevels =
    Array.isArray(levels) && levels.length > 0 ? levels : SERVER_DEFAULT_LOYALTY_LEVELS;
  const sortedAsc = [...safeLevels].sort((a, b) => (a.minPoints || 0) - (b.minPoints || 0));
  const safePoints = Math.max(0, Number(lifetimePointsEarned) || 0);
  const nextLevel = sortedAsc.find((l) => (Number(l.minPoints) || 0) > safePoints) || null;
  return {
    nextLevel,
    pointsNeeded: nextLevel ? Math.max(0, (Number(nextLevel.minPoints) || 0) - safePoints) : 0,
  };
}

export function calculateEarnedPointsForAmount(
  eligibleSpend: number,
  policy: LoyaltySettings
): number {
  if (!policy.enabled || !policy.enableAutoEarning) return 0;
  if (!Number.isFinite(eligibleSpend) || eligibleSpend <= 0) return 0;
  if (!Number.isFinite(policy.earningRateAmount) || policy.earningRateAmount <= 0) return 0;
  if (!Number.isFinite(policy.earningRatePoints) || policy.earningRatePoints <= 0) return 0;
  return Math.floor((eligibleSpend / policy.earningRateAmount) * policy.earningRatePoints);
}

export function calculateRedemptionMonetaryValue(
  points: number,
  policy: LoyaltySettings
): number {
  const safePts = Math.max(0, Math.floor(Number(points) || 0));
  const valPerPt = Math.max(0, Number(policy.redemptionPointValue) || 0);
  return Number((safePts * valPerPt).toFixed(2));
}

export interface ManualPointsValidationResult {
  valid: boolean;
  error?: string;
}

export function validateManualPointsAdjustment(
  params: {
    action: 'manual_award' | 'manual_deduct' | 'reversal';
    points: number;
    reason: string;
    expiresAt?: string | null;
    reversalDirection?: 'credit' | 'debit';
  },
  policy: LoyaltySettings,
  currentAvailablePoints: number
): ManualPointsValidationResult {
  if (!policy.enabled) {
    return { valid: false, error: 'Loyalty programme is currently disabled in Admin Controls.' };
  }
  if (!policy.allowManualAllocation) {
    return { valid: false, error: 'Manual points allocation is disabled in Admin Controls.' };
  }
  const pts = Number(params.points);
  if (!Number.isFinite(pts) || !Number.isInteger(pts) || pts <= 0) {
    return { valid: false, error: 'Points must be a positive whole number.' };
  }
  if (!params.reason || !params.reason.trim()) {
    return { valid: false, error: 'A clear reason is required for every loyalty adjustment.' };
  }
  const isDebit =
    params.action === 'manual_deduct' ||
    (params.action === 'reversal' && params.reversalDirection === 'debit');
  if (isDebit && pts > Math.max(0, currentAvailablePoints)) {
    return {
      valid: false,
      error: `Deduction (${pts.toLocaleString()} pts) exceeds available balance (${Math.max(0, currentAvailablePoints).toLocaleString()} pts).`,
    };
  }
  if (params.expiresAt) {
    const parsed = new Date(params.expiresAt);
    if (isNaN(parsed.getTime())) {
      return { valid: false, error: 'Invalid expiry date provided.' };
    }
  }
  return { valid: true };
}

export interface ExpiredPointLotDetail {
  txId: string;
  expiredPoints: number;
  expiresAt: string;
}

export interface LoyaltyExpirySummary {
  expiredPointsUnprocessed: number;
  expiringSoonPoints: number;
  earliestExpiringDate: string | null;
  expiredLots: ExpiredPointLotDetail[];
  lotSignature: string;
}

function deterministicHexHash(input: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x811c9dc5 ^ 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= (c + i) & 0xff;
    h2 = Math.imul(h2, 0x01000193);
  }
  return ((h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')).slice(0, 16);
}

export function buildDeterministicExpiryKey(
  guestId: string,
  expiredLots: ExpiredPointLotDetail[]
): string {
  const safeGuest = guestId.replace(/[^a-zA-Z0-9_\-:.]/g, '_').slice(0, 64);
  const canonical = [...expiredLots]
    .sort((a, b) => a.txId.localeCompare(b.txId))
    .map((l) => `${l.txId}:${l.expiredPoints}:${l.expiresAt}`)
    .join('|');
  const hash = deterministicHexHash(canonical || 'none');
  return `expiry_${safeGuest}_${hash}`.slice(0, 150);
}

export function evaluateLoyaltyPointsExpiry(
  transactions: LoyaltyTransaction[],
  reminderDays: number = 30,
  now: Date = new Date()
): LoyaltyExpirySummary {
  const sorted = [...transactions].sort((a, b) => {
    const diff =
      new Date(a.timestamp || a.createdAt).getTime() -
      new Date(b.timestamp || b.createdAt).getTime();
    if (diff !== 0) return diff;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });

  type CreditLot = {
    txId: string;
    remaining: number;
    earnedAtMs: number;
    expiresAt: Date | null;
    expiresAtIso: string | null;
  };

  const lots: CreditLot[] = [];

  for (const tx of sorted) {
    const txTimeMs = new Date(tx.timestamp || tx.createdAt).getTime();
    const safeTxTimeMs = Number.isFinite(txTimeMs) ? txTimeMs : 0;

    if (tx.pointsDelta > 0) {
      const expDate = tx.expiresAt ? new Date(tx.expiresAt) : null;
      const validExp = expDate && !isNaN(expDate.getTime()) ? expDate : null;
      lots.push({
        txId: tx.id || tx.idempotencyKey || `lot_${lots.length}`,
        remaining: Math.floor(tx.pointsDelta),
        earnedAtMs: safeTxTimeMs,
        expiresAt: validExp,
        expiresAtIso: validExp ? validExp.toISOString() : null,
      });
    } else if (tx.pointsDelta < 0) {
      let toConsume = Math.floor(Math.abs(tx.pointsDelta));

      if (tx.transactionType === 'expiry') {
        const explicitSet = new Set(Array.isArray(tx.expiredLotIds) ? tx.expiredLotIds : []);
        const candidateLots = lots
          .filter((l) => l.remaining > 0 && l.expiresAt !== null)
          .sort((a, b) => {
            const aExp = explicitSet.has(a.txId) ? 0 : 1;
            const bExp = explicitSet.has(b.txId) ? 0 : 1;
            if (aExp !== bExp) return aExp - bExp;
            const expDiff = (a.expiresAt?.getTime() ?? Infinity) - (b.expiresAt?.getTime() ?? Infinity);
            if (expDiff !== 0) return expDiff;
            return a.earnedAtMs - b.earnedAtMs;
          });

        for (const lot of candidateLots) {
          if (toConsume <= 0) break;
          const lotExpMs = lot.expiresAt!.getTime();
          if (!explicitSet.has(lot.txId) && safeTxTimeMs > 0 && lotExpMs > safeTxTimeMs) {
            continue;
          }
          const used = Math.min(lot.remaining, toConsume);
          lot.remaining -= used;
          toConsume -= used;
        }
      } else {
        const candidateLots = lots
          .filter((l) => l.remaining > 0)
          .sort((a, b) => {
            const aAlreadyExpired = a.expiresAt !== null && safeTxTimeMs > 0 && a.expiresAt.getTime() <= safeTxTimeMs;
            const bAlreadyExpired = b.expiresAt !== null && safeTxTimeMs > 0 && b.expiresAt.getTime() <= safeTxTimeMs;
            if (aAlreadyExpired !== bAlreadyExpired) return aAlreadyExpired ? 1 : -1;
            const aExp = a.expiresAt ? a.expiresAt.getTime() : Number.MAX_SAFE_INTEGER;
            const bExp = b.expiresAt ? b.expiresAt.getTime() : Number.MAX_SAFE_INTEGER;
            if (aExp !== bExp) return aExp - bExp;
            return a.earnedAtMs - b.earnedAtMs;
          });

        for (const lot of candidateLots) {
          if (toConsume <= 0) break;
          if (
            tx.transactionType === 'redemption' &&
            lot.expiresAt !== null &&
            safeTxTimeMs > 0 &&
            lot.expiresAt.getTime() <= safeTxTimeMs
          ) {
            continue;
          }
          const used = Math.min(lot.remaining, toConsume);
          lot.remaining -= used;
          toConsume -= used;
        }
      }
    }
  }

  const nowMs = now.getTime();
  const reminderCutoffMs = nowMs + Math.max(1, reminderDays) * 24 * 60 * 60 * 1000;

  let expiredPointsUnprocessed = 0;
  let expiringSoonPoints = 0;
  let earliestExpiringDate: string | null = null;
  const expiredLots: ExpiredPointLotDetail[] = [];

  for (const lot of lots) {
    if (lot.remaining <= 0 || !lot.expiresAt || !lot.expiresAtIso) continue;
    const expMs = lot.expiresAt.getTime();
    if (expMs <= nowMs) {
      const rem = Math.floor(lot.remaining);
      expiredPointsUnprocessed += rem;
      expiredLots.push({
        txId: lot.txId,
        expiredPoints: rem,
        expiresAt: lot.expiresAtIso,
      });
    } else if (expMs <= reminderCutoffMs) {
      expiringSoonPoints += Math.floor(lot.remaining);
      if (!earliestExpiringDate || expMs < new Date(earliestExpiringDate).getTime()) {
        earliestExpiringDate = lot.expiresAtIso;
      }
    }
  }

  const lotSignature = expiredLots
    .map((l) => `${l.txId}:${l.expiredPoints}`)
    .sort()
    .join('|');

  return {
    expiredPointsUnprocessed: Math.floor(expiredPointsUnprocessed),
    expiringSoonPoints: Math.floor(expiringSoonPoints),
    earliestExpiringDate,
    expiredLots,
    lotSignature,
  };
}

/**
 * Node-22 server-safe read-only payable balance evaluator for a reservation + its ledger entries.
 * Never mutates any financial records; mirrors existing PMS ledger netAmountDue semantics.
 */
export function computeReadOnlyBookingPayableBalance(
  reservation: Reservation,
  ledgerEntries?: LedgerEntry[]
): number {
  const status = String(reservation?.status || '').toLowerCase();
  if (status === 'cancelled' || status === 'no_show') return 0;

  const resLedger = Array.isArray(ledgerEntries)
    ? ledgerEntries.filter((e) => e.reservationId === reservation.id)
    : [];

  if (resLedger.length > 0) {
    let debits = 0;
    let credits = 0;
    let refunds = 0;
    for (const e of resLedger) {
      const amt = Number(e.amount) || 0;
      const cat = String(e.category || '').toLowerCase();
      if (e.type === 'debit') {
        if (cat === 'refund') refunds += amt;
        else debits += amt;
      } else if (e.type === 'credit') {
        credits += amt;
      }
    }
    const baseTotal = Math.max(debits, Number(reservation.totalAmount) || 0);
    const hasDiscountInLedger = resLedger.some(
      (e) =>
        e.type === 'credit' &&
        (String(e.category || '').toLowerCase() === 'discount' ||
          String(e.description || '').toLowerCase().includes('discount'))
    );
    const unpostedDiscount = !hasDiscountInLedger
      ? Math.max(0, Number((reservation as any).totalDiscount || (reservation as any).discountAmount || 0))
      : 0;
    const netCredits = Math.max(0, credits + unpostedDiscount - refunds);
    return Number(Math.max(0, baseTotal - netCredits).toFixed(2));
  }

  if (typeof (reservation as any).ledgerBalance === 'number' && Number.isFinite((reservation as any).ledgerBalance)) {
    return Number(Math.max(0, (reservation as any).ledgerBalance).toFixed(2));
  }
  if (String(reservation.paymentStatus || '').toLowerCase() === 'paid') {
    return 0;
  }
  const total = Math.max(0, Number(reservation.totalAmount) || 0);
  const paid = Math.max(0, Number(reservation.paidAmount) || 0);
  const disc = Math.max(0, Number((reservation as any).totalDiscount || (reservation as any).discountAmount || 0));
  return Number(Math.max(0, total - paid - disc).toFixed(2));
}

export interface RedemptionValidationContext {
  accountIsActive?: boolean;
  reservationId?: string;
  reservation?: Reservation | null;
  hotel?: Hotel | null;
  ledgerEntries?: LedgerEntry[];
  existingTransactions?: LoyaltyTransaction[];
  eligiblePayableAmount?: number;
  idempotencyKey?: string;
  now?: Date;
}

export interface RedemptionValidationResult {
  valid: boolean;
  monetaryValue: number;
  effectiveAvailablePoints?: number;
  unprocessedExpiredPoints?: number;
  alreadyRedeemedForBooking?: number;
  remainingBookingRedemptionCap?: number;
  eligiblePayableAmount?: number;
  alreadyProcessed?: boolean;
  error?: string;
}

export function validatePointsRedemptionCore(
  pointsToRedeem: number,
  policy: LoyaltySettings,
  currentAvailablePoints: number,
  context?: RedemptionValidationContext,
  resolvePayableAmount?: (ctx: RedemptionValidationContext) => number | undefined
): RedemptionValidationResult {
  if (!policy.enabled) {
    return { valid: false, monetaryValue: 0, error: 'Loyalty programme is currently disabled in Admin Controls.' };
  }
  if (!policy.enableRedemption) {
    return { valid: false, monetaryValue: 0, error: 'Points redemption is disabled in Admin Controls.' };
  }
  if (context?.accountIsActive === false) {
    return { valid: false, monetaryValue: 0, error: 'Guest loyalty account is inactive and cannot redeem points.' };
  }

  const pts = Number(pointsToRedeem);
  if (!Number.isFinite(pts) || !Number.isInteger(pts) || pts <= 0) {
    return { valid: false, monetaryValue: 0, error: 'Redemption points must be a positive whole number.' };
  }

  const effectiveMin = Math.min(
    HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
    Math.max(HARD_MIN_REDEMPTION_POINTS, Math.floor(Number(policy.minimumRedemptionPoints) || HARD_MIN_REDEMPTION_POINTS))
  );
  const rawMax = Math.floor(Number(policy.maximumRedemptionPointsPerBooking) || 0);
  const effectiveMax = Math.max(
    effectiveMin,
    rawMax > 0 ? Math.min(HARD_MAX_REDEMPTION_POINTS_PER_BOOKING, rawMax) : HARD_MAX_REDEMPTION_POINTS_PER_BOOKING
  );

  if (context?.idempotencyKey && Array.isArray(context.existingTransactions)) {
    const alreadyDone = context.existingTransactions.some(
      (tx) => tx.idempotencyKey === context.idempotencyKey || tx.id === context.idempotencyKey
    );
    if (alreadyDone) {
      return {
        valid: false,
        monetaryValue: 0,
        alreadyProcessed: true,
        error: 'This redemption request has already been processed.',
      };
    }
  }

  const rawBalance = Math.max(0, Math.floor(Number(currentAvailablePoints) || 0));
  let unprocessedExpiredPoints = 0;
  if (Array.isArray(context?.existingTransactions) && context.existingTransactions.length > 0) {
    const expirySummary = evaluateLoyaltyPointsExpiry(
      context.existingTransactions,
      policy.expiryReminderDays,
      context.now || new Date()
    );
    unprocessedExpiredPoints = expirySummary.expiredPointsUnprocessed;
  }
  const effectiveAvailablePoints = Math.max(0, rawBalance - unprocessedExpiredPoints);

  if (pts < effectiveMin) {
    return {
      valid: false,
      monetaryValue: 0,
      effectiveAvailablePoints,
      unprocessedExpiredPoints,
      error: `Minimum redemption is ${effectiveMin.toLocaleString()} points.`,
    };
  }

  if (pts > effectiveMax) {
    return {
      valid: false,
      monetaryValue: 0,
      effectiveAvailablePoints,
      unprocessedExpiredPoints,
      error: `Maximum redemption allowed per booking is ${effectiveMax.toLocaleString()} points.`,
    };
  }

  if (pts > effectiveAvailablePoints) {
    const expiredNote =
      unprocessedExpiredPoints > 0
        ? ` (${unprocessedExpiredPoints.toLocaleString()} expired pts excluded)`
        : '';
    return {
      valid: false,
      monetaryValue: 0,
      effectiveAvailablePoints,
      unprocessedExpiredPoints,
      error: `Redemption (${pts.toLocaleString()} pts) exceeds redeemable available balance (${effectiveAvailablePoints.toLocaleString()} pts${expiredNote}).`,
    };
  }

  const monetaryValue = calculateRedemptionMonetaryValue(pts, policy);

  const targetReservationId = context?.reservation?.id || context?.reservationId;
  let alreadyRedeemedForBooking = 0;
  let remainingBookingRedemptionCap = effectiveMax;

  if (targetReservationId && Array.isArray(context?.existingTransactions)) {
    alreadyRedeemedForBooking = context.existingTransactions
      .filter((tx) => tx.transactionType === 'redemption' && tx.reservationId === targetReservationId)
      .reduce((sum, tx) => sum + Math.max(0, Math.floor(Number(tx.points) || 0)), 0);
    remainingBookingRedemptionCap = Math.max(0, effectiveMax - alreadyRedeemedForBooking);

    if (alreadyRedeemedForBooking + pts > effectiveMax) {
      return {
        valid: false,
        monetaryValue,
        effectiveAvailablePoints,
        unprocessedExpiredPoints,
        alreadyRedeemedForBooking,
        remainingBookingRedemptionCap,
        error: `Booking redemption limit exceeded: ${alreadyRedeemedForBooking.toLocaleString()} pts already redeemed on this booking (max ${effectiveMax.toLocaleString()} pts per booking; remaining allowance: ${remainingBookingRedemptionCap.toLocaleString()} pts).`,
      };
    }
  }

  if (context?.reservation) {
    const status = String(context.reservation.status || '').toLowerCase();
    if (status === 'cancelled' || status === 'no_show') {
      return {
        valid: false,
        monetaryValue,
        effectiveAvailablePoints,
        unprocessedExpiredPoints,
        alreadyRedeemedForBooking,
        remainingBookingRedemptionCap,
        error: `Cannot redeem loyalty points against a ${status === 'no_show' ? 'No-Show' : 'Cancelled'} booking.`,
      };
    }
  }

  let eligiblePayableAmount: number | undefined = context?.eligiblePayableAmount;
  if (eligiblePayableAmount === undefined && context?.reservation) {
    eligiblePayableAmount = resolvePayableAmount
      ? resolvePayableAmount(context)
      : computeReadOnlyBookingPayableBalance(context.reservation, context.ledgerEntries);
  }

  if (eligiblePayableAmount !== undefined) {
    if (eligiblePayableAmount <= 0.01) {
      return {
        valid: false,
        monetaryValue,
        effectiveAvailablePoints,
        unprocessedExpiredPoints,
        alreadyRedeemedForBooking,
        remainingBookingRedemptionCap,
        eligiblePayableAmount: 0,
        error: 'Cannot redeem points against a booking whose balance is already fully settled.',
      };
    }
    if (monetaryValue > eligiblePayableAmount + 0.01) {
      return {
        valid: false,
        monetaryValue,
        effectiveAvailablePoints,
        unprocessedExpiredPoints,
        alreadyRedeemedForBooking,
        remainingBookingRedemptionCap,
        eligiblePayableAmount,
        error: `Redemption value (${monetaryValue.toLocaleString()}) exceeds the booking's eligible payable balance (${eligiblePayableAmount.toLocaleString()}).`,
      };
    }
  }

  return {
    valid: true,
    monetaryValue,
    effectiveAvailablePoints,
    unprocessedExpiredPoints,
    alreadyRedeemedForBooking,
    remainingBookingRedemptionCap,
    eligiblePayableAmount,
  };
}
