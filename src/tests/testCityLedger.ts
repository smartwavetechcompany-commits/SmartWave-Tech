import assert from 'node:assert/strict';
import {
  CITY_LEDGER_ACCOUNT_TYPE_LABELS,
  CITY_LEDGER_ACCOUNT_STATUS_LABELS,
  CITY_LEDGER_INVOICE_STATUS_LABELS,
  resolveAccountSettlementDays,
  computeDueDate,
  getEffectiveAccountStatus,
  getEffectiveAccountType,
  isCityLedgerAccountActive,
  validateAccountReceivableEligibility,
  validateCreditLimitHeadroom,
  generateCityLedgerAccountReference,
  generateCityLedgerInvoiceNumber,
  canPerformCityLedgerAction,
  enforceCityLedgerTenantIsolation,
  isDuplicateCityLedgerTransfer,
  computeCityLedgerInvoiceStatus,
  applyPaymentToCityLedgerInvoice,
  applyAdjustmentToCityLedgerInvoice,
  buildCityLedgerAccountStatement,
  classifyAgeingBucket,
  buildCityLedgerAgeingReport,
  buildCityLedgerReconciliation,
} from '../services/cityLedgerCore';
import type { CorporateAccount, CityLedgerInvoice, LedgerEntry } from '../types';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS: ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL: ${name}`);
    console.error(`        ${err?.message || err}`);
    failed++;
  }
}

const mkAccount = (partial: Partial<CorporateAccount>): CorporateAccount => ({
  id: partial.id || 'corp_1',
  hotelId: partial.hotelId || 'h1',
  name: partial.name || 'Acme Corp',
  accountType: partial.accountType || 'corporate',
  accountReference: partial.accountReference,
  status: partial.status || 'active',
  approvalStatus: partial.approvalStatus || 'approved',
  contactPerson: partial.contactPerson || 'Contact Person',
  email: partial.email || 'billing@example.com',
  phone: partial.phone || '+2348000000000',
  address: partial.address || '123 Victoria Island, Lagos',
  taxId: partial.taxId || 'TIN-0001',
  billingCycle: partial.billingCycle || 'monthly',
  creditLimit: partial.creditLimit ?? 1000000,
  currentBalance: partial.currentBalance ?? 0,
  totalDebits: partial.totalDebits ?? 0,
  totalCredits: partial.totalCredits ?? 0,
  paymentTerms: partial.paymentTerms || 'Net 30',
  settlementDays: partial.settlementDays ?? 30,
  createdAt: partial.createdAt || '2026-01-01T00:00:00Z',
});

const mkLedgerEntry = (
  partial: Partial<LedgerEntry> & Pick<LedgerEntry, 'id' | 'type' | 'category' | 'amount' | 'description' | 'timestamp'>
): LedgerEntry => ({
  hotelId: 'h1',
  guestId: '',
  postedBy: 'u1',
  ...partial,
});

const mkInvoice = (partial: Partial<CityLedgerInvoice>): CityLedgerInvoice => ({
  id: partial.id || 'inv_1',
  hotelId: partial.hotelId || 'h1',
  invoiceNumber: partial.invoiceNumber || 'CL-INV-2026-0001',
  corporateId: partial.corporateId || 'corp_1',
  accountName: partial.accountName || 'Acme Corp',
  accountType: partial.accountType || 'corporate',
  sourceType: partial.sourceType || 'folio_transfer',
  revenueAlreadyRecognized: partial.revenueAlreadyRecognized ?? true,
  description: partial.description || 'City Ledger Invoice',
  issueDate: partial.issueDate || '2026-04-01',
  dueDate: partial.dueDate || '2026-05-01',
  originalAmount: partial.originalAmount ?? 100000,
  amountPaid: partial.amountPaid ?? 0,
  adjustmentsNet: partial.adjustmentsNet ?? 0,
  outstandingAmount: partial.outstandingAmount ?? 100000,
  status: partial.status || 'issued',
  payments: partial.payments || [],
  adjustments: partial.adjustments || [],
  createdAt: partial.createdAt || '2026-04-01T10:00:00Z',
  createdBy: partial.createdBy || 'u1',
  createdByName: partial.createdByName || 'Admin',
});

console.log('\n=== City Ledger Accounts Receivable Test Suite ===\n');

test('Supports all 6 City Ledger account categories and payment term parsing', () => {
  const categories = Object.keys(CITY_LEDGER_ACCOUNT_TYPE_LABELS);
  assert.deepEqual(categories.sort(), [
    'approved_guest',
    'corporate',
    'event_client',
    'government',
    'group_booking',
    'travel_agency',
  ]);
  assert.equal(Object.keys(CITY_LEDGER_ACCOUNT_STATUS_LABELS).length, 4);
  assert.equal(Object.keys(CITY_LEDGER_INVOICE_STATUS_LABELS).length, 6);

  assert.equal(resolveAccountSettlementDays({ paymentTerms: 'Net 45' }), 45);
  assert.equal(resolveAccountSettlementDays({ paymentTerms: 'Immediate' }), 0);
  assert.equal(resolveAccountSettlementDays({ settlementDays: 14, paymentTerms: 'Net 30' }), 14);
  assert.equal(computeDueDate('2026-03-01', 30), '2026-03-31');
  assert.equal(getEffectiveAccountType({ accountType: 'government' }), 'government');
  assert.equal(getEffectiveAccountType({}), 'corporate');
});

test('Generates unique sequential City Ledger account references per category', () => {
  const refDate = new Date('2026-05-10T10:00:00Z');
  const first = generateCityLedgerAccountReference('travel_agency', [], refDate);
  assert.equal(first, 'CL-TRVL-2026-0001');

  const second = generateCityLedgerAccountReference('travel_agency', [first], refDate);
  assert.equal(second, 'CL-TRVL-2026-0002');

  const govRef = generateCityLedgerAccountReference('government', [first, second], refDate);
  assert.equal(govRef, 'CL-GOVT-2026-0003');
});

test('Blocks pending, rejected, suspended, and closed accounts from receiving transfers/invoices', () => {
  const pendingAcc: Partial<CorporateAccount> = { id: 'c1', name: 'Pending Corp', status: 'pending', approvalStatus: 'pending' };
  const rejectedAcc: Partial<CorporateAccount> = { id: 'c2', name: 'Rejected Corp', status: 'active', approvalStatus: 'rejected' };
  const suspendedAcc: Partial<CorporateAccount> = { id: 'c3', name: 'Suspended Corp', status: 'suspended', approvalStatus: 'approved' };
  const closedAcc: Partial<CorporateAccount> = { id: 'c4', name: 'Closed Corp', status: 'closed', approvalStatus: 'approved' };
  const activeAcc: Partial<CorporateAccount> = { id: 'c5', name: 'Active Corp', status: 'active', approvalStatus: 'approved' };
  const legacyAcc: Partial<CorporateAccount> = { id: 'c6', name: 'Legacy Corp' };

  assert.equal(isCityLedgerAccountActive(pendingAcc), false);
  assert.equal(validateAccountReceivableEligibility(pendingAcc).eligible, false);
  assert.equal(validateAccountReceivableEligibility(rejectedAcc).eligible, false);
  assert.equal(validateAccountReceivableEligibility(suspendedAcc).eligible, false);
  assert.equal(validateAccountReceivableEligibility(closedAcc).eligible, false);

  assert.equal(isCityLedgerAccountActive(activeAcc), true);
  assert.equal(validateAccountReceivableEligibility(activeAcc).eligible, true);

  assert.equal(getEffectiveAccountStatus(legacyAcc), 'active');
  assert.equal(isCityLedgerAccountActive(legacyAcc), true);
});

test('Calculates available credit headroom and detects credit limit breaches accurately', () => {
  const acc: Partial<CorporateAccount> = { creditLimit: 500000, currentBalance: 350000 };

  const within = validateCreditLimitHeadroom(acc, 100000);
  assert.equal(within.availableCredit, 150000);
  assert.equal(within.projectedBalance, 450000);
  assert.equal(within.exceedsLimit, false);
  assert.equal(within.excessAmount, 0);

  const breach = validateCreditLimitHeadroom(acc, 200000);
  assert.equal(breach.projectedBalance, 550000);
  assert.equal(breach.exceedsLimit, true);
  assert.equal(breach.excessAmount, 50000);

  const unlimited = validateCreditLimitHeadroom({ creditLimit: 0, currentBalance: 10000 }, 50000);
  assert.equal(unlimited.exceedsLimit, false);
});

test('Prevents duplicate City Ledger transfers by idempotencyKey and by reservation+account+amount', () => {
  const existing: LedgerEntry[] = [
    mkLedgerEntry({
      id: 'led_1',
      corporateId: 'corp_1',
      reservationId: 'res_101',
      type: 'debit',
      category: 'city_ledger',
      amount: 120000,
      description: 'Guest balance transferred to City Ledger',
      timestamp: '2026-04-01T12:00:00Z',
      idempotencyKey: 'cl_xfer_res_101_corp_1',
    }),
  ];

  const dupByKey = isDuplicateCityLedgerTransfer(existing, 'res_101', 'corp_1', 120000, 'cl_xfer_res_101_corp_1');
  assert.equal(dupByKey.isDuplicate, true);

  const dupByTuple = isDuplicateCityLedgerTransfer(existing, 'res_101', 'corp_1', 120000, 'another_key');
  assert.equal(dupByTuple.isDuplicate, true);

  const allowedOther = isDuplicateCityLedgerTransfer(existing, 'res_102', 'corp_1', 120000, 'key_other');
  assert.equal(allowedOther.isDuplicate, false);

  const withReversal: LedgerEntry[] = [
    ...existing,
    mkLedgerEntry({
      id: 'led_2',
      corporateId: 'corp_1',
      reservationId: 'res_101',
      type: 'credit',
      category: 'city_ledger',
      amount: 120000,
      description: 'Reversal of transferred balance',
      timestamp: '2026-04-02T12:00:00Z',
    }),
  ];
  const afterReversal = isDuplicateCityLedgerTransfer(withReversal, 'res_101', 'corp_1', 120000, 'new_key');
  assert.equal(afterReversal.isDuplicate, false);
});

test('Generates sequential invoice numbers per year', () => {
  const now = new Date('2026-06-15T10:00:00Z');
  assert.equal(generateCityLedgerInvoiceNumber([], now), 'CL-INV-2026-0001');
  assert.equal(
    generateCityLedgerInvoiceNumber(['CL-INV-2026-0001', 'CL-INV-2026-0007', 'CL-INV-2025-0099'], now),
    'CL-INV-2026-0008'
  );
});

test('Handles partial payment, full settlement, overpayment guard, and idempotency on City Ledger invoices', () => {
  const baseInvoice = mkInvoice({
    id: 'inv_1',
    invoiceNumber: 'CL-INV-2026-0001',
    originalAmount: 100000,
    outstandingAmount: 100000,
    status: 'issued',
  });

  const p1 = applyPaymentToCityLedgerInvoice(
    baseInvoice,
    {
      amount: 40000,
      paymentDate: '2026-04-10',
      paymentMethod: 'transfer',
      reference: 'TRF-001',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      idempotencyKey: 'pay_key_1',
    },
    new Date('2026-04-10T10:00:00Z')
  );
  assert.equal(p1.isDuplicate, false);
  assert.equal(p1.updatedInvoice.amountPaid, 40000);
  assert.equal(p1.updatedInvoice.outstandingAmount, 60000);
  assert.equal(p1.updatedInvoice.status, 'partially_paid');

  const dupP1 = applyPaymentToCityLedgerInvoice(
    p1.updatedInvoice,
    {
      amount: 40000,
      paymentDate: '2026-04-10',
      paymentMethod: 'transfer',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      idempotencyKey: 'pay_key_1',
    },
    new Date('2026-04-10T10:05:00Z')
  );
  assert.equal(dupP1.isDuplicate, true);
  assert.equal(dupP1.updatedInvoice.outstandingAmount, 60000);

  assert.throws(
    () =>
      applyPaymentToCityLedgerInvoice(
        p1.updatedInvoice,
        {
          amount: 65000,
          paymentDate: '2026-04-15',
          paymentMethod: 'transfer',
          recordedBy: 'u1',
          recordedByName: 'Admin',
          idempotencyKey: 'pay_over',
        },
        new Date('2026-04-15T10:00:00Z')
      ),
    /exceeds remaining invoice balance/i
  );

  const p2 = applyPaymentToCityLedgerInvoice(
    p1.updatedInvoice,
    {
      amount: 60000,
      paymentDate: '2026-04-20',
      paymentMethod: 'card',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      idempotencyKey: 'pay_key_2',
    },
    new Date('2026-04-20T10:00:00Z')
  );
  assert.equal(p2.updatedInvoice.amountPaid, 100000);
  assert.equal(p2.updatedInvoice.outstandingAmount, 0);
  assert.equal(p2.updatedInvoice.status, 'paid');

  assert.throws(
    () =>
      applyPaymentToCityLedgerInvoice(
        p2.updatedInvoice,
        {
          amount: 100,
          paymentDate: '2026-04-21',
          paymentMethod: 'cash',
          recordedBy: 'u1',
          recordedByName: 'Admin',
          idempotencyKey: 'pay_key_3',
        },
        new Date('2026-04-21T10:00:00Z')
      ),
    /already fully paid/i
  );

  assert.throws(
    () =>
      applyPaymentToCityLedgerInvoice(
        { ...baseInvoice, status: 'draft' },
        {
          amount: 1000,
          paymentDate: '2026-04-10',
          paymentMethod: 'cash',
          recordedBy: 'u1',
          recordedByName: 'Admin',
          idempotencyKey: 'pay_draft',
        }
      ),
    /still a draft/i
  );
  assert.throws(
    () =>
      applyPaymentToCityLedgerInvoice(
        { ...baseInvoice, status: 'cancelled' },
        {
          amount: 1000,
          paymentDate: '2026-04-10',
          paymentMethod: 'cash',
          recordedBy: 'u1',
          recordedByName: 'Admin',
          idempotencyKey: 'pay_cancel',
        }
      ),
    /cancelled/i
  );
});

test('Applies authorized credit notes and debit adjustments with validation and idempotency', () => {
  const inv = mkInvoice({
    id: 'inv_adj',
    invoiceNumber: 'CL-INV-2026-0002',
    sourceType: 'direct_invoice',
    revenueAlreadyRecognized: false,
    originalAmount: 50000,
    amountPaid: 20000,
    adjustmentsNet: 0,
    outstandingAmount: 30000,
    status: 'partially_paid',
  });

  assert.throws(
    () =>
      applyAdjustmentToCityLedgerInvoice(inv, {
        type: 'credit_note',
        amount: 35000,
        reason: 'Over-credit attempt',
        approvedBy: 'admin_1',
        recordedBy: 'u1',
        recordedByName: 'Admin',
        idempotencyKey: 'adj_over',
      }),
    /cannot exceed remaining/i
  );

  assert.throws(
    () =>
      applyAdjustmentToCityLedgerInvoice(inv, {
        type: 'credit_note',
        amount: 5000,
        reason: '',
        approvedBy: 'admin_1',
        recordedBy: 'u1',
        recordedByName: 'Admin',
        idempotencyKey: 'adj_noreason',
      }),
    /reason is required/i
  );

  const a1 = applyAdjustmentToCityLedgerInvoice(
    inv,
    {
      type: 'credit_note',
      amount: 10000,
      reason: 'Approved banquet rate rebate',
      approvedBy: 'admin_1',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      idempotencyKey: 'adj_1',
    },
    new Date('2026-04-12T10:00:00Z')
  );
  assert.equal(a1.updatedInvoice.adjustmentsNet, -10000);
  assert.equal(a1.updatedInvoice.outstandingAmount, 20000);
  assert.equal(a1.updatedInvoice.status, 'partially_paid');

  const a2 = applyAdjustmentToCityLedgerInvoice(
    a1.updatedInvoice,
    {
      type: 'credit_note',
      amount: 20000,
      reason: 'Full disputed balance waived by GM',
      approvedBy: 'admin_1',
      recordedBy: 'u1',
      recordedByName: 'Admin',
      idempotencyKey: 'adj_2',
    },
    new Date('2026-04-15T10:00:00Z')
  );
  assert.equal(a2.updatedInvoice.outstandingAmount, 0);
  assert.equal(a2.updatedInvoice.status, 'paid');
});

test('Builds accurate Account Statement with opening balance, period activity, running balance & closing balance', () => {
  const account = mkAccount({
    id: 'corp_stmt',
    name: 'Global Travels Ltd',
    accountType: 'travel_agency',
    accountReference: 'CL-TRVL-2026-0001',
    currentBalance: 135000,
    totalDebits: 250000,
    totalCredits: 115000,
  });

  const entries: LedgerEntry[] = [
    mkLedgerEntry({
      id: 'e1',
      corporateId: 'corp_stmt',
      type: 'debit',
      category: 'city_ledger',
      amount: 100000,
      description: 'January Stay Transfer',
      timestamp: '2026-01-15T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'e2',
      corporateId: 'corp_stmt',
      type: 'credit',
      category: 'payment',
      amount: 20000,
      description: 'Partial January Payment',
      timestamp: '2026-01-25T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'e3',
      corporateId: 'corp_stmt',
      type: 'debit',
      category: 'city_ledger',
      amount: 150000,
      description: 'February Group Transfer',
      invoiceNumber: 'CL-INV-2026-0010',
      timestamp: '2026-02-05T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'e4',
      corporateId: 'corp_stmt',
      type: 'credit',
      category: 'payment',
      amount: 85000,
      description: 'Bank Transfer Settlement',
      invoiceNumber: 'CL-INV-2026-0010',
      timestamp: '2026-02-18T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'e5',
      corporateId: 'corp_stmt',
      type: 'credit',
      category: 'discount',
      amount: 10000,
      description: 'Credit Note Rebate',
      invoiceNumber: 'CL-INV-2026-0010',
      timestamp: '2026-02-22T10:00:00Z',
    }),
  ];

  const stmt = buildCityLedgerAccountStatement(account, entries, [], {
    startDate: '2026-02-01',
    endDate: '2026-02-28',
  });

  assert.equal(stmt.openingBalance, 80000);
  assert.equal(stmt.invoicesRaised, 150000);
  assert.equal(stmt.paymentsReceived, 85000);
  assert.equal(stmt.adjustmentsNet, -10000);
  assert.equal(stmt.closingBalance, 135000);
  assert.equal(stmt.lines.length, 3);
  assert.equal(stmt.lines[0].runningBalance, 230000);
  assert.equal(stmt.lines[1].runningBalance, 145000);
  assert.equal(stmt.lines[2].runningBalance, 135000);
});

test('Dynamically classifies 0-30, 31-60, 61-90, and >90 ageing buckets and excludes paid/cancelled/draft', () => {
  assert.equal(classifyAgeingBucket(0), '0-30');
  assert.equal(classifyAgeingBucket(30), '0-30');
  assert.equal(classifyAgeingBucket(31), '31-60');
  assert.equal(classifyAgeingBucket(60), '31-60');
  assert.equal(classifyAgeingBucket(61), '61-90');
  assert.equal(classifyAgeingBucket(90), '61-90');
  assert.equal(classifyAgeingBucket(91), '90+');

  const asOf = new Date('2026-06-30T12:00:00Z');
  const accounts: CorporateAccount[] = [
    mkAccount({
      id: 'c_age_1',
      name: 'Alpha Corp',
      accountType: 'corporate',
      currentBalance: 400000,
    }),
    mkAccount({
      id: 'c_age_2',
      name: 'Ministry of Tourism',
      accountType: 'government',
      creditLimit: 2000000,
      currentBalance: 150000,
    }),
  ];

  const invoices: CityLedgerInvoice[] = [
    mkInvoice({ id: 'i1', corporateId: 'c_age_1', accountName: 'Alpha Corp', invoiceNumber: 'CL-INV-2026-0001', dueDate: '2026-06-20', originalAmount: 100000, outstandingAmount: 100000 }),
    mkInvoice({ id: 'i2', corporateId: 'c_age_1', accountName: 'Alpha Corp', invoiceNumber: 'CL-INV-2026-0002', dueDate: '2026-05-16', originalAmount: 150000, amountPaid: 50000, outstandingAmount: 100000, status: 'partially_paid' }),
    mkInvoice({ id: 'i3', corporateId: 'c_age_1', accountName: 'Alpha Corp', invoiceNumber: 'CL-INV-2026-0003', dueDate: '2026-04-16', originalAmount: 200000, outstandingAmount: 200000 }),
    mkInvoice({ id: 'i4', corporateId: 'c_age_2', accountName: 'Ministry of Tourism', accountType: 'government', invoiceNumber: 'CL-INV-2026-0004', dueDate: '2026-03-02', originalAmount: 150000, outstandingAmount: 150000 }),
    mkInvoice({ id: 'i5', corporateId: 'c_age_1', invoiceNumber: 'CL-INV-2026-0005', dueDate: '2026-02-01', originalAmount: 90000, amountPaid: 90000, outstandingAmount: 0, status: 'paid' }),
    mkInvoice({ id: 'i6', corporateId: 'c_age_1', invoiceNumber: 'CL-INV-2026-0006', dueDate: '2026-02-01', originalAmount: 80000, outstandingAmount: 80000, status: 'cancelled' }),
    mkInvoice({ id: 'i7', corporateId: 'c_age_1', invoiceNumber: 'CL-INV-2026-0007', dueDate: '2026-02-01', originalAmount: 70000, outstandingAmount: 70000, status: 'draft' }),
  ];

  const report = buildCityLedgerAgeingReport(accounts, invoices, [], { asOfDate: asOf });
  assert.equal(report.summary.bucket0To30, 100000);
  assert.equal(report.summary.bucket31To60, 100000);
  assert.equal(report.summary.bucket61To90, 200000);
  assert.equal(report.summary.bucketOver90, 150000);
  assert.equal(report.summary.totalOutstanding, 550000);
  assert.equal(report.summary.openInvoiceCount, 4);
  assert.equal(report.invoices.length, 4);

  const govOnly = buildCityLedgerAgeingReport(accounts, invoices, [], { asOfDate: asOf, accountType: 'government' });
  assert.equal(govOnly.summary.totalOutstanding, 150000);
  assert.equal(govOnly.summary.bucketOver90, 150000);
  assert.equal(govOnly.invoices.length, 1);

  assert.equal(computeCityLedgerInvoiceStatus(mkInvoice({ dueDate: '2026-06-30' }), asOf), 'issued');
  assert.equal(computeCityLedgerInvoiceStatus(mkInvoice({ dueDate: '2026-06-29' }), asOf), 'overdue');
});

test('Reconciles Revenue Earned, Guest Collections, Transfers, and City Ledger Settlements with ZERO duplicate revenue', () => {
  const entries: LedgerEntry[] = [
    mkLedgerEntry({
      id: 'l1',
      guestId: 'g1',
      reservationId: 'r1',
      type: 'debit',
      category: 'room',
      amount: 200000,
      description: 'Room stay charge',
      timestamp: '2026-05-01T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'l2',
      guestId: 'g1',
      reservationId: 'r1',
      type: 'credit',
      category: 'payment',
      paymentMethod: 'cash',
      amount: 50000,
      description: 'Direct guest partial cash payment',
      timestamp: '2026-05-01T12:00:00Z',
    }),
    mkLedgerEntry({
      id: 'l3',
      guestId: 'g1',
      reservationId: 'r1',
      type: 'credit',
      category: 'city_ledger',
      amount: 150000,
      description: 'Transferred to City Ledger: Acme Corp',
      timestamp: '2026-05-02T10:00:00Z',
    }),
    mkLedgerEntry({
      id: 'l4',
      corporateId: 'corp_1',
      reservationId: 'r1',
      type: 'debit',
      category: 'city_ledger',
      amount: 150000,
      description: 'Transferred from Guest Folio',
      timestamp: '2026-05-02T10:00:01Z',
    }),
    mkLedgerEntry({
      id: 'l5',
      corporateId: 'corp_1',
      type: 'credit',
      category: 'payment',
      paymentMethod: 'transfer',
      amount: 90000,
      description: 'City Ledger invoice partial payment',
      timestamp: '2026-05-10T10:00:00Z',
    }),
  ];

  const corpAccount = mkAccount({
    id: 'corp_1',
    name: 'Acme Corp',
    creditLimit: 500000,
    currentBalance: 60000,
  });

  const recon = buildCityLedgerReconciliation({
    ledgerEntries: entries,
    corporateAccounts: [corpAccount],
    invoices: [],
    outstandingGuestBalancesTotal: 0,
  });

  assert.equal(recon.revenueEarned, 200000);
  assert.equal(recon.directGuestCashBankCollected, 50000);
  assert.equal(recon.transferredToCityLedger, 150000);
  assert.equal(recon.corporateReceivablesGross, 150000);
  assert.equal(recon.cityLedgerCollections, 90000);
  assert.equal(recon.remainingCityLedgerReceivables, 60000);
  assert.equal(recon.accountBalancesTotal, 60000);
  assert.equal(recon.reconciliationVariance, 0);
  assert.equal(recon.isRevenueFreeOfTransferDuplication, true);
});

test('Enforces City Ledger RBAC and multi-tenant hotel isolation strictly', () => {
  const hotelAdmin = { uid: 'u_admin', role: 'hotelAdmin', status: 'active' };
  const suspendedAdmin = { uid: 'u_susp', role: 'hotelAdmin', status: 'suspended' };
  const housekeeper = { uid: 'u_hk', role: 'housekeeping', status: 'active', permissions: ['view_housekeeping'] };
  const accountant = {
    uid: 'u_acc',
    role: 'accountant',
    status: 'active',
    permissions: ['view_city_ledger', 'receive_payments', 'export_financial_data'],
  };

  assert.equal(canPerformCityLedgerAction(hotelAdmin, 'approve_account'), true);
  assert.equal(canPerformCityLedgerAction(hotelAdmin, 'apply_adjustment'), true);
  assert.equal(canPerformCityLedgerAction(suspendedAdmin, 'view'), false);

  assert.equal(canPerformCityLedgerAction(housekeeper, 'view'), false);
  assert.equal(canPerformCityLedgerAction(housekeeper, 'approve_account'), false);
  assert.equal(canPerformCityLedgerAction(housekeeper, 'record_payment'), false);
  assert.equal(canPerformCityLedgerAction(housekeeper, 'transfer_balance'), false);

  assert.equal(canPerformCityLedgerAction(accountant, 'view'), true);
  assert.equal(canPerformCityLedgerAction(accountant, 'record_payment'), true);
  assert.equal(canPerformCityLedgerAction(accountant, 'export_reports'), true);
  assert.equal(canPerformCityLedgerAction(accountant, 'approve_account'), false);
  assert.equal(canPerformCityLedgerAction(accountant, 'cancel_invoice'), false);

  assert.doesNotThrow(() => enforceCityLedgerTenantIsolation('hotel_A', 'hotel_A'));
  assert.doesNotThrow(() => enforceCityLedgerTenantIsolation('hotel_A', undefined));
  assert.throws(() => enforceCityLedgerTenantIsolation('hotel_A', 'hotel_B'), /Tenant Isolation Violation/i);
  assert.throws(() => enforceCityLedgerTenantIsolation('', 'hotel_A'), /Hotel tenant context is required/i);
});

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
if (failed > 0) {
  process.exit(1);
}
