import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  runTransaction,
  where,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import {
  Guest,
  Hotel,
  LedgerEntry,
  LoyaltyAccount,
  LoyaltySettings,
  LoyaltyTransaction,
  Reservation,
  UserProfile,
} from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import { hasPermission } from '../utils/permissions';
import { notifyPlatformEvent } from './transactionalEmailClient';
import {
  HARD_MIN_REDEMPTION_POINTS,
  HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  buildDeterministicExpiryKey,
  calculateEarnedPointsForAmount,
  calculateRedemptionMonetaryValue,
  evaluateLoyaltyPointsExpiry,
  evaluateStayEligibilityForAutoEarn,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  mapToCanonicalLoyaltyTransactionType,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
  validatePointsRedemption,
  type ExpiredPointLotDetail,
  type LoyaltyExpirySummary,
  type ManualPointsValidationResult,
  type RedemptionValidationContext,
  type RedemptionValidationResult,
  type StayAutoEarnEvaluation,
} from '../modules/loyalty/shared/loyaltyRules';

export {
  HARD_MIN_REDEMPTION_POINTS,
  HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  buildDeterministicExpiryKey,
  calculateEarnedPointsForAmount,
  calculateRedemptionMonetaryValue,
  evaluateLoyaltyPointsExpiry,
  evaluateStayEligibilityForAutoEarn,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  mapToCanonicalLoyaltyTransactionType,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
  validatePointsRedemption,
  type ExpiredPointLotDetail,
  type LoyaltyExpirySummary,
  type ManualPointsValidationResult,
  type RedemptionValidationContext,
  type RedemptionValidationResult,
  type StayAutoEarnEvaluation,
};

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

