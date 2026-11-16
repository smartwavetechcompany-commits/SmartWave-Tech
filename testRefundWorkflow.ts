import assert from 'node:assert/strict';
import { validateRefundRequest } from './src/services/ledgerService';
import { BillingEngine } from './src/utils/billingEngine';
import { calculateReservationAccount } from './src/utils/financialUtils';
import { calculateGuestFinancialPosition, validateLedgerTransaction } from './src/services/financialService';
import { principalRoomService } from './src/services/principalRoomService';
import { canProcessRefund } from './src/utils/policyUtils';
import { Hotel, LedgerEntry, Reservation, UserProfile } from './src/types';

const hotel: Hotel = {
  id: 'hotel_1',
  name: 'Grand Test Hotel',
  plan: 'premium',
  subscriptionStatus: 'active',
  subscriptionExpiry: '2027-12-31',
  trackingCode: 'TRK1',
  createdAt: '2026-01-01T00:00:00.000Z',
  roomLimit: 50,
  staffLimit: 30,
  modulesEnabled: ['frontDesk', 'finance'],
  taxes: [],
  settings: {
    financial: {
      allowRefunds: true,
      requireApprovalForRefunds: false,
      allowDiscounts: true,
      requireApprovalForLargeDiscounts: false,
      largeDiscountThreshold: 10,
      allowManualLedgerAdjustments: true,
      allowExpenseManagement: true,
      allowFinancialReportViewing: true,
      allowExportingReports: true,
      allowInvoiceEditingAfterPayment: true,
      lockInvoicesAfterCheckout: false
    }
  } as any
};

// 1. validateRefundRequest unit tests
{
  const okPartial = validateRefundRequest({
    amount: 40000,
    availableCredit: 100000,
    method: 'transfer',
    reason: 'Early departure credit refund',
    refundDateTime: '2026-11-16T10:30:00.000Z'
  });
  assert.equal(okPartial.isValid, true, 'Partial refund within credit should be valid');

  const okFull = validateRefundRequest({
    amount: 100000,
    availableCredit: 100000,
    method: 'cash',
    reason: 'Full overpayment refund'
  });
  assert.equal(okFull.isValid, true, 'Full refund equal to available credit should be valid');

  const exceed = validateRefundRequest({
    amount: 100001,
    availableCredit: 100000,
    method: 'card',
    reason: 'Over limit attempt'
  });
  assert.equal(exceed.isValid, false, 'Refund exceeding available credit must fail');

  const zeroCredit = validateRefundRequest({
    amount: 5000,
    availableCredit: 0,
    method: 'cash',
    reason: 'No credit on account'
  });
  assert.equal(zeroCredit.isValid, false, 'Refund with zero credit must fail');

  const missingReason = validateRefundRequest({
    amount: 5000,
    availableCredit: 10000,
    method: 'cash',
    reason: '   '
  });
  assert.equal(missingReason.isValid, false, 'Refund without reason must fail');

  const badAmount = validateRefundRequest({
    amount: -500,
    availableCredit: 10000,
    method: 'cash',
    reason: 'Negative test'
  });
  assert.equal(badAmount.isValid, false, 'Negative refund amount must fail');
}

