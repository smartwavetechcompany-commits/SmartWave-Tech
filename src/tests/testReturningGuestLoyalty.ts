import assert from 'node:assert/strict';
import {
  buildMissingGuestFieldUpdates,
  findReturningGuestMatch,
  normalizeGuestEmail,
  normalizeGuestName,
  normalizeIdNumber,
  phonesMatch,
} from '../utils/guestMatchingUtils';
import {
  evaluateStayEligibilityForAutoEarn,
  resolveMembershipLevel,
  validatePointsRedemption,
  getLoyaltyPolicy,
} from '../services/loyaltyService';
import { DEFAULT_SETTINGS } from '../constants';
import { Guest, Hotel, LedgerEntry, LoyaltyAccount, LoyaltyTransaction, Reservation } from '../types';

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function makeGuest(overrides: Partial<Guest> & { id: string; name: string }): Guest {
  return {
    email: '',
    phone: '',
    totalStays: 1,
    totalNights: 2,
    totalSpent: 100000,
    ledgerBalance: 0,
    createdAt: '2026-01-10T10:00:00.000Z',
    ...overrides,
  } as Guest;
}

function makeHotel(): Hotel {
  return {
    id: 'hotel-returning-test',
    name: 'Emerald Crown Hotel',
    email: 'desk@emeraldcrown.com',
    defaultCurrency: 'NGN',
    taxes: [],
    defaultCheckInTime: '14:00',
    defaultCheckOutTime: '12:00',
    settings: {
      ...DEFAULT_SETTINGS,
      loyalty: {
        ...DEFAULT_SETTINGS.loyalty!,
        enabled: true,
        enableAutoEarning: true,
        enableRedemption: true,
        earningRateAmount: 1000,
        earningRatePoints: 10, // 10 pts per 1,000 NGN
        minimumRedemptionPoints: 100,
        maximumRedemptionPointsPerBooking: 5000,
        pointsExpiryEnabled: false,
      },
    },
  } as unknown as Hotel;
}

console.log('\n=== Returning Guest Detection & Continuous Loyalty Accumulation Tests ===\n');

test('1. Phone matching handles international, local leading-zero, dashes, and spaces', () => {
  assert.equal(phonesMatch('+234 801 234 5678', '08012345678'), true);
  assert.equal(phonesMatch('2348012345678', '0801-234-5678'), true);
  assert.equal(phonesMatch('(801) 234-5678', '+2348012345678'), true);
  assert.equal(phonesMatch('08012345678', '08099999999'), false);
  assert.equal(phonesMatch('12345', '12345'), false); // Too short (< 7 digits)
});

test('2. Email, ID number, and name normalizers handle casing and punctuation', () => {
  assert.equal(normalizeGuestEmail('  Ada.Okafor@Example.COM '), 'ada.okafor@example.com');
  assert.equal(normalizeGuestEmail('not-an-email'), '');
  assert.equal(normalizeIdNumber('A-0987 6543'), 'a09876543');
  assert.equal(normalizeIdNumber('N/A'), '');
  assert.equal(normalizeGuestName('  Chinedu   Eze  '), 'chinedu eze');
});

test('3. Detects returning guest by formatted phone variation even if name differs slightly', () => {
  const existing = [
    makeGuest({
      id: 'guest-ada',
      name: 'Adaeze Okafor',
      email: 'adaeze@example.com',
      phone: '+234 803 555 1234',
      totalStays: 3,
    }),
  ];

  const match = findReturningGuestMatch(
    { name: 'Ada Okafor', phone: '0803-555-1234' },
    existing
  );
  assert.ok(match);
  assert.equal(match.guest.id, 'guest-ada');
  assert.equal(match.confidence, 'high');
  assert.ok(match.matchReasons.includes('Phone'));
});

test('4. Detects returning guest by case-insensitive email or government ID number', () => {
  const existing = [
    makeGuest({
      id: 'guest-musa',
      name: 'Musa Ibrahim',
      email: 'Musa.Ibrahim@Corp.ng',
      phone: '08021112222',
      idNumber: 'NIN-4455-6677',
    }),
  ];

  const byEmail = findReturningGuestMatch(
    { name: 'M. Ibrahim', email: '  musa.ibrahim@corp.ng ' },
    existing
  );
  assert.ok(byEmail);
  assert.equal(byEmail.guest.id, 'guest-musa');
  assert.ok(byEmail.matchReasons.includes('Email'));

  const byId = findReturningGuestMatch(
    { name: 'Musa I.', idNumber: 'nin44556677' },
    existing
  );
  assert.ok(byId);
  assert.equal(byId.guest.id, 'guest-musa');
  assert.ok(byId.matchReasons.includes('ID Number'));
});

