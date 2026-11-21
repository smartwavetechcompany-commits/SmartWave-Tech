import assert from 'node:assert/strict';
import { Hotel, Guest, Reservation, LedgerEntry } from '../types';
import { DEFAULT_SETTINGS } from '../constants';
import {
  calculateReservationAccount,
  calculateGuestAccount,
} from '../utils/financialUtils';
import { getReservationLiveBalance } from '../utils/billingEngine';
import { calculateGuestFinancialPosition } from '../services/financialService';
import {
  getNoShowPenaltyPolicy,
  getCancellationFeePolicy,
  calculatePolicyPenaltyAmount,
  buildPolicyPenaltyLedgerEntry,
  hasExistingPostedPenalty,
} from '../utils/policyUtils';

function makeHotel(overrides?: Partial<Hotel['settings']['reservations']>): Hotel {
  return {
    id: 'hotel-test-1',
    name: 'Test Grand Hotel',
    branding: {},
    taxes: [],
    defaultCheckInTime: '14:00',
    defaultCheckOutTime: '12:00',
    settings: {
      ...DEFAULT_SETTINGS,
      reservations: {
        ...DEFAULT_SETTINGS.reservations,
        ...(overrides || {}),
      },
    },
  } as unknown as Hotel;
}

function makeGuest(id: string, name: string, staleBalance = 0, staleNights = 0): Guest {
  return {
    id,
    hotelId: 'hotel-test-1',
    name,
    email: `${id}@example.com`,
    phone: '+2348000000000',
    totalStays: staleNights > 0 ? 1 : 0,
    totalSpent: 0,
    ledgerBalance: staleBalance,
    createdAt: '2026-01-01T10:00:00.000Z',
    ...(staleNights > 0 ? { totalNights: staleNights } : {}),
  } as unknown as Guest;
}

function makeReservation(overrides: Partial<Reservation>): Reservation {
  return {
    id: 'res-default',
    hotelId: 'hotel-test-1',
    guestId: 'guest-default',
    guestName: 'Test Guest',
    guestEmail: 'guest-default@example.com',
    roomId: 'room-101',
    roomNumber: '101',
    checkIn: '2026-05-01',
    checkOut: '2026-05-03',
    nights: 2,
    nightlyRate: 90000,
    totalAmount: 180000,
    paidAmount: 0,
    status: 'confirmed',
    paymentStatus: 'unpaid',
    createdAt: '2026-04-20T10:00:00.000Z',
    ...overrides,
  } as Reservation;
}

function makeLedgerEntry(overrides: Partial<LedgerEntry>): LedgerEntry {
  return {
    id: `led-${Math.random().toString(36).slice(2, 8)}`,
    hotelId: 'hotel-test-1',
    guestId: 'guest-default',
    reservationId: 'res-default',
    type: 'debit',
    amount: 0,
    category: 'other',
    description: 'Entry',
    timestamp: '2026-05-01T15:00:00.000Z',
    postedBy: 'admin-1',
    ...overrides,
  };
}

let passed = 0;
function test(name: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`PASS [${passed}]: ${name}`);
}

const defaultHotel = makeHotel();

