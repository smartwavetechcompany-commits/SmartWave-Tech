import type {
  CorporateAccount,
  CityLedgerAccountType,
  CityLedgerAccountStatus,
  CityLedgerInvoice,
  CityLedgerInvoiceStatus,
  CityLedgerInvoicePayment,
  CityLedgerInvoiceAdjustment,
  CityLedgerStatement,
  CityLedgerStatementLine,
  CityLedgerAgeingBucketTotals,
  CityLedgerAgeingInvoiceItem,
  CityLedgerAccountAgeingRow,
  CityLedgerReconciliationSummary,
  LedgerEntry,
  FinanceRecord,
  Reservation,
} from '../types';
import { hasPermission } from '../utils/permissions';

export const CITY_LEDGER_ACCOUNT_TYPE_LABELS: Record<CityLedgerAccountType, string> = {
  corporate: 'Corporate Organisation',
  travel_agency: 'Travel Agency / Tour Operator',
  event_client: 'Event / Banquet Client',
  government: 'Government Organisation',
  group_booking: 'Approved Group Booking',
  approved_guest: 'Approved Outstanding Guest',
};

export const CITY_LEDGER_ACCOUNT_STATUS_LABELS: Record<CityLedgerAccountStatus, string> = {
  pending: 'Pending Approval',
  active: 'Active',
  suspended: 'Suspended',
  closed: 'Closed',
};

export const CITY_LEDGER_INVOICE_STATUS_LABELS: Record<CityLedgerInvoiceStatus, string> = {
  draft: 'Draft',
  issued: 'Issued',
  partially_paid: 'Partially Paid',
  paid: 'Paid',
  overdue: 'Overdue',
  cancelled: 'Cancelled',
};

export const CITY_LEDGER_PAYMENT_TERM_OPTIONS = [
  { label: 'Immediate (0 Days)', terms: 'Immediate', days: 0 },
  { label: 'Net 7 Days', terms: 'Net 7', days: 7 },
  { label: 'Net 14 Days', terms: 'Net 14', days: 14 },
  { label: 'Net 30 Days', terms: 'Net 30', days: 30 },
  { label: 'Net 45 Days', terms: 'Net 45', days: 45 },
  { label: 'Net 60 Days', terms: 'Net 60', days: 60 },
  { label: 'Net 90 Days', terms: 'Net 90', days: 90 },
] as const;

export type CityLedgerAction =
  | 'view'
  | 'create_account'
  | 'edit_account'
  | 'approve_account'
  | 'suspend_or_close_account'
  | 'change_credit_limit'
  | 'transfer_balance'
  | 'create_invoice'
  | 'issue_invoice'
  | 'cancel_invoice'
  | 'record_payment'
  | 'apply_adjustment'
  | 'export_reports';

export const roundMoney = (val: number): number => {
  if (!Number.isFinite(val)) return 0;
  return Number(val.toFixed(2));
};

export const parseDateSafe = (value?: string | Date | null): Date | null => {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
};

export const formatISODateOnly = (value: Date | string): string => {
  const d = parseDateSafe(value) || new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

export const computeDueDate = (issueDate: string | Date, settlementDays = 30): string => {
  const base = parseDateSafe(issueDate) || new Date();
  const days = Math.max(0, Math.floor(Number(settlementDays) || 0));
  const due = new Date(base.getTime());
  due.setDate(due.getDate() + days);
  return formatISODateOnly(due);
};

export const parseSettlementDaysFromTerms = (paymentTerms?: string, fallbackDays = 30): number => {
  if (!paymentTerms) return fallbackDays;
  const lower = paymentTerms.toLowerCase().trim();
  if (lower.includes('immediate') || lower === 'due on receipt') return 0;
  const match = lower.match(/(\d+)/);
  if (match) {
    const parsed = parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 365) return parsed;
  }
  return fallbackDays;
};

export const resolveAccountSettlementDays = (account?: Partial<CorporateAccount> | null): number => {
  if (!account) return 30;
  if (typeof account.settlementDays === 'number' && Number.isFinite(account.settlementDays) && account.settlementDays >= 0) {
    return Math.floor(account.settlementDays);
  }
  if (account.paymentTerms) {
    return parseSettlementDaysFromTerms(account.paymentTerms, 30);
  }
  if (account.billingCycle === 'daily') return 1;
  if (account.billingCycle === 'weekly') return 7;
  if (account.billingCycle === 'quarterly') return 90;
  return 30;
};

export const getEffectiveAccountStatus = (account?: Partial<CorporateAccount> | null): CityLedgerAccountStatus => {
  if (!account) return 'pending';
  if (account.status === 'pending' || account.status === 'active' || account.status === 'suspended' || account.status === 'closed') {
    return account.status;
  }
  // Backward compatibility for legacy corporate accounts created before status workflow
  return 'active';
};

export const getEffectiveAccountType = (account?: Partial<CorporateAccount> | null): CityLedgerAccountType => {
  const valid: CityLedgerAccountType[] = [
    'corporate',
    'travel_agency',
    'event_client',
    'government',
    'group_booking',
    'approved_guest',
  ];
  if (account?.accountType && valid.includes(account.accountType)) {
    return account.accountType;
  }
  return 'corporate';
};

/**
 * Returns true ONLY when the City Ledger account is approved and active.
 * Legacy accounts without status/approvalStatus remain active for backward compatibility.
 */
