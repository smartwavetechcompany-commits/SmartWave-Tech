import { calculateBilling } from './src/utils/billingEngine';
import { Reservation, Hotel, LedgerEntry } from './src/types';
import { format, addDays, subDays } from 'date-fns';

function runTests() {
  console.log('----------------------------------------------------');
  console.log('RUNNING AUTOMATED BILLING ENGINE SCENARIO TESTS...');
  console.log('----------------------------------------------------');

  const today = new Date();
  const todayStr = format(today, 'yyyy-MM-dd');

  const mockHotel: Hotel = {
    id: 'test-hotel',
    name: 'Test PMS Hotel',
    overstayChargeTime: '12:00',
    defaultCheckOutTime: '12:00',
    autoChargeOverstays: true,
    taxes: []
  } as any;

  // SCENARIO 1: Typical Stay, Fully Paid, Checked out
  // Stay: 2 nights @ 90k = 180k
  // Paid: 180k
  // Expected Balance: 0
  {
    const reservation: Reservation = {
      id: 'res-1',
      guestId: 'guest-1',
      guestName: 'John Doe',
      roomId: 'room-1',
      roomNumber: '101',
      checkIn: format(subDays(today, 2), 'yyyy-MM-dd'),
      checkOut: todayStr,
      nights: 2,
      status: 'checked_out',
      totalAmount: 180000,
      paidAmount: 180000,
      totalDiscount: 0,
      nightlyRate: 90000
    } as any;

    const billing = calculateBilling(reservation, mockHotel);
    if (billing.nightsCount !== 2 || billing.outstandingBalance !== 0) {
      console.error('❌ Scenario 1 failed!', billing);
      process.exit(1);
    }
    console.log('`-> Scenario 1 (checked_out normal stay) PASSED! Expected 2 nights, Balance: 0');
  }

  // SCENARIO 2: Stay with Unposted Prepayment / Deposit
  // Booking stay: 2 nights @ 90000 = 180k
  // Paid: 90,000 prepayment at booking
  // Ledger has no entries yet (checking-in phase)
  // Expected Balance: 90,000 owing (room charges are projected is 180k, minus 90k deposit)
  {
    const reservation: Reservation = {
      id: 'res-2',
      guestId: 'guest-2',
      guestName: 'Jane Smith',
      roomId: 'room-2',
      roomNumber: '102',
      checkIn: todayStr,
      checkOut: format(addDays(today, 2), 'yyyy-MM-dd'),
      nights: 2,
      status: 'checked_in',
      totalAmount: 180000,
      paidAmount: 90000,
      totalDiscount: 0,
      nightlyRate: 90000
    } as any;

    const ledger: LedgerEntry[] = [];
    const billing = calculateBilling(reservation, mockHotel, ledger);

    if (billing.nightsCount !== 2 || billing.outstandingBalance !== 90000 || billing.projectedRoomCharge !== 180000) {
      console.error('❌ Scenario 2 failed!', billing);
      process.exit(1);
    }
    console.log('`-> Scenario 2 (Checked-in with prepayment) PASSED! Expected 2 nights, Projected Charges: 180k, Prepayment: 90k, Owing: 90k');
  }

  // SCENARIO 3: Calendar overstay
  // original stay 1 night @ 90k, guest paid 90k, but still checked-in after scheduled checkout
  // Let scheduled checkout be yesterday.
  // Expected Nights: 2 (elapsed 1 night + 1 overstay charge night)
  // Total charges: 180,000
  // Payments received: 90,000
  // Expected Balance: 90,000 owing (no double charges)
  {
    const reservation: Reservation = {
      id: 'res-3',
      guestId: 'guest-3',
      guestName: 'Ifeanyi Okoro',
      roomId: 'room-3',
      roomNumber: '103',
      checkIn: format(subDays(today, 1), 'yyyy-MM-dd'),
      checkOut: format(subDays(today, 1), 'yyyy-MM-dd'), // checked out yesterday but still checked-in!
      nights: 1,
      status: 'checked_in', 
      totalAmount: 90000,
      paidAmount: 90000,
      totalDiscount: 0,
      nightlyRate: 90000
    } as any;

    const billing = calculateBilling(reservation, mockHotel);
    if (billing.nightsCount !== 2 || billing.totalCharges !== 180000 || billing.outstandingBalance !== 90000) {
      console.error('❌ Scenario 3 failed!', billing);
      process.exit(1);
    }
    console.log('`-> Scenario 3 (Checked-in Guest overstay) PASSED! Expected 2 nights, Total Charges: 180k, Balance: 90k owing');
  }

  // SCENARIO 4: Stay with Ancillary services & ledger postings
  // Booking stay: 1 night @ 90,000 = 90k
  // Food services charge: 16,226 posted to ledger in real time
  // Payments made: 20,000 CASH
  // Total charges = 90k room + 16,226 food = 106,226
  // Total payments = 20,000
  // Expected Outstanding: 86,226
  {
    const reservation: Reservation = {
      id: 'res-4',
      guestId: 'guest-4',
      roomId: 'room-4',
      roomNumber: '104',
      status: 'checked_in',
      checkIn: todayStr,
      checkOut: format(addDays(today, 1), 'yyyy-MM-dd'),
      nights: 1,
      totalAmount: 106226, // totalAmount includes the food charge
      paidAmount: 20000,
      nightlyRate: 90000,
      totalDiscount: 0
    } as any;

    const ledger: LedgerEntry[] = [
      {
        id: 'ent-1',
        amount: 16226,
        type: 'debit',
        category: 'restaurant',
        description: 'Rice order',
        reservationId: 'res-4'
      } as any,
      {
        id: 'ent-2',
        amount: 20000,
        type: 'credit',
        category: 'payment',
        description: 'Payment Cash',
        reservationId: 'res-4'
      } as any
    ];

    const billing = calculateBilling(reservation, mockHotel, ledger);
    if (billing.projectedRoomCharge !== 90000 || billing.totalCharges !== 106226 || billing.outstandingBalance !== 86226) {
      console.error('❌ Scenario 4 failed!', billing);
      process.exit(1);
    }
    console.log('`-> Scenario 4 (Ancillary charges list sync) PASSED! Expected 1 night room, 16.2k ancillary, 20k paid, Owing: 86.2k');
  }

  console.log('----------------------------------------------------');
  console.log('ALL BILLING TESTS COMPLETED SUCCESSFULY!');
  console.log('----------------------------------------------------');
}

runTests();