// Pure policy, earning, redemption, and FIFO expiry rules are exported from
// `../modules/loyalty/shared/loyaltyRules` above as the single source of truth shared with server routes.

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
        canonicalType: mapToCanonicalLoyaltyTransactionType('account_activation', 0),
        points: 0,
        pointsDelta: 0,
        previousBalance: 0,
        updatedBalance: 0,
        previousLifetimeBalance: 0,
        updatedLifetimeBalance: 0,
        reason: 'Loyalty account activated',
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        actorType: 'staff',
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
    reversalDirection?: 'credit' | 'debit';
    originalTransactionId?: string;
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
      const isDebitReversal = params.action === 'reversal' && params.reversalDirection === 'debit';
      const isDeduction = params.action === 'manual_deduct' || isDebitReversal;
      const delta = isDeduction ? -pts : pts;
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const updatedBalance = previousBalance + delta;

      if (updatedBalance < 0) {
        throw new Error('Deduction cannot reduce balance below 0 points.');
      }

      const previousLifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));
      // Manual deductions never reduce lifetime earned; debit reversals of erroneous earnings adjust lifetime auditably
      const nextLifetimeEarned = isDebitReversal
        ? Math.max(0, previousLifetime - pts)
        : params.action === 'manual_deduct'
          ? previousLifetime
          : previousLifetime + pts;
      const nextManualAdjusted = (currentAccount.totalPointsManuallyAdjusted || 0) + delta;

      const prevTier = currentAccount.membershipLevelName;
      const nextLevel = resolveMembershipLevel(nextLifetimeEarned, policy.membershipLevels);
      const tierChanged = nextLevel.name !== prevTier;
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
        canonicalType: mapToCanonicalLoyaltyTransactionType(params.action, delta),
        points: pts,
        pointsDelta: delta,
        previousBalance,
        updatedBalance,
        previousLifetimeBalance: previousLifetime,
        updatedLifetimeBalance: nextLifetimeEarned,
        reason: params.reason.trim(),
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        actorType: 'staff',
        ...(params.originalTransactionId ? { originalTransactionId: params.originalTransactionId } : {}),
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
          canonicalType: mapToCanonicalLoyaltyTransactionType('account_activation', 0),
          points: 0,
          pointsDelta: 0,
          previousBalance: 0,
          updatedBalance: 0,
          previousLifetimeBalance: 0,
          updatedLifetimeBalance: 0,
          reason: 'Loyalty account activated upon initial points allocation',
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          actorType: 'staff',
          newTierName: prevTier,
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
          canonicalType: mapToCanonicalLoyaltyTransactionType('tier_change', 0),
          points: 0,
          pointsDelta: 0,
          previousBalance: updatedBalance,
          updatedBalance,
          previousLifetimeBalance: nextLifetimeEarned,
          updatedLifetimeBalance: nextLifetimeEarned,
          reason: `Membership level upgraded from ${prevTier} to ${nextLevel.name}`,
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          actorType: 'system',
          systemProcess: 'tier_evaluation',
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
      const previousLifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));
      const nextLifetimeEarned = previousLifetime + pts;

      const prevTier = currentAccount.membershipLevelName;
      const nextLevel = resolveMembershipLevel(nextLifetimeEarned, policy.membershipLevels);
      const tierUpgraded =
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
      const financialRef =
        evalResult.financialTransactionRefs.length > 0
          ? evalResult.financialTransactionRefs.join(',')
          : undefined;
      const tx: LoyaltyTransaction = {
        id: safeKey,
        hotelId: hotel.id,
        guestId: guest.id,
        guestName: guest.name || currentAccount.guestName,
        ...(guest.email ? { guestEmail: guest.email } : {}),
        transactionType: 'earn_auto',
        canonicalType: mapToCanonicalLoyaltyTransactionType('earn_auto', pts),
        points: pts,
        pointsDelta: pts,
        previousBalance,
        updatedBalance,
        previousLifetimeBalance: previousLifetime,
        updatedLifetimeBalance: nextLifetimeEarned,
        reason: `Automatic stay points earned — Room ${res.roomNumber || 'N/A'} (Settled spend: ${evalResult.eligibleSpend.toLocaleString()})`,
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        actorType: 'system',
        systemProcess: 'auto_stay_earning',
        reservationId: res.id,
        ...(financialRef ? { financialTransactionRef: financialRef } : {}),
        ...(expiryIso ? { expiresAt: expiryIso } : {}),
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

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
          canonicalType: mapToCanonicalLoyaltyTransactionType('account_activation', 0),
          points: 0,
          pointsDelta: 0,
          previousBalance: 0,
          updatedBalance: 0,
          previousLifetimeBalance: 0,
          updatedLifetimeBalance: 0,
          reason: 'Loyalty account activated upon first eligible settled stay',
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          actorType: 'system',
          systemProcess: 'auto_stay_earning',
          reservationId: res.id,
          newTierName: prevTier,
          idempotencyKey: actKey,
          timestamp: nowIso,
          createdAt: nowIso,
        };
        trx.set(actRef, actTx);
      }

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
          canonicalType: mapToCanonicalLoyaltyTransactionType('tier_change', 0),
          points: 0,
          pointsDelta: 0,
          previousBalance: updatedBalance,
          updatedBalance,
          previousLifetimeBalance: nextLifetimeEarned,
          updatedLifetimeBalance: nextLifetimeEarned,
          reason: `Membership level upgraded from ${prevTier} to ${nextLevel.name}`,
          adminId: adminProfile.uid,
          adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
          ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
          actorType: 'system',
          systemProcess: 'tier_evaluation',
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
 * Authoritatively redeems loyalty points via the server-side validation endpoint (`POST /api/loyalty/redeem`),
 * enforcing minimum 100 pts, maximum 5,000 pts per booking (cumulative), active account, live unexpired balance,
 * booking status, settled check, eligible payable amount cap, and duplicate/concurrency protection.
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
    reservation?: Reservation | null;
    ledgerEntries?: LedgerEntry[];
    existingTransactions?: LoyaltyTransaction[];
  },
  adminProfile: UserProfile
): Promise<LoyaltyMutationResult> {
  if (!hotel?.id || !guest?.id || !adminProfile?.uid) {
    return { success: false, error: 'Missing hotel, guest, or administrator context.' };
  }

  const safeKey = sanitizeDocId(params.idempotencyKey || `redeem_${guest.id}_${Date.now()}`);

  // Primary path: Authoritative server-side redemption validation & commit
  try {
    const currentUser = auth?.currentUser;
    if (currentUser && typeof fetch === 'function') {
      const idToken = await currentUser.getIdToken();
      if (idToken) {
        const resp = await fetch('/api/loyalty/redeem', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            hotelId: hotel.id,
            guestId: guest.id,
            points: Math.floor(Number(params.points)),
            reason: (params.reason || '').trim() || 'Loyalty points redeemed',
            ...(params.reservationId ? { reservationId: params.reservationId } : {}),
            idempotencyKey: safeKey,
          }),
        });

        // Authoritative server handled the request (either success or authoritative validation rejection)
        if (resp.status !== 404 && resp.status !== 502 && resp.status !== 503) {
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.success) {
            return {
              success: false,
              error: data?.error || `Redemption rejected by server (${resp.status}).`,
            };
          }
          return {
            success: true,
            duplicate: Boolean(data.duplicate),
            account: data.account,
            transaction: data.transaction,
          };
        }
      }
    }
  } catch (apiErr) {
    console.warn('[LoyaltyService] Server redemption endpoint unreachable; falling back to atomic Firestore transaction with full validation:', apiErr);
  }

  // Fallback path (offline / test contexts): enforces identical 7-point validation inside Firestore runTransaction
  const policy = await fetchFreshHotelPolicy(hotel);
  const accountRef = doc(db, 'hotels', hotel.id, 'loyaltyAccounts', guest.id);
  const txRef = doc(db, 'hotels', hotel.id, 'loyaltyTransactions', safeKey);
  const now = new Date();
  const nowIso = now.toISOString();

  try {
    const existingTransactions =
      params.existingTransactions || (await fetchGuestLoyaltyTransactions(hotel.id, guest.id));

    let reservation = params.reservation || null;
    let reservationLedger = params.ledgerEntries;
    if (params.reservationId && !reservation) {
      const resSnap = await getDoc(doc(db, 'hotels', hotel.id, 'reservations', params.reservationId));
      if (resSnap.exists()) {
        reservation = { id: resSnap.id, ...resSnap.data() } as Reservation;
      }
    }
    if (params.reservationId && !reservationLedger) {
      const ledgerSnap = await getDocs(
        query(collection(db, 'hotels', hotel.id, 'ledger'), where('reservationId', '==', params.reservationId))
      );
      reservationLedger = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry));
    }

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
      const validation = validatePointsRedemption(params.points, policy, currentAccount.availablePoints, {
        accountIsActive: currentAccount.isActive,
        reservationId: params.reservationId,
        reservation,
        hotel,
        ledgerEntries: reservationLedger,
        existingTransactions,
        idempotencyKey: safeKey,
        now,
      });
      if (!validation.valid) {
        throw new Error(validation.error || 'Points redemption validation failed.');
      }

      const pts = Math.floor(Number(params.points));
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const updatedBalance = previousBalance - pts;
      if (updatedBalance < 0) {
        throw new Error('Redemption cannot result in a negative loyalty balance.');
      }
      const nextRedeemed = (currentAccount.totalPointsRedeemed || 0) + pts;
      const lifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));

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
        canonicalType: mapToCanonicalLoyaltyTransactionType('redemption', -pts),
        points: pts,
        pointsDelta: -pts,
        previousBalance,
        updatedBalance,
        previousLifetimeBalance: lifetime,
        updatedLifetimeBalance: lifetime,
        reason: params.reason.trim() || 'Loyalty points redeemed',
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'Admin',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        actorType: 'staff',
        ...(params.reservationId ? { reservationId: params.reservationId } : {}),
        redemptionRef: safeKey,
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
 * Uses deterministic per-lot idempotency keys so expired lots can never expire twice,
 * reduces availablePoints only (preserving lifetimePointsEarned and membership tier),
 * and dispatches post-commit `loyalty.points_expired` email notification when enabled.
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

  // Primary path: Authoritative server-side expiry endpoint
  try {
    const currentUser = auth?.currentUser;
    if (currentUser && typeof fetch === 'function') {
      const idToken = await currentUser.getIdToken();
      if (idToken) {
        const resp = await fetch('/api/loyalty/process-expiry', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify({
            hotelId: hotel.id,
            guestId: guest.id,
          }),
        });
        if (resp.status !== 404 && resp.status !== 502 && resp.status !== 503) {
          const data = await resp.json().catch(() => ({}));
          if (!resp.ok || !data?.success) {
            return { success: false, error: data?.error || `Expiry processing failed (${resp.status}).` };
          }
          return {
            success: true,
            duplicate: Boolean(data.duplicate),
            account: data.account,
            transaction: data.transaction,
          };
        }
      }
    }
  } catch (apiErr) {
    console.warn('[LoyaltyService] Server expiry endpoint unreachable; falling back to atomic Firestore transaction:', apiErr);
  }

  const policy = await fetchFreshHotelPolicy(hotel);
  const expirySummary = evaluateLoyaltyPointsExpiry(guestTransactions, policy.expiryReminderDays, new Date());
  if (expirySummary.expiredPointsUnprocessed <= 0 || expirySummary.expiredLots.length === 0) {
    return { success: false, error: 'No expired points pending deduction.' };
  }

  const safeKey = buildDeterministicExpiryKey(guest.id, expirySummary.expiredLots);
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
        throw new Error('Loyalty account not found.');
      }

      const currentAccount = accSnap.data() as LoyaltyAccount;
      const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
      const ptsToExpire = Math.min(previousBalance, expirySummary.expiredPointsUnprocessed);
      if (ptsToExpire <= 0) {
        return { duplicate: true as const, account: currentAccount };
      }

      const updatedBalance = previousBalance - ptsToExpire;
      const lifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));
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
        canonicalType: mapToCanonicalLoyaltyTransactionType('expiry', -ptsToExpire),
        points: ptsToExpire,
        pointsDelta: -ptsToExpire,
        previousBalance,
        updatedBalance,
        previousLifetimeBalance: lifetime,
        updatedLifetimeBalance: lifetime,
        reason: `Automatic expiry of ${ptsToExpire.toLocaleString()} unused loyalty points past expiry date`,
        adminId: adminProfile.uid,
        adminName: adminProfile.displayName || adminProfile.name || adminProfile.email || 'System Policy',
        ...(adminProfile.email ? { adminEmail: adminProfile.email } : {}),
        actorType: 'staff',
        expiredLotIds: expirySummary.expiredLots.map((l) => l.txId),
        idempotencyKey: safeKey,
        timestamp: nowIso,
        createdAt: nowIso,
      };

      trx.set(accountRef, updatedAccount);
      trx.set(txRef, tx);

      return { duplicate: false as const, account: updatedAccount, transaction: tx };
    });

    if (!trxResult.duplicate && policy.notifyGuestsByEmail !== false && trxResult.account && 'transaction' in trxResult && trxResult.transaction) {
      const tx = trxResult.transaction;
      const acc = trxResult.account;
      void notifyPlatformEvent({
        hotelId: hotel.id,
        eventType: 'loyalty.points_expired',
        entityId: tx.id,
        guestId: guest.id,
        idempotencyKey: tx.idempotencyKey,
        metadata: {
          guestName: guest.name,
          transactionType: 'Points Expired',
          pointsFormatted: `-${tx.points.toLocaleString()} pts expired`,
          updatedBalanceFormatted: `${acc.availablePoints.toLocaleString()} pts`,
          membershipLevel: acc.membershipLevelName,
          transactionDate: formatReadableDate(tx.timestamp),
          reason: tx.reason,
        },
      });
    }

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

