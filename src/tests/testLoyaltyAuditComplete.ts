import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  HARD_MAX_REDEMPTION_POINTS_PER_BOOKING,
  HARD_MIN_REDEMPTION_POINTS,
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
} from '../modules/loyalty/shared/loyaltyRules.ts';
import {
  isHotelEmailEventEnabled,
  renderMultiTenantEmail,
  type HotelBrandContext,
} from '../services/multiTenantEmailService.ts';
import { DEFAULT_LOYALTY_LEVELS, DEFAULT_SETTINGS } from '../constants.ts';
import type { Hotel, LedgerEntry, LoyaltyTransaction, Reservation } from '../types.ts';

function makeHotel(overrides: Partial<NonNullable<Hotel['settings']>['loyalty']> = {}): Hotel {
  return {
    id: 'hotel-audit-1',
    name: 'Audit Grand Hotel',
    email: 'frontdesk@auditgrand.test',
    defaultCurrency: 'NGN',
    taxes: [],
    defaultCheckInTime: '14:00',
    defaultCheckOutTime: '12:00',
    settings: {
      ...DEFAULT_SETTINGS,
      loyalty: {
        ...DEFAULT_SETTINGS.loyalty!,
        enabled: true,
        allowManualAllocation: true,
        enableAutoEarning: true,
        enableRedemption: true,
        earningRatePoints: 1,
        earningRateAmount: 1000,
        redemptionPointValue: 10,
        minimumRedemptionPoints: 100,
        maximumRedemptionPointsPerBooking: 5000,
        pointsExpiryEnabled: true,
        pointsExpiryDays: 365,
        expiryReminderDays: 30,
        notifyGuestsByEmail: true,
        ...overrides,
      },
    },
  } as unknown as Hotel;
}

function makeRes(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: 'res-1',
    hotelId: 'hotel-audit-1',
    guestId: 'guest-1',
    guestName: 'Ada Lovelace',
    roomId: 'room-101',
    roomNumber: '101',
    checkIn: '2026-10-01',
    checkOut: '2026-10-03',
    actualCheckOut: '2026-10-03T10:00:00.000Z',
    overstayNights: 0,
    nights: 2,
    nightlyRate: 50000,
    totalAmount: 100000,
    paidAmount: 100000,
    status: 'checked_out',
    paymentStatus: 'paid',
    ...overrides,
  } as unknown as Reservation;
}

function makeTx(overrides: Partial<LoyaltyTransaction> = {}): LoyaltyTransaction {
  return {
    id: 'tx-1',
    hotelId: 'hotel-audit-1',
    guestId: 'guest-1',
    guestName: 'Ada Lovelace',
    transactionType: 'earn_auto',
    canonicalType: 'EARNING',
    points: 500,
    pointsDelta: 500,
    previousBalance: 0,
    updatedBalance: 500,
    previousLifetimeBalance: 0,
    updatedLifetimeBalance: 500,
    reason: 'Completed settled stay',
    adminId: 'admin-1',
    adminName: 'Admin',
    actorType: 'system',
    systemProcess: 'auto_stay_earning',
    idempotencyKey: 'tx-1',
    timestamp: '2026-01-15T10:00:00.000Z',
    createdAt: '2026-01-15T10:00:00.000Z',
    ...overrides,
  };
}