// 1. No-Show without penalty -> ₦0 outstanding debt
test('Scenario 1: No-Show without penalty -> ₦0 outstanding debt (ignores unpaid booking total & pre-posted room charge)', () => {
  const guest = makeGuest('g-noshow-0', 'Ada NoShow', 180000, 2);
  const res = makeReservation({
    id: 'res-ns-0',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'no_show',
    totalAmount: 180000,
    paidAmount: 0,
    ledgerBalance: 180000,
  });

  // Even if a pre-stay room charge was posted before marking no-show, no penalty was posted
  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-pre-room',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      description: 'Room 101 Charge (2 nights)',
      amount: 180000,
    }),
  ];

  const resAccNoLedger = calculateReservationAccount(res, defaultHotel, []);
  const resAccWithRoomLedger = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const liveBalEmpty = getReservationLiveBalance(res, defaultHotel, []);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);
  const guestAcc = calculateGuestAccount(guest, [res], defaultHotel, ledger);

  assert.equal(resAccNoLedger.outstandingBalance, 0);
  assert.equal(resAccNoLedger.netAmountDue, 0);
  assert.equal(resAccNoLedger.totalNights, 0);
  assert.equal(resAccWithRoomLedger.outstandingBalance, 0);
  assert.equal(resAccWithRoomLedger.totalCharges, 0);
  assert.equal(liveBal, 0);
  assert.equal(liveBalEmpty, 0);
  assert.equal(guestPos.outstandingBalance, 0);
  assert.equal(guestPos.netAmountDue, 0);
  assert.equal(guestPos.totalSpent, 0);
  assert.equal(guestPos.actualStayedNights, 0);
  assert.equal(guestPos.chargeableNights, 0);
  assert.equal(guestAcc.netAmountDue, 0);
});

// 2. No-Show with unpaid ₦50,000 penalty -> ₦50,000 outstanding debt
test('Scenario 2: No-Show with unpaid ₦50,000 penalty -> ₦50,000 outstanding debt', () => {
  const guest = makeGuest('g-noshow-50k', 'Bola NoShowPenalty');
  const res = makeReservation({
    id: 'res-ns-50k',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'no_show',
    totalAmount: 180000,
    paidAmount: 0,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-ns-pen',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'no_show_penalty',
      chargeType: 'no_show_penalty',
      description: 'No-Show Penalty - Room 101 (Fixed policy fee)',
      amount: 50000,
    }),
  ];

  const resAcc = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);
  const guestAcc = calculateGuestAccount(guest, [res], defaultHotel, ledger);

  assert.equal(resAcc.outstandingBalance, 50000);
  assert.equal(resAcc.netAmountDue, 50000);
  assert.equal(resAcc.totalCharges, 50000);
  assert.equal(resAcc.totalNights, 0);
  assert.equal(liveBal, 50000);
  assert.equal(guestPos.outstandingBalance, 50000);
  assert.equal(guestPos.netAmountDue, 50000);
  assert.equal(guestPos.totalSpent, 0);
  assert.equal(guestPos.actualStayedNights, 0);
  assert.equal(guestAcc.netAmountDue, 50000);
});

// 3. Cancelled without cancellation fee -> ₦0 outstanding debt
test('Scenario 3: Cancelled without cancellation fee -> ₦0 outstanding debt', () => {
  const guest = makeGuest('g-cancel-0', 'Chidi Cancelled', 240000, 3);
  const res = makeReservation({
    id: 'res-cancel-0',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'cancelled',
    nights: 3,
    totalAmount: 240000,
    paidAmount: 0,
    ledgerBalance: 240000,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-cancel-pre-room',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      description: 'Room 101 Charge (3 nights)',
      amount: 240000,
    }),
  ];

  const resAcc = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);
  const guestAcc = calculateGuestAccount(guest, [res], defaultHotel, ledger);

  assert.equal(resAcc.outstandingBalance, 0);
  assert.equal(resAcc.netAmountDue, 0);
  assert.equal(resAcc.totalNights, 0);
  assert.equal(liveBal, 0);
  assert.equal(guestPos.outstandingBalance, 0);
  assert.equal(guestPos.netAmountDue, 0);
  assert.equal(guestPos.totalSpent, 0);
  assert.equal(guestPos.actualStayedNights, 0);
  assert.equal(guestAcc.netAmountDue, 0);
});