test('5. Detects swapped multi-word name when no conflicting contact info, but blocks false merges on conflicting phone/email', () => {
  const existing = [
    makeGuest({
      id: 'guest-john',
      name: 'John Adeyemi',
      email: 'john.adeyemi@mail.com',
      phone: '08031234567',
    }),
  ];

  // Reordered name without conflicting email/phone -> matches
  const swapped = findReturningGuestMatch({ name: 'Adeyemi   John' }, existing);
  assert.ok(swapped);
  assert.equal(swapped.guest.id, 'guest-john');

  // Same name, DIFFERENT email -> MUST NOT merge two different people
  const conflictEmail = findReturningGuestMatch(
    { name: 'John Adeyemi', email: 'other.john@mail.com' },
    existing
  );
  assert.equal(conflictEmail, null);

  // Same name, DIFFERENT phone -> MUST NOT merge two different people
  const conflictPhone = findReturningGuestMatch(
    { name: 'John Adeyemi', phone: '08098887777' },
    existing
  );
  assert.equal(conflictPhone, null);
});

test('6. Tie-breaker prefers existing guest account holding unredeemed loyalty points', () => {
  const dupZeroPoints = makeGuest({
    id: 'guest-dup-new',
    name: 'Tunde Bakare',
    email: 'tunde@example.com',
    phone: '08051112233',
    totalStays: 1,
    createdAt: '2026-06-01T10:00:00.000Z',
  });
  const canonicalWithPoints = makeGuest({
    id: 'guest-canonical',
    name: 'Tunde Bakare',
    email: 'tunde@example.com',
    phone: '+234 805 111 2233',
    totalStays: 4,
    createdAt: '2026-01-15T10:00:00.000Z',
  });

  const loyaltyMap: Record<string, LoyaltyAccount> = {
    'guest-canonical': {
      id: 'guest-canonical',
      hotelId: 'hotel-returning-test',
      guestId: 'guest-canonical',
      guestName: 'Tunde Bakare',
      availablePoints: 1450,
      lifetimePointsEarned: 1450,
      totalPointsRedeemed: 0,
      totalPointsManuallyAdjusted: 0,
      totalPointsExpired: 0,
      membershipLevelId: 'silver',
      membershipLevelName: 'Silver',
      isActive: true,
      activatedAt: '2026-01-15T10:00:00.000Z',
      lastActivityAt: '2026-05-01T10:00:00.000Z',
      createdAt: '2026-01-15T10:00:00.000Z',
      updatedAt: '2026-05-01T10:00:00.000Z',
    },
  };

  const match = findReturningGuestMatch(
    { name: 'Tunde Bakare', phone: '08051112233', email: 'TUNDE@example.com' },
    [dupZeroPoints, canonicalWithPoints],
    loyaltyMap
  );

  assert.ok(match);
  assert.equal(match.guest.id, 'guest-canonical');
  assert.equal(match.loyaltyAccount?.availablePoints, 1450);
});

test('7. buildMissingGuestFieldUpdates only fills blank fields and never overwrites existing values', () => {
  const existing = makeGuest({
    id: 'guest-1',
    name: 'Ngozi Nwosu',
    email: 'ngozi@original.com',
    phone: '',
    idNumber: '',
  });

  const updates = buildMissingGuestFieldUpdates(existing, {
    email: 'ngozi@different.com',
    phone: '+234 809 000 1111',
    idType: 'Passport',
    idNumber: 'P9876543',
    address: '14 Victoria Island, Lagos',
  });

  assert.equal(updates.email, undefined); // Must preserve original email
  assert.equal(updates.phone, '+234 809 000 1111');
  assert.equal(updates.idType, 'Passport');
  assert.equal(updates.idNumber, 'P9876543');
  assert.equal(updates.address, '14 Victoria Island, Lagos');
});