export const isCityLedgerAccountActive = (account?: Partial<CorporateAccount> | null): boolean => {
  if (!account) return false;
  const status = getEffectiveAccountStatus(account);
  if (status !== 'active') return false;
  if (account.approvalStatus === 'pending' || account.approvalStatus === 'rejected') {
    return false;
  }
  return true;
};

export const validateAccountReceivableEligibility = (
  account?: Partial<CorporateAccount> | null
): { eligible: boolean; reason?: string } => {
  if (!account) {
    return { eligible: false, reason: 'Target City Ledger account was not found.' };
  }
  const status = getEffectiveAccountStatus(account);
  if (status === 'pending' || account.approvalStatus === 'pending') {
    return {
      eligible: false,
      reason: `Account "${account.name || account.id}" is pending approval and cannot receive transfers or invoices until approved and activated.`,
    };
  }
  if (account.approvalStatus === 'rejected') {
    return {
      eligible: false,
      reason: `Account "${account.name || account.id}" was rejected and cannot receive credit transfers.`,
    };
  }
  if (status === 'suspended') {
    return {
      eligible: false,
      reason: `Account "${account.name || account.id}" is suspended and cannot receive new balances or invoices.`,
    };
  }
  if (status === 'closed') {
    return {
      eligible: false,
      reason: `Account "${account.name || account.id}" is closed and cannot receive new balances or invoices.`,
    };
  }
  return { eligible: true };
};

export const validateCreditLimitHeadroom = (
  account: Partial<CorporateAccount>,
  additionalAmount: number
): {
  creditLimit: number;
  currentBalance: number;
  projectedBalance: number;
  availableCredit: number;
  exceedsLimit: boolean;
  excessAmount: number;
} => {
  const creditLimit = Math.max(0, Number(account.creditLimit) || 0);
  const currentBalance = Number(account.currentBalance) || 0;
  const add = Math.max(0, Number(additionalAmount) || 0);
  const projectedBalance = roundMoney(currentBalance + add);
  const availableCredit = roundMoney(Math.max(0, creditLimit - Math.max(0, currentBalance)));
  const exceedsLimit = creditLimit > 0 && projectedBalance > creditLimit + 0.01;
  const excessAmount = exceedsLimit ? roundMoney(projectedBalance - creditLimit) : 0;
  return {
    creditLimit,
    currentBalance,
    projectedBalance,
    availableCredit,
    exceedsLimit,
    excessAmount,
  };
};

export const generateCityLedgerAccountReference = (
  accountType: CityLedgerAccountType = 'corporate',
  existingReferences: string[] = [],
  now: Date = new Date()
): string => {
  const prefixMap: Record<CityLedgerAccountType, string> = {
    corporate: 'CORP',
    travel_agency: 'TRVL',
    event_client: 'EVNT',
    government: 'GOVT',
    group_booking: 'GRPB',
    approved_guest: 'APRG',
  };
  const prefix = prefixMap[accountType] || 'CORP';
  const year = now.getFullYear();
  const existingSet = new Set(existingReferences.map(r => (r || '').toUpperCase()));
  let seq = existingReferences.length + 1;
  while (seq < 99999) {
    const candidate = `CL-${prefix}-${year}-${String(seq).padStart(4, '0')}`;
    if (!existingSet.has(candidate)) return candidate;
    seq += 1;
  }
  return `CL-${prefix}-${year}-${Date.now().toString().slice(-5)}`;
};

export const generateCityLedgerInvoiceNumber = (
  existingInvoiceNumbers: string[] = [],
  now: Date = new Date()
): string => {
  const year = now.getFullYear();
  const existingSet = new Set(existingInvoiceNumbers.map(n => (n || '').toUpperCase()));
  let maxSeq = 0;
  const pattern = new RegExp(`^CL-INV-${year}-(\\d+)$`, 'i');
  existingInvoiceNumbers.forEach(num => {
    const match = (num || '').match(pattern);
    if (match) {
      const parsed = parseInt(match[1], 10);
      if (Number.isFinite(parsed) && parsed > maxSeq) maxSeq = parsed;
    }
  });
  let seq = maxSeq + 1;
  while (seq < 999999) {
    const candidate = `CL-INV-${year}-${String(seq).padStart(4, '0')}`;
    if (!existingSet.has(candidate)) return candidate;
    seq += 1;
  }
  return `CL-INV-${year}-${Date.now().toString().slice(-6)}`;
};

/**
 * Strict City Ledger RBAC evaluator reusing existing PMS permissions WITHOUT granting
 * any new permissions to unauthorized roles.
 */
