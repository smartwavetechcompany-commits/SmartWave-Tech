import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  Guest,
  Hotel,
  LedgerEntry,
  LoyaltyAccount,
  LoyaltyMembershipLevel,
  LoyaltySettings,
  LoyaltyTransaction,
  LoyaltyTransactionType,
  Reservation,
  UserProfile,
} from '../types';
import { DEFAULT_LOYALTY_LEVELS, DEFAULT_SETTINGS } from '../constants';
import { calculateReservationAccount } from '../utils/financialUtils';
import { hasPermission } from '../utils/permissions';
import { notifyPlatformEvent } from './transactionalEmailClient';

// ============================================================================
// PERMISSION & POLICY HELPERS (PURE)
// ============================================================================

/**
 * Checks whether a user is authorized to manage loyalty settings or manually adjust/redeem points.
 * Strictly honors existing PMS RBAC without automatically elevating existing non-admin roles.
 */
export function canManageLoyalty(
  profile: UserProfile | null | undefined,
  customRoles: any[] = []
): boolean {
  if (!profile) return false;
  if (profile.status === 'suspended' || profile.status === 'inactive') return false;
  if (profile.role === 'superAdmin' || profile.role === 'hotelAdmin' || (profile as any).role === 'admin') {
    return true;
  }
  return hasPermission(profile, 'manage_loyalty', customRoles);
}

/**
 * Checks whether a user is authorized to view guest loyalty accounts and history.
 */
export function canViewLoyalty(
  profile: UserProfile | null | undefined,
  customRoles: any[] = []
): boolean {
  if (!profile) return false;
  if (canManageLoyalty(profile, customRoles)) return true;
  if (profile.status === 'suspended' || profile.status === 'inactive') return false;
  return (
    hasPermission(profile, 'view_loyalty', customRoles) ||
    hasPermission(profile, 'view_guests', customRoles)
  );
}

/**
 * Safely resolves the hotel's loyalty policy merged with safe defaults (disabled by default).
 */
export function getLoyaltyPolicy(hotel?: Hotel | null): LoyaltySettings {
  const defaults = DEFAULT_SETTINGS.loyalty!;
  const raw = hotel?.settings?.loyalty;
  if (!raw) {
    return {
      ...defaults,
      membershipLevels: [...DEFAULT_LOYALTY_LEVELS],
    };
  }
  const levels =
    Array.isArray(raw.membershipLevels) && raw.membershipLevels.length > 0
      ? raw.membershipLevels
      : [...DEFAULT_LOYALTY_LEVELS];
  return {
    ...defaults,
    ...raw,
    earningRateAmount: Number(raw.earningRateAmount) > 0 ? Number(raw.earningRateAmount) : defaults.earningRateAmount,
    earningRatePoints: Number(raw.earningRatePoints) >= 0 ? Number(raw.earningRatePoints) : defaults.earningRatePoints,
    redemptionPointValue: Number(raw.redemptionPointValue) >= 0 ? Number(raw.redemptionPointValue) : defaults.redemptionPointValue,
    minimumRedemptionPoints: Math.max(0, Math.floor(Number(raw.minimumRedemptionPoints) || 0)),
    maximumRedemptionPointsPerBooking: Math.max(0, Math.floor(Number(raw.maximumRedemptionPointsPerBooking) || 0)),
    pointsExpiryDays: Math.max(1, Math.floor(Number(raw.pointsExpiryDays) || defaults.pointsExpiryDays)),
    expiryReminderDays: Math.max(1, Math.floor(Number(raw.expiryReminderDays) || defaults.expiryReminderDays)),
    membershipLevels: levels,
  };
}

/**
 * Dynamically resolves a guest's membership level strictly from the administrator's
 * configured membership levels (never hardcoded).
 */
