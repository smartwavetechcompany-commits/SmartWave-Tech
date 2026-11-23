import type {
  Hotel,
  LedgerEntry,
  LoyaltySettings,
  LoyaltyTransaction,
  Reservation,
} from '../../../types.ts';
import { calculateReservationAccount } from '../../../utils/financialUtils.ts';
import {
  HARD_MIN_REDEMPTION_POINTS,
  HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  buildDeterministicExpiryKey,
  calculateEarnedPointsForAmount,
  calculateRedemptionMonetaryValue,
  computeReadOnlyBookingPayableBalance,
  evaluateLoyaltyPointsExpiry,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  mapToCanonicalLoyaltyTransactionType,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
  validatePointsRedemptionCore,
  type ExpiredPointLotDetail,
  type LoyaltyExpirySummary,
  type ManualPointsValidationResult,
  type RedemptionValidationContext,
  type RedemptionValidationResult,
} from './loyaltyPolicyCore.ts';

export {
  HARD_MIN_REDEMPTION_POINTS,
  HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  buildDeterministicExpiryKey,
  calculateEarnedPointsForAmount,
  calculateRedemptionMonetaryValue,
  computeReadOnlyBookingPayableBalance,
  evaluateLoyaltyPointsExpiry,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  mapToCanonicalLoyaltyTransactionType,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
  type ExpiredPointLotDetail,
  type LoyaltyExpirySummary,
  type ManualPointsValidationResult,
  type RedemptionValidationContext,
  type RedemptionValidationResult,
};

/**
 * Validates a points redemption against ALL authoritative policy and booking rules,
 * reading live booking payable amounts strictly read-only from calculateReservationAccount.
 */
export function validatePointsRedemption(
  pointsToRedeem: number,
  policy: LoyaltySettings,
  currentAvailablePoints: number,
  context?: RedemptionValidationContext
): RedemptionValidationResult {
  return validatePointsRedemptionCore(pointsToRedeem, policy, currentAvailablePoints, context, (ctx) => {
    if (!ctx.reservation) return undefined;
    const account = calculateReservationAccount(
      ctx.reservation,
      ctx.hotel ?? null,
      ctx.ledgerEntries,
      ctx.now ? { currentTime: ctx.now } : undefined
    );
    return Number(Math.max(0, account.netAmountDue).toFixed(2));
  });
}

export interface StayAutoEarnEvaluation {
  eligible: boolean;
  eligibleSpend: number;
  pointsToAward: number;
  idempotencyKey: string;
  financialTransactionRefs: string[];
  reason: string;
}

/**
 * Evaluates whether a reservation qualifies for automatic loyalty points earning.
 * Strictly read-only against existing verified financial records via calculateReservationAccount.
 * Preserves the existing full-settlement policy without altering any PMS financial logic.
 */
export function evaluateStayEligibilityForAutoEarn(
  res: Reservation,
  hotel: Hotel | null,
  reservationLedgerEntries: LedgerEntry[],
  existingLoyaltyTransactions: LoyaltyTransaction[] = []
): StayAutoEarnEvaluation {
  const idempotencyKey = `auto_earn_${res?.id || 'unknown'}`;
  const policy = getLoyaltyPolicy(hotel);

  if (!policy.enabled) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Loyalty programme is disabled.' };
  }
  if (!policy.enableAutoEarning) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Automatic points earning is disabled.' };
  }
  if (!res?.id) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Missing reservation reference.' };
  }
  if (res.status === 'no_show') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'No-Show reservations are ineligible for automatic points.' };
  }
  if (res.status === 'cancelled') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Cancelled reservations are ineligible for automatic points.' };
  }
  if (res.status !== 'checked_out') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Only completed (checked-out) stays qualify for automatic points.' };
  }

  const alreadyAwarded = existingLoyaltyTransactions.some(
    (tx) =>
      tx.idempotencyKey === idempotencyKey ||
      (tx.transactionType === 'earn_auto' && tx.reservationId === res.id)
  );
  if (alreadyAwarded) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, financialTransactionRefs: [], reason: 'Points already awarded for this stay.' };
  }

  const account = calculateReservationAccount(res, hotel, reservationLedgerEntries);

  if (account.outstandingBalance > 0.01) {
    return {
      eligible: false,
      eligibleSpend: 0,
      pointsToAward: 0,
      idempotencyKey,
      financialTransactionRefs: [],
      reason: 'Reservation has an unpaid or outstanding balance.',
    };
  }

  const netPaymentsReceived = Number(Math.max(0, account.totalPayments - account.totalRefunds).toFixed(2));
  if (netPaymentsReceived <= 0.01) {
    return {
      eligible: false,
      eligibleSpend: 0,
      pointsToAward: 0,
      idempotencyKey,
      financialTransactionRefs: [],
      reason: 'No verified settled payments found for this stay.',
    };
  }

  const eligibleSpend =
    account.totalCharges > 0.01
      ? Number(Math.min(netPaymentsReceived, account.totalCharges).toFixed(2))
      : netPaymentsReceived;

  const pointsToAward = calculateEarnedPointsForAmount(eligibleSpend, policy);
  if (pointsToAward <= 0) {
    return {
      eligible: false,
      eligibleSpend,
      pointsToAward: 0,
      idempotencyKey,
      financialTransactionRefs: [],
      reason: 'Eligible stay spend is below the minimum threshold to earn 1 point.',
    };
  }

  const financialTransactionRefs = (reservationLedgerEntries || [])
    .filter((e) => e.reservationId === res.id && e.type === 'credit' && (e.category || '').toLowerCase() !== 'discount')
    .map((e) => e.id)
    .filter(Boolean)
    .slice(0, 20);

  return {
    eligible: true,
    eligibleSpend,
    pointsToAward,
    idempotencyKey,
    financialTransactionRefs,
    reason: `Completed & settled stay (Room ${res.roomNumber || 'N/A'})`,
  };
}