export const canPerformCityLedgerAction = (
  profile: any,
  action: CityLedgerAction,
  customRoles: any[] = []
): boolean => {
  if (!profile) return false;
  if (profile.status === 'suspended' || profile.status === 'inactive') return false;
  if (profile.role === 'superAdmin' || profile.role === 'hotelAdmin' || profile.role === 'admin') {
    return true;
  }

  switch (action) {
    case 'view':
      return (
        hasPermission(profile, 'view_city_ledger', customRoles) ||
        hasPermission(profile, 'manage_corporate', customRoles)
      );
    case 'create_account':
    case 'edit_account':
      return hasPermission(profile, 'manage_corporate', customRoles);
    case 'approve_account':
    case 'suspend_or_close_account':
    case 'change_credit_limit':
      return (
        hasPermission(profile, 'approve_ledger_transactions', customRoles) ||
        hasPermission(profile, 'manage_corporate', customRoles)
      );
    case 'transfer_balance':
      return (
        hasPermission(profile, 'transfer_debt', customRoles) ||
        hasPermission(profile, 'manage_corporate', customRoles) ||
        hasPermission(profile, 'approve_ledger_transactions', customRoles)
      );
    case 'create_invoice':
    case 'issue_invoice':
      return (
        hasPermission(profile, 'manage_corporate', customRoles) ||
        hasPermission(profile, 'create_ledger_entries', customRoles) ||
        hasPermission(profile, 'approve_ledger_transactions', customRoles)
      );
    case 'cancel_invoice':
    case 'apply_adjustment':
      return (
        hasPermission(profile, 'approve_ledger_transactions', customRoles) ||
        hasPermission(profile, 'reverse_ledger_transactions', customRoles) ||
        hasPermission(profile, 'adjust_debt', customRoles)
      );
    case 'record_payment':
      return (
        hasPermission(profile, 'receive_payments', customRoles) ||
        hasPermission(profile, 'receive_payment', customRoles) ||
        hasPermission(profile, 'process_payments', customRoles)
      );
    case 'export_reports':
      return (
        hasPermission(profile, 'export_financial_data', customRoles) ||
        hasPermission(profile, 'export_reports', customRoles) ||
        hasPermission(profile, 'view_city_ledger', customRoles)
      );
    default:
      return false;
  }
};

export const enforceCityLedgerTenantIsolation = (
  expectedHotelId: string,
  recordHotelId?: string | null
): void => {
  if (!expectedHotelId || typeof expectedHotelId !== 'string') {
    throw new Error('Hotel tenant context is required for City Ledger operations.');
  }
  if (recordHotelId && recordHotelId !== expectedHotelId) {
    throw new Error('Tenant Isolation Violation: Cross-hotel City Ledger access is strictly prohibited.');
  }
};

/**
 * Checks whether an unpaid guest balance for a reservation has already been transferred to City Ledger
 * to guarantee idempotency and prevent duplicate transfer debits/credits.
 */
export const isDuplicateCityLedgerTransfer = (
  existingEntries: LedgerEntry[],
  reservationId: string,
  corporateId: string,
  amount: number,
  idempotencyKey?: string
): { isDuplicate: boolean; existingEntryId?: string; reason?: string } => {
  const normalizedResId = (reservationId || '').trim();
  const normalizedCorpId = (corporateId || '').trim();
  const roundedAmt = roundMoney(amount);

  for (const e of existingEntries) {
    if (e.category !== 'city_ledger') continue;
    // Match by explicit idempotencyKey
    if (idempotencyKey && e.idempotencyKey && e.idempotencyKey === idempotencyKey) {
      return {
        isDuplicate: true,
        existingEntryId: e.id,
        reason: `Duplicate City Ledger transfer blocked (idempotency key ${idempotencyKey} already posted).`,
      };
    }
    // Match by same reservation + corporate debit transfer for same amount (and not reversed)
    if (
      e.type === 'debit' &&
      e.reservationId === normalizedResId &&
      e.corporateId === normalizedCorpId &&
      Math.abs((Number(e.amount) || 0) - roundedAmt) < 0.01
    ) {
      const hasReversal = existingEntries.some(
        rev =>
          rev.type === 'credit' &&
          rev.reservationId === normalizedResId &&
          rev.corporateId === normalizedCorpId &&
          (rev.description || '').toLowerCase().includes('reversal') &&
          Math.abs((Number(rev.amount) || 0) - roundedAmt) < 0.01
      );
      if (!hasReversal) {
        return {
          isDuplicate: true,
          existingEntryId: e.id,
          reason: `This unpaid folio balance (${roundedAmt.toFixed(2)}) for reservation ${normalizedResId} has already been transferred to this City Ledger account.`,
        };
      }
    }
  }
  return { isDuplicate: false };
};

/**
 * Computes the effective live status of a City Ledger invoice as of a reference date,
 * dynamically classifying overdue unpaid/partially_paid invoices past dueDate.
 */
export const computeCityLedgerInvoiceStatus = (
  invoice: Pick<CityLedgerInvoice, 'status' | 'originalAmount' | 'amountPaid' | 'adjustmentsNet' | 'outstandingAmount' | 'dueDate'>,
  asOfDate: Date = new Date()
): CityLedgerInvoiceStatus => {
  if (invoice.status === 'cancelled') return 'cancelled';
  if (invoice.status === 'draft') return 'draft';

  const effectiveTotal = roundMoney(Math.max(0, (Number(invoice.originalAmount) || 0) + (Number(invoice.adjustmentsNet) || 0)));
  const paid = roundMoney(Math.max(0, Number(invoice.amountPaid) || 0));
  const outstanding = roundMoney(
    invoice.outstandingAmount !== undefined
      ? Math.max(0, Number(invoice.outstandingAmount) || 0)
      : Math.max(0, effectiveTotal - paid)
  );

  if (outstanding <= 0.01) {
    return 'paid';
  }

  const due = parseDateSafe(invoice.dueDate);
  if (due) {
    // Compare date-only so an invoice due today is NOT overdue until tomorrow
    const asOfDay = new Date(asOfDate.getFullYear(), asOfDate.getMonth(), asOfDate.getDate()).getTime();
    const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate()).getTime();
    if (asOfDay > dueDay) {
      return 'overdue';
    }
  }

  if (paid > 0.01) {
    return 'partially_paid';
  }

  return 'issued';
};