export function resolveMembershipLevel(
  lifetimePointsEarned: number,
  levels: LoyaltyMembershipLevel[] = DEFAULT_LOYALTY_LEVELS
): LoyaltyMembershipLevel {
  const safeLevels =
    Array.isArray(levels) && levels.length > 0 ? levels : DEFAULT_LOYALTY_LEVELS;
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

/**
 * Returns the next higher configured membership level and remaining points required, if any.
 */
export function getNextMembershipLevel(
  lifetimePointsEarned: number,
  levels: LoyaltyMembershipLevel[] = DEFAULT_LOYALTY_LEVELS
): { nextLevel: LoyaltyMembershipLevel | null; pointsNeeded: number } {
  const safeLevels =
    Array.isArray(levels) && levels.length > 0 ? levels : DEFAULT_LOYALTY_LEVELS;
  const sortedAsc = [...safeLevels].sort((a, b) => (a.minPoints || 0) - (b.minPoints || 0));
  const safePoints = Math.max(0, Number(lifetimePointsEarned) || 0);
  const nextLevel = sortedAsc.find((l) => (Number(l.minPoints) || 0) > safePoints) || null;
  return {
    nextLevel,
    pointsNeeded: nextLevel ? Math.max(0, (Number(nextLevel.minPoints) || 0) - safePoints) : 0,
  };
}

/**
 * Computes points earned for an eligible monetary spend using the configured Admin Control Policy rate.
 */
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

/**
 * Computes monetary value of a given number of loyalty points using the configured redemption value.
 */
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

/**
 * Validates a manual award or deduction against the active Admin Control Policy and current balance.
 */
export function validateManualPointsAdjustment(
  params: {
    action: 'manual_award' | 'manual_deduct' | 'reversal';
    points: number;
    reason: string;
    expiresAt?: string | null;
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
  if (params.action === 'manual_deduct' && pts > Math.max(0, currentAvailablePoints)) {
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

export interface RedemptionValidationResult {
  valid: boolean;
  monetaryValue: number;
  error?: string;
}

/**
 * Validates a points redemption against Admin Control Policy rules and current available points.
 */
export function validatePointsRedemption(
  pointsToRedeem: number,
  policy: LoyaltySettings,
  currentAvailablePoints: number
): RedemptionValidationResult {
  if (!policy.enabled) {
    return { valid: false, monetaryValue: 0, error: 'Loyalty programme is currently disabled in Admin Controls.' };
  }
  if (!policy.enableRedemption) {
    return { valid: false, monetaryValue: 0, error: 'Points redemption is disabled in Admin Controls.' };
  }
  const pts = Number(pointsToRedeem);
  if (!Number.isFinite(pts) || !Number.isInteger(pts) || pts <= 0) {
    return { valid: false, monetaryValue: 0, error: 'Redemption points must be a positive whole number.' };
  }
  const safeBalance = Math.max(0, Math.floor(Number(currentAvailablePoints) || 0));
  if (pts > safeBalance) {
    return {
      valid: false,
      monetaryValue: 0,
      error: `Redemption (${pts.toLocaleString()} pts) exceeds available points balance (${safeBalance.toLocaleString()} pts).`,
    };
  }
  if (policy.minimumRedemptionPoints > 0 && pts < policy.minimumRedemptionPoints) {
    return {
      valid: false,
      monetaryValue: 0,
      error: `Minimum redemption is ${policy.minimumRedemptionPoints.toLocaleString()} points.`,
    };
  }
  if (policy.maximumRedemptionPointsPerBooking > 0 && pts > policy.maximumRedemptionPointsPerBooking) {
    return {
      valid: false,
      monetaryValue: 0,
      error: `Maximum redemption allowed per booking is ${policy.maximumRedemptionPointsPerBooking.toLocaleString()} points.`,
    };
  }
  return {
    valid: true,
    monetaryValue: calculateRedemptionMonetaryValue(pts, policy),
  };
}

export interface StayAutoEarnEvaluation {
  eligible: boolean;
  eligibleSpend: number;
  pointsToAward: number;
  idempotencyKey: string;
  reason: string;
}

/**
 * Evaluates whether a reservation qualifies for automatic loyalty points earning.
 * Strictly read-only against existing verified financial records via calculateReservationAccount.
 * Never awards points for No-Show, Cancelled, non-checked-out, or unpaid/outstanding stays.
 */
export function evaluateStayEligibilityForAutoEarn(
  res: Reservation,
  hotel: Hotel | null,
  reservationLedgerEntries: LedgerEntry[],
  existingLoyaltyTransactions: LoyaltyTransaction[] = []
): StayAutoEarnEvaluation {
  const idempotencyKey = `auto_earn_${res.id}`;
  const policy = getLoyaltyPolicy(hotel);

  if (!policy.enabled) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Loyalty programme is disabled.' };
  }
  if (!policy.enableAutoEarning) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Automatic points earning is disabled.' };
  }
  if (!res?.id) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Missing reservation reference.' };
  }
  if (res.status === 'no_show') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'No-Show reservations are ineligible for automatic points.' };
  }
  if (res.status === 'cancelled') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Cancelled reservations are ineligible for automatic points.' };
  }
  if (res.status !== 'checked_out') {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Only completed (checked-out) stays qualify for automatic points.' };
  }

  // Prevent duplicate point awards for the same reservation
  const alreadyAwarded = existingLoyaltyTransactions.some(
    (tx) =>
      tx.idempotencyKey === idempotencyKey ||
      (tx.transactionType === 'earn_auto' && tx.reservationId === res.id)
  );
  if (alreadyAwarded) {
    return { eligible: false, eligibleSpend: 0, pointsToAward: 0, idempotencyKey, reason: 'Points already awarded for this stay.' };
  }

  // Read verified financial figures from existing financial engine (read-only)
  const account = calculateReservationAccount(res, hotel, reservationLedgerEntries);

  // Reject any stay with an unpaid / outstanding balance
  if (account.outstandingBalance > 0.01) {
    return {
      eligible: false,
      eligibleSpend: 0,
      pointsToAward: 0,
      idempotencyKey,
      reason: 'Reservation has an unpaid or outstanding balance.',
    };
  }

  // Use verified net payments received (excluding refunds) as eligible expenditure
  const netPaymentsReceived = Number(Math.max(0, account.totalPayments - account.totalRefunds).toFixed(2));
  if (netPaymentsReceived <= 0.01) {
    return {
      eligible: false,
      eligibleSpend: 0,
      pointsToAward: 0,
      idempotencyKey,
      reason: 'No verified settled payments found for this stay.',
    };
  }

  // Cap eligible spend at settled invoice charges so overpayments/unrefunded deposits don't inflate points
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
      reason: 'Eligible stay spend is below the minimum threshold to earn 1 point.',
    };
  }

  return {
    eligible: true,
    eligibleSpend,
    pointsToAward,
    idempotencyKey,
    reason: `Completed & settled stay (Room ${res.roomNumber || 'N/A'})`,
  };
}

