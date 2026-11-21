import assert from 'node:assert/strict';
import {
  calculateEarnedPointsForAmount,
  calculateRedemptionMonetaryValue,
  canManageLoyalty,
  canViewLoyalty,
  evaluateLoyaltyPointsExpiry,
  evaluateStayEligibilityForAutoEarn,
  getLoyaltyPolicy,
  getNextMembershipLevel,
  resolveMembershipLevel,
  validateManualPointsAdjustment,
  validatePointsRedemption,
} from '../services/loyaltyService';
import {
  isHotelEmailEventEnabled,
  renderMultiTenantEmail,
  HotelBrandContext,
  MultiTenantEmailEventType,
} from '../services/multiTenantEmailService';
import { DEFAULT_LOYALTY_LEVELS, DEFAULT_SETTINGS } from '../constants';
import { SYSTEM_ROLE_TEMPLATES, hasPermission } from '../utils/permissions';
import { calculateReservationAccount } from '../utils/financialUtils';
import { Hotel, LedgerEntry, LoyaltyMembershipLevel, LoyaltyTransaction, Reservation, UserProfile } from '../types';

function createHotel(loyaltyOverrides: Partial<NonNullable<Hotel['settings']>['loyalty']> = {}): Hotel {
  return {
    id: 'hotel-tide-1',
    name: 'Tide Grand Hotel',
    email: 'frontdesk@tidehotel.com',
    defaultCurrency: 'NGN',
    taxes: [],
    defaultCheckInTime: '14:00',
    defaultCheckOutTime: '12:00',
    settings: {
      ...DEFAULT_SETTINGS,
      loyalty: {
        ...DEFAULT_SETTINGS.loyalty!,
        ...loyaltyOverrides,
      },
    },
  } as unknown as Hotel;
}