export interface ApplyInvoicePaymentInput {
  amount: number;
  paymentDate: string;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'cheque' | 'other';
  reference?: string;
  notes?: string;
  recordedBy: string;
  recordedByName: string;
  idempotencyKey: string;
  ledgerEntryId?: string;
}

/**
 * Pure, atomic partial/full payment transition for a City Ledger invoice.
 * Prevents overpayment, blocks draft/cancelled/already-paid invoices, and blocks duplicate payments via idempotencyKey.
 */
export const applyPaymentToCityLedgerInvoice = (
  invoice: CityLedgerInvoice,
  input: ApplyInvoicePaymentInput,
  asOfDate: Date = new Date()
): {
  updatedInvoice: CityLedgerInvoice;
  payment: CityLedgerInvoicePayment;
  isDuplicate: boolean;
} => {
  const existingPayments = Array.isArray(invoice.payments) ? invoice.payments : [];

  // Idempotency guard: never post the same payment twice
  const existingDup = existingPayments.find(
    p => p.idempotencyKey && p.idempotencyKey === input.idempotencyKey
  );
  if (existingDup) {
    return {
      updatedInvoice: invoice,
      payment: existingDup,
      isDuplicate: true,
    };
  }

  if (invoice.status === 'cancelled') {
    throw new Error(`Invoice ${invoice.invoiceNumber} is cancelled and cannot accept payments.`);
  }
  if (invoice.status === 'draft') {
    throw new Error(`Invoice ${invoice.invoiceNumber} is still a draft. Issue the invoice before recording payments.`);
  }

  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Payment amount must be greater than zero.');
  }

  const effectiveTotal = roundMoney(Math.max(0, (Number(invoice.originalAmount) || 0) + (Number(invoice.adjustmentsNet) || 0)));
  const currentPaid = roundMoney(Math.max(0, Number(invoice.amountPaid) || 0));
  const currentOutstanding = roundMoney(Math.max(0, effectiveTotal - currentPaid));

  if (currentOutstanding <= 0.01) {
    throw new Error(`Invoice ${invoice.invoiceNumber} is already fully paid.`);
  }

  if (amount > currentOutstanding + 0.01) {
    throw new Error(
      `Payment amount (${amount.toFixed(2)}) exceeds remaining invoice balance (${currentOutstanding.toFixed(2)}).`
    );
  }

  const newAmountPaid = roundMoney(Math.min(effectiveTotal, currentPaid + amount));
  const newOutstanding = roundMoney(Math.max(0, effectiveTotal - newAmountPaid));
  const nowISO = asOfDate.toISOString();

  const payment: CityLedgerInvoicePayment = {
    id: `clpay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    amount,
    paymentDate: input.paymentDate || formatISODateOnly(asOfDate),
    paymentMethod: input.paymentMethod,
    reference: input.reference?.trim() || undefined,
    notes: input.notes?.trim() || undefined,
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    recordedAt: nowISO,
    ledgerEntryId: input.ledgerEntryId,
    idempotencyKey: input.idempotencyKey,
  };

  const nextStatus = computeCityLedgerInvoiceStatus(
    {
      status: newOutstanding <= 0.01 ? 'paid' : 'partially_paid',
      originalAmount: invoice.originalAmount,
      amountPaid: newAmountPaid,
      adjustmentsNet: invoice.adjustmentsNet,
      outstandingAmount: newOutstanding,
      dueDate: invoice.dueDate,
    },
    asOfDate
  );

  const updatedInvoice: CityLedgerInvoice = {
    ...invoice,
    amountPaid: newAmountPaid,
    outstandingAmount: newOutstanding,
    status: nextStatus,
    payments: [...existingPayments, payment],
    lastPaymentAt: nowISO,
    updatedAt: nowISO,
  };

  return { updatedInvoice, payment, isDuplicate: false };
};

export interface ApplyInvoiceAdjustmentInput {
  type: 'credit_note' | 'debit_adjustment' | 'reversal';
  amount: number;
  reason: string;
  approvedBy: string;
  recordedBy: string;
  recordedByName: string;
  idempotencyKey: string;
  ledgerEntryId?: string;
}

export const applyAdjustmentToCityLedgerInvoice = (
  invoice: CityLedgerInvoice,
  input: ApplyInvoiceAdjustmentInput,
  asOfDate: Date = new Date()
): {
  updatedInvoice: CityLedgerInvoice;
  adjustment: CityLedgerInvoiceAdjustment;
  isDuplicate: boolean;
} => {
  const existingAdjustments = Array.isArray(invoice.adjustments) ? invoice.adjustments : [];
  const dup = existingAdjustments.find(a => a.idempotencyKey === input.idempotencyKey);
  if (dup) {
    return { updatedInvoice: invoice, adjustment: dup, isDuplicate: true };
  }

  if (invoice.status === 'cancelled') {
    throw new Error(`Cannot adjust cancelled invoice ${invoice.invoiceNumber}.`);
  }
  const amount = roundMoney(Number(input.amount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Adjustment amount must be greater than zero.');
  }
  if (!input.reason || input.reason.trim().length < 3) {
    throw new Error('A clear justification reason is required for City Ledger adjustments.');
  }

  const currentAdjNet = roundMoney(Number(invoice.adjustmentsNet) || 0);
  const previousOutstanding = roundMoney(Math.max(0, Number(invoice.outstandingAmount) || 0));

  const signedDelta = input.type === 'debit_adjustment' ? amount : -amount;
  if (signedDelta < 0 && amount > previousOutstanding + 0.01) {
    throw new Error(
      `Credit adjustment (${amount.toFixed(2)}) cannot exceed remaining invoice outstanding balance (${previousOutstanding.toFixed(2)}).`
    );
  }

  const newAdjNet = roundMoney(currentAdjNet + signedDelta);
  const newEffectiveTotal = roundMoney(Math.max(0, (Number(invoice.originalAmount) || 0) + newAdjNet));
  const newOutstanding = roundMoney(Math.max(0, newEffectiveTotal - (Number(invoice.amountPaid) || 0)));
  const nowISO = asOfDate.toISOString();

  const adjustment: CityLedgerInvoiceAdjustment = {
    id: `cladj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    type: input.type,
    amount,
    reason: input.reason.trim(),
    approvedBy: input.approvedBy,
    recordedBy: input.recordedBy,
    recordedByName: input.recordedByName,
    recordedAt: nowISO,
    ledgerEntryId: input.ledgerEntryId,
    previousOutstanding,
    newOutstanding,
    idempotencyKey: input.idempotencyKey,
  };

  const nextStatus = computeCityLedgerInvoiceStatus(
    {
      status: invoice.status === 'draft' ? 'draft' : (newOutstanding <= 0.01 ? 'paid' : 'issued'),
      originalAmount: invoice.originalAmount,
      amountPaid: invoice.amountPaid,
      adjustmentsNet: newAdjNet,
      outstandingAmount: newOutstanding,
      dueDate: invoice.dueDate,
    },
    asOfDate
  );

  const updatedInvoice: CityLedgerInvoice = {
    ...invoice,
    adjustmentsNet: newAdjNet,
    outstandingAmount: newOutstanding,
    status: nextStatus,
    adjustments: [...existingAdjustments, adjustment],
    updatedAt: nowISO,
  };

  return { updatedInvoice, adjustment, isDuplicate: false };
};