export interface LoyaltyExpirySummary {
  expiredPointsUnprocessed: number;
  expiringSoonPoints: number;
  earliestExpiringDate: string | null;
}

/**
 * Calculates expired points awaiting expiry deduction and points approaching expiry
 * using FIFO consumption against prior redemptions, deductions, and expiry entries.
 */
export function evaluateLoyaltyPointsExpiry(
  transactions: LoyaltyTransaction[],
  reminderDays: number = 30,
  now: Date = new Date()
): LoyaltyExpirySummary {
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.timestamp || a.createdAt).getTime() - new Date(b.timestamp || b.createdAt).getTime()
  );

  // Build FIFO credit lots (positive point transactions)
  const lots: Array<{ remaining: number; expiresAt: Date | null; expiresAtIso: string | null }> = [];
  for (const tx of sorted) {
    if (tx.pointsDelta > 0) {
      const expDate = tx.expiresAt ? new Date(tx.expiresAt) : null;
      const validExp = expDate && !isNaN(expDate.getTime()) ? expDate : null;
      lots.push({
        remaining: tx.pointsDelta,
        expiresAt: validExp,
        expiresAtIso: validExp ? validExp.toISOString() : null,
      });
    } else if (tx.pointsDelta < 0) {
      let toConsume = Math.abs(tx.pointsDelta);
      // Consume earliest-expiring lots first (standard loyalty FIFO)
      for (const lot of lots) {
        if (toConsume <= 0) break;
        if (lot.remaining <= 0) continue;
        const used = Math.min(lot.remaining, toConsume);
        lot.remaining -= used;
        toConsume -= used;
      }
    }
  }

  const nowMs = now.getTime();
  const reminderCutoffMs = nowMs + Math.max(1, reminderDays) * 24 * 60 * 60 * 1000;

  let expiredPointsUnprocessed = 0;
  let expiringSoonPoints = 0;
  let earliestExpiringDate: string | null = null;

  for (const lot of lots) {
    if (lot.remaining <= 0 || !lot.expiresAt) continue;
    const expMs = lot.expiresAt.getTime();
    if (expMs <= nowMs) {
      expiredPointsUnprocessed += lot.remaining;
    } else if (expMs <= reminderCutoffMs) {
      expiringSoonPoints += lot.remaining;
      if (!earliestExpiringDate || expMs < new Date(earliestExpiringDate).getTime()) {
        earliestExpiringDate = lot.expiresAtIso;
      }
    }
  }

  return {
    expiredPointsUnprocessed: Math.floor(expiredPointsUnprocessed),
    expiringSoonPoints: Math.floor(expiringSoonPoints),
    earliestExpiringDate,
  };
}

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

function sanitizeDocId(key: string): string {
  return key.replace(/[^a-zA-Z0-9_\-:.]/g, '_').slice(0, 150);
}

function buildDefaultExpiryIso(policy: LoyaltySettings, explicitExpiry?: string | null): string | null {
  if (explicitExpiry) {
    const parsed = new Date(explicitExpiry);
    if (!isNaN(parsed.getTime())) return parsed.toISOString();
  }
  if (policy.pointsExpiryEnabled && policy.pointsExpiryDays > 0) {
    const exp = new Date();
    exp.setDate(exp.getDate() + policy.pointsExpiryDays);
    return exp.toISOString();
  }
  return null;
}

async function fetchFreshHotelPolicy(hotel: Hotel): Promise<LoyaltySettings> {
  try {
    const snap = await getDoc(doc(db, 'hotels', hotel.id));
    if (snap.exists()) {
      const freshHotel = { id: snap.id, ...(snap.data() as Omit<Hotel, 'id'>) } as Hotel;
      return getLoyaltyPolicy(freshHotel);
    }
  } catch {
    // Fallback cleanly to local hotel prop
  }
  return getLoyaltyPolicy(hotel);
}