// 2. Folio & Account Math with Overpayment -> Partial Refund -> Full Refund
{
  const res: Reservation = {
    id: 'res_101',
    hotelId: 'hotel_1',
    guestId: 'guest_1',
    guestName: 'Ada Lovelace',
    roomId: 'rm_101',
    roomNumber: '101',
    checkIn: '2026-11-14',
    checkOut: '2026-11-16',
    nights: 2,
    status: 'checked_out',
    totalAmount: 180000,
    paidAmount: 280000,
    paymentStatus: 'paid',
    nightlyRate: 90000,
    autoNightlyDeduction: true,
    autoNightDeduction: true,
    createdAt: '2026-11-14T12:00:00.000Z'
  } as any;

  const baseLedger: LedgerEntry[] = [
    {
      id: 'l_room_1',
      hotelId: 'hotel_1',
      guestId: 'guest_1',
      reservationId: 'res_101',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 90000,
      description: 'Room Charge: Room 101 (Night of Nov 14, 2026)',
      timestamp: '2026-11-14T12:00:00.000Z',
      postedBy: 'system'
    },
    {
      id: 'l_room_2',
      hotelId: 'hotel_1',
      guestId: 'guest_1',
      reservationId: 'res_101',
      type: 'debit',
      category: 'room',
      chargeType: 'room_rate',
      amount: 90000,
      description: 'Room Charge: Room 101 (Night of Nov 15, 2026)',
      timestamp: '2026-11-15T12:00:00.000Z',
      postedBy: 'system'
    },
    {
      id: 'l_pay_1',
      hotelId: 'hotel_1',
      guestId: 'guest_1',
      reservationId: 'res_101',
      type: 'credit',
      category: 'payment',
      paymentMethod: 'transfer',
      amount: 280000,
      description: 'Payment via TRANSFER',
      timestamp: '2026-11-14T13:00:00.000Z',
      postedBy: 'staff_1'
    }
  ];

  // Initial overpayment: 100,000 credit
  const beforeRefund = BillingEngine.calculateFolioBreakdown(res, hotel, baseLedger);
  assert.equal(beforeRefund.tier3.totalCharges, 180000);
  assert.equal(beforeRefund.tier3.totalPayments, 280000);
  assert.equal(beforeRefund.tier3.totalRefunds, 0);
  assert.equal(beforeRefund.tier3.outstandingBalance, -100000);

  // Partial refund of 40,000
  const refund1: LedgerEntry = {
    id: 'l_ref_1',
    hotelId: 'hotel_1',
    guestId: 'guest_1',
    reservationId: 'res_101',
    type: 'debit',
    category: 'refund',
    paymentMethod: 'transfer',
    amount: 40000,
    description: 'Refund (TRANSFER): Partial excess refund',
    refundStatus: 'Refunded',
    refundReason: 'Partial excess refund',
    refundDateTime: '2026-11-16T10:00:00.000Z',
    referenceCode: 'TXN-REF-001',
    timestamp: '2026-11-16T10:00:00.000Z',
    postedBy: 'finance_1',
    idempotencyKey: 'refund_res_101_1'
  };
  assert.equal(validateLedgerTransaction(refund1).isValid, true);

  const ledgerAfterPartial = [...baseLedger, refund1];
  const afterPartial = BillingEngine.calculateFolioBreakdown(res, hotel, ledgerAfterPartial);
  assert.equal(afterPartial.tier3.totalCharges, 180000, 'Refund must not inflate totalCharges');
  assert.equal(afterPartial.tier3.totalPayments, 280000, 'Original payment must stay intact');
  assert.equal(afterPartial.tier3.totalRefunds, 40000, 'Refund total must be 40,000');
  assert.equal(afterPartial.tier3.totalPayments - afterPartial.tier3.totalRefunds, 240000, 'Remaining net paid must be 240,000');
  assert.equal(afterPartial.tier3.outstandingBalance, -60000, 'Remaining credit must be 60,000');
  assert.equal(afterPartial.tier3.creditBalance, 60000, 'Remaining creditBalance must be 60,000');

  const acctPartial = calculateReservationAccount(res, hotel, ledgerAfterPartial);
  assert.equal(acctPartial.totalPayments, 280000);
  assert.equal(acctPartial.totalRefunds, 40000);
  assert.equal(acctPartial.totalSpent, 240000);
  assert.equal(acctPartial.outstandingBalance, -60000);
  assert.equal(acctPartial.creditBalance, 60000);

  const guestPosPartial = calculateGuestFinancialPosition({ id: 'guest_1' } as any, [res], hotel, ledgerAfterPartial);
  assert.equal(guestPosPartial.outstandingBalance, -60000);
  assert.equal(guestPosPartial.totalSpent, 240000);

  // Full remaining refund of 60,000
  const refund2: LedgerEntry = {
    ...refund1,
    id: 'l_ref_2',
    amount: 60000,
    paymentMethod: 'cash',
    description: 'Refund (CASH): Final balance refund',
    idempotencyKey: 'refund_res_101_2'
  };
  const ledgerAfterFull = [...ledgerAfterPartial, refund2];
  const afterFull = BillingEngine.calculateFolioBreakdown(res, hotel, ledgerAfterFull);
  assert.equal(afterFull.tier3.totalRefunds, 100000);
  assert.equal(afterFull.tier3.totalPayments - afterFull.tier3.totalRefunds, 180000);
  assert.equal(afterFull.tier3.outstandingBalance, 0, 'Full credit refund leaves 0 balance');
  assert.equal(afterFull.tier3.creditBalance, 0, 'Full credit refund leaves 0 creditBalance');
}