/**
 * Dynamically builds a reconciled Account Statement for a City Ledger account
 * over any date period directly from existing ledger entries and invoices.
 */
export const buildCityLedgerAccountStatement = (
  account: CorporateAccount,
  ledgerEntries: LedgerEntry[],
  invoices: CityLedgerInvoice[],
  options: {
    startDate?: string;
    endDate?: string;
    generatedAt?: Date;
  } = {}
): CityLedgerStatement => {
  const generatedAt = options.generatedAt || new Date();
  const accountEntries = ledgerEntries
    .filter(e => e.corporateId === account.id)
    .sort((a, b) => {
      const ta = parseDateSafe(a.timestamp)?.getTime() || 0;
      const tb = parseDateSafe(b.timestamp)?.getTime() || 0;
      return ta - tb;
    });

  const startMs = options.startDate
    ? new Date(`${options.startDate}T00:00:00.000`).getTime()
    : Number.NEGATIVE_INFINITY;
  const endMs = options.endDate
    ? new Date(`${options.endDate}T23:59:59.999`).getTime()
    : Number.POSITIVE_INFINITY;

  const invoiceById = new Map<string, CityLedgerInvoice>();
  const invoiceByNumber = new Map<string, CityLedgerInvoice>();
  const invoiceByTransferId = new Map<string, CityLedgerInvoice>();
  invoices
    .filter(inv => inv.corporateId === account.id)
    .forEach(inv => {
      invoiceById.set(inv.id, inv);
      invoiceByNumber.set(inv.invoiceNumber, inv);
      if (inv.sourceTransferLedgerId) {
        invoiceByTransferId.set(inv.sourceTransferLedgerId, inv);
      }
    });

  let openingBalance = 0;
  let invoicesRaised = 0;
  let paymentsReceived = 0;
  let adjustmentsNet = 0;
  const periodLines: CityLedgerStatementLine[] = [];

  for (const entry of accountEntries) {
    const entryDate = parseDateSafe(entry.timestamp);
    const tsMs = entryDate ? entryDate.getTime() : 0;
    const amt = roundMoney(Number(entry.amount) || 0);
    const signedDelta = entry.type === 'debit' ? amt : -amt;

    if (tsMs < startMs) {
      openingBalance = roundMoney(openingBalance + signedDelta);
      continue;
    }
    if (tsMs > endMs) {
      continue;
    }

    const cat = (entry.category || '').toLowerCase();
    const descLower = (entry.description || '').toLowerCase();
    const linkedInv =
      (entry.invoiceId ? invoiceById.get(entry.invoiceId) : undefined) ||
      (entry.invoiceNumber ? invoiceByNumber.get(entry.invoiceNumber) : undefined) ||
      (entry.referenceId ? invoiceByNumber.get(entry.referenceId) : undefined) ||
      (entry.id ? invoiceByTransferId.get(entry.id) : undefined);

    let lineType: CityLedgerStatementLine['type'] = 'charge';
    if (cat === 'payment' || cat === 'corporate_payment') {
      lineType = 'payment';
      if (entry.type === 'credit') {
        paymentsReceived = roundMoney(paymentsReceived + amt);
      } else {
        paymentsReceived = roundMoney(paymentsReceived - amt);
      }
    } else if (cat === 'adjustment' || cat === 'discount' || descLower.includes('reversal') || descLower.includes('credit note')) {
      lineType = 'adjustment';
      adjustmentsNet = roundMoney(adjustmentsNet + signedDelta);
    } else if (cat === 'city_ledger' || cat === 'transfer') {
      lineType = 'transfer';
      if (entry.type === 'debit') {
        invoicesRaised = roundMoney(invoicesRaised + amt);
      } else {
        adjustmentsNet = roundMoney(adjustmentsNet - amt);
      }
    } else {
      lineType = linkedInv ? 'invoice' : 'charge';
      if (entry.type === 'debit') {
        invoicesRaised = roundMoney(invoicesRaised + amt);
      } else {
        adjustmentsNet = roundMoney(adjustmentsNet - amt);
      }
    }

    const ref =
      entry.invoiceNumber ||
      linkedInv?.invoiceNumber ||
      entry.referenceCode ||
      entry.referenceId ||
      (entry.id ? entry.id.slice(-8).toUpperCase() : 'TXN');

    periodLines.push({
      id: entry.id || `stmt_${periodLines.length}`,
      date: entry.timestamp || generatedAt.toISOString(),
      dueDate: linkedInv?.dueDate,
      reference: ref,
      type: lineType,
      description: entry.description || `${entry.category || 'City Ledger'} ${entry.type}`,
      debit: entry.type === 'debit' ? amt : 0,
      credit: entry.type === 'credit' ? amt : 0,
      runningBalance: 0, // populated below
      recordedBy: entry.postedByName || entry.postedBy,
    });
  }

  let running = openingBalance;
  for (const line of periodLines) {
    running = roundMoney(running + line.debit - line.credit);
    line.runningBalance = running;
  }

  const closingBalance = running;

  return {
    accountId: account.id,
    accountName: account.name,
    accountType: getEffectiveAccountType(account),
    accountReference: account.accountReference,
    periodStart: options.startDate || (accountEntries[0]?.timestamp ? formatISODateOnly(accountEntries[0].timestamp) : formatISODateOnly(generatedAt)),
    periodEnd: options.endDate || formatISODateOnly(generatedAt),
    generatedAt: generatedAt.toISOString(),
    openingBalance,
    invoicesRaised,
    paymentsReceived,
    adjustmentsNet,
    closingBalance,
    lines: periodLines,
  };
};