function buildInitialAccount(
  hotelId: string,
  guest: Guest,
  policy: LoyaltySettings,
  nowIso: string
): LoyaltyAccount {
  const baseLevel = resolveMembershipLevel(0, policy.membershipLevels);
  return {
    id: guest.id,
    hotelId,
    guestId: guest.id,
    guestName: guest.name || 'Guest',
    ...(guest.email ? { guestEmail: guest.email } : {}),
    ...(guest.phone ? { guestPhone: guest.phone } : {}),
    availablePoints: 0,
    lifetimePointsEarned: 0,
    totalPointsRedeemed: 0,
    totalPointsManuallyAdjusted: 0,
    totalPointsExpired: 0,
    membershipLevelId: baseLevel.id,
    membershipLevelName: baseLevel.name,
    isActive: true,
    activatedAt: nowIso,
    lastActivityAt: nowIso,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

function formatReadableDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ============================================================================
// ATOMIC FIRESTORE OPERATIONS (CONCURRENCY-SAFE VIA runTransaction)
// ============================================================================

export interface LoyaltyMutationResult {
  success: boolean;
  duplicate?: boolean;
  account?: LoyaltyAccount;
  transaction?: LoyaltyTransaction;
  tierUpgraded?: { previousTier: string; newTier: string } | null;
  accountActivated?: boolean;
  error?: string;
}

/**
 * Explicitly activates a loyalty account for an existing guest (idempotent).
 * Dispatches loyalty.account_activated email ONLY after transaction commit.
 */
export async function activateGuestLoyaltyAccount(
  hotel: Hotel,
  guest: Guest,
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing hotel, guest, or administrator context.' };
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  if (!policy.enabled) {
    return { success: false, error: 'Loyalty programme is currently disabled in Admin Controls.' };
  }

  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const activationKey = sanitizeDocId(`activation_${guest.id}`);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', activationKey);
  const nowIso = new Date().toISOString();

  try {
    const result = await runTransaction(db, async (trx) => {
      const [accSnap, txSnap] = await Promise.all([trx.get(accountRef), trx.get(txRef)]);
      if (accSnap.exists() || txSnap.exists()) {
        return {
          duplicate: true,
          account: accSnap.exists() ? (accSnap.data() as LoyaltyAccount) : undefined,
        };
      }

      const account = buildInitialAccount(hotel.id, guest, policy, nowIso);
      const tx: LoyaltyTransaction = {
        id: activationKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || 'Guest',
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: 'account_activation',
        points: 0,
        pointsDelta: 0,
        previousBalance: 0,
        updatedBalance: 0,
        reason: 'Loyalty account activated',
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        newTierName: account.membershipLevelName,
        idempotencyKey: activationKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, account);
      trx.set(txRef, tx);

      return { duplicate: false, account, transaction: tx };
    });

    if (result.duplicate) {
      return { success: true, duplicate: true, account: result.account };
    }

    // Post-commit email dispatch via existing email infrastructure (non-blocking)
    if (policy.notifyGuestsByEmail !== false && result.account && result.transaction) {
      void notifyPlatformEvent({
        hotelId: hotel.id,
        eventType: 'loyalty.account_activated',
        entityId: result.transaction.id,
        guestId: guest.id,
        idempotencyKey: result.transaction.idempotencyKey,
        metadata: {
          guestName: guest.name,
          transactionType: 'Account Activation',
          pointsFormatted: '0 pts',
          updatedBalanceFormatted: `${result.account.availablePoints.toLocaleString()} pts`,
          membershipLevel: result.account.membershipLevelName,
          transactionDate: formatReadableDate(nowIso),
          reason: result.transaction.reason,
        },
      });
    }

    return {
      success: true,
      duplicate: false,
      account: result.account,
      transaction: result.transaction,
      accountActivated: true,
    };
  } catch (err: any) {
    console.error('[LoyaltyService] activateGuestLoyaltyAccount error:', err);
    return { success: false, error: err?.message || 'Failed to activate loyalty account.' };
  }
}

/**
 * Atomically awards, deducts, or posts a reversal adjustment for an existing guest.
 * Uses deterministic idempotencyKey document ID inside runTransaction to prevent duplicates
 * and protect against concurrent balance race conditions.
 * Does NOT create any financial ledger entries or affect folios/accounting.
 */
export async function adjustGuestLoyaltyPoints(
  hotel: Hotel,
  guest: Guest,
  params: {
    action: 'manual_award' | 'manual_deduct' | 'reversal';
    points: number;
    reason: string;
    expiresAt?: string | null;
    idempotencyKey: string;
  },
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing hotel, guest, or administrator context.' };
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  const safeKey = sanitizeDocId(params.idempotencyKey || `manual_${guest.id}_${Date.now()}`);
  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', safeKey);
  const nowIso = new Date().toISOString();

  try {
    const trxResult = await runTransaction(db, async (trx) => {
      const [accSnap, txSnap] = await Promise.all([trx.get(accountRef), trx.get(txRef)]);

      // Duplicate submission protection
      if (txSnap.exists()) {
        return {
          duplicate: true as const,
          account: accSnap.exists() ? (accSnap.data() as LoyaltyAccount) : undefined,
          transaction: txSnap.data() as LoyaltyTransaction,
        };
      }

      const isNewAccount = !accSnap.exists();
      const currentAccount: LoyaltyAccount = isNewAccount
        ? buildInitialAccount(hotel.id, guest, policy, nowIso)
        : (accSnap.data() as LoyaltyAccount);

      const validation = validateManualPointsAdjustment(params, policy, currentAccount.availablePoints);
      if (!validation.valid) {
        throw new Error(validation.error || 'Invalid manual loyalty adjustment.');
      }

      const pts = Math.floor(Number(params.points));
      const isDeduction = params.action === 'manual_deduct';
      const delta = isDeduction ? -pts : pts;
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const updatedBalance = previousBalance + delta;

      if (updatedBalance < 0) {
        throw new Error('Deduction cannot reduce balance below 0 points.');
      }

      const nextLifetimeEarned = isDeduction
        ? currentAccount.lifetimePointsEarned
        : currentAccount.lifetimePointsEarned + pts;
      const nextManualAdjusted = (currentAccount.totalPointsManuallyAdjusted || 0) + delta;

      const prevTier = currentAccount.membershipLevelName;
      const nextLevel = resolveMembershipLevel(nextLifetimeEarned, policy.membershipLevels);
      const tierChanged = !isNewAccount && nextLevel.name !== prevTier;
      const tierUpgraded =
        tierChanged &&
        nextLevel.minPoints >
          (policy.membershipLevels.find((l) => l.name === prevTier)?.minPoints ?? -1);

      const updatedAccount: LoyaltyAccount = {
        ...currentAccount,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        ...(guest.phone ? { guestPhone: guest.phone } : {}),
        availablePoints: updatedBalance,
        lifetimePointsEarned: nextLifetimeEarned,
        totalPointsManuallyAdjusted: nextManualAdjusted,
        membershipLevelId: nextLevel.id,
        membershipLevelName: nextLevel.name,
        lastActivityAt: nowIso,
        updatedAt: nowIso,
      };

      const expiryIso = !isDeduction ? buildDefaultExpiryIso(policy, params.expiresAt) : null;

      const tx: LoyaltyTransaction = {
        id: safeKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: params.action,
        points: pts,
        pointsDelta: delta,
        previousBalance,
        updatedBalance,
        reason: params.reason.trim(),
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        ...(expiryIso ? { expiresAt: expiryIso } : {}),
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

      // Record immutable activation entry if account was newly initialized
      if (isNewAccount) {
        const actKey = sanitizeDocId(`activation_${guest.id}`);
        const actRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', actKey);
        const actTx: LoyaltyTransaction = {
          id: actKey,
          hotelId: hotel.id,
          guestId: guest.id,
          guestName: guest.name || 'Guest',
          ...(guest.email ? { guestEmail: guest.email } : {}),
          transactionType: 'account_activation',
          points: 0,
          pointsDelta: 0,
          previousBalance: 0,
          updatedBalance: 0,
          reason: 'Loyalty account activated upon initial points allocation',
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          newTierName: nextLevel.name,
          idempotencyKey: actKey,
          timestamp: nowIso,
          createdAt: nowIso,
        };
        trx.set(actRef, actTx);
      }

      // Record immutable tier change entry atomically if membership tier upgraded
      if (tierUpgraded) {
        const tierKey = sanitizeDocId(`tier_${safeKey}`);
        const tierRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', tierKey);
        const tierTx: LoyaltyTransaction = {
          id: tierKey,
          hotelId: hotel.id,
          guestId: guest.id,
          guestName: guest.name || currentAccount.guestName,
          ...(guest.email ? { guestEmail: guest.email } : {}),
          transactionType: 'tier_change',
          points: 0,
          pointsDelta: 0,
          previousBalance: updatedBalance,
          updatedBalance,
          reason: `Membership level upgraded from ${prevTier} to ${nextLevel.name}`,
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          previousTierName: prevTier,
          newTierName: nextLevel.name,
          idempotencyKey: tierKey,
          timestamp: nowIso,
          createdAt: nowIso,
        };
        trx.set(tierRef, tierTx);
      }

      return {
        duplicate: false as const,
        account: updatedAccount,
        transaction: tx,
        accountActivated: isNewAccount,
        tierUpgraded: tierUpgraded ? { previousTier: prevTier, newTier: nextLevel.name } : null,
      };
    });

    if (trxResult.duplicate) {
      return {
        success: true,
        duplicate: true,
        account: trxResult.account,
        transaction: trxResult.transaction,
      };
    }

    // Trigger branded guest emails ONLY AFTER atomic commit succeeds
    if (policy.notifyGuestsByEmail !== false && trxResult.account && trxResult.transaction) {
      const tx = trxResult.transaction;
      const acc = trxResult.account;
      const isDeduct = tx.transactionType === 'manual_deduct';
      const eventType = isDeduct ? 'loyalty.points_deducted' : 'loyalty.points_awarded';
      const typeLabel =
        tx.transactionType === 'manual_deduct'
          ? 'Manual Points Deduction'
          : tx.transactionType === 'reversal'
            ? 'Points Adjustment / Reversal'
            : 'Manual Points Award';

      if (trxResult.accountActivated) {
        void notifyPlatformEvent({
          hotelId: hotel.id,
          eventType: 'loyalty.account_activated',
          entityId: `activation_${guest.id}`,
          guestId: guest.id,
          idempotencyKey: `activation_${guest.id}`,
          metadata: {
            guestName: guest.name,
            transactionType: 'Account Activation',
            pointsFormatted: '0 pts',
            updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
            membershipLevel: acc.membershipLevelName,
            transactionDate: formatReadableDate(nowIso),
          },
        });
      }

      void notifyPlatformEvent({
        hotelId: hotel.id,
        eventType,
        entityId: tx.id,
        guestId: guest.id,
        idempotencyKey: tx.idempotencyKey,
        metadata: {
          guestName: guest.name,
          transactionType: typeLabel,
          pointsFormatted: `${isDeduct ? '-' : '+'}${tx.points.toLocaleString()} pts`,
          updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
          membershipLevel: acc.membershipLevelName,
          transactionDate: formatReadableDate(tx.timestamp),
          reason: tx.reason,
          ...(tx.expiresAt ? { expiryDate: formatReadableDate(tx.expiresAt) } : {}),
        },
      });

      if (trxResult.tierUpgraded) {
        void notifyPlatformEvent({
          hotelId: hotel.id,
          eventType: 'loyalty.tier_upgraded',
          entityId: `tier_${tx.id}`,
          guestId: guest.id,
          idempotencyKey: `tier_${tx.id}`,
          metadata: {
            guestName: guest.name,
            transactionType: 'Membership Level Upgrade',
            previousTier: trxResult.tierUpgraded.previousTier,
            membershipLevel: trxResult.tierUpgraded.newTier,
            updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
            transactionDate: formatReadableDate(nowIso),
            reason: `Upgraded from ${trxResult.tierUpgraded.previousTier} to ${trxResult.tierUpgraded.newTier}`,
          },
        });
      }
    }

    return {
      success: true,
      duplicate: false,
      account: trxResult.account,
      transaction: trxResult.transaction,
      accountActivated: trxResult.accountActivated,
      tierUpgraded: trxResult.tierUpgraded,
    };
  } catch (err: any) {
    console.error('[LoyaltyService] adjustGuestLoyaltyPoints error:', err);
    return { success: false, error: err?.message || 'Failed to adjust loyalty points.' };
  }
}

/**
 * Atomically awards automatic stay points for a verified completed & settled reservation.
 * Idempotent per reservation via deterministic doc ID `auto_earn_{reservationId}`.
 */
export async function awardAutomaticStayPoints(
  hotel: Hotel,
  guest: Guest,
  res: Reservation,
  reservationLedgerEntries: LedgerEntry[],
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !res?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing required context for automatic points earning.' };
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  const hotelWithFreshPolicy: Hotel = {
    ...hotel,
    settings: {
      ...(hotel.settings || DEFAULT_SETTINGS),
      loyalty: policy,
    },
  };

  const evalResult = evaluateStayEligibilityForAutoEarn(res, hotelWithFreshPolicy, reservationLedgerEntries, []);
  if (!evalResult.eligible || evalResult.pointsToAward <= 0) {
    return { success: false, error: evalResult.reason };
  }

  const safeKey = sanitizeDocId(evalResult.idempotencyKey);
  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', safeKey);
  const nowIso = new Date().toISOString();

  try {
    const trxResult = await runTransaction(db, async (trx) => {
      const [accSnap, txSnap] = await Promise.all([trx.get(accountRef), trx.get(txRef)]);
      if (txSnap.exists()) {
        return {
          duplicate: true as const,
          account: accSnap.exists() ? (accSnap.data() as LoyaltyAccount) : undefined,
          transaction: txSnap.data() as LoyaltyTransaction,
        };
      }

      const isNewAccount = !accSnap.exists();
      const currentAccount: LoyaltyAccount = isNewAccount
        ? buildInitialAccount(hotel.id, guest, policy, nowIso)
        : (accSnap.data() as LoyaltyAccount);

      const pts = evalResult.pointsToAward;
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const updatedBalance = previousBalance + pts;
      const nextLifetimeEarned = (currentAccount.lifetimePointsEarned || 0) + pts;

      const prevTier = currentAccount.membershipLevelName;
      const nextLevel = resolveMembershipLevel(nextLifetimeEarned, policy.membershipLevels);
      const tierUpgraded =
        !isNewAccount &&
        nextLevel.name !== prevTier &&
        nextLevel.minPoints >
          (policy.membershipLevels.find((l) => l.name === prevTier)?.minPoints ?? -1);

      const updatedAccount: LoyaltyAccount = {
        ...currentAccount,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        ...(guest.phone ? { guestPhone: guest.phone } : {}),
        availablePoints: updatedBalance,
        lifetimePointsEarned: nextLifetimeEarned,
        membershipLevelId: nextLevel.id,
        membershipLevelName: nextLevel.name,
        lastActivityAt: nowIso,
        updatedAt: nowIso,
      };

      const expiryIso = buildDefaultExpiryIso(policy, null);
      const tx: LoyaltyTransaction = {
        id: safeKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: 'earn_auto',
        points: pts,
        pointsDelta: pts,
        previousBalance,
        updatedBalance,
        reason: `Automatic stay points earned — Room ${res.roomNumber || 'N/A'} (Settled spend: ${evalResult.eligibleSpend.toLocaleString()})`,
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        reservationId: res.id,
        ...(expiryIso ? { expiresAt: expiryIso } : {}),
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

      if (tierUpgraded) {
        const tierKey = sanitizeDocId(`tier_${safeKey}`);
        const tierRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', tierKey);
        const tierTx: LoyaltyTransaction = {
          id: tierKey,
          hotelId: hotel.id,
          guestId: guest.id,
          guestName: guest.name || currentAccount.guestName,
          ...(guest.email ? { guestEmail: guest.email } : {}),
          transactionType: 'tier_change',
          points: 0,
          pointsDelta: 0,
          previousBalance: updatedBalance,
          updatedBalance,
          reason: `Membership level upgraded from ${prevTier} to ${nextLevel.name}`,
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          reservationId: res.id,
          previousTierName: prevTier,
          newTierName: nextLevel.name,
          idempotencyKey: tierKey,
          timestamp: nowIso,
          createdAt: nowIso,
        };
        trx.set(tierRef, tierTx);
      }

      return {
        duplicate: false as const,
        account: updatedAccount,
        transaction: tx,
        accountActivated: isNewAccount,
        tierUpgraded: tierUpgraded ? { previousTier: prevTier, newTier: nextLevel.name } : null,
      };
    });

    if (trxResult.duplicate) {
      return { success: true, duplicate: true, account: trxResult.account, transaction: trxResult.transaction };
    }

    if (policy.notifyGuestsByEmail !== false && trxResult.account && trxResult.transaction) {
      const tx = trxResult.transaction;
      const acc = trxResult.account;

      void notifyPlatformEvent({
        hotelId: hotel.id,
        eventType: 'loyalty.points_awarded',
        entityId: tx.id,
        guestId: guest.id,
        reservationId: res.id,
        idempotencyKey: tx.idempotencyKey,
        metadata: {
          guestName: guest.name,
          transactionType: 'Stay Points Earned',
          pointsFormatted: `+${tx.points.toLocaleString()} pts`,
          updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
          membershipLevel: acc.membershipLevelName,
          transactionDate: formatReadableDate(tx.timestamp),
          reason: tx.reason,
          ...(tx.expiresAt ? { expiryDate: formatReadableDate(tx.expiresAt) } : {}),
        },
      });

      if (trxResult.tierUpgraded) {
        void notifyPlatformEvent({
          hotelId: hotel.id,
          eventType: 'loyalty.tier_upgraded',
          entityId: `tier_${tx.id}`,
          guestId: guest.id,
          idempotencyKey: `tier_${tx.id}`,
          metadata: {
            guestName: guest.name,
            transactionType: 'Membership Level Upgrade',
            previousTier: trxResult.tierUpgraded.previousTier,
            membershipLevel: trxResult.tierUpgraded.newTier,
            updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
            transactionDate: formatReadableDate(nowIso),
            reason: `Upgraded from ${trxResult.tierUpgraded.previousTier} to ${trxResult.tierUpgraded.newTier}`,
          },
        });
      }
    }

    return {
      success: true,
      duplicate: false,
      account: trxResult.account,
      transaction: trxResult.transaction,
      accountActivated: trxResult.accountActivated,
      tierUpgraded: trxResult.tierUpgraded,
    };
  } catch (err: any) {
    console.error('[LoyaltyService] awardAutomaticStayPoints error:', err);
    return { success: false, error: err?.message || 'Failed to award automatic stay points.' };
  }
}

/**
 * Atomically redeems loyalty points in the isolated loyalty ledger.
 * Strictly enforces policy enablement, min/max bounds, available balance, and duplicate protection.
 * Does NOT independently modify room prices, taxes, folio calculations, or payment logic.
 */
export async function redeemGuestLoyaltyPoints(
  hotel: Hotel,
  guest: Guest,
  params: {
    points: number;
    reason: string;
    reservationId?: string;
    idempotencyKey: string;
  },
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing hotel, guest, or administrator context.' };
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  const safeKey = sanitizeDocId(params.idempotencyKey || `redeem_${guest.id}_${Date.now()}`);
  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', safeKey);
  const nowIso = new Date().toISOString();

  try {
    const trxResult = await runTransaction(db, async (trx) => {
      const [accSnap, txSnap] = await Promise.all([trx.get(accountRef), trx.get(txRef)]);
      if (txSnap.exists()) {
        return {
          duplicate: true as const,
          account: accSnap.exists() ? (accSnap.data() as LoyaltyAccount) : undefined,
          transaction: txSnap.data() as LoyaltyTransaction,
        };
      }

      if (!accSnap.exists()) {
        throw new Error('Guest does not have an active loyalty account with redeemable points.');
      }

      const currentAccount = accSnap.data() as LoyaltyAccount;
      const validation = validatePointsRedemption(params.points, policy, currentAccount.availablePoints);
      if (!validation.valid) {
        throw new Error(validation.error || 'Points redemption validation failed.');
      }

      const pts = Math.floor(Number(params.points));
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const updatedBalance = previousBalance - pts;
      const nextRedeemed = (currentAccount.totalPointsRedeemed || 0) + pts;

      const updatedAccount: LoyaltyAccount = {
        ...currentAccount,
        availablePoints: updatedBalance,
        totalPointsRedeemed: nextRedeemed,
        lastActivityAt: nowIso,
        updatedAt: nowIso,
      };

      const tx: LoyaltyTransaction = {
        id: safeKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: 'redemption',
        points: pts,
        pointsDelta: -pts,
        previousBalance,
        updatedBalance,
        reason: params.reason.trim() || 'Loyalty points redeemed',
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        ...(params.reservationId ? { reservationId: params.reservationId } : {}),
        monetaryValue: validation.monetaryValue,
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

      return { duplicate: false as const, account: updatedAccount, transaction: tx };
    });

    if (trxResult.duplicate) {
      return { success: true, duplicate: true, account: trxResult.account, transaction: trxResult.transaction };
    }

    if (policy.notifyGuestsByEmail !== false && trxResult.account && trxResult.transaction) {
      const tx = trxResult.transaction;
      const acc = trxResult.account;
      const currency = hotel.defaultCurrency || 'NGN';
      const symbol = currency === 'USD' ? '$' : '₦';

      void notifyPlatformEvent({
        hotelId: hotel.id,
        eventType: 'loyalty.points_redeemed',
        entityId: tx.id,
        guestId: guest.id,
        reservationId: tx.reservationId,
        idempotencyKey: tx.idempotencyKey,
        metadata: {
          guestName: guest.name,
          transactionType: 'Points Redemption',
          pointsFormatted: `-${tx.points.toLocaleString()} pts`,
          monetaryValueFormatted: `${symbol}${(tx.monetaryValue || 0).toLocaleString()}`,
          updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
          membershipLevel: acc.membershipLevelName,
          transactionDate: formatReadableDate(tx.timestamp),
          reason: tx.reason,
        },
      });
    }

    return {
      success: true,
      duplicate: false,
      account: trxResult.account,
      transaction: trxResult.transaction,
    };
  } catch (err: any) {
    console.error('[LoyaltyService] redeemGuestLoyaltyPoints error:', err);
    return { success: false, error: err?.message || 'Failed to redeem loyalty points.' };
  }
}

/**
 * Atomically expires unconsumed points that have passed their configured expiry date.
 * Safe and idempotent per calendar day per guest.
 */
export async function processExpiredLoyaltyPoints(
  hotel: Hotel,
  guest: Guest,
  guestTransactions: LoyaltyTransaction[],
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing required context.' };
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  const expirySummary = evaluateLoyaltyPointsExpiry(guestTransactions, policy.expiryReminderDays, new Date());
  if (expirySummary.expiredPointsUnprocessed <= 0) {
    return { success: false, error: 'No expired points pending deduction.' };
  }

  const todayKey = new Date().toISOString().slice(0, 10);
  const safeKey = sanitizeDocId(`expiry_${guest.id}_${todayKey}_${expirySummary.expiredPointsUnprocessed}`);
  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', safeKey);
  const nowIso = new Date().toISOString();

  try {
    const trxResult = await runTransaction(db, async (trx) => {
      const [accSnap, txSnap] = await Promise.all([trx.get(accountRef), trx.get(txRef)]);
      if (txSnap.exists()) {
        return { duplicate: true as const, account: accSnap.exists() ? (accSnap.data() as LoyaltyAccount) : undefined };
      }
      if (!accSnap.exists()) {
        throw new Error('Loyalty account not found.');
      }

      const currentAccount = accSnap.data() as LoyaltyAccount;
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const ptsToExpire = Math.min(previousBalance, expirySummary.expiredPointsUnprocessed);
      if (ptsToExpire <= 0) {
        return { duplicate: true as const, account: currentAccount };
      }

      const updatedBalance = previousBalance - ptsToExpire;
      const updatedAccount: LoyaltyAccount = {
        ...currentAccount,
        availablePoints: updatedBalance,
        totalPointsExpired: (currentAccount.totalPointsExpired || 0) + ptsToExpire,
        lastActivityAt: nowIso,
        updatedAt: nowIso,
      };

      const tx: LoyaltyTransaction = {
        id: safeKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: 'expiry',
        points: ptsToExpire,
        pointsDelta: -ptsToExpire,
        previousBalance,
        updatedBalance,
        reason: `Automatic expiry of ${ptsToExpire.toLocaleString()} unused loyalty points past expiry date`,
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

      return { duplicate: false as const, account: updatedAccount, transaction: tx };
    });

    return {
      success: true,
      duplicate: trxResult.duplicate,
      account: trxResult.account,
      transaction: 'transaction' in trxResult ? trxResult.transaction : undefined,
    };
  } catch (err: any) {
    console.error('[LoyaltyService] processExpiredLoyaltyPoints error:', err);
    return { success: false, error: err?.message || 'Failed to process expired points.' };
  }
}

/**
 * Dispatches an approaching-expiry reminder email via the existing email infrastructure.
 * Deduplicated per guest + earliest expiry date so repeated clicks never spam guests.
 */
export async function sendExpiringPointsReminder(
  hotel: Hotel,
  guest: Guest,
  account: LoyaltyAccount,
  expiringPoints: number,
  earliestExpiryDate: string
): Promise<{ sent: boolean; reason?: string }> {
  if (!hotel?.id || !guest?.id || expiringPoints <= 0 || !earliestExpiryDate) {
    return { sent: false, reason: 'No expiring points to notify.' };
  }
  const datePart = earliestExpiryDate.slice(0, 10);
  await notifyPlatformEvent({
    hotelId: hotel.id,
    eventType: 'loyalty.points_expiring',
    entityId: `expiring_${guest.id}_${datePart}`,
    guestId: guest.id,
    idempotencyKey: `expiring_${guest.id}_${datePart}`,
    metadata: {
      guestName: guest.name,
      transactionType: 'Points Approaching Expiry',
      pointsFormatted: `${expiringPoints.toLocaleString()} pts expiring`,
      updatedBalanceFormatted: `${account.availablePoints.toLocaleString()} pts`,
      membershipLevel: account.membershipLevelName,
      expiryDate: formatReadableDate(earliestExpiryDate),
      transactionDate: formatReadableDate(new Date().toISOString()),
      reason: `${expiringPoints.toLocaleString()} loyalty points are scheduled to expire on ${formatReadableDate(earliestExpiryDate)}.`,
    },
  });
  return { sent: true };
}

/**
 * Fetches all loyalty transactions for a specific guest (tenant-scoped).
 */
export async function fetchGuestLoyaltyTransactions(
  hotelId: string,
  guestId: string
): Promise<LoyaltyTransaction[]> {
  const snap = await getDocs(
    query(collection(db, 'hotels', hotelId, 'loyaltyTransactions'), where('guestId', '==', guestId))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as LoyaltyTransaction))
    .sort((a, b) => new Date(b.timestamp || b.createdAt).getTime() - new Date(a.timestamp || a.createdAt).getTime());
}
