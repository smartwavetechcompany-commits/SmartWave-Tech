import assert from 'node:assert/strict';
import {
  canDepositToGuestAccount,
  getAvailableGuestDeposit,
  validateDepositApplication,
} from '../services/guestDepositService';
import { isPrimaryHotelAdminUser } from '../utils/permissions';
import type { Guest } from '../types';

function runGuestDepositTests() {
  // 1. getAvailableGuestDeposit boundary cases
  assert.equal(getAvailableGuestDeposit(null), 0, 'null guest returns 0');
  assert.equal(getAvailableGuestDeposit(undefined), 0, 'undefined guest returns 0');
  assert.equal(getAvailableGuestDeposit({} as Partial<Guest>), 0, 'missing depositBalance returns 0');
  assert.equal(getAvailableGuestDeposit({ depositBalance: -50 }), 0, 'negative depositBalance clamps to 0');
  assert.equal(getAvailableGuestDeposit({ depositBalance: 12500.456 }), 12500.46, 'depositBalance rounds to 2 decimals');

  // 2. validateDepositApplication boundary cases
  const zeroCheck = validateDepositApplication(50000, 0);
  assert.equal(zeroCheck.isValid, false);
  assert.equal(zeroCheck.appliedAmount, 0);

  const negCheck = validateDepositApplication(50000, -100);
  assert.equal(negCheck.isValid, false);

  const emptyWallet = validateDepositApplication(0, 1000);
  assert.equal(emptyWallet.isValid, false);
  assert.match(emptyWallet.error || '', /no available deposit/i);

  const overdraw = validateDepositApplication(25000, 30000);
  assert.equal(overdraw.isValid, false);
  assert.match(overdraw.error || '', /exceeds/i);

  const partial = validateDepositApplication(50000, 18500.5);
  assert.equal(partial.isValid, true);
  assert.equal(partial.appliedAmount, 18500.5);

  const exact = validateDepositApplication(50000, 50000);
  assert.equal(exact.isValid, true);
  assert.equal(exact.appliedAmount, 50000);

  // 3. Multi-visit carry-over & invariant simulation (deposit -> stay 1 -> checkout -> F&B -> returning stay 2 -> refund)
  let wallet: Guest = {
    id: 'guest_test_1',
    name: 'Amaka Okafor',
    email: 'amaka@example.com',
    phone: '08012345678',
    ledgerBalance: 0,
    totalStays: 0,
    totalNights: 0,
    totalSpent: 0,
    depositBalance: 0,
    totalDeposited: 0,
    totalDepositUsed: 0,
    totalDepositRefunded: 0,
  };

  // Guest deposits ₦200,000 ahead of stay 1
  const initialDeposit = 200000;
  wallet = {
    ...wallet,
    depositBalance: (wallet.depositBalance || 0) + initialDeposit,
    totalDeposited: (wallet.totalDeposited || 0) + initialDeposit,
  };
  assert.equal(getAvailableGuestDeposit(wallet), 200000);

  // Stay 1 consumes ₦120,000; guest checks out with ₦80,000 remaining
  const stay1Charge = validateDepositApplication(getAvailableGuestDeposit(wallet), 120000);
  assert.equal(stay1Charge.isValid, true);
  wallet = {
    ...wallet,
    depositBalance: getAvailableGuestDeposit(wallet) - stay1Charge.appliedAmount,
    totalDepositUsed: (wallet.totalDepositUsed || 0) + stay1Charge.appliedAmount,
  };
  assert.equal(getAvailableGuestDeposit(wallet), 80000, 'Unused deposit remains on guest profile after check-out');

  // F&B dining order during return visit consumes ₦15,000
  const fbCharge = validateDepositApplication(getAvailableGuestDeposit(wallet), 15000);
  assert.equal(fbCharge.isValid, true);
  wallet = {
    ...wallet,
    depositBalance: getAvailableGuestDeposit(wallet) - fbCharge.appliedAmount,
    totalDepositUsed: (wallet.totalDepositUsed || 0) + fbCharge.appliedAmount,
  };
  assert.equal(getAvailableGuestDeposit(wallet), 65000);

  // Returning Stay 2 consumes ₦50,000
  const stay2Charge = validateDepositApplication(getAvailableGuestDeposit(wallet), 50000);
  assert.equal(stay2Charge.isValid, true);
  wallet = {
    ...wallet,
    depositBalance: getAvailableGuestDeposit(wallet) - stay2Charge.appliedAmount,
    totalDepositUsed: (wallet.totalDepositUsed || 0) + stay2Charge.appliedAmount,
  };
  assert.equal(getAvailableGuestDeposit(wallet), 15000);

  // Attempt to overdraw ₦20,000 against remaining ₦15,000 fails cleanly
  const badAttempt = validateDepositApplication(getAvailableGuestDeposit(wallet), 20000);
  assert.equal(badAttempt.isValid, false);

  // Refund final ₦15,000 unused balance
  const refundCheck = validateDepositApplication(getAvailableGuestDeposit(wallet), 15000);
  assert.equal(refundCheck.isValid, true);
  wallet = {
    ...wallet,
    depositBalance: getAvailableGuestDeposit(wallet) - refundCheck.appliedAmount,
    totalDepositRefunded: (wallet.totalDepositRefunded || 0) + refundCheck.appliedAmount,
  };

  assert.equal(getAvailableGuestDeposit(wallet), 0);
  assert.equal(
    (wallet.totalDeposited || 0) - (wallet.totalDepositUsed || 0) - (wallet.totalDepositRefunded || 0),
    wallet.depositBalance,
    'Wallet conservation invariant holds across deposit, usage across stays/F&B, and refund'
  );

  // 4. RBAC tests for deposit_guest_account
  assert.equal(canDepositToGuestAccount({ uid: 'sa1', role: 'superAdmin' }), true);
  assert.equal(canDepositToGuestAccount({ uid: 'ha1', role: 'hotelAdmin' }), true);
  assert.equal(
    canDepositToGuestAccount({ uid: 'fd1', role: 'staff', staffRole: 'frontDesk', permissions: ['view_guests', 'receive_payments'] }),
    false,
    'Front desk staff without deposit_guest_account cannot deposit money'
  );
  assert.equal(
    canDepositToGuestAccount({ uid: 'fd2', role: 'staff', staffRole: 'frontDesk', permissions: ['view_guests', 'deposit_guest_account'] }),
    true,
    'Staff granted deposit_guest_account can deposit money'
  );
  assert.equal(
    canDepositToGuestAccount(
      { uid: 'cashier1', role: 'staff', customRoleId: 'role_cashier', permissions: [] },
      [{ id: 'role_cashier', status: 'active', permissions: ['deposit_guest_account'] }]
    ),
    true,
    'Staff with custom role granting deposit_guest_account can deposit money'
  );
  assert.equal(
    canDepositToGuestAccount({ uid: 's1', role: 'staff', status: 'suspended', permissions: ['deposit_guest_account'] }),
    false,
    'Suspended staff cannot deposit money'
  );

  // 5. Primary HotelAdmin vs Created Staff subscription countdown visibility
  const hotelStub = { adminUIDs: ['primary_admin_uid', 'secondary_staff_admin_uid'] };
  assert.equal(
    isPrimaryHotelAdminUser({ uid: 'primary_admin_uid', role: 'hotelAdmin' }, hotelStub),
    true,
    'Primary Hotel Admin sees countdown'
  );
  assert.equal(
    isPrimaryHotelAdminUser({ uid: 'secondary_staff_admin_uid', role: 'hotelAdmin', activationEmailSentBy: 'primary_admin_uid' }, hotelStub),
    false,
    'Staff created by Hotel Admin (even with admin role) does not see countdown'
  );
  assert.equal(
    isPrimaryHotelAdminUser({ uid: 'staff_uid', role: 'staff', staffRole: 'frontDesk' }, hotelStub),
    false,
    'Regular staff does not see countdown'
  );

  console.log('ALL GUEST DEPOSIT TESTS PASSED');
}

runGuestDepositTests();