export interface AutoAwardStayCompletionResult {
  awarded: boolean;
  duplicate?: boolean;
  pointsAwarded?: number;
  updatedBalance?: number;
  membershipLevel?: string;
  skippedReason?: string;
}

/**
 * Non-blocking post-checkout / post-settlement loyalty accumulation hook.
 * When the hotel's Loyalty program and Automatic Earning are enabled in Admin Controls,
 * automatically evaluates a completed & settled reservation and additively accumulates
 * earned points onto the guest's existing loyalty account (`loyaltyAccounts/{guestId}`).
 * Unredeemed points from prior stays are strictly preserved and keep accumulating until redeemed.
 * Idempotent per reservation (`auto_earn_{reservationId}`). Never mutates folio, pricing, or checkout workflows.
 */
export async function tryAutoAwardLoyaltyOnStayCompletion(
  hotel: Hotel | null | undefined,
  guestOrId: Guest | string | null | undefined,
  res: Reservation | null | undefined,
  adminProfile: UserProfile | null | undefined,
  customRoles: any[] = []
): Promise<AutoAwardStayCompletionResult> {
  if (!hotel?.id || !res?.id || !adminProfile?.uid || !guestOrId) {
    return { awarded: false, skippedReason: 'Missing hotel, reservation, guest, or operator context.' };
  }

  if (!canManageLoyalty(adminProfile, customRoles)) {
    return { awarded: false, skippedReason: 'Operator does not have loyalty management permission.' };
  }

  try {
    const policy = await fetchFreshHotelPolicy(hotel);
    if (!policy.enabled || !policy.enableAutoEarning) {
      return { awarded: false, skippedReason: 'Loyalty program or automatic earning is disabled.' };
    }

    let resolvedGuest: Guest;
    if (typeof guestOrId === 'string') {
      const guestSnap = await getDoc(doc(db, 'hotels', hotel.id, 'guests', guestOrId));
      if (guestSnap.exists()) {
        resolvedGuest = { id: guestSnap.id, ...guestSnap.data() } as Guest;
      } else {
        resolvedGuest = {
          id: guestOrId,
          name: res.guestName || 'Guest',
          email: res.guestEmail || '',
          phone: res.guestPhone || '',
          totalStays: 1,
          totalNights: res.nights || 1,
          totalSpent: res.paidAmount || 0,
          ledgerBalance: 0,
          createdAt: new Date().toISOString(),
        } as Guest;
      }
    } else {
      resolvedGuest = guestOrId;
    }

    if (!resolvedGuest?.id) {
      return { awarded: false, skippedReason: 'Could not resolve guest profile ID.' };
    }

    // Fetch fresh committed reservation & ledger entries read-only to evaluate settled spend accurately
    const [freshResSnap, ledgerSnap] = await Promise.all([
      getDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id)),
      getDocs(query(collection(db, 'hotels', hotel.id, 'ledger'), where('reservationId', '==', res.id))),
    ]);
    const resLedger = ledgerSnap.docs.map((d) => ({ id: d.id, ...d.data() } as LedgerEntry));
    const freshResData = freshResSnap.exists() ? (freshResSnap.data() as Partial<Reservation>) : {};

    const completedRes: Reservation = {
      ...res,
      ...freshResData,
      id: res.id,
      status: 'checked_out',
    };

    const result = await awardAutomaticStayPoints(
      hotel,
      resolvedGuest,
      completedRes,
      resLedger,
      adminProfile
    );

    if (result.success && !result.duplicate && result.transaction && result.account) {
      return {
        awarded: true,
        duplicate: false,
        pointsAwarded: result.transaction.points,
        updatedBalance: result.account.availablePoints,
        membershipLevel: result.account.membershipLevelName,
      };
    }

    if (result.success && result.duplicate) {
      return {
        awarded: false,
        duplicate: true,
        updatedBalance: result.account?.availablePoints,
        membershipLevel: result.account?.membershipLevelName,
        skippedReason: 'Points already awarded for this stay.',
      };
    }

    return {
      awarded: false,
      skippedReason: result.error || 'Stay not eligible for automatic loyalty earning.',
    };
  } catch (err: any) {
    console.warn('[LoyaltyService] Non-blocking post-checkout auto-award skipped:', err?.message || err);
    return { awarded: false, skippedReason: err?.message || 'Unexpected error during auto-award.' };
  }
}