test('8. Multi-stay returning guest unredeemed loyalty points keep accumulating until redeemed', () => {
  const hotel = makeHotel();
  const policy = getLoyaltyPolicy(hotel);
  const existingGuests: Guest[] = [
    makeGuest({
      id: 'guest-returning-vip',
      name: 'Kemi Balogun',
      email: 'kemi.balogun@example.com',
      phone: '+234 802 333 4444',
      totalStays: 1,
    }),
  ];

  // Track cumulative account balance and transaction history across returning visits
  const accountState = { availablePoints: 0, lifetimeEarned: 0 };
  const txHistory: LoyaltyTransaction[] = [];

  const simulateSettledStay = (resId: string, stayTotal: number, incomingContact: { name: string; phone?: string; email?: string }) => {
    // Returning guest detection links every returning stay to the exact same guest account
    const loyaltyMap: Record<string, LoyaltyAccount> =
      accountState.lifetimeEarned > 0
        ? {
            'guest-returning-vip': {
              id: 'guest-returning-vip',
              hotelId: hotel.id,
              guestId: 'guest-returning-vip',
              guestName: 'Kemi Balogun',
              availablePoints: accountState.availablePoints,
              lifetimePointsEarned: accountState.lifetimeEarned,
              totalPointsRedeemed: accountState.lifetimeEarned - accountState.availablePoints,
              totalPointsManuallyAdjusted: 0,
              totalPointsExpired: 0,
              membershipLevelId: resolveMembershipLevel(accountState.lifetimeEarned, policy.membershipLevels).id,
              membershipLevelName: resolveMembershipLevel(accountState.lifetimeEarned, policy.membershipLevels).name,
              isActive: true,
              activatedAt: '2026-01-10T10:00:00.000Z',
              lastActivityAt: '2026-06-01T10:00:00.000Z',
              createdAt: '2026-01-10T10:00:00.000Z',
              updatedAt: '2026-06-01T10:00:00.000Z',
            },
          }
        : {};

    const match = findReturningGuestMatch(incomingContact, existingGuests, loyaltyMap);
    assert.ok(match, `Returning guest should match on ${resId}`);
    assert.equal(match.guest.id, 'guest-returning-vip');

    const res: Reservation = {
      id: resId,
      guestId: match.guest.id,
      guestName: match.guest.name,
      guestEmail: match.guest.email,
      guestPhone: match.guest.phone,
      roomId: 'room-101',
      roomNumber: '101',
      checkIn: '2026-05-01',
      checkOut: '2026-05-03',
      actualCheckOut: '2026-05-03T10:00:00.000Z',
      overstayNights: 0,
      nights: 2,
      nightlyRate: stayTotal / 2,
      status: 'checked_out',
      totalAmount: stayTotal,
      paidAmount: stayTotal,
      paymentStatus: 'paid',
      ledgerBalance: 0,
    } as Reservation;

    const ledger: LedgerEntry[] = [
      {
        id: `chg-${resId}`,
        reservationId: resId,
        guestId: match.guest.id,
        amount: stayTotal,
        type: 'debit',
        category: 'room',
        description: 'Room charge',
        timestamp: '2026-05-01T14:00:00.000Z',
      } as LedgerEntry,
      {
        id: `pay-${resId}`,
        reservationId: resId,
        guestId: match.guest.id,
        amount: stayTotal,
        type: 'credit',
        category: 'payment',
        description: 'Card settlement',
        timestamp: '2026-05-03T11:00:00.000Z',
      } as LedgerEntry,
    ];

    const evalRes = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, txHistory);
    assert.equal(evalRes.eligible, true, `Stay ${resId} should be eligible: ${evalRes.reason}`);

    // Additive accumulation (mirrors awardAutomaticStayPoints transaction logic)
    const prev = accountState.availablePoints;
    accountState.availablePoints = prev + evalRes.pointsToAward;
    accountState.lifetimeEarned += evalRes.pointsToAward;
    txHistory.push({
      id: evalRes.idempotencyKey,
      hotelId: hotel.id,
      guestId: match.guest.id,
      guestName: match.guest.name,
      transactionType: 'earn_auto',
      points: evalRes.pointsToAward,
      pointsDelta: evalRes.pointsToAward,
      previousBalance: prev,
      updatedBalance: accountState.availablePoints,
      reason: 'Stay points earned',
      adminId: 'admin-1',
      adminName: 'Admin',
      reservationId: resId,
      idempotencyKey: evalRes.idempotencyKey,
      timestamp: '2026-05-03T12:00:00.000Z',
      createdAt: '2026-05-03T12:00:00.000Z',
    });

    // Idempotency: re-evaluating same stay must NOT double-award
    const dupEval = evaluateStayEligibilityForAutoEarn(res, hotel, ledger, txHistory);
    assert.equal(dupEval.eligible, false);
  };

  // Stay 1: 50,000 NGN -> earns 500 pts; guest does NOT redeem
  simulateSettledStay('res-stay-1', 50000, { name: 'Kemi Balogun', phone: '08023334444' });
  assert.equal(Number(accountState.availablePoints), 500);
  assert.equal(Number(accountState.lifetimeEarned), 500);

  // Stay 2 (returning guest using formatted phone & uppercase email): 80,000 NGN -> +800 pts -> accumulates to 1,300 pts
  simulateSettledStay('res-stay-2', 80000, { name: 'Balogun Kemi', email: 'KEMI.BALOGUN@EXAMPLE.COM' });
  assert.equal(Number(accountState.availablePoints), 1300);
  assert.equal(Number(accountState.lifetimeEarned), 1300);

  // Stay 3 (returning guest still hasn't redeemed): 70,000 NGN -> +700 pts -> accumulates to 2,000 pts
  simulateSettledStay('res-stay-3', 70000, { name: 'Kemi Balogun', phone: '2348023334444' });
  assert.equal(Number(accountState.availablePoints), 2000);
  assert.equal(Number(accountState.lifetimeEarned), 2000);

  // Partial redemption of 600 pts -> leaves 1,400 unredeemed pts intact
  const redeemCheck = validatePointsRedemption(600, policy, accountState.availablePoints);
  assert.equal(redeemCheck.valid, true);
  accountState.availablePoints -= 600;
  assert.equal(Number(accountState.availablePoints), 1400);

  // Stay 4 (returns again): 40,000 NGN -> +400 pts -> accumulates on top of 1,400 to reach 1,800 pts
  simulateSettledStay('res-stay-4', 40000, { name: 'Kemi Balogun', phone: '+234-802-333-4444' });
  assert.equal(Number(accountState.availablePoints), 1800);
  assert.equal(Number(accountState.lifetimeEarned), 2400);
});

console.log(`\nAll ${passed} returning guest & cumulative loyalty tests passed!\n`);