function createUser(role: UserProfile['role'], extra: Partial<UserProfile> = {}): UserProfile {
  return {
    uid: `uid-${role}`,
    email: `${role}@tidehotel.com`,
    displayName: `Test ${role}`,
    role,
    hotelId: 'hotel-tide-1',
    status: 'active',
    ...extra,
  } as UserProfile;
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log('\n=== Guest Loyalty & Rewards Verification Suite ===\n');

// 1. Default policy is safely disabled and non-intrusive
test('1. Default loyalty policy is disabled and safe on legacy hotels without loyalty config', () => {
  const legacyHotel = { id: 'legacy-1', name: 'Legacy Inn', settings: {} } as unknown as Hotel;
  const policy = getLoyaltyPolicy(legacyHotel);
  assert.equal(policy.enabled, false);
  assert.equal(policy.allowManualAllocation, false);
  assert.equal(policy.enableAutoEarning, false);
  assert.equal(policy.enableRedemption, false);
  assert.equal(policy.notifyGuestsByEmail, true);
  assert.equal(policy.membershipLevels.length, DEFAULT_LOYALTY_LEVELS.length);
});

// 2. Dynamic admin-configured membership levels (zero hardcoded tier assignment)
test('2. Membership levels resolve dynamically from admin-configured thresholds', () => {
  const customLevels: LoyaltyMembershipLevel[] = [
    { id: 't1', name: 'Explorer', minPoints: 0, benefits: ['Welcome water'] },
    { id: 't2', name: 'Voyager', minPoints: 250, benefits: ['Late checkout'] },
    { id: 't3', name: 'Ambassador', minPoints: 1200, benefits: ['Suite upgrade', 'Airport transfer'] },
  ];
  assert.equal(resolveMembershipLevel(0, customLevels).name, 'Explorer');
  assert.equal(resolveMembershipLevel(249, customLevels).name, 'Explorer');
  assert.equal(resolveMembershipLevel(250, customLevels).name, 'Voyager');
  assert.equal(resolveMembershipLevel(1500, customLevels).name, 'Ambassador');

  const next = getNextMembershipLevel(400, customLevels);
  assert.equal(next.nextLevel?.name, 'Ambassador');
  assert.equal(next.pointsNeeded, 800);

  const top = getNextMembershipLevel(1500, customLevels);
  assert.equal(top.nextLevel, null);
  assert.equal(top.pointsNeeded, 0);
});

// 3. Manual points allocation validation
test('3. Manual points award enforces policy toggles, integer points, and mandatory reason', () => {
  const disabledPolicy = getLoyaltyPolicy(createHotel({ enabled: false, allowManualAllocation: false }));
  assert.equal(
    validateManualPointsAdjustment({ action: 'manual_award', points: 100, reason: 'VIP bonus' }, disabledPolicy, 0).valid,
    false
  );

  const enabledPolicy = getLoyaltyPolicy(createHotel({ enabled: true, allowManualAllocation: true }));
  assert.equal(
    validateManualPointsAdjustment({ action: 'manual_award', points: 100, reason: 'VIP bonus' }, enabledPolicy, 0).valid,
    true
  );
  assert.equal(
    validateManualPointsAdjustment({ action: 'manual_award', points: 0, reason: 'Zero' }, enabledPolicy, 0).valid,
    false
  );
  assert.equal(
    validateManualPointsAdjustment({ action: 'manual_award', points: 12.5, reason: 'Decimal' }, enabledPolicy, 0).valid,
    false
  );
  assert.equal(
    validateManualPointsAdjustment({ action: 'manual_award', points: 50, reason: '   ' }, enabledPolicy, 0).valid,
    false
  );
});

// 4. Manual points deduction rejects over-balance deductions (no negative balances)
test('4. Manual points deduction blocks deductions exceeding available balance', () => {
  const policy = getLoyaltyPolicy(createHotel({ enabled: true, allowManualAllocation: true }));
  const validDeduct = validateManualPointsAdjustment(
    { action: 'manual_deduct', points: 150, reason: 'Correction of prior manual entry' },
    policy,
    200
  );
  assert.equal(validDeduct.valid, true);

  const overDeduct = validateManualPointsAdjustment(
    { action: 'manual_deduct', points: 201, reason: 'Over-deduct attempt' },
    policy,
    200
  );
  assert.equal(overDeduct.valid, false);
  assert.match(overDeduct.error || '', /exceeds available balance/i);
});

// 5. Reversal adjustment validation
test('5. Reversal adjustment passes validation with reason and positive integer points', () => {
  const policy = getLoyaltyPolicy(createHotel({ enabled: true, allowManualAllocation: true }));
  const res = validateManualPointsAdjustment(
    { action: 'reversal', points: 75, reason: 'Reversing accidental deduction tx_123' },
    policy,
    0
  );
  assert.equal(res.valid, true);
});

// 6. Automatic earning on completed & settled stay + deterministic idempotency duplicate protection
test('6. Automatic earning awards configured points for completed settled stay and prevents duplicates', () => {
  const hotel = createHotel({
    enabled: true,
    enableAutoEarning: true,
    earningRatePoints: 1,
    earningRateAmount: 1000,
  });

  const settledStay: Reservation = {
    id: 'res-settled-1',
    hotelId: hotel.id,
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
  } as unknown as Reservation;

  const ledger: LedgerEntry[] = [
    {
      id: 'l1',
      hotelId: hotel.id,
      reservationId: 'res-settled-1',
      guestId: 'guest-1',
      type: 'debit',
      category: 'room',
      amount: 100000,
      description: 'Room charges (2 nights)',
      timestamp: '2026-10-01T14:00:00.000Z',
    } as LedgerEntry,
    {
      id: 'l2',
      hotelId: hotel.id,
      reservationId: 'res-settled-1',
      guestId: 'guest-1',
      type: 'credit',
      category: 'payment',
      amount: 100000,
      description: 'Card settlement',
      timestamp: '2026-10-03T10:00:00.000Z',
    } as LedgerEntry,
  ];

  const eval1 = evaluateStayEligibilityForAutoEarn(settledStay, hotel, ledger, []);
  assert.equal(eval1.eligible, true);
  assert.equal(eval1.eligibleSpend, 100000);
  assert.equal(eval1.pointsToAward, 100);
  assert.equal(eval1.idempotencyKey, 'auto_earn_res-settled-1');

  // Duplicate attempt with existing transaction having same idempotencyKey must be rejected
  const existingTx: LoyaltyTransaction = {
    id: 'auto_earn_res-settled-1',
    hotelId: hotel.id,
    guestId: 'guest-1',
    guestName: 'Ada Lovelace',
    transactionType: 'earn_auto',
    points: 100,
    pointsDelta: 100,
    previousBalance: 0,
    updatedBalance: 100,
    reason: 'Automatic stay points earned',
    adminId: 'admin-1',
    adminName: 'Hotel Admin',
    reservationId: 'res-settled-1',
    idempotencyKey: 'auto_earn_res-settled-1',
    timestamp: '2026-10-03T11:00:00.000Z',
    createdAt: '2026-10-03T11:00:00.000Z',
  };
  const eval2 = evaluateStayEligibilityForAutoEarn(settledStay, hotel, ledger, [existingTx]);
  assert.equal(eval2.eligible, false);
  assert.match(eval2.reason, /already awarded/i);
});

// 7. No-Show reservations NEVER earn automatic points (and financial classification remains intact)
test('7. No-Show reservations are strictly excluded from automatic points and show 0 balance without penalty', () => {
  const hotel = createHotel({ enabled: true, enableAutoEarning: true, earningRatePoints: 2, earningRateAmount: 1000 });
  const noShowRes: Reservation = {
    id: 'res-noshow-1',
    hotelId: hotel.id,
    guestId: 'guest-2',
    guestName: 'IFS Guest',
    roomId: 'room-209',
    roomNumber: '209',
    checkIn: '2026-11-20',
    checkOut: '2026-11-21',
    nights: 1,
    totalAmount: 141500,
    paidAmount: 0,
    status: 'no_show',
    paymentStatus: 'unpaid',
  } as unknown as Reservation;

  const evalNoShow = evaluateStayEligibilityForAutoEarn(noShowRes, hotel, [], []);
  assert.equal(evalNoShow.eligible, false);
  assert.equal(evalNoShow.pointsToAward, 0);
  assert.match(evalNoShow.reason, /no-show/i);

  // Confirm existing No-Show financial classification untouched
  const finAccount = calculateReservationAccount(noShowRes, hotel, []);
  assert.equal(finAccount.totalCharges, 0);
  assert.equal(finAccount.outstandingBalance, 0);
});

// 8. Cancelled reservations NEVER earn automatic points
test('8. Cancelled reservations are strictly excluded from automatic points', () => {
  const hotel = createHotel({ enabled: true, enableAutoEarning: true });
  const cancelledRes: Reservation = {
    id: 'res-cancelled-1',
    hotelId: hotel.id,
    guestId: 'guest-3',
    guestName: 'Cancelled Guest',
    roomNumber: '305',
    checkIn: '2026-11-10',
    checkOut: '2026-11-12',
    nights: 2,
    totalAmount: 80000,
    paidAmount: 0,
    status: 'cancelled',
    paymentStatus: 'unpaid',
  } as unknown as Reservation;

  const evalCancelled = evaluateStayEligibilityForAutoEarn(cancelledRes, hotel, [], []);
  assert.equal(evalCancelled.eligible, false);
  assert.match(evalCancelled.reason, /cancelled/i);
});

// 9. Unpaid / active / checked-in stays NEVER earn automatic points
test('9. Unpaid checked-out stays and active checked-in stays are excluded from automatic points', () => {
  const hotel = createHotel({ enabled: true, enableAutoEarning: true });
  const unpaidCheckedOut: Reservation = {
    id: 'res-unpaid-1',
    hotelId: hotel.id,
    guestId: 'guest-4',
    roomNumber: '104',
    checkIn: '2026-10-01',
    checkOut: '2026-10-02',
    nights: 1,
    totalAmount: 50000,
    paidAmount: 10000,
    status: 'checked_out',
    paymentStatus: 'partial',
  } as unknown as Reservation;

  const ledger: LedgerEntry[] = [
    {
      id: 'lu1',
      hotelId: hotel.id,
      reservationId: 'res-unpaid-1',
      guestId: 'guest-4',
      type: 'debit',
      category: 'room',
      amount: 50000,
      description: 'Room charge',
      timestamp: '2026-10-01T12:00:00.000Z',
    } as LedgerEntry,
    {
      id: 'lu2',
      hotelId: hotel.id,
      reservationId: 'res-unpaid-1',
      guestId: 'guest-4',
      type: 'credit',
      category: 'payment',
      amount: 10000,
      description: 'Partial payment',
      timestamp: '2026-10-01T13:00:00.000Z',
    } as LedgerEntry,
  ];

  const evalUnpaid = evaluateStayEligibilityForAutoEarn(unpaidCheckedOut, hotel, ledger, []);
  assert.equal(evalUnpaid.eligible, false);
  assert.match(evalUnpaid.reason, /unpaid|outstanding/i);

  const activeStay = { ...unpaidCheckedOut, id: 'res-active-1', status: 'checked_in' } as Reservation;
  const evalActive = evaluateStayEligibilityForAutoEarn(activeStay, hotel, [], []);
  assert.equal(evalActive.eligible, false);
  assert.match(evalActive.reason, /checked-out/i);
});

// 10. Redemption policy bounds (min, max, balance, monetary conversion)
test('10. Point redemption enforces enabled toggle, min/max bounds, balance cap, and monetary value', () => {
  const policy = getLoyaltyPolicy(
    createHotel({
      enabled: true,
      enableRedemption: true,
      redemptionPointValue: 10,
      minimumRedemptionPoints: 100,
      maximumRedemptionPointsPerBooking: 500,
    })
  );

  // Below min
  assert.equal(validatePointsRedemption(50, policy, 1000).valid, false);
  // Above max per booking
  assert.equal(validatePointsRedemption(600, policy, 1000).valid, false);
  // Exceeds available balance
  assert.equal(validatePointsRedemption(300, policy, 250).valid, false);
  // Valid redemption
  const ok = validatePointsRedemption(250, policy, 400);
  assert.equal(ok.valid, true);
  assert.equal(ok.monetaryValue, 2500);
  assert.equal(calculateRedemptionMonetaryValue(250, policy), 2500);
});

// 11. FIFO points expiry & approaching-expiry window detection
test('11. FIFO points expiry accurately separates already-expired and approaching-expiry balances', () => {
  const now = new Date('2026-11-21T12:00:00.000Z');
  const txs: LoyaltyTransaction[] = [
    {
      id: 'tx1',
      hotelId: 'h1',
      guestId: 'g1',
      guestName: 'Guest',
      transactionType: 'manual_award',
      points: 300,
      pointsDelta: 300,
      previousBalance: 0,
      updatedBalance: 300,
      reason: 'Lot 1 (expired)',
      adminId: 'admin-1',
      adminName: 'Hotel Admin',
      expiresAt: '2026-11-01T00:00:00.000Z',
      idempotencyKey: 'tx1',
      timestamp: '2026-01-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    },
    {
      id: 'tx2',
      hotelId: 'h1',
      guestId: 'g1',
      guestName: 'Guest',
      transactionType: 'manual_award',
      points: 400,
      pointsDelta: 400,
      previousBalance: 300,
      updatedBalance: 700,
      reason: 'Lot 2 (expiring in 10 days)',
      adminId: 'admin-1',
      adminName: 'Hotel Admin',
      expiresAt: '2026-12-01T00:00:00.000Z',
      idempotencyKey: 'tx2',
      timestamp: '2026-06-01T00:00:00.000Z',
      createdAt: '2026-06-01T00:00:00.000Z',
    },
    {
      id: 'tx3',
      hotelId: 'h1',
      guestId: 'g1',
      guestName: 'Guest',
      transactionType: 'redemption',
      points: 100,
      pointsDelta: -100,
      previousBalance: 700,
      updatedBalance: 600,
      reason: 'FIFO consumes 100 from Lot 1',
      adminId: 'admin-1',
      adminName: 'Hotel Admin',
      idempotencyKey: 'tx3',
      timestamp: '2026-08-01T00:00:00.000Z',
      createdAt: '2026-08-01T00:00:00.000Z',
    },
  ];

  const summary = evaluateLoyaltyPointsExpiry(txs, 30, now);
  assert.equal(summary.expiredPointsUnprocessed, 200); // 300 - 100 consumed
  assert.equal(summary.expiringSoonPoints, 400);
  assert.equal(summary.earliestExpiringDate, '2026-12-01T00:00:00.000Z');
});

// 12. Earning rate math edge cases
test('12. Earning rate calculation floors points safely and returns 0 when auto-earning disabled', () => {
  const enabled = getLoyaltyPolicy(
    createHotel({ enabled: true, enableAutoEarning: true, earningRatePoints: 3, earningRateAmount: 1000 })
  );
  assert.equal(calculateEarnedPointsForAmount(2500, enabled), 7); // floor(2.5 * 3) = 7
  assert.equal(calculateEarnedPointsForAmount(0, enabled), 0);

  const disabled = getLoyaltyPolicy(
    createHotel({ enabled: true, enableAutoEarning: false, earningRatePoints: 3, earningRateAmount: 1000 })
  );
  assert.equal(calculateEarnedPointsForAmount(2500, disabled), 0);
});

// 13. RBAC isolation — no existing non-admin roles automatically receive manage_loyalty
test('13. RBAC preserves strict permission boundaries without auto-granting loyalty rights to non-admin roles', () => {
  assert.equal(canManageLoyalty(createUser('superAdmin')), true);
  assert.equal(canManageLoyalty(createUser('hotelAdmin')), true);

  // Verify SYSTEM_ROLE_TEMPLATES do NOT automatically include manage_loyalty or view_loyalty
  for (const [templateName, tpl] of Object.entries(SYSTEM_ROLE_TEMPLATES)) {
    const perms = tpl.permissions || [];
    assert.equal(
      perms.includes('manage_loyalty'),
      false,
      `Role template ${templateName} must not auto-grant manage_loyalty`
    );
    assert.equal(
      perms.includes('view_loyalty'),
      false,
      `Role template ${templateName} must not auto-grant view_loyalty`
    );
  }

  // Standard staff without explicit manage_loyalty cannot manage loyalty
  const frontDeskUser = createUser('staff', { staffRole: 'frontDesk' });
  assert.equal(canManageLoyalty(frontDeskUser), false);
  assert.equal(hasPermission(frontDeskUser, 'manage_loyalty'), false);

  // Suspended admin cannot manage loyalty
  const suspendedAdmin = createUser('hotelAdmin', { status: 'suspended' });
  assert.equal(canManageLoyalty(suspendedAdmin), false);
  assert.equal(canViewLoyalty(suspendedAdmin), false);

  // Custom role explicitly granted manage_loyalty CAN manage loyalty
  const customRoles = [{ id: 'role-loyalty-mgr', name: 'Loyalty Lead', permissions: ['view_loyalty', 'manage_loyalty'] }];
  const delegatedUser = createUser('staff', { customRoleId: 'role-loyalty-mgr' });
  assert.equal(canManageLoyalty(delegatedUser, customRoles), true);
  assert.equal(canViewLoyalty(delegatedUser, customRoles), true);
});

// 14. Existing multi-tenant email service supports all 6 loyalty events with hotel branding & toggle enforcement
test('14. Multi-tenant email service renders all 6 loyalty event types with hotel branding and respects policy toggle', () => {
  const brandA: HotelBrandContext = {
    hotelId: 'hotel-a',
    hotelName: 'Oceanview Suites',
    senderDisplayName: 'Oceanview Suites',
    primaryColor: '#0f766e',
    secondaryColor: '#134e4a',
    supportEmail: 'concierge@oceanview.test',
    website: 'https://oceanview.test',
    currency: 'NGN',
  };
  const brandB: HotelBrandContext = {
    hotelId: 'hotel-b',
    hotelName: 'Savanna Palace',
    senderDisplayName: 'Savanna Palace',
    primaryColor: '#b45309',
    secondaryColor: '#78350f',
    supportEmail: 'care@savannapalace.test',
    website: 'https://savannapalace.test',
    currency: 'USD',
  };

  const loyaltyEvents: MultiTenantEmailEventType[] = [
    'loyalty.account_activated',
    'loyalty.points_awarded',
    'loyalty.points_deducted',
    'loyalty.points_redeemed',
    'loyalty.tier_upgraded',
    'loyalty.points_expiring',
  ];

  for (const evt of loyaltyEvents) {
    const renderedA = renderMultiTenantEmail(evt, brandA, {
      recipientName: 'Ada Lovelace',
      rows: [
        { label: 'Points', value: '+250 pts' },
        { label: 'Updated Balance', value: '1,250 pts' },
        { label: 'Membership Level', value: 'Gold' },
      ],
    });
    assert.ok(renderedA.subject.includes('Oceanview Suites'), `Subject missing hotel name for ${evt}`);
    assert.ok(renderedA.html.includes('Oceanview Suites'), `HTML missing hotel name for ${evt}`);
    assert.ok(!renderedA.html.includes('Savanna Palace'), `Tenant leakage detected for ${evt}`);
    assert.ok(renderedA.html.includes('1,250 pts'), `Balance missing in HTML for ${evt}`);

    const renderedB = renderMultiTenantEmail(evt, brandB, {
      recipientName: 'Alan Turing',
      rows: [{ label: 'Updated Balance', value: '500 pts' }],
    });
    assert.ok(renderedB.subject.includes('Savanna Palace'), `Brand B subject missing for ${evt}`);
    assert.ok(!renderedB.html.includes('Oceanview Suites'), `Tenant leakage into Brand B for ${evt}`);

    // Policy toggle check
    assert.equal(isHotelEmailEventEnabled({ settings: { loyalty: { notifyGuestsByEmail: true } } }, evt, 'guest').enabled, true);
    assert.equal(isHotelEmailEventEnabled({ settings: { loyalty: { notifyGuestsByEmail: false } } }, evt, 'guest').enabled, false);
  }
});

console.log(`\n✅ All ${passed} Loyalty & Rewards verification tests passed!\n`);