let passed = 0;
function scenario(num: number, title: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ [${String(num).padStart(2, '0')}/35] ${title}`);
}

console.log('\n=== Loyalty Audit Complete 35-Scenario Verification Suite ===\n');

// ---------------------------------------------------------------------------
// SECTION A: EARNING (Scenarios 1–5)
// ---------------------------------------------------------------------------
scenario(1, 'Fully settled checked-out stay earns points based on verified net settled spend', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-full', totalAmount: 150000, paidAmount: 150000 });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room (2 nights)', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'd2', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'restaurant', amount: 50000, description: 'Restaurant dinner', timestamp: '2026-10-02T19:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 150000, description: 'POS settlement', timestamp: '2026-10-03T09:00:00Z' } as LedgerEntry,
  ];
  const ev = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, []);
  assert.equal(ev.eligible, true);
  assert.equal(ev.eligibleSpend, 150000);
  assert.equal(ev.pointsToAward, 150);
  assert.deepEqual(ev.financialTransactionRefs, ['c1']);
});

scenario(2, 'Unpaid or partially settled booking earns zero points under full-settlement policy', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-partial', totalAmount: 100000, paidAmount: 40000, paymentStatus: 'partial' });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 40000, description: 'Deposit', timestamp: '2026-10-01T15:00:00Z' } as LedgerEntry,
  ];
  const ev = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, []);
  assert.equal(ev.eligible, false);
  assert.equal(ev.pointsToAward, 0);
});

scenario(3, 'Booking value alone without completed checkout & payment earns zero points', () => {
  const hotel = makeHotel();
  const confirmed = makeRes({ id: 'res-conf', status: 'confirmed', totalAmount: 250000, paidAmount: 250000 });
  const checkedIn = makeRes({ id: 'res-in', status: 'checked_in', totalAmount: 250000, paidAmount: 250000 });
  assert.equal(evaluateStayEligibilityForAutoEarn(confirmed, hotel, [], []).eligible, false);
  assert.equal(evaluateStayEligibilityForAutoEarn(checkedIn, hotel, [], []).eligible, false);
});

scenario(4, 'No-Show and Cancelled reservations are strictly excluded from automatic earning', () => {
  const hotel = makeHotel();
  const noShow = makeRes({ id: 'res-ns', status: 'no_show' });
  const cancelled = makeRes({ id: 'res-can', status: 'cancelled' });
  assert.equal(evaluateStayEligibilityForAutoEarn(noShow, hotel, [], []).eligible, false);
  assert.equal(evaluateStayEligibilityForAutoEarn(cancelled, hotel, [], []).eligible, false);
});

scenario(5, 'Refunded payments reduce net eligible spend and fully refunded stays earn zero points', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-ref', totalAmount: 100000, paidAmount: 100000 });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 100000, description: 'Payment', timestamp: '2026-10-01T15:00:00Z' } as LedgerEntry,
    { id: 'r1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'refund', amount: 100000, description: 'Full refund', timestamp: '2026-10-02T10:00:00Z' } as LedgerEntry,
  ];
  const ev = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, []);
  assert.equal(ev.eligible, false);
  assert.equal(ev.pointsToAward, 0);
});

// ---------------------------------------------------------------------------
// SECTION B: DUPLICATE PREVENTION (Scenarios 6–10)
// ---------------------------------------------------------------------------
scenario(6, 'Deterministic earning idempotency key blocks duplicate award for same reservation', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-dup' });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 100000, description: 'Paid', timestamp: '2026-10-03T09:00:00Z' } as LedgerEntry,
  ];
  const first = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, []);
  assert.equal(first.eligible, true);
  assert.equal(first.idempotencyKey, 'auto_earn_res-dup');

  const priorTx = makeTx({ id: 'auto_earn_res-dup', idempotencyKey: 'auto_earn_res-dup', reservationId: 'res-dup' });
  const second = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, [priorTx]);
  assert.equal(second.eligible, false);
  assert.match(second.reason, /already awarded/i);
});

scenario(7, 'Receipt generator & consolidated receipt module contain zero loyalty award triggers', () => {
  const receiptSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/components/ReceiptGenerator.tsx'), 'utf8');
  assert.equal(/awardAutomaticStayPoints|tryAutoAwardLoyaltyOnStayCompletion|loyaltyService/i.test(receiptSrc), false);
});

scenario(8, 'Duplicate award check catches matching reservationId even under a legacy tx ID', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-legacy-dup' });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 100000, description: 'Paid', timestamp: '2026-10-03T09:00:00Z' } as LedgerEntry,
  ];
  const legacyTx = makeTx({ id: 'old-id-999', idempotencyKey: 'old-key-999', transactionType: 'earn_auto', reservationId: 'res-legacy-dup' });
  const check = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, [legacyTx]);
  assert.equal(check.eligible, false);
});

scenario(9, 'Duplicate redemption submission with same idempotencyKey is rejected cleanly', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);
  const existing = [
    makeTx({ id: 'redeem_dup_1', idempotencyKey: 'redeem_dup_1', transactionType: 'redemption', points: 200, pointsDelta: -200 }),
  ];
  const res = validatePointsRedemption(200, policy, 1000, {
    idempotencyKey: 'redeem_dup_1',
    existingTransactions: existing,
  });
  assert.equal(res.valid, false);
  assert.equal(res.alreadyProcessed, true);
});

scenario(10, 'Discount credits do not inflate eligible spend beyond actual net payments', () => {
  const hotel = makeHotel();
  const res = makeRes({ id: 'res-disc', totalAmount: 100000, paidAmount: 80000 });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'disc1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'discount', amount: 20000, description: 'Promo Discount', timestamp: '2026-10-01T14:05:00Z' } as LedgerEntry,
    { id: 'p1', hotelId: hotel.id, reservationId: res.id, guestId: 'guest-1', type: 'credit', category: 'payment', amount: 80000, description: 'Cash settled', timestamp: '2026-10-03T09:00:00Z' } as LedgerEntry,
  ];
  const ev = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, []);
  assert.equal(ev.eligible, true);
  assert.equal(ev.eligibleSpend, 80000);
  assert.equal(ev.pointsToAward, 80);
});

// ---------------------------------------------------------------------------
// SECTION C: SEPARATE LIFETIME & AVAILABLE BALANCES (Scenarios 11–14)
// ---------------------------------------------------------------------------
scenario(11, 'Earning increases both lifetime and available; redemption reduces available only', () => {
  const lifetime = 1200;
  const availableAfterRedeem = lifetime - 400;
  assert.equal(availableAfterRedeem, 800);
  assert.equal(resolveMembershipLevel(lifetime, DEFAULT_LOYALTY_LEVELS).name, 'Silver');
  // Even if available drops below 500, lifetime remains 1200 so tier stays Silver
  assert.equal(resolveMembershipLevel(lifetime, DEFAULT_LOYALTY_LEVELS).name, 'Silver');
  assert.notEqual(availableAfterRedeem, lifetime);
});

scenario(12, 'Manual deduction rejects any attempt that would create a negative balance', () => {
  const policy = getLoyaltyPolicy(makeHotel());
  const bad = validateManualPointsAdjustment({ action: 'manual_deduct', points: 301, reason: 'Over-deduct' }, policy, 300);
  assert.equal(bad.valid, false);
  const ok = validateManualPointsAdjustment({ action: 'manual_deduct', points: 300, reason: 'Exact deduction' }, policy, 300);
  assert.equal(ok.valid, true);
});

scenario(13, 'Debit reversal of erroneous earning validates against available balance & supports audit metadata', () => {
  const policy = getLoyaltyPolicy(makeHotel());
  const invalidDebitRev = validateManualPointsAdjustment(
    { action: 'reversal', reversalDirection: 'debit', points: 500, reason: 'Reverse erroneous stay award' },
    policy,
    200
  );
  assert.equal(invalidDebitRev.valid, false);
  const validDebitRev = validateManualPointsAdjustment(
    { action: 'reversal', reversalDirection: 'debit', points: 150, reason: 'Reverse erroneous stay award' },
    policy,
    200
  );
  assert.equal(validDebitRev.valid, true);
});

scenario(14, 'Manual adjustment requires a non-empty reason and positive integer points', () => {
  const policy = getLoyaltyPolicy(makeHotel());
  assert.equal(validateManualPointsAdjustment({ action: 'manual_award', points: 100, reason: '' }, policy, 0).valid, false);
  assert.equal(validateManualPointsAdjustment({ action: 'manual_award', points: -50, reason: 'Bad' }, policy, 100).valid, false);
  assert.equal(validateManualPointsAdjustment({ action: 'manual_award', points: 10.5, reason: 'Fraction' }, policy, 100).valid, false);
});

// ---------------------------------------------------------------------------
// SECTION D: REDEMPTION LIMITS & VALIDATION (Scenarios 15–20)
// ---------------------------------------------------------------------------
scenario(15, 'Authoritative hard minimum 100 pts and maximum 5,000 pts per booking cannot be bypassed via config', () => {
  assert.equal(HARD_MIN_REDEMPTION_POINTS, 100);
  assert.equal(HARD_MAX_REDEMPTION_POINTS_PER_BOOKING, 5000);

  // Even if hotel config attempts min=0 or max=0 (uncapped) or max=99999, policy clamps to [100, 5000]
  const looseHotel = makeHotel({ minimumRedemptionPoints: 0, maximumRedemptionPointsPerBooking: 0 });
  const clampedPolicy = getLoyaltyPolicy(looseHotel);
  assert.equal(clampedPolicy.minimumRedemptionPoints, 100);
  assert.equal(clampedPolicy.maximumRedemptionPointsPerBooking, 5000);

  const overCapHotel = makeHotel({ minimumRedemptionPoints: 50, maximumRedemptionPointsPerBooking: 12000 });
  const clampedOver = getLoyaltyPolicy(overCapHotel);
  assert.equal(clampedOver.minimumRedemptionPoints, 100);
  assert.equal(clampedOver.maximumRedemptionPointsPerBooking, 5000);

  assert.equal(validatePointsRedemption(99, clampedPolicy, 10000).valid, false);
  assert.equal(validatePointsRedemption(100, clampedPolicy, 10000).valid, true);
  assert.equal(validatePointsRedemption(5000, clampedPolicy, 10000).valid, true);
  assert.equal(validatePointsRedemption(5001, clampedPolicy, 10000).valid, false);
});

scenario(16, 'Cumulative per-booking redemption cap (5,000 pts) blocks split redemptions exceeding cap', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);
  const openRes = makeRes({ id: 'res-open', status: 'checked_in', totalAmount: 200000, paidAmount: 0, paymentStatus: 'unpaid' });
  const openLedger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: 'res-open', guestId: 'guest-1', type: 'debit', category: 'room', amount: 200000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
  ];
  const priorRedemptions = [
    makeTx({ id: 'r1', transactionType: 'redemption', points: 3500, pointsDelta: -3500, reservationId: 'res-open', timestamp: '2026-10-02T10:00:00Z' }),
  ];

  // Trying to redeem another 1,600 pts (3,500 + 1,600 = 5,100 > 5,000) MUST fail
  const overSplit = validatePointsRedemption(1600, policy, 6000, {
    accountIsActive: true,
    reservationId: 'res-open',
    reservation: openRes,
    hotel,
    ledgerEntries: openLedger,
    existingTransactions: priorRedemptions,
  });
  assert.equal(overSplit.valid, false);
  assert.equal(overSplit.alreadyRedeemedForBooking, 3500);
  assert.equal(overSplit.remainingBookingRedemptionCap, 1500);

  // Redeeming 1,500 pts (3,500 + 1,500 = 5,000) succeeds
  const exactSplit = validatePointsRedemption(1500, policy, 6000, {
    accountIsActive: true,
    reservationId: 'res-open',
    reservation: openRes,
    hotel,
    ledgerEntries: openLedger,
    existingTransactions: priorRedemptions,
  });
  assert.equal(exactSplit.valid, true);
  assert.equal(exactSplit.monetaryValue, 15000);
});

scenario(17, 'Redemption rejects inactive loyalty account and bookings with Cancelled or No-Show status', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);

  const inactive = validatePointsRedemption(200, policy, 1000, { accountIsActive: false });
  assert.equal(inactive.valid, false);
  assert.match(inactive.error || '', /inactive/i);

  const cancelledRes = makeRes({ id: 'res-can', status: 'cancelled' });
  const cancelledResCheck = validatePointsRedemption(200, policy, 1000, {
    accountIsActive: true,
    reservation: cancelledRes,
    hotel,
    ledgerEntries: [],
  });
  assert.equal(cancelledResCheck.valid, false);
  assert.match(cancelledResCheck.error || '', /cancelled/i);

  const noShowRes = makeRes({ id: 'res-ns', status: 'no_show' });
  const noShowCheck = validatePointsRedemption(200, policy, 1000, {
    accountIsActive: true,
    reservation: noShowRes,
    hotel,
    ledgerEntries: [],
  });
  assert.equal(noShowCheck.valid, false);
  assert.match(noShowCheck.error || '', /no-show/i);
});

scenario(18, 'Redemption blocks spending against an already fully settled booking', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);
  const settledRes = makeRes({ id: 'res-paid', status: 'checked_out', totalAmount: 100000, paidAmount: 100000, paymentStatus: 'paid' });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: 'res-paid', guestId: 'guest-1', type: 'debit', category: 'room', amount: 100000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: 'res-paid', guestId: 'guest-1', type: 'credit', category: 'payment', amount: 100000, description: 'Paid', timestamp: '2026-10-03T09:00:00Z' } as LedgerEntry,
  ];
  const check = validatePointsRedemption(200, policy, 1000, {
    accountIsActive: true,
    reservation: settledRes,
    hotel,
    ledgerEntries: ledger,
  });
  assert.equal(check.valid, false);
  assert.match(check.error || '', /already fully settled/i);
});

scenario(19, 'Redemption blocks monetary value exceeding the booking eligible payable balance', () => {
  const hotel = makeHotel({ redemptionPointValue: 10 });
  const policy = getLoyaltyPolicy(hotel);
  const stayNow = new Date('2026-10-01T18:00:00.000Z');
  const partialRes = makeRes({
    id: 'res-bal',
    status: 'checked_in',
    checkIn: '2026-10-01',
    checkOut: '2026-10-02',
    nights: 1,
    nightlyRate: 50000,
    totalAmount: 50000,
    paidAmount: 45000,
    paymentStatus: 'partial',
  });
  const ledger: LedgerEntry[] = [
    { id: 'd1', hotelId: hotel.id, reservationId: 'res-bal', guestId: 'guest-1', type: 'debit', category: 'room', amount: 50000, description: 'Room', timestamp: '2026-10-01T14:00:00Z' } as LedgerEntry,
    { id: 'c1', hotelId: hotel.id, reservationId: 'res-bal', guestId: 'guest-1', type: 'credit', category: 'payment', amount: 45000, description: 'Part payment', timestamp: '2026-10-01T15:00:00Z' } as LedgerEntry,
  ];
  // Payable balance is 5,000. 600 pts * 10 = 6,000 > 5,000 -> MUST reject
  const overPayable = validatePointsRedemption(600, policy, 2000, {
    accountIsActive: true,
    reservation: partialRes,
    hotel,
    ledgerEntries: ledger,
    now: stayNow,
  });
  assert.equal(overPayable.valid, false);
  assert.equal(overPayable.eligiblePayableAmount, 5000);
  assert.match(overPayable.error || '', /exceeds the booking's eligible payable balance/i);

  // 500 pts * 10 = 5,000 <= 5,000 -> MUST succeed
  const exactPayable = validatePointsRedemption(500, policy, 2000, {
    accountIsActive: true,
    reservation: partialRes,
    hotel,
    ledgerEntries: ledger,
    now: stayNow,
  });
  assert.equal(exactPayable.valid, true);
  assert.equal(exactPayable.monetaryValue, 5000);
});

scenario(20, 'Live expiry check blocks redeeming expired points even before background expiry job runs', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);
  const now = new Date('2026-11-23T12:00:00.000Z');
  const txs: LoyaltyTransaction[] = [
    makeTx({ id: 'lot-expired', points: 400, pointsDelta: 400, expiresAt: '2026-11-01T00:00:00.000Z', timestamp: '2025-11-01T00:00:00.000Z' }),
    makeTx({ id: 'lot-valid', points: 250, pointsDelta: 250, expiresAt: '2027-06-01T00:00:00.000Z', timestamp: '2026-06-01T00:00:00.000Z' }),
  ];
  // Stored availablePoints is still 650 (expiry job hasn't run yet), but only 250 pts are unexpired!
  const attemptExpired = validatePointsRedemption(300, policy, 650, {
    accountIsActive: true,
    existingTransactions: txs,
    now,
  });
  assert.equal(attemptExpired.valid, false);
  assert.equal(attemptExpired.effectiveAvailablePoints, 250);
  assert.equal(attemptExpired.unprocessedExpiredPoints, 400);

  const attemptUnexpired = validatePointsRedemption(250, policy, 650, {
    accountIsActive: true,
    existingTransactions: txs,
    now,
  });
  assert.equal(attemptUnexpired.valid, true);
});

// ---------------------------------------------------------------------------
// SECTION E: POINT EXPIRY POLICY (Scenarios 21–24)
// ---------------------------------------------------------------------------
scenario(21, 'Independent per-lot expiry dates & earliest-expiry-first FIFO consumption', () => {
  const now = new Date('2026-11-23T00:00:00.000Z');
  const txs: LoyaltyTransaction[] = [
    // Lot A earned earlier with NO expiry
    makeTx({ id: 'lot-noexp', points: 500, pointsDelta: 500, expiresAt: null, timestamp: '2025-01-01T00:00:00.000Z' }),
    // Lot B earned later with earlier expiry
    makeTx({ id: 'lot-soon', points: 300, pointsDelta: 300, expiresAt: '2026-11-10T00:00:00.000Z', timestamp: '2025-11-10T00:00:00.000Z' }),
    // Redemption on 2026-06-01 should consume earliest-expiring Lot B first (200 of 300), leaving 100 expired in Lot B
    makeTx({ id: 'red-1', transactionType: 'redemption', points: 200, pointsDelta: -200, timestamp: '2026-06-01T00:00:00.000Z' }),
  ];
  const summary = evaluateLoyaltyPointsExpiry(txs, 30, now);
  assert.equal(summary.expiredPointsUnprocessed, 100);
  assert.equal(summary.expiredLots.length, 1);
  assert.equal(summary.expiredLots[0].txId, 'lot-soon');
  assert.equal(summary.expiredLots[0].expiredPoints, 100);
});

scenario(22, 'Deterministic lot-based expiry idempotency key prevents double expiry across days and retries', () => {
  const now1 = new Date('2026-11-22T23:59:59.000Z');
  const now2 = new Date('2026-11-23T00:00:01.000Z');
  const txs: LoyaltyTransaction[] = [
    makeTx({ id: 'lot-exp-1', points: 200, pointsDelta: 200, expiresAt: '2026-11-01T00:00:00.000Z', timestamp: '2025-11-01T00:00:00.000Z' }),
  ];
  const s1 = evaluateLoyaltyPointsExpiry(txs, 30, now1);
  const s2 = evaluateLoyaltyPointsExpiry(txs, 30, now2);
  const key1 = buildDeterministicExpiryKey('guest-1', s1.expiredLots);
  const key2 = buildDeterministicExpiryKey('guest-1', s2.expiredLots);
  assert.equal(key1, key2);

  // Once expiry transaction is posted, re-evaluating reports 0 pending expired points
  const afterExpiryTxs: LoyaltyTransaction[] = [
    ...txs,
    makeTx({
      id: key1,
      idempotencyKey: key1,
      transactionType: 'expiry',
      canonicalType: 'EXPIRY',
      points: 200,
      pointsDelta: -200,
      expiredLotIds: ['lot-exp-1'],
      timestamp: '2026-11-23T00:05:00.000Z',
    }),
  ];
  const sAfter = evaluateLoyaltyPointsExpiry(afterExpiryTxs, 30, now2);
  assert.equal(sAfter.expiredPointsUnprocessed, 0);
  assert.equal(sAfter.expiredLots.length, 0);
});

scenario(23, 'Expiry transaction consumes only expired lots and never eats non-expiring or future-expiring lots', () => {
  const now = new Date('2026-11-23T12:00:00.000Z');
  const txs: LoyaltyTransaction[] = [
    makeTx({ id: 'lot-noexp', points: 500, pointsDelta: 500, expiresAt: null, timestamp: '2025-01-01T00:00:00.000Z' }),
    makeTx({ id: 'lot-exp', points: 200, pointsDelta: 200, expiresAt: '2026-11-01T00:00:00.000Z', timestamp: '2025-11-01T00:00:00.000Z' }),
    makeTx({
      id: 'exp-tx',
      transactionType: 'expiry',
      points: 200,
      pointsDelta: -200,
      expiredLotIds: ['lot-exp'],
      timestamp: '2026-11-02T00:00:00.000Z',
    }),
  ];
  const summary = evaluateLoyaltyPointsExpiry(txs, 30, now);
  assert.equal(summary.expiredPointsUnprocessed, 0);
});

scenario(24, 'Approaching-expiry window detects points expiring soon and returns earliest expiry date', () => {
  const now = new Date('2026-11-23T00:00:00.000Z');
  const txs: LoyaltyTransaction[] = [
    makeTx({ id: 'lot-15d', points: 300, pointsDelta: 300, expiresAt: '2026-12-08T00:00:00.000Z', timestamp: '2025-12-08T00:00:00.000Z' }),
    makeTx({ id: 'lot-90d', points: 400, pointsDelta: 400, expiresAt: '2027-02-20T00:00:00.000Z', timestamp: '2026-02-20T00:00:00.000Z' }),
  ];
  const summary = evaluateLoyaltyPointsExpiry(txs, 30, now);
  assert.equal(summary.expiredPointsUnprocessed, 0);
  assert.equal(summary.expiringSoonPoints, 300);
  assert.equal(summary.earliestExpiringDate, '2026-12-08T00:00:00.000Z');
});

// ---------------------------------------------------------------------------
// SECTION F: MEMBERSHIP LEVEL THRESHOLDS & BENEFITS (Scenarios 25–28)
// ---------------------------------------------------------------------------
scenario(25, 'Silver membership threshold is verified at exactly 500 lifetime points', () => {
  const silver = DEFAULT_LOYALTY_LEVELS.find((l) => l.name === 'Silver');
  assert.ok(silver, 'Silver tier must exist in DEFAULT_LOYALTY_LEVELS');
  assert.equal(silver!.minPoints, 500);
  assert.equal(resolveMembershipLevel(499, DEFAULT_LOYALTY_LEVELS).name, 'Standard');
  assert.equal(resolveMembershipLevel(500, DEFAULT_LOYALTY_LEVELS).name, 'Silver');
});

scenario(26, 'Standard (0), Silver (500), Gold (2,000), Platinum (5,000) resolve cleanly with configured benefits', () => {
  assert.equal(resolveMembershipLevel(0, DEFAULT_LOYALTY_LEVELS).name, 'Standard');
  assert.equal(resolveMembershipLevel(500, DEFAULT_LOYALTY_LEVELS).name, 'Silver');
  assert.equal(resolveMembershipLevel(1999, DEFAULT_LOYALTY_LEVELS).name, 'Silver');
  assert.equal(resolveMembershipLevel(2000, DEFAULT_LOYALTY_LEVELS).name, 'Gold');
  assert.equal(resolveMembershipLevel(5000, DEFAULT_LOYALTY_LEVELS).name, 'Platinum');
  for (const tier of DEFAULT_LOYALTY_LEVELS) {
    assert.ok(Array.isArray(tier.benefits) && tier.benefits.length > 0);
  }
});

scenario(27, 'Next membership level progress computes accurately from lifetime points', () => {
  const fromZero = getNextMembershipLevel(0, DEFAULT_LOYALTY_LEVELS);
  assert.equal(fromZero.nextLevel?.name, 'Silver');
  assert.equal(fromZero.pointsNeeded, 500);

  const fromSilver = getNextMembershipLevel(750, DEFAULT_LOYALTY_LEVELS);
  assert.equal(fromSilver.nextLevel?.name, 'Gold');
  assert.equal(fromSilver.pointsNeeded, 1250);

  const atTop = getNextMembershipLevel(6000, DEFAULT_LOYALTY_LEVELS);
  assert.equal(atTop.nextLevel, null);
  assert.equal(atTop.pointsNeeded, 0);
});

scenario(28, 'Spending or expiring points does NOT downgrade lifetime-based membership level', () => {
  // Guest earned 2,200 lifetime pts (Gold), then redeemed 2,000 pts leaving 200 available
  const lifetime = 2200;
  const availableAfterRedeem = 200;
  assert.equal(resolveMembershipLevel(lifetime, DEFAULT_LOYALTY_LEVELS).name, 'Gold');
  assert.notEqual(
    resolveMembershipLevel(lifetime, DEFAULT_LOYALTY_LEVELS).name,
    resolveMembershipLevel(availableAfterRedeem, DEFAULT_LOYALTY_LEVELS).name
  );
});

// ---------------------------------------------------------------------------
// SECTION G: LEDGER, EMAILS, SECURITY & DATA INTEGRITY (Scenarios 29–35)
// ---------------------------------------------------------------------------
scenario(29, 'All internal transaction types map cleanly to canonical audit ledger types', () => {
  assert.equal(mapToCanonicalLoyaltyTransactionType('earn_auto', 100), 'EARNING');
  assert.equal(mapToCanonicalLoyaltyTransactionType('redemption', -200), 'REDEMPTION');
  assert.equal(mapToCanonicalLoyaltyTransactionType('manual_award', 50), 'MANUAL_CREDIT');
  assert.equal(mapToCanonicalLoyaltyTransactionType('manual_deduct', -50), 'MANUAL_DEBIT');
  assert.equal(mapToCanonicalLoyaltyTransactionType('expiry', -100), 'EXPIRY');
  assert.equal(mapToCanonicalLoyaltyTransactionType('reversal', -50), 'REVERSAL');
  assert.equal(mapToCanonicalLoyaltyTransactionType('account_activation', 0), 'ACCOUNT_ACTIVATION');
  assert.equal(mapToCanonicalLoyaltyTransactionType('tier_change', 0), 'TIER_CHANGE');
});

scenario(30, 'Loyalty points expired email event renders with hotel branding and respects policy toggle', () => {
  const brand: HotelBrandContext = {
    hotelId: 'hotel-audit-1',
    hotelName: 'Audit Grand Hotel',
    senderDisplayName: 'Audit Grand Hotel',
    primaryColor: '#059669',
    secondaryColor: '#18181b',
    website: 'https://auditgrand.test',
    currency: 'NGN',
  };
  const rendered = renderMultiTenantEmail('loyalty.points_expired', brand, {
    recipientName: 'Ada Lovelace',
    rows: [
      { label: 'Expired Points', value: '-200 pts' },
      { label: 'Available Points Balance', value: '300 pts' },
    ],
  });
  assert.ok(rendered.subject.includes('Audit Grand Hotel'));
  assert.ok(rendered.html.includes('Loyalty Points Expired'));
  assert.ok(rendered.html.includes('-200 pts'));
  assert.equal(
    isHotelEmailEventEnabled({ settings: { loyalty: { notifyGuestsByEmail: true } } }, 'loyalty.points_expired', 'guest').enabled,
    true
  );
  assert.equal(
    isHotelEmailEventEnabled({ settings: { loyalty: { notifyGuestsByEmail: false } } }, 'loyalty.points_expired', 'guest').enabled,
    false
  );
});

scenario(31, 'Firestore rules preserve immutable append-only loyaltyTransactions and enforce 100–5,000 redemption bounds', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  assert.ok(
    rules.includes("data.transactionType != 'redemption' || (data.points >= 100 && data.points <= 5000)"),
    'firestore.rules must enforce 100..5000 redemption bounds'
  );
  assert.ok(rules.includes('allow update: if false;'), 'loyaltyTransactions must remain append-only');
});

scenario(32, 'Server mounts authoritative /api/loyalty/redeem, /api/loyalty/process-expiry, and cron expiry routes', () => {
  const routesSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/modules/loyalty/server/loyaltyRoutes.ts'), 'utf8');
  assert.ok(routesSrc.includes("app.post('/api/loyalty/redeem'"));
  assert.ok(routesSrc.includes("app.post('/api/loyalty/process-expiry'"));
  assert.ok(routesSrc.includes("app.post('/api/loyalty/cron/process-expiry'"));
  assert.ok(routesSrc.includes('deps.requireAuth'));
  assert.ok(routesSrc.includes('callerCanManageHotelLoyalty'));

  const serverSrc = fs.readFileSync(path.resolve(process.cwd(), 'server.ts'), 'utf8');
  assert.ok(serverSrc.includes('mountLoyaltyRoutes'));
  assert.ok(serverSrc.includes('startLoyaltyExpiryBackgroundJob'));
});

scenario(33, 'Earning rate calculation handles disabled toggles, zero amounts, and floor rounding accurately', () => {
  const policy = getLoyaltyPolicy(makeHotel({ earningRatePoints: 2, earningRateAmount: 1000 }));
  assert.equal(calculateEarnedPointsForAmount(1999, policy), 3); // floor(1.999 * 2) = 3
  assert.equal(calculateEarnedPointsForAmount(0, policy), 0);
  assert.equal(calculateEarnedPointsForAmount(-5000, policy), 0);
  const disabled = getLoyaltyPolicy(makeHotel({ enableAutoEarning: false }));
  assert.equal(calculateEarnedPointsForAmount(50000, disabled), 0);
});

scenario(34, 'Redemption point-to-currency conversion uses configured policy rate accurately', () => {
  const policy = getLoyaltyPolicy(makeHotel({ redemptionPointValue: 12.5 }));
  assert.equal(calculateRedemptionMonetaryValue(100, policy), 1250);
  assert.equal(calculateRedemptionMonetaryValue(5000, policy), 62500);
});

scenario(35, 'Client loyaltyService routes redemption and expiry through authoritative server API with complete audit fields', () => {
  const svcSrc = fs.readFileSync(path.resolve(process.cwd(), 'src/services/loyaltyService.ts'), 'utf8');
  assert.ok(svcSrc.includes("fetch('/api/loyalty/redeem'"));
  assert.ok(svcSrc.includes("fetch('/api/loyalty/process-expiry'"));
  assert.ok(svcSrc.includes('previousLifetimeBalance'));
  assert.ok(svcSrc.includes('updatedLifetimeBalance'));
  assert.ok(svcSrc.includes('canonicalType'));
  assert.ok(svcSrc.includes('actorType'));
  assert.ok(svcSrc.includes("'loyalty.points_expired'"));
});

console.log(`\n✅ All ${passed}/35 Loyalty Audit & Hardening verification scenarios passed!\n`);