export const classifyAgeingBucket = (daysPastDue: number): '0-30' | '31-60' | '61-90' | '90+' => {
  if (daysPastDue <= 30) return '0-30';
  if (daysPastDue <= 60) return '31-60';
  if (daysPastDue <= 90) return '61-90';
  return '90+';
};

const emptyAgeingBuckets = (): CityLedgerAgeingBucketTotals => ({
  bucket0To30: 0,
  bucket31To60: 0,
  bucket61To90: 0,
  bucketOver90: 0,
  totalOutstanding: 0,
  overdueTotal: 0,
  overdueInvoiceCount: 0,
  openInvoiceCount: 0,
});

const addInvoiceToBuckets = (target: CityLedgerAgeingBucketTotals, item: CityLedgerAgeingInvoiceItem) => {
  const amt = roundMoney(item.outstandingAmount);
  if (item.bucket === '0-30') target.bucket0To30 = roundMoney(target.bucket0To30 + amt);
  else if (item.bucket === '31-60') target.bucket31To60 = roundMoney(target.bucket31To60 + amt);
  else if (item.bucket === '61-90') target.bucket61To90 = roundMoney(target.bucket61To90 + amt);
  else target.bucketOver90 = roundMoney(target.bucketOver90 + amt);

  target.totalOutstanding = roundMoney(target.totalOutstanding + amt);
  target.openInvoiceCount += 1;
  if (item.daysPastDue > 0) {
    target.overdueTotal = roundMoney(target.overdueTotal + amt);
    target.overdueInvoiceCount += 1;
  }
};

/**
 * Dynamically computes the Debt Ageing Report across 0-30, 31-60, 61-90, and >90 days
 * directly from City Ledger invoices and existing ledger records (no separate debt records).
 * Strictly excludes settled, paid, cancelled, and draft invoices.
 */