// 4. Cancelled with unpaid ₦20,000 cancellation fee -> ₦20,000 outstanding debt
test('Scenario 4: Cancelled with unpaid ₦20,000 cancellation fee -> ₦20,000 outstanding debt', () => {
  const guest = makeGuest('g-cancel-20k', 'Damilola CancelFee');
  const res = makeReservation({
    id: 'res-cancel-20k',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'cancelled',
    totalAmount: 180000,
    paidAmount: 0,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-cancel-fee',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'cancellation_fee',
      chargeType: 'cancellation_fee',
      description: 'Cancellation Fee - Room 101 (Fixed policy fee)',
      amount: 20000,
    }),
  ];

  const resAcc = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);
  const guestAcc = calculateGuestAccount(guest, [res], defaultHotel, ledger);

  assert.equal(resAcc.outstandingBalance, 20000);
  assert.equal(resAcc.netAmountDue, 20000);
  assert.equal(resAcc.totalCharges, 20000);
  assert.equal(resAcc.totalNights, 0);
  assert.equal(liveBal, 20000);
  assert.equal(guestPos.outstandingBalance, 20000);
  assert.equal(guestPos.netAmountDue, 20000);
  assert.equal(guestPos.totalSpent, 0);
  assert.equal(guestPos.actualStayedNights, 0);
  assert.equal(guestAcc.netAmountDue, 20000);
});

// 5. Checked-out guest with unpaid folio -> unpaid folio balance remains debt
test('Scenario 5: Checked-out guest with unpaid folio -> unpaid folio balance remains debt', () => {
  const guest = makeGuest('g-co-debt', 'Emeka DepartedDebt');
  const res = makeReservation({
    id: 'res-co-debt',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'checked_out',
    actualCheckOut: '2026-05-03T11:00:00.000Z',
    overstayNights: 0,
    nights: 2,
    nightlyRate: 90000,
    totalAmount: 180000,
    paidAmount: 80000,
    paymentStatus: 'partial',
    ledgerBalance: 100000,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-co-room',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      description: 'Room 101 Charge (2 nights)',
      amount: 180000,
    }),
    makeLedgerEntry({
      id: 'led-co-pay',
      guestId: guest.id,
      reservationId: res.id,
      type: 'credit',
      category: 'payment',
      description: 'Partial Payment (Card)',
      amount: 80000,
    }),
  ];

  const resAcc = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);

  assert.equal(resAcc.outstandingBalance, 100000);
  assert.equal(resAcc.netAmountDue, 100000);
  assert.equal(liveBal, 100000);
  assert.equal(guestPos.outstandingBalance, 100000);
  assert.equal(guestPos.netAmountDue, 100000);
  assert.equal(guestPos.totalSpent, 80000);
  assert.equal(guestPos.chargeableNights, 2);
});

// 6. Fully settled guest -> ₦0 outstanding debt
test('Scenario 6: Fully settled guest -> ₦0 outstanding debt', () => {
  const guest = makeGuest('g-settled', 'Fatima Settled');
  const res = makeReservation({
    id: 'res-settled',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'checked_out',
    actualCheckOut: '2026-05-03T11:00:00.000Z',
    overstayNights: 0,
    nights: 2,
    nightlyRate: 90000,
    totalAmount: 180000,
    paidAmount: 180000,
    paymentStatus: 'paid',
    financialStatus: 'SETTLED',
    ledgerBalance: 0,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-st-room',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      description: 'Room 101 Charge (2 nights)',
      amount: 180000,
    }),
    makeLedgerEntry({
      id: 'led-st-pay',
      guestId: guest.id,
      reservationId: res.id,
      type: 'credit',
      category: 'payment',
      description: 'Full Payment (Transfer)',
      amount: 180000,
    }),
  ];

  const resAcc = calculateReservationAccount(res, defaultHotel, ledger);
  const liveBal = getReservationLiveBalance(res, defaultHotel, ledger);
  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);

  assert.equal(resAcc.outstandingBalance, 0);
  assert.equal(resAcc.netAmountDue, 0);
  assert.equal(liveBal, 0);
  assert.equal(guestPos.outstandingBalance, 0);
  assert.equal(guestPos.netAmountDue, 0);
  assert.equal(guestPos.totalSpent, 180000);
  assert.equal(guestPos.chargeableNights, 2);
});

