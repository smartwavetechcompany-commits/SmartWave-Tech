import { BillingEngine, calculateBilling, getReservationLiveBalance } from './src/utils/billingEngine';
import { calculateReservationAccount, calculateCorporateUnpostedStayCharge } from './src/utils/financialUtils';
import { calculateStayDuration } from './src/utils/dateUtils';
import {
  resolveApplicableRoomRate,
  buildInitialRateSnapshot,
  ensureBaseRateSnapshot,
  appendExtensionToRateSnapshot,
  getNightlyRateForStayIndex,
  calculateBookedRoomTotal,
  computeOverstayNightAmount
} from './src/utils/rateSnapshot';
import { Hotel, LedgerEntry, RateConfiguration, Reservation, Room, RoomType } from './src/types';

function assertEqual(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`FAIL: ${message}. Expected ${expected}, got ${actual}`);
  }
  console.log(`  [PASS] ${message} (${actual})`);
}

function assert(condition: boolean, message: string) {
  if (!condition) {
    throw new Error(`FAIL: ${message}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runTests() {
  console.log('=== ROOM RATE SNAPSHOT & EXTENSION ISOLATION TEST SUITE ===\n');

  const baseHotel: Hotel = {
    id: 'hotel_rate_test',
    name: 'Rate Snapshot Test Hotel',
    plan: 'enterprise',
    subscriptionStatus: 'active',
    subscriptionExpiry: '2027-12-31T00:00:00Z',
    trackingCode: 'TEST-RATE',
    createdAt: '2026-01-01T00:00:00Z',
    roomLimit: 50,
    staffLimit: 20,
    modulesEnabled: [],
    defaultCheckInTime: '14:00',
    defaultCheckOutTime: '12:00',
    autoChargeOverstays: true,
    overstayPolicy: 'grace',
    overstayGraceHours: 1
  };

  const roomTypeStandard: RoomType = {
    id: 'rt_std',
    name: 'Standard',
    basePrice: 90000,
    capacity: 2,
    capacityAdults: 2,
    capacityChildren: 0,
    amenities: []
  };

  const room101: Room = {
    id: 'room_101',
    roomNumber: '101',
    type: 'Standard',
    roomTypeId: 'rt_std',
    price: 90000,
    status: 'clean',
    floor: '1',
    capacity: 2
  };

  // ---------------------------------------------------------------------------
  // SCENARIO 1: Existing Reservation Protected Against Room Price Increase
  // ---------------------------------------------------------------------------
  console.log('1. Existing Reservation After Room Price Increase');
  const initialRate = resolveApplicableRoomRate({
    room: room101,
    roomType: roomTypeStandard,
    targetDate: '2026-06-01'
  });
  assertEqual(initialRate.rate, 90000, 'Initial applicable room rate is 90,000');

  const snapshot1 = buildInitialRateSnapshot({
    checkIn: '2026-06-01',
    nights: 3,
    nightlyRate: initialRate.rate,
    rateSource: initialRate.rateSource,
    effectiveDate: initialRate.effectiveDate
  });

  const existingRes: Reservation = {
    id: 'res_existing_1',
    hotelId: baseHotel.id,
    guestId: 'guest_1',
    guestName: 'Ada Lovelace',
    roomId: room101.id,
    roomNumber: room101.roomNumber,
    checkIn: '2026-06-01',
    checkOut: '2026-06-04',
    nights: 3,
    status: 'checked_in',
    nightlyRate: 90000,
    originalNightlyRate: 90000,
    rateSnapshot: snapshot1,
    totalAmount: 270000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T10:00:00Z'
  };

  // Management increases room 101 price to 130,000
  const room101Increased: Room = { ...room101, price: 130000 };
  const hotelWithIncreasedRoom = { ...baseHotel, rooms: [room101Increased] } as any;

  const stayTimeBeforeCheckout = new Date('2026-06-03T10:00:00');
  assertEqual(
    BillingEngine.getNightlyRate(existingRes, hotelWithIncreasedRoom),
    90000,
    'Existing reservation nightly rate remains 90,000 after room price increase to 130,000'
  );
  assertEqual(
    calculateBookedRoomTotal(existingRes, 3, hotelWithIncreasedRoom),
    270000,
    'Existing reservation 3 booked nights remain 270,000'
  );
  const accIncreased = calculateReservationAccount(existingRes, hotelWithIncreasedRoom, [], {
    currentTime: stayTimeBeforeCheckout
  });
  assertEqual(accIncreased.totalRoomCharges, 270000, 'Account room charges stay 270,000');
  assertEqual(accIncreased.outstandingBalance, 270000, 'Account balance stays 270,000');

  // ---------------------------------------------------------------------------
  // SCENARIO 2: Existing Reservation Protected Against Room Price Reduction
  // ---------------------------------------------------------------------------
  console.log('\n2. Existing Reservation After Room Price Reduction');
  const room101Reduced: Room = { ...room101, price: 60000 };
  const hotelWithReducedRoom = { ...baseHotel, rooms: [room101Reduced] } as any;

  assertEqual(
    BillingEngine.getNightlyRate(existingRes, hotelWithReducedRoom),
    90000,
    'Existing reservation nightly rate remains 90,000 after room price drop to 60,000'
  );
  assertEqual(
    calculateBookedRoomTotal(existingRes, 3, hotelWithReducedRoom),
    270000,
    'Existing reservation 3 booked nights remain 270,000 after price drop'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 3: New Reservations Use Currently Applicable Room Rate
  // ---------------------------------------------------------------------------
  console.log('\n3. New Reservation Uses Currently Applicable Room Rate');
  const newBookingRate = resolveApplicableRoomRate({
    room: room101Reduced,
    roomType: roomTypeStandard,
    targetDate: '2026-06-05'
  });
  assertEqual(newBookingRate.rate, 60000, 'New booking picks up current room rate 60,000');
  assert(newBookingRate.rateSource === 'room_rate', 'Rate source recorded as room_rate');

  const rateConfigs: RateConfiguration[] = [
    {
      id: 'rc_std',
      roomTypeId: 'rt_std',
      baseRate: 90000,
      weekendRate: 115000,
      weekdayRate: 85000,
      seasonalRates: [
        { name: 'December Peak', startDate: '2026-12-20', endDate: '2026-12-31', rate: 150000 }
      ]
    }
  ];
  const seasonalRate = resolveApplicableRoomRate({
    room: room101,
    roomType: roomTypeStandard,
    rateConfigs,
    targetDate: '2026-12-24'
  });
  assertEqual(seasonalRate.rate, 150000, 'New seasonal booking uses seasonal rate 150,000');
  assert(seasonalRate.rateSource === 'seasonal_rate', 'Rate source recorded as seasonal_rate');

  // ---------------------------------------------------------------------------
  // SCENARIO 4: Stay Extension Uses Extension-Time Rate ONLY for Extension Nights
  // ---------------------------------------------------------------------------
  console.log('\n4. Stay Extension Applies Current Rate Only to Extension Nights & Preserves Snapshot');
  const stayToExtend: Reservation = {
    id: 'res_ext_1',
    hotelId: baseHotel.id,
    guestId: 'guest_2',
    guestName: 'Grace Hopper',
    roomId: room101.id,
    roomNumber: room101.roomNumber,
    checkIn: '2026-06-01',
    checkOut: '2026-06-03', // 2 original nights
    nights: 2,
    status: 'checked_in',
    nightlyRate: 50000,
    originalNightlyRate: 50000,
    rateSnapshot: buildInitialRateSnapshot({
      checkIn: '2026-06-01',
      nights: 2,
      nightlyRate: 50000,
      rateSource: 'room_rate',
      effectiveDate: '2026-06-01'
    }),
    totalAmount: 100000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T14:00:00Z'
  };

  // Room price changes to 80,000 before extension confirmation
  const roomAtExtensionTime: Room = { ...room101, price: 80000 };
  const extRateAtConfirm = resolveApplicableRoomRate({
    room: roomAtExtensionTime,
    roomType: roomTypeStandard,
    targetDate: stayToExtend.checkOut
  });
  assertEqual(extRateAtConfirm.rate, 80000, 'Extension confirmation reads current applicable rate 80,000');

  const extendedSnapshot = appendExtensionToRateSnapshot({
    res: stayToExtend,
    previousCheckOut: '2026-06-03',
    newCheckOut: '2026-06-05',
    extraNights: 2,
    extensionRate: extRateAtConfirm.rate,
    extensionRateSource: extRateAtConfirm.rateSource,
    confirmedBy: 'manager@hotel.com'
  });

  const extendedRes: Reservation = {
    ...stayToExtend,
    checkOut: '2026-06-05',
    nights: 4,
    totalAmount: 260000, // 2*50k + 2*80k
    rateSnapshot: extendedSnapshot
  };

  // Later management increases room price AGAIN to 110,000!
  const roomAfterExtension: Room = { ...room101, price: 110000 };
  const hotelAfterExtension = { ...baseHotel, rooms: [roomAfterExtension] } as any;

  assertEqual(getNightlyRateForStayIndex(extendedRes, 1, hotelAfterExtension).rate, 50000, 'Night 1 remains original 50,000');
  assertEqual(getNightlyRateForStayIndex(extendedRes, 2, hotelAfterExtension).rate, 50000, 'Night 2 remains original 50,000');
  assertEqual(getNightlyRateForStayIndex(extendedRes, 3, hotelAfterExtension).rate, 80000, 'Night 3 (extension) locked at 80,000');
  assertEqual(getNightlyRateForStayIndex(extendedRes, 4, hotelAfterExtension).rate, 80000, 'Night 4 (extension) locked at 80,000');
  assert(getNightlyRateForStayIndex(extendedRes, 1, hotelAfterExtension).segment === 'original', 'Night 1 segment is original');
  assert(getNightlyRateForStayIndex(extendedRes, 3, hotelAfterExtension).segment === 'extension', 'Night 3 segment is extension');
  assert((extendedRes.rateSnapshot?.extensions?.length || 0) === 1, 'Extension record persisted in rateSnapshot.extensions');
  assertEqual(extendedRes.nightlyRate || 0, 50000, 'Reservation original nightlyRate remains 50,000');
  assertEqual(calculateBookedRoomTotal(extendedRes, 4, hotelAfterExtension), 260000, 'Total booked stay is 260,000 (100k + 160k) regardless of 110k current price');

  // ---------------------------------------------------------------------------
  // SCENARIO 5: Legacy Reservations Without Rate Snapshot Do NOT Use Live Price
  // ---------------------------------------------------------------------------
  console.log('\n5. Legacy Reservations Without Snapshot Compatibility');
  const legacyResTotalOnly: Reservation = {
    id: 'res_legacy_total',
    guestName: 'Legacy Guest A',
    roomId: 'room_101',
    roomNumber: '101',
    checkIn: '2026-06-01',
    checkOut: '2026-06-03',
    nights: 2,
    status: 'checked_in',
    totalAmount: 140000, // 70,000 / night agreed originally (no nightlyRate, no rateSnapshot)
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T10:00:00Z'
  };
  assertEqual(
    BillingEngine.getNightlyRate(legacyResTotalOnly, hotelAfterExtension),
    70000,
    'Legacy reservation without nightlyRate/rateSnapshot infers 70,000 from totalAmount/nights (not live 110,000 room price)'
  );
  assertEqual(
    getNightlyRateForStayIndex(legacyResTotalOnly, 2, hotelAfterExtension).rate,
    70000,
    'Overnight charge lookup for legacy reservation uses 70,000 (not 110,000)'
  );

  const legacySnapshotFrozen = ensureBaseRateSnapshot(legacyResTotalOnly, hotelAfterExtension);
  assertEqual(legacySnapshotFrozen.originalNightlyRate, 70000, 'ensureBaseRateSnapshot freezes legacy agreed rate at 70,000');

  // Legacy reservation with posted ledger debit (even if totalAmount was 0 and room price later changed to 110,000)
  const legacyLedger: LedgerEntry[] = [
    {
      id: 'leg_deb_1',
      guestId: 'g_leg',
      hotelId: baseHotel.id,
      reservationId: 'res_legacy_ledger',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 65000,
      description: 'Room Charge: Room 101',
      timestamp: '2026-06-01T14:00:00Z',
      postedBy: 'system'
    }
  ];
  const legacyResLedgerBacked: Reservation = {
    id: 'res_legacy_ledger',
    guestName: 'Legacy Guest B',
    roomId: 'room_101',
    roomNumber: '101',
    checkIn: '2026-06-01',
    checkOut: '2026-06-03',
    nights: 2,
    status: 'checked_in',
    totalAmount: 0,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T10:00:00Z'
  };
  assertEqual(
    BillingEngine.getNightlyRate(legacyResLedgerBacked, hotelAfterExtension, legacyLedger),
    65000,
    'Legacy reservation without nightlyRate/totalAmount derives 65,000 from its posted room debit (not 110,000)'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 6: Unapproved Overstays Preserve Overstay Rules & Ignore Room Price Changes
  // ---------------------------------------------------------------------------
  console.log('\n6. Unapproved Overstays Preserve Overstay Policy Rules & Saved Rate');
  // Checkout was 2026-06-05 12:00. Grace = 1h (until 13:00).
  const withinGrace = new Date(2026, 5, 5, 12, 30, 0, 0); // June 5 12:30 local
  const pastGrace1Day = new Date(2026, 5, 5, 14, 0, 0, 0); // June 5 14:00 local (past 13:00)

  const stayGrace = calculateStayDuration(extendedRes.checkIn, extendedRes.checkOut, undefined, extendedRes.status, {
    hotel: hotelAfterExtension,
    res: extendedRes,
    currentTime: withinGrace
  });
  assertEqual(stayGrace.overstayNights, 0, 'Grace period respected: 0 overstay nights within 1h grace');

  const stayOverstay = calculateStayDuration(extendedRes.checkIn, extendedRes.checkOut, undefined, extendedRes.status, {
    hotel: hotelAfterExtension,
    res: extendedRes,
    currentTime: pastGrace1Day
  });
  assertEqual(stayOverstay.overstayNights, 1, 'Past grace triggers 1 unapproved overstay night');
  assertEqual(
    BillingEngine.calculateOverstay(extendedRes, hotelAfterExtension, { currentTime: pastGrace1Day }),
    50000,
    'Overstay uses saved reservation rate (50,000), NEVER current live room price (110,000)'
  );

  // Partial overstay policy check (preserves PMS integer overstayNights + partial percentage pricing)
  const partialHotel: Hotel = {
    ...hotelAfterExtension,
    overstayPolicy: 'partial',
    overstayGraceHours: 1,
    overstayPartialHours: 4,
    overstayPartialPercentage: 50
  };
  const partialOverstayTime = new Date(2026, 5, 5, 15, 0, 0, 0); // 2h past 13:00 deadline (inside partialHours 4)
  const partialStay = calculateStayDuration(extendedRes.checkIn, extendedRes.checkOut, undefined, extendedRes.status, {
    hotel: partialHotel,
    res: extendedRes,
    currentTime: partialOverstayTime
  });
  assertEqual(partialStay.overstayNights, 1, 'Partial overstay triggers 1 overstay period');
  const savedOverstayRate = BillingEngine.getNightlyRate(extendedRes, partialHotel);
  assertEqual(savedOverstayRate, 50000, 'Overstay base rate uses saved reservation rate 50,000');
  assertEqual(
    computeOverstayNightAmount({
      nightlyRate: savedOverstayRate,
      hotel: partialHotel,
      overstayNightIndex: 1,
      hoursPastDeadline: 2
    }),
    25000,
    'Partial overstay within partialHours charges 50% of saved rate (25,000)'
  );
  assertEqual(
    computeOverstayNightAmount({
      nightlyRate: savedOverstayRate,
      hotel: partialHotel,
      overstayNightIndex: 1,
      hoursPastDeadline: 5
    }),
    50000,
    'Partial overstay beyond partialHours escalates to 100% of saved rate (50,000)'
  );

  // ---------------------------------------------------------------------------
  // SCENARIO 7: Folio & Account Totals Match Multi-Rate Ledger + Unposted Accruals
  // ---------------------------------------------------------------------------
  console.log('\n7. Multi-Rate Folio & Account Accuracy');
  const simulatedMultiRateLedger: LedgerEntry[] = [
    {
      id: 'l_n1',
      guestId: 'guest_2',
      hotelId: baseHotel.id,
      reservationId: extendedRes.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      referenceId: `${extendedRes.id}_NIGHT_1`,
      amount: 50000,
      description: 'Nightly Room Charge: 101 (Night 1 of 4)',
      timestamp: '2026-06-01T14:00:00Z',
      postedBy: 'system',
      rateSegment: 'original',
      appliedNightlyRate: 50000
    },
    {
      id: 'l_n2',
      guestId: 'guest_2',
      hotelId: baseHotel.id,
      reservationId: extendedRes.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      referenceId: `${extendedRes.id}_NIGHT_2`,
      amount: 50000,
      description: 'Nightly Room Charge: 101 (Night 2 of 4)',
      timestamp: '2026-06-02T12:05:00Z',
      postedBy: 'system',
      rateSegment: 'original',
      appliedNightlyRate: 50000
    },
    {
      id: 'l_n3',
      guestId: 'guest_2',
      hotelId: baseHotel.id,
      reservationId: extendedRes.id,
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      referenceId: `${extendedRes.id}_NIGHT_3`,
      amount: 80000,
      description: 'Nightly Room Charge [Extension]: 101 (Night 3 of 4)',
      timestamp: '2026-06-03T12:05:00Z',
      postedBy: 'system',
      rateSegment: 'extension',
      appliedNightlyRate: 80000
    }
  ];

  // Night 4 (June 4) accrued unposted, checked before June 5 checkout
  const checkTimeDay4 = new Date(2026, 5, 5, 10, 0, 0, 0);
  const folioMulti = BillingEngine.calculateFolioBreakdown(
    extendedRes,
    hotelAfterExtension,
    simulatedMultiRateLedger,
    checkTimeDay4
  );
  assertEqual(folioMulti.tier1.baseRoomGross, 260000, 'Folio baseRoomGross equals 2*50k + 2*80k = 260,000');
  assertEqual(folioMulti.tier3.totalCharges, 260000, 'Folio totalCharges equals 260,000 (posted 180k + unposted Night 4 80k)');
  assertEqual(folioMulti.tier3.outstandingBalance, 260000, 'Folio outstandingBalance equals 260,000');

  const accountMulti = calculateReservationAccount(
    extendedRes,
    hotelAfterExtension,
    simulatedMultiRateLedger,
    { currentTime: checkTimeDay4 }
  );
  assertEqual(accountMulti.totalRoomCharges, 260000, 'Account totalRoomCharges equals 260,000');
  assertEqual(accountMulti.outstandingBalance, 260000, 'Account outstandingBalance equals 260,000');

  const billingWrapper = calculateBilling(extendedRes, hotelAfterExtension, simulatedMultiRateLedger);
  assertEqual(billingWrapper.nightlyRate, 50000, 'calculateBilling exposes original confirmed nightlyRate 50,000');

  // ---------------------------------------------------------------------------
  // SCENARIO 8: Corporate Stay Extension Unposted Charge Sync
  // ---------------------------------------------------------------------------
  console.log('\n8. Corporate Stay Extension & Inclusive/Exclusive Tax Sync');
  const corpCheckInTime = new Date(2026, 10, 18, 9, 35, 0, 0); // Nov 18, 2026 09:35
  const corpSnapshot1 = buildInitialRateSnapshot({
    checkIn: '2026-11-18',
    nights: 1,
    nightlyRate: 70000,
    rateSource: 'corporate_rate',
    effectiveDate: '2026-11-18'
  });
  const corpSnapshotExtended = appendExtensionToRateSnapshot({
    res: {
      id: 'res_corp_margret',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      guestName: 'Margret',
      roomId: room101.id,
      roomNumber: '105',
      checkIn: '2026-11-18',
      checkOut: '2026-11-19',
      nights: 1,
      status: 'checked_in',
      corporateId: 'corp_smartwave',
      nightlyRate: 70000,
      originalNightlyRate: 70000,
      rateSnapshot: corpSnapshot1,
      totalAmount: 95000,
      paidAmount: 95000,
      paymentStatus: 'paid',
      autoNightDeduction: true,
      createdAt: '2026-11-18T09:35:00Z'
    },
    previousCheckOut: '2026-11-19',
    newCheckOut: '2026-11-21',
    extraNights: 2,
    extensionRate: 70000,
    extensionRateSource: 'corporate_rate',
    hotel: baseHotel,
    ledgerEntries: []
  });

  const extendedCorpRes: Reservation = {
    id: 'res_corp_margret',
    hotelId: baseHotel.id,
    guestId: 'guest_margret',
    guestName: 'Margret',
    roomId: room101.id,
    roomNumber: '105',
    checkIn: '2026-11-18',
    checkOut: '2026-11-21',
    nights: 3,
    status: 'checked_in',
    corporateId: 'corp_smartwave',
    nightlyRate: 70000,
    originalNightlyRate: 70000,
    rateSnapshot: corpSnapshotExtended,
    totalAmount: 235000,
    paidAmount: 95000,
    ledgerBalance: 0, // stale DB field overwritten by reconcileAndRepairReservationFinancials
    paymentStatus: 'paid',
    autoNightDeduction: true,
    createdAt: '2026-11-18T09:35:00Z'
  };

  const corpNight1Ledger: LedgerEntry[] = [
    {
      id: 'c_n1',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      referenceId: `${extendedCorpRes.id}_NIGHT_1`,
      amount: 70000,
      description: 'Room Charge: Room 105 (Night of Nov 18, 2026)',
      timestamp: '2026-11-18T09:35:00Z',
      postedBy: 'staff'
    },
    {
      id: 'c_svc',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'debit',
      category: 'service',
      amount: 25000,
      description: 'ironing',
      timestamp: '2026-11-18T09:36:00Z',
      postedBy: 'staff'
    },
    {
      id: 'c_pay',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'credit',
      category: 'payment',
      amount: 95000,
      description: 'Payment Received',
      timestamp: '2026-11-18T09:40:00Z',
      postedBy: 'staff'
    }
  ];

  assertEqual(
    calculateCorporateUnpostedStayCharge(extendedCorpRes, baseHotel, corpNight1Ledger, corpCheckInTime),
    140000,
    'Corporate unposted charge reflects +2 extended nights (140,000) immediately after extension'
  );
  assertEqual(
    getReservationLiveBalance(extendedCorpRes, baseHotel, corpNight1Ledger),
    140000,
    'getReservationLiveBalance returns 140,000 despite stale ledgerBalance=0'
  );

  // Night 2 later posts to ledger -> unposted drops cleanly to 70,000 (zero double-counting)
  const corpNight2Ledger: LedgerEntry[] = [
    ...corpNight1Ledger,
    {
      id: 'c_n2',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      referenceId: `${extendedCorpRes.id}_NIGHT_2`,
      amount: 70000,
      description: 'Nightly Room Charge [Extension]: Room 105 (Night of Nov 19, 2026)',
      timestamp: '2026-11-19T12:00:00Z',
      postedBy: 'system'
    }
  ];
  assertEqual(
    calculateCorporateUnpostedStayCharge(extendedCorpRes, baseHotel, corpNight2Ledger, new Date(2026, 10, 19, 13, 0, 0)),
    70000,
    'Corporate unposted charge drops to 70,000 once Night 2 posts to ledger'
  );

  // Inclusive 7.5% VAT split on Night 1 should reconstruct cleanly back to 70,000
  const inclusiveVatHotel: Hotel = {
    ...baseHotel,
    taxes: [{ id: 'vat_inc', name: 'VAT', percentage: 7.5, category: 'all', isInclusive: true, status: 'active', showOnReceipt: true, showOnFolio: true }]
  };
  const inclusiveLedger: LedgerEntry[] = [
    {
      id: 'ci_n1',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 65116.28,
      description: 'Room Charge: Room 105 (Night of Nov 18, 2026)',
      timestamp: '2026-11-18T09:35:00.000Z',
      postedBy: 'staff'
    },
    {
      id: 'ci_tax',
      hotelId: baseHotel.id,
      guestId: 'guest_margret',
      reservationId: extendedCorpRes.id,
      corporateId: 'corp_smartwave',
      type: 'debit',
      category: 'tax',
      amount: 4883.72,
      description: 'VAT (7.5%) [Inclusive] for Room Charge: Room 105 (Night of Nov 18, 2026)',
      timestamp: '2026-11-18T09:35:00.000Z',
      postedBy: 'staff'
    }
  ];
  assertEqual(
    calculateCorporateUnpostedStayCharge(extendedCorpRes, inclusiveVatHotel, inclusiveLedger, corpCheckInTime),
    140000,
    'Inclusive VAT split reconstructs Night 1 to 70,000 leaving exact 140,000 unposted'
  );

  // Exclusive 7.5% VAT adds 10,500 onto the 140,000 unposted room base
  const exclusiveVatHotel: Hotel = {
    ...baseHotel,
    taxes: [{ id: 'vat_exc', name: 'VAT', percentage: 7.5, category: 'all', isInclusive: false, status: 'active', showOnReceipt: true, showOnFolio: true }]
  };
  assertEqual(
    calculateCorporateUnpostedStayCharge(extendedCorpRes, exclusiveVatHotel, corpNight1Ledger, corpCheckInTime),
    150500,
    'Exclusive 7.5% VAT adds 10,500 onto 140,000 unposted room base (150,500)'
  );

  // Checked-out reservation yields 0 unposted corporate charge
  assertEqual(
    calculateCorporateUnpostedStayCharge({ ...extendedCorpRes, status: 'checked_out' }, baseHotel, corpNight1Ledger, corpCheckInTime),
    0,
    'Checked-out corporate reservation yields 0 unposted stay charge'
  );

  console.log('\nALL RATE SNAPSHOT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('\nTEST FAILURE:', err.message);
  process.exit(1);
});