export const buildCityLedgerAgeingReport = (
  accounts: CorporateAccount[],
  invoices: CityLedgerInvoice[],
  ledgerEntries: LedgerEntry[] = [],
  options: {
    asOfDate?: Date;
    accountId?: string;
    accountType?: CityLedgerAccountType | 'all';
    accountStatus?: CityLedgerAccountStatus | 'all';
    issueDateFrom?: string;
    issueDateTo?: string;
  } = {}
): {
  asOfDate: string;
  summary: CityLedgerAgeingBucketTotals;
  accounts: CityLedgerAccountAgeingRow[];
  invoices: CityLedgerAgeingInvoiceItem[];
} => {
  const asOf = options.asOfDate || new Date();
  const asOfMidnight = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate()).getTime();
  const accountMap = new Map<string, CorporateAccount>();
  accounts.forEach(a => accountMap.set(a.id, a));

  const filteredAccounts = accounts.filter(acc => {
    if (options.accountId && acc.id !== options.accountId) return false;
    if (options.accountType && options.accountType !== 'all' && getEffectiveAccountType(acc) !== options.accountType) {
      return false;
    }
    if (options.accountStatus && options.accountStatus !== 'all' && getEffectiveAccountStatus(acc) !== options.accountStatus) {
      return false;
    }
    return true;
  });

  const allowedAccountIds = new Set(filteredAccounts.map(a => a.id));
  const rowMap = new Map<string, CityLedgerAccountAgeingRow>();

  filteredAccounts.forEach(acc => {
    rowMap.set(acc.id, {
      ...emptyAgeingBuckets(),
      accountId: acc.id,
      accountName: acc.name,
      accountType: getEffectiveAccountType(acc),
      accountStatus: getEffectiveAccountStatus(acc),
      accountReference: acc.accountReference,
      creditLimit: Number(acc.creditLimit) || 0,
      paymentTerms: acc.paymentTerms || `Net ${resolveAccountSettlementDays(acc)}`,
      invoices: [],
    });
  });

  const fromMs = options.issueDateFrom ? new Date(`${options.issueDateFrom}T00:00:00.000`).getTime() : Number.NEGATIVE_INFINITY;
  const toMs = options.issueDateTo ? new Date(`${options.issueDateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;

  const ageingInvoices: CityLedgerAgeingInvoiceItem[] = [];
  const invoicedOutstandingByAccount = new Map<string, number>();

  for (const inv of invoices) {
    if (!allowedAccountIds.has(inv.corporateId)) continue;
    if (inv.status === 'cancelled' || inv.status === 'draft' || inv.status === 'paid') continue;

    const liveStatus = computeCityLedgerInvoiceStatus(inv, asOf);
    if (liveStatus === 'paid' || liveStatus === 'cancelled' || liveStatus === 'draft') continue;

    const effectiveTotal = roundMoney(Math.max(0, (Number(inv.originalAmount) || 0) + (Number(inv.adjustmentsNet) || 0)));
    const outstanding = roundMoney(Math.max(0, effectiveTotal - (Number(inv.amountPaid) || 0)));
    if (outstanding <= 0.01) continue;

    const issueParsed = parseDateSafe(inv.issueDate || inv.createdAt);
    const issueMs = issueParsed ? issueParsed.getTime() : asOfMidnight;
    if (issueMs < fromMs || issueMs > toMs) continue;

    const acc = accountMap.get(inv.corporateId);
    const dueParsed = parseDateSafe(inv.dueDate) || issueParsed || asOf;
    const dueMidnight = new Date(dueParsed.getFullYear(), dueParsed.getMonth(), dueParsed.getDate()).getTime();
    const daysPastDue = Math.max(0, Math.floor((asOfMidnight - dueMidnight) / (1000 * 60 * 60 * 24)));
    const bucket = classifyAgeingBucket(daysPastDue);

    const item: CityLedgerAgeingInvoiceItem = {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      corporateId: inv.corporateId,
      accountName: acc?.name || inv.accountName,
      accountType: getEffectiveAccountType(acc),
      accountStatus: getEffectiveAccountStatus(acc),
      issueDate: formatISODateOnly(issueParsed || asOf),
      dueDate: formatISODateOnly(dueParsed),
      daysPastDue,
      bucket,
      originalAmount: roundMoney(Number(inv.originalAmount) || 0),
      amountPaid: roundMoney(Number(inv.amountPaid) || 0),
      outstandingAmount: outstanding,
      status: liveStatus,
      reservationId: inv.reservationId,
      folioNumber: inv.folioNumber,
      guestName: inv.guestName,
    };

    ageingInvoices.push(item);
    invoicedOutstandingByAccount.set(
      inv.corporateId,
      roundMoney((invoicedOutstandingByAccount.get(inv.corporateId) || 0) + outstanding)
    );
    const row = rowMap.get(inv.corporateId);
    if (row) {
      row.invoices.push(item);
      addInvoiceToBuckets(row, item);
    }
  }

  // Transparent fallback for legacy uninvoiced corporate balances (accounts with active balance > invoiced total)
  for (const acc of filteredAccounts) {
    const accountBal = roundMoney(Math.max(0, Number(acc.currentBalance) || 0));
    const alreadyInvoiced = invoicedOutstandingByAccount.get(acc.id) || 0;
    const uninvoicedRemainder = roundMoney(accountBal - alreadyInvoiced);
    if (uninvoicedRemainder <= 0.01) continue;

    // Determine oldest open corporate debit date from ledger (fallback to account.createdAt)
    const corpDebits = ledgerEntries
      .filter(e => e.corporateId === acc.id && e.type === 'debit' && !e.invoiceId)
      .sort((a, b) => (parseDateSafe(a.timestamp)?.getTime() || 0) - (parseDateSafe(b.timestamp)?.getTime() || 0));

    const oldestDate = parseDateSafe(corpDebits[0]?.timestamp || acc.createdAt) || asOf;
    const oldestMs = oldestDate.getTime();
    if (oldestMs < fromMs || oldestMs > toMs) continue;

    const settlementDays = resolveAccountSettlementDays(acc);
    const computedDue = parseDateSafe(computeDueDate(oldestDate, settlementDays)) || oldestDate;
    const dueMidnight = new Date(computedDue.getFullYear(), computedDue.getMonth(), computedDue.getDate()).getTime();
    const daysPastDue = Math.max(0, Math.floor((asOfMidnight - dueMidnight) / (1000 * 60 * 60 * 24)));
    const bucket = classifyAgeingBucket(daysPastDue);

    const fallbackItem: CityLedgerAgeingInvoiceItem = {
      invoiceId: `uninvoiced_${acc.id}`,
      invoiceNumber: 'UNINVOICED-BAL',
      corporateId: acc.id,
      accountName: acc.name,
      accountType: getEffectiveAccountType(acc),
      accountStatus: getEffectiveAccountStatus(acc),
      issueDate: formatISODateOnly(oldestDate),
      dueDate: formatISODateOnly(computedDue),
      daysPastDue,
      bucket,
      originalAmount: uninvoicedRemainder,
      amountPaid: 0,
      outstandingAmount: uninvoicedRemainder,
      status: daysPastDue > 0 ? 'overdue' : 'issued',
      isUninvoicedLedgerFallback: true,
    };

    ageingInvoices.push(fallbackItem);
    const row = rowMap.get(acc.id);
    if (row) {
      row.invoices.push(fallbackItem);
      addInvoiceToBuckets(row, fallbackItem);
    }
  }

  const summary = emptyAgeingBuckets();
  ageingInvoices.forEach(item => addInvoiceToBuckets(summary, item));

  const accountRows = Array.from(rowMap.values())
    .filter(r => r.totalOutstanding > 0.01 || Boolean(options.accountId))
    .sort((a, b) => b.totalOutstanding - a.totalOutstanding);

  ageingInvoices.sort((a, b) => b.daysPastDue - a.daysPastDue || b.outstandingAmount - a.outstandingAmount);

  return {
    asOfDate: formatISODateOnly(asOf),
    summary,
    accounts: accountRows,
    invoices: ageingInvoices,
  };
};

/**
 * Dynamically reconciles Revenue Earned, Direct Guest Cash/Bank Collected, Outstanding Guest Balances,
 * Amounts Transferred to City Ledger, Corporate AR, City Ledger Collections, and Remaining Receivables.
 * Guarantees that neither City Ledger transfers nor City Ledger collections inflate Revenue Earned.
 */
export const buildCityLedgerReconciliation = (params: {
  ledgerEntries: LedgerEntry[];
  financeRecords?: FinanceRecord[];
  reservations?: Reservation[];
  corporateAccounts: CorporateAccount[];
  invoices: CityLedgerInvoice[];
  outstandingGuestBalancesTotal?: number;
}): CityLedgerReconciliationSummary => {
  const { ledgerEntries, corporateAccounts, invoices } = params;

  const nonRevenueDebitCategories = new Set([
    'payment',
    'refund',
    'transfer',
    'city_ledger',
    'discount',
  ]);

  let revenueEarned = 0;
  let directGuestCashBankCollected = 0;
  let transferredToCityLedger = 0;
  let corporateReceivablesGross = 0;
  let cityLedgerCollections = 0;

  for (const e of ledgerEntries) {
    const amt = roundMoney(Number(e.amount) || 0);
    if (amt <= 0) continue;
    const cat = (e.category || '').toLowerCase();
    const desc = (e.description || '').toLowerCase();

    if (e.type === 'debit') {
      // 1. Revenue Earned: ONLY actual operational charges (room, F&B, services, laundry, tax, corporate direct charges)
      // NEVER includes city_ledger transfers, balance transfers, payments, or refunds!
      if (!nonRevenueDebitCategories.has(cat)) {
        revenueEarned = roundMoney(revenueEarned + amt);
      }

      // 2. Amounts transferred to City Ledger (debit side on corporate account)
      if (cat === 'city_ledger' && e.corporateId) {
        transferredToCityLedger = roundMoney(transferredToCityLedger + amt);
      }

      // 3. Gross Corporate / City Ledger Receivables (all debits posted to a corporateId)
      if (e.corporateId && cat !== 'refund') {
        corporateReceivablesGross = roundMoney(corporateReceivablesGross + amt);
      }
    } else if (e.type === 'credit') {
      const isActualCashBankPayment =
        (cat === 'payment' || cat === 'corporate_payment' || (cat === 'city_ledger' && !desc.includes('transfer'))) &&
        e.paymentMethod !== 'deposit' &&
        e.fromGuestDeposit !== true;

      if (isActualCashBankPayment) {
        if (e.corporateId) {
          cityLedgerCollections = roundMoney(cityLedgerCollections + amt);
        } else {
          directGuestCashBankCollected = roundMoney(directGuestCashBankCollected + amt);
        }
      } else if (e.corporateId && (cat === 'adjustment' || cat === 'discount' || cat === 'transfer')) {
        // Non-cash credit notes / outbound corporate transfers reduce corporate receivables
        corporateReceivablesGross = roundMoney(Math.max(0, corporateReceivablesGross - amt));
      }
    }
  }

  const remainingCityLedgerReceivables = roundMoney(
    Math.max(0, corporateReceivablesGross - cityLedgerCollections)
  );

  const openInvoicesOutstandingTotal = roundMoney(
    invoices
      .filter(inv => inv.status !== 'cancelled' && inv.status !== 'draft' && inv.status !== 'paid')
      .reduce((sum, inv) => {
        const eff = Math.max(0, (Number(inv.originalAmount) || 0) + (Number(inv.adjustmentsNet) || 0) - (Number(inv.amountPaid) || 0));
        return sum + (eff > 0.01 ? eff : 0);
      }, 0)
  );

  const accountBalancesTotal = roundMoney(
    corporateAccounts.reduce((sum, acc) => sum + Math.max(0, Number(acc.currentBalance) || 0), 0)
  );

  const outstandingGuestBalances = roundMoney(Math.max(0, Number(params.outstandingGuestBalancesTotal) || 0));

  const reconciliationVariance = roundMoney(accountBalancesTotal - remainingCityLedgerReceivables);

  return {
    revenueEarned,
    directGuestCashBankCollected,
    outstandingGuestBalances,
    transferredToCityLedger,
    corporateReceivablesGross,
    cityLedgerCollections,
    remainingCityLedgerReceivables,
    openInvoicesOutstandingTotal,
    accountBalancesTotal,
    isRevenueFreeOfTransferDuplication: true,
    reconciliationVariance,
  };
};