// 7. Cancelled with deposit, posted fee, and partial refund
test('Scenario 7: Cancelled with ₦50,000 deposit, ₦20,000 posted fee, and ₦30,000 refund -> ₦0 debt, ₦20,000 total spent', () => {
  const guest = makeGuest('g-cancel-dep', 'Grace DepositCancel');
  const res = makeReservation({
    id: 'res-cancel-dep',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'cancelled',
    totalAmount: 200000,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-dep',
      guestId: guest.id,
      reservationId: res.id,
      type: 'credit',
      category: 'payment',
      description: 'Advance Deposit',
      amount: 50000,
    }),
    makeLedgerEntry({
      id: 'led-fee',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'cancellation_fee',
      chargeType: 'cancellation_fee',
      description: 'Cancellation Fee',
      amount: 20000,
    }),
    makeLedgerEntry({
      id: 'led-ref',
      guestId: guest.id,
      reservationId: res.id,
      type: 'debit',
      category: 'refund',
      description: 'Refund of remaining deposit',
      amount: 30000,
    }),
  ];

  const guestPos = calculateGuestFinancialPosition(guest, [res], defaultHotel, ledger);
  assert.equal(guestPos.outstandingBalance, 0);
  assert.equal(guestPos.netAmountDue, 0);
  assert.equal(guestPos.totalSpent, 20000);
  assert.equal(guestPos.totalCharges, 20000);
  assert.equal(guestPos.totalRefunds, 30000);
  assert.equal(guestPos.chargeableNights, 0);
});

// 8. Mixed guest history: 1 completed stay + 1 no-show + 1 cancelled
test('Scenario 8: Mixed guest history counts only actual stay nights/visits and excludes unpenalized no-show/cancelled', () => {
  const guest = makeGuest('g-mixed', 'Hassan Frequent');
  const completed = makeReservation({
    id: 'res-m-1',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'checked_out',
    actualCheckOut: '2026-04-04T11:00:00.000Z',
    overstayNights: 0,
    checkIn: '2026-04-01',
    checkOut: '2026-04-04',
    nights: 3,
    nightlyRate: 50000,
    totalAmount: 150000,
    paidAmount: 150000,
    paymentStatus: 'paid',
  });
  const noShow = makeReservation({
    id: 'res-m-2',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'no_show',
    checkIn: '2026-04-10',
    checkOut: '2026-04-12',
    nights: 2,
    nightlyRate: 50000,
    totalAmount: 100000,
    paidAmount: 0,
  });
  const cancelled = makeReservation({
    id: 'res-m-3',
    guestId: guest.id,
    guestEmail: guest.email,
    status: 'cancelled',
    checkIn: '2026-04-20',
    checkOut: '2026-04-21',
    nights: 1,
    nightlyRate: 50000,
    totalAmount: 50000,
    paidAmount: 0,
  });

  const ledger: LedgerEntry[] = [
    makeLedgerEntry({
      id: 'led-m-room',
      guestId: guest.id,
      reservationId: completed.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      description: 'Room 101 Charge (3 nights)',
      amount: 150000,
    }),
    makeLedgerEntry({
      id: 'led-m-pay',
      guestId: guest.id,
      reservationId: completed.id,
      type: 'credit',
      category: 'payment',
      description: 'Payment',
      amount: 150000,
    }),
  ];

  const allRes = [completed, noShow, cancelled];
  const visitsCount = allRes.filter(r => r.status === 'checked_out' || r.status === 'checked_in').length;
  const guestPos = calculateGuestFinancialPosition(guest, allRes, defaultHotel, ledger);

  assert.equal(visitsCount, 1);
  assert.equal(guestPos.actualStayedNights, 3);
  assert.equal(guestPos.chargeableNights, 3);
  assert.equal(guestPos.totalSpent, 150000);
  assert.equal(guestPos.outstandingBalance, 0);
  assert.equal(guestPos.netAmountDue, 0);
});

