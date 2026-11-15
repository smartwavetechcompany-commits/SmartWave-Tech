import { planGroupPaymentAllocation, principalRoomService } from './src/services/principalRoomService';
import { calculateReservationAccount } from './src/utils/financialUtils';
import { calculateGuestFinancialPosition } from './src/services/financialService';
import { getReservationLiveBalance, calculateBilling, BillingEngine } from './src/utils/billingEngine';
import { calculateStayDuration } from './src/utils/dateUtils';
import { Hotel, LedgerEntry, Reservation, Guest } from './src/types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

function assertClose(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`FAIL: ${message}. Expected ${expected}, got ${actual}`);
  }
  console.log(`  [PASS] ${message} (${actual})`);
}

function makeHotel(): Hotel {
  return {
    id: 'hotel_test',
    name: 'Test Hotel',
    plan: 'enterprise',
    subscriptionStatus: 'active',
    subscriptionExpiry: '2027-01-01T00:00:00Z',
    trackingCode: 'TEST-01',
    createdAt: '2026-01-01T00:00:00Z',
    roomLimit: 50,
    staffLimit: 10,
    modulesEnabled: []
  };
}

function runSuite() {
  console.log('--- STARTING MASTER ROOM PAYMENT ALLOCATION TESTS ---');
  const hotel = makeHotel();

  const master101: Reservation = {
    id: 'res_101',
    guestId: 'guest_youtube',
    guestName: 'Youtube James',
    status: 'checked_in',
    roomId: 'room_101',
    roomNumber: '101',
    checkIn: '2026-11-13',
    checkOut: '2026-11-16',
    nights: 3,
    nightlyRate: 90000,
    totalAmount: 270000,
    paidAmount: 200000,
    paymentStatus: 'partial',
    isPrincipalRoom: true,
    linkedReservationIds: ['res_102'],
    linkedRoomNumbers: ['102'],
    autoNightDeduction: true,
    createdAt: '2026-11-13T13:10:00Z'
  };

  const linked102: Reservation = {
    id: 'res_102',
    guestId: 'guest_francis',
    guestName: 'Francis Royce',
    status: 'checked_in',
    roomId: 'room_102',
    roomNumber: '102',
    checkIn: '2026-11-13',
    checkOut: '2026-11-14',
    nights: 1,
    nightlyRate: 90000,
    totalAmount: 230000,
    paidAmount: 100000,
    paymentStatus: 'partial',
    principalReservationId: 'res_101',
    principalRoomNumber: '101',
    autoNightDeduction: true,
    createdAt: '2026-11-13T11:50:00Z'
  };

  const baseLedger = (mPaid: number, cTotal: number, cPaid: number): LedgerEntry[] => {
    const entries: LedgerEntry[] = [
      {
        id: 'e_m_room_1',
        hotelId: hotel.id,
        guestId: master101.guestId!,
        reservationId: master101.id,
        type: 'debit',
        category: 'room',
        chargeType: 'room_rate',
        amount: 90000,
        description: 'Room 101 Night 1',
        timestamp: '2026-11-13T13:10:00Z',
        postedBy: 'staff'
      },
      {
        id: 'e_m_room_2',
        hotelId: hotel.id,
        guestId: master101.guestId!,
        reservationId: master101.id,
        type: 'debit',
        category: 'room',
        chargeType: 'room_rate',
        amount: 90000,
        description: 'Room 101 Night 2',
        timestamp: '2026-11-14T00:00:00Z',
        postedBy: 'staff'
      },
      {
        id: 'e_m_room_3',
        hotelId: hotel.id,
        guestId: master101.guestId!,
        reservationId: master101.id,
        type: 'debit',
        category: 'room',
        chargeType: 'room_rate',
        amount: 90000,
        description: 'Room 101 Night 3',
        timestamp: '2026-11-15T00:00:00Z',
        postedBy: 'staff'
      },
      {
        id: 'e_c_room_1',
        hotelId: hotel.id,
        guestId: linked102.guestId!,
        reservationId: linked102.id,
        type: 'debit',
        category: 'room',
        chargeType: 'room_rate',
        amount: 90000,
        description: 'Room 102 Night 1',
        timestamp: '2026-11-13T11:50:00Z',
        postedBy: 'staff'
      },
      {
        id: 'e_c_overstay_1',
        hotelId: hotel.id,
        guestId: linked102.guestId!,
        reservationId: linked102.id,
        type: 'debit',
        category: 'room',
        chargeType: 'overstay',
        amount: 90000,
        description: 'Overstay Charge: Room 102 Night 2',
        timestamp: '2026-11-14T15:00:00Z',
        postedBy: 'staff'
      },
      {
        id: 'e_c_extra',
        hotelId: hotel.id,
        guestId: linked102.guestId!,
        reservationId: linked102.id,
        type: 'debit',
        category: 'service',
        amount: Math.max(0, cTotal - 180000),
        description: 'Room 102 Services',
        timestamp: '2026-11-14T16:00:00Z',
        postedBy: 'staff'
      }
    ];
    if (mPaid > 0) {
      entries.push({
        id: 'e_m_pay_init',
        hotelId: hotel.id,
        guestId: master101.guestId!,
        reservationId: master101.id,
        type: 'credit',
        category: 'payment',
        amount: mPaid,
        description: 'Initial Master Payment',
        timestamp: '2026-11-13T14:00:00Z',
        postedBy: 'staff'
      });
    }
    if (cPaid > 0) {
      entries.push({
        id: 'e_c_pay_init',
        hotelId: hotel.id,
        guestId: linked102.guestId!,
        reservationId: linked102.id,
        type: 'credit',
        category: 'payment',
        amount: cPaid,
        description: 'Initial Linked Payment',
        timestamp: '2026-11-13T14:05:00Z',
        postedBy: 'staff'
      });
    }
    return entries;
  };

  // TEST 1: Payment sufficient to settle both Master Room (owes 70k) & Linked Room (owes 130k) => total 200k
  console.log('\nCondition 1: Payment sufficient to settle both Master & Linked room balances');
  const ledger1 = baseLedger(200000, 230000, 100000);
  const plan1 = planGroupPaymentAllocation(
    master101,
    [linked102],
    [{ amount: 200000, method: 'transfer', referenceCode: 'TX-100' }],
    ledger1,
    hotel
  );
  assertClose(plan1.totalSubmitted, 200000, 'Total submitted equals 200,000');
  assertClose(plan1.totalAllocatedToDebt, 200000, 'Total allocated to debt equals 200,000');
  assertClose(plan1.masterExcess, 0, 'No excess credit left on Master Room');
  assert(plan1.allocations.length === 2, 'Exactly 2 allocations (no duplicate entries)');
  assertClose(
    plan1.allocations.find(a => a.reservation.id === 'res_101')?.amount || 0,
    70000,
    'Master Room 101 receives exact 70,000 owed'
  );
  assertClose(
    plan1.allocations.find(a => a.reservation.id === 'res_102')?.amount || 0,
    130000,
    'Linked Room 102 receives exact 130,000 owed'
  );

  // Verify ledger consistency after applying allocations
  const ledger1After: LedgerEntry[] = [
    ...ledger1,
    ...plan1.allocations.map((a, i) => ({
      id: `alloc_1_${i}`,
      hotelId: hotel.id,
      guestId: a.reservation.guestId!,
      reservationId: a.reservation.id,
      type: 'credit' as const,
      category: 'payment' as const,
      amount: a.amount,
      description: `Payment ${i}`,
      timestamp: '2026-11-15T10:00:00Z',
      postedBy: 'staff'
    }))
  ];
  const groupAfter1 = principalRoomService.calculateGroupFinancials(master101, [linked102], ledger1After, hotel);
  assertClose(groupAfter1.masterBalance, 0, 'Master Room 101 balance becomes 0');
  assertClose(groupAfter1.chargesByRoom['102'].balance, 0, 'Linked Room 102 balance becomes 0');
  assertClose(groupAfter1.groupNetBalance, 0, 'Consolidated group balance becomes 0');
  assertClose(
    getReservationLiveBalance(linked102, hotel, ledger1After.filter(e => e.reservationId === linked102.id)),
    0,
    'Linked Room 102 live balance becomes 0'
  );

  // TEST 2: Payment insufficient to settle entire group balance (120k paid against 200k owed across 101 & 102)
  console.log('\nCondition 2: Payment insufficient to settle entire group balance (partial allocation)');
  const ledger2 = baseLedger(200000, 230000, 100000);
  const plan2 = planGroupPaymentAllocation(
    master101,
    [linked102],
    [{ amount: 120000, method: 'cash' }],
    ledger2,
    hotel
  );
  assertClose(plan2.masterExcess, 0, 'No fake credit on Master when Linked Room still owes');
  assertClose(
    plan2.allocations.find(a => a.reservation.id === 'res_101')?.amount || 0,
    70000,
    'Master Room 101 settles its 70,000 owed first'
  );
  assertClose(
    plan2.allocations.find(a => a.reservation.id === 'res_102')?.amount || 0,
    50000,
    'Remaining 50,000 reduces Linked Room 102 debt'
  );
  const ledger2After: LedgerEntry[] = [
    ...ledger2,
    ...plan2.allocations.map((a, i) => ({
      id: `alloc_2_${i}`,
      hotelId: hotel.id,
      guestId: a.reservation.guestId!,
      reservationId: a.reservation.id,
      type: 'credit' as const,
      category: 'payment' as const,
      amount: a.amount,
      description: `Payment ${i}`,
      timestamp: '2026-11-15T10:00:00Z',
      postedBy: 'staff'
    }))
  ];
  const groupAfter2 = principalRoomService.calculateGroupFinancials(master101, [linked102], ledger2After, hotel);
  assertClose(groupAfter2.masterBalance, 0, 'Master Room 101 owed = 0 (not negative credit)');
  assertClose(groupAfter2.chargesByRoom['102'].balance, 80000, 'Linked Room 102 remaining owed = 80,000');
  assertClose(groupAfter2.groupNetBalance, 80000, 'Consolidated group net balance = 80,000');

  // TEST 3: Payment exceeds total group balance (250k paid against 200k total owed => 50k genuine excess)
  console.log('\nCondition 3: Payment exceeds total group balance (excess kept as Master credit only after all debts settled)');
  const ledger3 = baseLedger(200000, 230000, 100000);
  const plan3 = planGroupPaymentAllocation(
    master101,
    [linked102],
    [{ amount: 100000, method: 'cash' }, { amount: 150000, method: 'card', referenceCode: 'POS-9' }],
    ledger3,
    hotel
  );
  assertClose(plan3.totalSubmitted, 250000, 'Total submitted = 250,000 across split payments');
  assertClose(plan3.totalAllocatedToDebt, 200000, 'Debt allocation = 200,000 (70k + 130k)');
  assertClose(plan3.masterExcess, 50000, 'Genuine excess after settling all rooms = 50,000');
  const ledger3After: LedgerEntry[] = [
    ...ledger3,
    ...plan3.allocations.map((a, i) => ({
      id: `alloc_3_${i}`,
      hotelId: hotel.id,
      guestId: a.reservation.guestId!,
      reservationId: a.reservation.id,
      type: 'credit' as const,
      category: 'payment' as const,
      amount: a.amount,
      description: `Payment ${i}`,
      timestamp: '2026-11-15T10:00:00Z',
      postedBy: 'staff'
    }))
  ];
  const groupAfter3 = principalRoomService.calculateGroupFinancials(master101, [linked102], ledger3After, hotel);
  assertClose(groupAfter3.chargesByRoom['102'].balance, 0, 'Linked Room 102 fully settled (0 owed)');
  assertClose(groupAfter3.masterBalance, -50000, 'Master Room 101 retains only genuine 50,000 excess credit');
  assertClose(groupAfter3.groupNetBalance, -50000, 'Group net balance = -50,000');

  // TEST 4: Live screenshot scenario (Master 101 already paid 280k => 10k credit; Linked 102 paid 100k => 130k owed; net = 120k)
  console.log('\nCondition 4: Screenshot scenario (101 has 10k existing credit, 102 owes 130k, pay 120k consolidated balance)');
  const ledger4 = baseLedger(280000, 230000, 100000);
  const plan4 = planGroupPaymentAllocation(
    { ...master101, paidAmount: 280000, ledgerBalance: -10000 },
    [linked102],
    [{ amount: 120000, method: 'transfer' }],
    ledger4,
    hotel
  );
  assertClose(plan4.masterInitialBalance, -10000, 'Master 101 initial balance detected as -10,000 credit');
  assertClose(
    plan4.allocations.find(a => a.reservation.id === 'res_102')?.amount || 0,
    120000,
    'Entire 120,000 new payment allocates straight to Linked Room 102 (NOT to Master 101)'
  );
  assertClose(plan4.masterExcess, 0, 'Zero additional excess credit posted to Master 101');
  assertClose(plan4.targets[1].remainingOwed, 10000, 'Linked 102 has 10,000 remaining to pull from Master existing credit');

  // Simulate the credit reallocation entries posted by reallocateMasterCreditToLinkedRooms
  const ledger4AfterRealloc: LedgerEntry[] = [
    ...ledger4,
    {
      id: 'e_new_102',
      hotelId: hotel.id,
      guestId: linked102.guestId!,
      reservationId: linked102.id,
      type: 'credit',
      category: 'payment',
      amount: 120000,
      description: 'Payment via TRANSFER (Allocated from Master Room 101)',
      timestamp: '2026-11-15T10:01:00Z',
      postedBy: 'staff'
    },
    {
      id: 'e_realloc_101_debit',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'refund',
      amount: 10000,
      description: 'Master Credit Applied to Linked Room 102',
      timestamp: '2026-11-15T10:01:05Z',
      postedBy: 'staff'
    },
    {
      id: 'e_realloc_102_credit',
      hotelId: hotel.id,
      guestId: linked102.guestId!,
      reservationId: linked102.id,
      type: 'credit',
      category: 'payment',
      amount: 10000,
      description: 'Settled via Master Room 101 Credit',
      timestamp: '2026-11-15T10:01:06Z',
      postedBy: 'staff'
    }
  ];
  const groupAfter4 = principalRoomService.calculateGroupFinancials(master101, [linked102], ledger4AfterRealloc, hotel);
  assertClose(groupAfter4.masterBalance, 0, 'Master Room 101 balance = 0 after credit reallocation');
  assertClose(groupAfter4.chargesByRoom['102'].balance, 0, 'Linked Room 102 balance = 0 after credit reallocation');
  assertClose(groupAfter4.groupNetBalance, 0, 'Consolidated group net balance = 0');

  const francisGuest: Guest = {
    id: 'guest_francis',
    name: 'Francis Royce',
    email: 'okoronkwofrancis01@gmail.com',
    phone: '070',
    ledgerBalance: 0,
    totalStays: 1,
    totalNights: 2,
    totalSpent: 230000
  };
  const francisPos = calculateGuestFinancialPosition(francisGuest, [linked102], hotel, ledger4AfterRealloc);
  assertClose(francisPos.outstandingBalance, 0, 'Individual guest financial position (Francis Royce) owes 0');
  const mAccount = calculateReservationAccount(master101, hotel, ledger4AfterRealloc);
  assertClose(mAccount.outstandingBalance, 0, 'calculateReservationAccount matches Master 101 = 0');

  // TEST 5: Exact early-checkout Master Room 101 (Nov 13 - Nov 15, stale nights: 3, inclusive 7.5% Tax + 13.5% SC, 280k payments, 10k refund reallocation)
  console.log('\nCondition 5: Early-checkout Master Room 101 (2 nights stayed, stale nights=3, inclusive taxes, 10k refund reallocation)');
  const inclusiveHotel: Hotel = {
    ...hotel,
    taxes: [
      { id: 't_vat', name: 'Tax', percentage: 7.5, isInclusive: true, status: 'active', category: 'all', showOnFolio: true, showOnReceipt: true },
      { id: 't_sc', name: 'SC', percentage: 13.5, isInclusive: true, status: 'active', category: 'all', showOnFolio: true, showOnReceipt: true }
    ]
  };
  const checkedOutEarly101: Reservation = {
    ...master101,
    status: 'checked_out',
    checkIn: '2026-11-13',
    checkOut: '2026-11-15',
    nights: 3, // stale nights pre-checkout
    overstayNights: 0,
    ledgerBalance: -90000
  };
  const inclusiveLedger101: LedgerEntry[] = [
    {
      id: 'night_1_base',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 73016,
      description: 'Room Charge: Room 101 (Night of Nov 13, 2026)',
      timestamp: '2026-11-13T13:10:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'night_1_vat',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'tax',
      amount: 6279,
      description: 'Tax (7.5%) [Inclusive] for Room Charge: Room 101 (Night of Nov 13, 2026)',
      timestamp: '2026-11-13T13:10:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'night_1_sc',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'tax',
      amount: 10705,
      description: 'SC (13.5%) [Inclusive] for Room Charge: Room 101 (Night of Nov 13, 2026)',
      timestamp: '2026-11-13T13:10:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'night_2_base',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 73016,
      description: 'Nightly Room Charge: 101 (Night of Nov 14, 2026) (Night 2 of 3)',
      timestamp: '2026-11-14T00:05:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'night_2_vat',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'tax',
      amount: 6279,
      description: 'Tax (7.5%) [Inclusive] for Nightly Room Charge: 101 (Night of Nov 14, 2026) (Night 2 of 3)',
      timestamp: '2026-11-14T00:05:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'night_2_sc',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'tax',
      amount: 10705,
      description: 'SC (13.5%) [Inclusive] for Nightly Room Charge: 101 (Night of Nov 14, 2026) (Night 2 of 3)',
      timestamp: '2026-11-14T00:05:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'pay_transfer_10k',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'credit',
      category: 'payment',
      amount: 10000,
      description: 'Payment via TRANSFER',
      timestamp: '2026-11-13T13:16:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'pay_cash_260k',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'credit',
      category: 'payment',
      amount: 260000,
      description: 'Payment via CASH',
      timestamp: '2026-11-13T14:41:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'pay_card_10k',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'credit',
      category: 'payment',
      amount: 10000,
      description: 'Payment via CARD',
      timestamp: '2026-11-13T14:43:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'refund_master_realloc_10k',
      hotelId: hotel.id,
      guestId: master101.guestId!,
      reservationId: master101.id,
      type: 'debit',
      category: 'refund',
      amount: 10000,
      description: 'Master Credit Applied to Linked Room 102',
      timestamp: '2026-11-15T09:10:00.000Z',
      postedBy: 'staff'
    }
  ];

  const earlyDuration = calculateStayDuration(
    checkedOutEarly101.checkIn,
    checkedOutEarly101.checkOut,
    checkedOutEarly101.overstayNights,
    checkedOutEarly101.status,
    { hotel: inclusiveHotel, res: checkedOutEarly101 }
  );
  assert(earlyDuration.bookingNights === 2 && earlyDuration.chargeableNights === 2, 'Early checkout duration clamps to 2 stayed nights despite stale res.nights=3');

  const earlyAcc = calculateReservationAccount(checkedOutEarly101, inclusiveHotel, inclusiveLedger101);
  assertClose(earlyAcc.totalCharges, 180000, 'ReservationAccount totalCharges = 180,000 (not 270k)');
  assertClose(earlyAcc.outstandingBalance, -90000, 'ReservationAccount outstandingBalance = -90,000 credit');
  assertClose(earlyAcc.creditBalance, 90000, 'ReservationAccount creditBalance = 90,000');
  assertClose(earlyAcc.netAmountDue, 0, 'ReservationAccount netAmountDue = 0');

  const earlyBilling = calculateBilling(checkedOutEarly101, inclusiveHotel, inclusiveLedger101);
  assertClose(earlyBilling.totalCharges, 180000, 'calculateBilling totalCharges = 180,000');
  assertClose(earlyBilling.outstandingBalance, -90000, 'calculateBilling outstandingBalance = -90,000');

  const earlyFolio = BillingEngine.calculateFolioBreakdown(checkedOutEarly101, inclusiveHotel, inclusiveLedger101);
  assertClose(earlyFolio.tier3.totalCharges, 180000, 'Folio tier3 totalCharges = 180,000');
  assertClose(earlyFolio.tier3.creditBalance, 90000, 'Folio tier3 creditBalance = 90,000');

  // Verify inclusive tax reconstruction prevents double-counting 33,968 even when checked_in with 3 booked nights
  const reconstructedRoomSum = BillingEngine.reconstructInclusiveTaxes(inclusiveLedger101)
    .filter(e => e.type === 'debit' && (e.category === 'room' || e.chargeType === 'room_rate'))
    .reduce((s, e) => s + e.amount, 0);
  assertClose(reconstructedRoomSum, 180000, 'Reconstructed posted room charges equal tax-inclusive 180,000 (no 33,968 tax double-count)');

  // Verify FrontDesk Active 'All' tab hides settled/overpaid checkouts (liveBal <= 0.01)
  const liveBal5 = getReservationLiveBalance(checkedOutEarly101, inclusiveHotel, inclusiveLedger101);
  assert(liveBal5 <= 0.01, `FrontDesk live balance (${liveBal5}) <= 0.01 moves checked-out Master Room to Check-Out History`);

  console.log('\nALL MASTER ROOM PAYMENT ALLOCATION TESTS PASSED!');
}

runSuite();