// 3. Master + Linked Room Refund Cap Integrity
{
  const masterRes: Reservation = {
    id: 'res_m',
    hotelId: 'hotel_1',
    guestId: 'guest_m',
    guestName: 'Master Guest',
    roomId: 'r101',
    roomNumber: '101',
    checkIn: '2026-11-14',
    checkOut: '2026-11-16',
    nights: 2,
    status: 'checked_out',
    totalAmount: 180000,
    paidAmount: 380000,
    paymentStatus: 'paid',
    nightlyRate: 90000,
    isPrincipalRoom: true,
    linkedReservationIds: ['res_l'],
    linkedRoomNumbers: ['102'],
    autoNightDeduction: true,
    createdAt: '2026-11-14T12:00:00.000Z'
  };
  const linkedRes: Reservation = {
    id: 'res_l',
    hotelId: 'hotel_1',
    guestId: 'guest_l',
    guestName: 'Linked Guest',
    roomId: 'r102',
    roomNumber: '102',
    checkIn: '2026-11-14',
    checkOut: '2026-11-16',
    nights: 2,
    status: 'checked_out',
    totalAmount: 150000,
    paidAmount: 0,
    paymentStatus: 'unpaid',
    nightlyRate: 75000,
    principalReservationId: 'res_m',
    principalRoomNumber: '101',
    autoNightDeduction: true,
    createdAt: '2026-11-14T12:00:00.000Z'
  };
  const groupLedger: LedgerEntry[] = [
    { id: 'm1', hotelId: 'hotel_1', guestId: 'guest_m', reservationId: 'res_m', type: 'debit', category: 'room', chargeType: 'room_rate', amount: 180000, description: 'Room 101 stay', timestamp: '2026-11-14T12:00:00.000Z', postedBy: 'sys' },
    { id: 'm2', hotelId: 'hotel_1', guestId: 'guest_m', reservationId: 'res_m', type: 'credit', category: 'payment', paymentMethod: 'cash', amount: 380000, description: 'Payment via CASH', timestamp: '2026-11-14T13:00:00.000Z', postedBy: 'staff' },
    { id: 'l1', hotelId: 'hotel_1', guestId: 'guest_l', reservationId: 'res_l', type: 'debit', category: 'room', chargeType: 'room_rate', amount: 150000, description: 'Room 102 stay', timestamp: '2026-11-14T12:00:00.000Z', postedBy: 'sys' }
  ];
  const groupSummary = principalRoomService.calculateGroupFinancials(masterRes, [linkedRes], groupLedger, hotel);
  const masterCredit = Math.abs(Math.min(0, groupSummary.masterBalance));
  const groupCredit = Math.abs(Math.min(0, groupSummary.groupNetBalance));
  const maxGroupRefundable = Math.min(masterCredit, groupCredit);
  assert.equal(masterCredit, 200000);
  assert.equal(groupCredit, 50000);
  assert.equal(maxGroupRefundable, 50000, 'Group refundable credit must respect linked room debt');
}

// 4. Role & policy permission check
{
  const financeUser: UserProfile = {
    uid: 'fin1',
    email: 'fin@hotel.com',
    role: 'finance',
    permissions: ['process_refunds'],
    hotelId: 'hotel_1',
    status: 'active'
  } as any;
  const frontDeskNoRefund: UserProfile = {
    uid: 'fd1',
    email: 'fd@hotel.com',
    role: 'receptionist',
    permissions: ['process_payments'],
    hotelId: 'hotel_1',
    status: 'active'
  } as any;
  assert.equal(canProcessRefund(hotel, financeUser, 10000).allowed, true);
  assert.equal(canProcessRefund(hotel, frontDeskNoRefund, 10000).allowed, false);
}

console.log('ALL REFUND WORKFLOW TESTS PASSED!');