// 9. Admin Control Policy enforcement, duplicate prevention & non-retroactivity
test('Scenario 9: Admin Control Policy controls penalty calculation, prevents duplicates, and never acts retroactively', () => {
  const resNoShow = makeReservation({
    id: 'res-pol-ns',
    guestId: 'g-pol',
    status: 'no_show',
    totalAmount: 200000,
  });
  const resCancel = makeReservation({
    id: 'res-pol-can',
    guestId: 'g-pol',
    status: 'cancelled',
    totalAmount: 200000,
  });

  // Disabled by default
  const disabledHotel = makeHotel();
  assert.equal(getNoShowPenaltyPolicy(disabledHotel).enabled, false);
  assert.equal(getCancellationFeePolicy(disabledHotel).enabled, false);
  assert.equal(calculatePolicyPenaltyAmount(getNoShowPenaltyPolicy(disabledHotel), 200000), 0);
  assert.equal(buildPolicyPenaltyLedgerEntry(resNoShow, disabledHotel, 'no_show_penalty', 'admin-1', []), null);
  assert.equal(buildPolicyPenaltyLedgerEntry(resCancel, disabledHotel, 'cancellation_fee', 'admin-1', []), null);

  // Enabled fixed & percentage policies
  const enabledHotel = makeHotel({
    enableNoShowPenalty: true,
    noShowPenaltyType: 'percentage',
    noShowPenaltyAmount: 25,
    enableCancellationFee: true,
    cancellationFeeType: 'fixed',
    cancellationFeeAmount: 20000,
  });

  const nsEntry = buildPolicyPenaltyLedgerEntry(resNoShow, enabledHotel, 'no_show_penalty', 'admin-1', []);
  assert.ok(nsEntry !== null);
  assert.equal(nsEntry!.amount, 50000);
  assert.equal(nsEntry!.chargeType, 'no_show_penalty');
  assert.equal(nsEntry!.idempotencyKey, 'no_show_penalty:res-pol-ns');

  const canEntry = buildPolicyPenaltyLedgerEntry(resCancel, enabledHotel, 'cancellation_fee', 'admin-1', []);
  assert.ok(canEntry !== null);
  assert.equal(canEntry!.amount, 20000);
  assert.equal(canEntry!.chargeType, 'cancellation_fee');
  assert.equal(canEntry!.idempotencyKey, 'cancellation_fee:res-pol-can');

  // Duplicate prevention guard
  const postedLedger: LedgerEntry[] = [
    { ...nsEntry!, id: 'posted-ns-1' },
    { ...canEntry!, id: 'posted-can-1' },
  ];
  assert.equal(hasExistingPostedPenalty(postedLedger, resNoShow.id, 'no_show_penalty'), true);
  assert.equal(buildPolicyPenaltyLedgerEntry(resNoShow, enabledHotel, 'no_show_penalty', 'admin-1', postedLedger), null);
  assert.equal(buildPolicyPenaltyLedgerEntry(resCancel, enabledHotel, 'cancellation_fee', 'admin-1', postedLedger), null);

  // Non-retroactivity: enabling policy does NOT create debt on historical unposted reservation
  assert.equal(calculateReservationAccount(resNoShow, enabledHotel, []).netAmountDue, 0);
  assert.equal(calculateReservationAccount(resCancel, enabledHotel, []).netAmountDue, 0);

  // Non-retroactivity: disabling policy does NOT erase already-posted historical penalty transactions
  assert.equal(calculateReservationAccount(resNoShow, disabledHotel, postedLedger).netAmountDue, 50000);
  assert.equal(calculateReservationAccount(resCancel, disabledHotel, postedLedger).netAmountDue, 20000);
});

console.log(`\nALL ${passed} TESTS PASSED SUCCESSFULLY.`);
