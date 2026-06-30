import { BillingEngine } from './src/utils/billingEngine';
import { Reservation, Hotel, LedgerEntry } from './src/types';

// Simple assert helper
function assertEqual(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`FAIL: ${message}. Expected ${expected}, got ${actual}`);
  }
  console.log(`  [PASS] ${message}`);
}

async function runTests() {
  console.log('--- STARTING ENTERPRISE PMS BILLING ENGINE AUTOMATED TESTS ---');

  // We set a fixed currentTime for our test calculations (e.g. before the checkout date)
  const testCurrentTime = new Date('2026-06-05T10:00:00Z');

  // Test Case 1: Standard Room Charge Calculation (90,000 x 4 nights)
  console.log('\nTest Case 1: Standard Room Charge Calculation');
  const res1: Reservation = {
    id: 'res_001',
    guestName: 'John Doe',
    status: 'checked_in',
    roomId: 'room_101',
    roomNumber: '101',
    checkIn: '2026-06-01',
    checkOut: '2026-06-05',
    nights: 4,
    nightlyRate: 90000,
    totalAmount: 360000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T12:00:00Z'
  };
  const hotel: Hotel = {
    id: 'hotel_001',
    name: 'Enterprise Hotel',
    plan: 'enterprise',
    subscriptionStatus: 'active',
    subscriptionExpiry: '2027-01-01T00:00:00Z',
    trackingCode: 'ENT-001',
    createdAt: '2026-01-01T00:00:00Z',
    roomLimit: 100,
    staffLimit: 10,
    modulesEnabled: []
  };

  const billing1 = BillingEngine.calculateReservation(res1, hotel, [], { currentTime: testCurrentTime });
  assertEqual(billing1.roomCharge, 360000, 'Base room charge should be 360,000');
  assertEqual(billing1.grandTotal, 360000, 'Grand total without tax should be 360,000');
  assertEqual(billing1.balance, 360000, 'Balance should be 360,000');


  // Test Case 2: Overstay Charges (90,000 x 3 nights)
  console.log('\nTest Case 2: Overstay Calculation (Separate & Stored)');
  const res2: Reservation = {
    ...res1,
    id: 'res_002',
    overstayNights: 3
  };

  const billing2 = BillingEngine.calculateReservation(res2, hotel, [], { 
    allowOverstayCharges: true,
    currentTime: testCurrentTime
  });
  assertEqual(billing2.roomCharge, 360000, 'Base room charge remains 360,000');
  assertEqual(billing2.overstayCharge, 270000, 'Overstay charge for 3 nights should be 270,000');
  assertEqual(billing2.grandTotal, 630000, 'Grand total should be 630,000 (360k + 270k)');


  // Test Case 2b: Overstay Charges (Dynamic overstay past checkout by 1 day and 3 hours)
  console.log('\nTest Case 2b: Overstay Calculation (Dynamic overstay)');
  const dynamicOverstayTime = new Date('2026-06-06T15:30:00Z'); // 1 day and 3.5 hours past June 5th 12:00
  const billing2b = BillingEngine.calculateReservation(res1, hotel, [], {
    allowOverstayCharges: true,
    currentTime: dynamicOverstayTime
  });
  assertEqual(billing2b.roomCharge, 360000, 'Base room charge remains 360,000');
  assertEqual(billing2b.overstayCharge, 180000, 'Dynamic overstay past 1 day + grace period should charge 2 nights (180k)');


  // Test Case 3: Overstay Disabled policy check
  console.log('\nTest Case 3: Overstay Disabled Option Check');
  const billing3 = BillingEngine.calculateReservation(res2, hotel, [], { 
    allowOverstayCharges: false,
    currentTime: testCurrentTime
  });
  assertEqual(billing3.overstayCharge, 0, 'Overstay charge must be 0 when allowOverstayCharges is disabled');
  assertEqual(billing3.grandTotal, 360000, 'Grand total must remain 360,000');


  // Test Case 4: Exclusive Tax (VAT 7.5% added to subtotal)
  console.log('\nTest Case 4: Exclusive Tax Calculation (VAT 7.5% added)');
  const res4: Reservation = {
    id: 'res_004',
    guestName: 'Jane Smith',
    status: 'checked_in',
    roomId: 'room_102',
    roomNumber: '102',
    checkIn: '2026-06-01',
    checkOut: '2026-06-02',
    nights: 1,
    nightlyRate: 100000,
    totalAmount: 100000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-01T12:00:00Z'
  };

  const testCurrentTimeRes4 = new Date('2026-06-02T10:00:00Z');

  const billing4 = BillingEngine.calculateReservation(res4, hotel, [], {
    taxEnabled: true,
    taxInclusive: false,
    taxRate: 7.5,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing4.roomCharge, 100000, 'Base room charge 100,000');
  assertEqual(billing4.taxAmount, 7500, 'Exclusive tax (7.5% of 100k) should be 7,500');
  assertEqual(billing4.grandTotal, 107500, 'Grand total should be 107,500 (100k + 7.5k)');


  // Test Case 5: Inclusive Tax (VAT 7.5% included in subtotal)
  console.log('\nTest Case 5: Inclusive Tax Calculation (VAT 7.5% extracted)');
  const billing5 = BillingEngine.calculateReservation(res4, hotel, [], {
    taxEnabled: true,
    taxInclusive: true,
    taxRate: 7.5,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing5.roomCharge, 100000, 'Base room charge 100,000');
  assertEqual(billing5.taxAmount, 6976.74, 'Inclusive tax extracted should be 6,976.74');
  assertEqual(billing5.grandTotal, 100000, 'Grand total must remain 100,000 (tax should not increase total)');


  // Test Case 6: Service Charge Logic (10% Exclusive)
  console.log('\nTest Case 6: Exclusive Service Charge Logic (10% added)');
  const billing6 = BillingEngine.calculateReservation(res4, hotel, [], {
    serviceChargeEnabled: true,
    serviceChargeInclusive: false,
    serviceChargeRate: 10,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing6.roomCharge, 100000, 'Base room charge 100,000');
  assertEqual(billing6.serviceChargeAmount, 10000, 'Exclusive service charge should be 10,000');
  assertEqual(billing6.grandTotal, 110000, 'Grand total should be 110,000 (100k + 10k SC)');


  // Test Case 7: Inclusive Service Charge Logic (10% extracted)
  console.log('\nTest Case 7: Inclusive Service Charge Logic (10% extracted)');
  const billing7 = BillingEngine.calculateReservation(res4, hotel, [], {
    serviceChargeEnabled: true,
    serviceChargeInclusive: true,
    serviceChargeRate: 10,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing7.roomCharge, 100000, 'Base room charge 100,000');
  assertEqual(billing7.serviceChargeAmount, 9090.91, 'Inclusive service charge extracted should be 9,090.91');
  assertEqual(billing7.grandTotal, 100000, 'Grand total must remain 100,000');


  // Test Case 8: Dual taxes/charges (Exclusive 7.5% Tax + Exclusive 10% Service Charge)
  console.log('\nTest Case 8: Combined Exclusive Tax and Service Charge');
  const billing8 = BillingEngine.calculateReservation(res4, hotel, [], {
    taxEnabled: true,
    taxInclusive: false,
    taxRate: 7.5,
    serviceChargeEnabled: true,
    serviceChargeInclusive: false,
    serviceChargeRate: 10,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing8.roomCharge, 100000, 'Base room charge 100,000');
  assertEqual(billing8.taxAmount, 7500, 'Exclusive tax (7.5%) = 7,500');
  assertEqual(billing8.serviceChargeAmount, 10000, 'Exclusive SC (10%) = 10,000');
  assertEqual(billing8.grandTotal, 117500, 'Grand total should be 117,500 (100k + 7.5k + 10k)');


  // Test Case 9: Multiple Payments Logic
  console.log('\nTest Case 9: Multiple Partial Payments & Balance Calculations');
  const ledgerEntries: LedgerEntry[] = [
    { id: 'l_1', guestId: 'g_1', hotelId: 'h_1', type: 'credit', amount: 50000, description: 'First payment', timestamp: '2026-06-01', category: 'payment', postedBy: 'staff' },
    { id: 'l_2', guestId: 'g_1', hotelId: 'h_1', type: 'credit', amount: 30000, description: 'Second payment', timestamp: '2026-06-02', category: 'payment', postedBy: 'staff' },
    { id: 'l_3', guestId: 'g_1', hotelId: 'h_1', type: 'credit', amount: 100000, description: 'Third payment', timestamp: '2026-06-03', category: 'payment', postedBy: 'staff' }
  ];

  const billing9 = BillingEngine.calculateReservation(res4, hotel, ledgerEntries, {
    taxEnabled: true,
    taxInclusive: false,
    taxRate: 7.5,
    serviceChargeEnabled: true,
    serviceChargeInclusive: false,
    serviceChargeRate: 10,
    currentTime: testCurrentTimeRes4
  });
  assertEqual(billing9.grandTotal, 117500, 'Grand total is 117,500');
  assertEqual(billing9.totalPayments, 180000, 'Total paid sum of all credits is 180,000');
  assertEqual(billing9.balance, 0, 'Balance must be capped at 0 (max(0, 117.5k - 180k))');
  assertEqual(billing9.outstandingBalance, -62500, 'Outstanding balance can accurately go negative for credits/refunds (-62,500)');

  // Test Case 10: Double Counting & Projected Stay Bug Fix (User scenario)
  console.log('\nTest Case 10: Split Inclusive Taxes handling (User scenario of 90,000 split)');
  const res10: Reservation = {
    id: 'res_010',
    guestName: 'John Royce',
    status: 'checked_in',
    roomId: 'room_102',
    roomNumber: '102',
    checkIn: '2026-06-30',
    checkOut: '2026-07-01',
    nights: 1,
    nightlyRate: 90000,
    totalAmount: 90000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    autoNightDeduction: true,
    createdAt: '2026-06-30T10:00:00Z'
  };

  const splitLedgerEntries: LedgerEntry[] = [
    {
      id: 'l_room_1',
      guestId: 'g_royce',
      hotelId: 'h_1',
      type: 'debit',
      amount: 73016,
      category: 'room',
      chargeType: 'room_rate',
      description: 'Automated Nightly Charge: Room 102 (Night of Jun 30, 2026)',
      timestamp: '2026-06-30T10:31:00Z',
      postedBy: 'staff'
    },
    {
      id: 'l_sc_1',
      guestId: 'g_royce',
      hotelId: 'h_1',
      type: 'debit',
      amount: 10705,
      category: 'tax',
      description: 'SC (13.5%) [Inclusive] for Automated Nightly Charge: Room 102 (Night of Jun 30, 2026)',
      timestamp: '2026-06-30T10:31:00Z',
      postedBy: 'staff'
    },
    {
      id: 'l_tax_1',
      guestId: 'g_royce',
      hotelId: 'h_1',
      type: 'debit',
      amount: 6279,
      category: 'tax',
      description: 'Tax (7.5%) [Inclusive] for Automated Nightly Charge: Room 102 (Night of Jun 30, 2026)',
      timestamp: '2026-06-30T10:31:00Z',
      postedBy: 'staff'
    }
  ];

  const billing10 = BillingEngine.calculateReservation(res10, hotel, splitLedgerEntries, {
    taxEnabled: true,
    taxInclusive: true,
    taxRate: 7.5,
    serviceChargeEnabled: true,
    serviceChargeInclusive: true,
    serviceChargeRate: 13.5,
    currentTime: new Date('2026-06-30T12:00:00Z')
  });

  assertEqual(billing10.roomCharge, 90000, 'Expected Room Charge is 90,000');
  assertEqual(billing10.extraServices, 0, 'Extra services should be 0 (inclusive taxes merged/not incidentals)');
  assertEqual(billing10.projectedRoomCharge, 0, 'Projected unposted room charge must be 0 (fully posted via split entries)');
  assertEqual(billing10.grandTotal, 90000, 'Grand total should remain 90,000');
  assertEqual(billing10.balance, 90000, 'Outstanding balance should be exactly 90,000');

  console.log('\n--- ALL ENTERPRISE PMS BILLING ENGINE TESTS PASSED SUCCESSFULLY! ---');
}

runTests().catch(err => {
  console.error('\nTEST SUITE CRITICAL FAILURE:');
  console.error(err);
  process.exit(1);
});
