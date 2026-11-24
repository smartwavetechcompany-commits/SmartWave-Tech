import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  where,
  setDoc,
  updateDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { logActivity } from '../utils/activityLogger';
import {
  CorporateAccount,
  CityLedgerAccountType,
  CityLedgerAccountStatus,
  CityLedgerInvoice,
  CityLedgerInvoiceStatus,
  LedgerEntry,
  Reservation,
} from '../types';
import {
  applyAdjustmentToCityLedgerInvoice,
  applyPaymentToCityLedgerInvoice,
  canPerformCityLedgerAction,
  computeCityLedgerInvoiceStatus,
  computeDueDate,
  enforceCityLedgerTenantIsolation,
  formatISODateOnly,
  generateCityLedgerAccountReference,
  generateCityLedgerInvoiceNumber,
  getEffectiveAccountStatus,
  getEffectiveAccountType,
  isDuplicateCityLedgerTransfer,
  resolveAccountSettlementDays,
  roundMoney,
  validateAccountReceivableEligibility,
  validateCreditLimitHeadroom,
} from './cityLedgerCore';
import {
  postToLedger,
  reconcileCorporateAccountBalance,
  settleLedger,
  transferToCityLedger,
} from './ledgerService';

const buildActor = (profile: any) => ({
  uid: profile?.uid || 'system',
  email: profile?.email || '',
  role: profile?.role || profile?.staffRole || 'staff',
  displayName: profile?.displayName || profile?.name || profile?.email || 'Staff',
});

const stripUndefined = <T extends Record<string, any>>(obj: T): T =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;

export interface CreateCityLedgerAccountInput {
  name: string;
  accountType: CityLedgerAccountType;
  accountReference?: string;
  contactPerson: string;
  email: string;
  phone: string;
  address: string;
  billingAddress?: string;
  taxId?: string;
  creditLimit: number;
  billingCycle: CorporateAccount['billingCycle'];
  paymentTerms?: string;
  settlementDays?: number;
  notes?: string;
}

/**
 * Creates a new City Ledger / Debtor account in PENDING status.
 * Accounts are NEVER auto-approved; an authorized approver must explicitly approve and activate them.
 */
export const createCityLedgerAccount = async (
  hotelId: string,
  input: CreateCityLedgerAccountInput,
  profile: any,
  customRoles: any[] = []
): Promise<CorporateAccount> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'create_account', customRoles)) {
    throw new Error('Access Denied: You do not have permission to create City Ledger accounts.');
  }

  const name = (input.name || '').trim();
  if (!name) throw new Error('Account / Organisation name is required.');
  const creditLimit = roundMoney(Math.max(0, Number(input.creditLimit) || 0));

  const existingSnap = await getDocs(collection(db, 'hotels', hotelId, 'corporate_accounts'));
  const existingRefs = existingSnap.docs
    .map(d => (d.data() as CorporateAccount).accountReference || '')
    .filter(Boolean);

  const actor = buildActor(profile);
  const nowISO = new Date().toISOString();
  const accountType = input.accountType || 'corporate';
  const settlementDays =
    typeof input.settlementDays === 'number' && Number.isFinite(input.settlementDays)
      ? Math.max(0, Math.floor(input.settlementDays))
      : resolveAccountSettlementDays({
          paymentTerms: input.paymentTerms,
          billingCycle: input.billingCycle,
        });
  const paymentTerms = (input.paymentTerms || '').trim() || (settlementDays === 0 ? 'Immediate' : `Net ${settlementDays}`);
  const accountReference =
    (input.accountReference || '').trim() ||
    generateCityLedgerAccountReference(accountType, existingRefs, new Date());

  const newDocRef = doc(collection(db, 'hotels', hotelId, 'corporate_accounts'));
  const payload: Omit<CorporateAccount, 'id'> = stripUndefined({
    hotelId,
    name,
    accountType,
    accountReference,
    contactPerson: (input.contactPerson || '').trim(),
    email: (input.email || '').trim(),
    phone: (input.phone || '').trim(),
    address: (input.address || '').trim(),
    billingAddress: (input.billingAddress || input.address || '').trim(),
    taxId: (input.taxId || '').trim(),
    creditLimit,
    currentBalance: 0,
    totalDebits: 0,
    totalCredits: 0,
    billingCycle: input.billingCycle || 'monthly',
    paymentTerms,
    settlementDays,
    status: 'pending' as CityLedgerAccountStatus,
    approvalStatus: 'pending' as const,
    createdAt: nowISO,
    createdBy: actor.uid,
    createdByName: actor.displayName,
    notes: (input.notes || '').trim() || undefined,
  });

  await setDoc(newDocRef, {
    ...payload,
    updatedAt: serverTimestamp(),
  });

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_ACCOUNT_CREATED',
    'City Ledger',
    `Created ${accountType} City Ledger account "${name}" (${accountReference}) in Pending Approval status with credit limit ${creditLimit}`,
    newDocRef.id,
    null,
    {
      accountId: newDocRef.id,
      accountReference,
      name,
      accountType,
      creditLimit,
      paymentTerms,
      status: 'pending',
      approvalStatus: 'pending',
    },
    {
      metadata: {
        transactionRef: accountReference,
        corporateId: newDocRef.id,
        previousValue: null,
        newValue: { status: 'pending', approvalStatus: 'pending', creditLimit, paymentTerms },
      },
    }
  );

  return { id: newDocRef.id, ...payload };
};

export const updateCityLedgerAccount = async (
  hotelId: string,
  accountId: string,
  updates: Partial<CreateCityLedgerAccountInput>,
  profile: any,
  customRoles: any[] = []
): Promise<CorporateAccount> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'edit_account', customRoles)) {
    throw new Error('Access Denied: You do not have permission to edit City Ledger accounts.');
  }

  const accRef = doc(db, 'hotels', hotelId, 'corporate_accounts', accountId);
  const snap = await getDoc(accRef);
  if (!snap.exists()) {
    throw new Error('City Ledger account not found.');
  }
  const existing = { id: snap.id, ...(snap.data() as Omit<CorporateAccount, 'id'>) } as CorporateAccount;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  const nextCreditLimit =
    updates.creditLimit !== undefined ? roundMoney(Math.max(0, Number(updates.creditLimit) || 0)) : existing.creditLimit;
  const creditLimitChanged = Math.abs((existing.creditLimit || 0) - (nextCreditLimit || 0)) > 0.001;

  if (creditLimitChanged && !canPerformCityLedgerAction(profile, 'change_credit_limit', customRoles)) {
    throw new Error('Access Denied: You do not have permission to modify credit limits.');
  }

  const nextSettlementDays =
    updates.settlementDays !== undefined
      ? Math.max(0, Math.floor(Number(updates.settlementDays) || 0))
      : updates.paymentTerms !== undefined
      ? resolveAccountSettlementDays({ paymentTerms: updates.paymentTerms, billingCycle: updates.billingCycle || existing.billingCycle })
      : existing.settlementDays;

  const safePatch = stripUndefined({
    name: updates.name !== undefined ? updates.name.trim() : existing.name,
    accountType: updates.accountType || getEffectiveAccountType(existing),
    accountReference: updates.accountReference !== undefined ? updates.accountReference.trim() : existing.accountReference,
    contactPerson: updates.contactPerson !== undefined ? updates.contactPerson.trim() : existing.contactPerson,
    email: updates.email !== undefined ? updates.email.trim() : existing.email,
    phone: updates.phone !== undefined ? updates.phone.trim() : existing.phone,
    address: updates.address !== undefined ? updates.address.trim() : existing.address,
    billingAddress: updates.billingAddress !== undefined ? updates.billingAddress.trim() : existing.billingAddress,
    taxId: updates.taxId !== undefined ? updates.taxId.trim() : existing.taxId,
    creditLimit: nextCreditLimit,
    billingCycle: updates.billingCycle || existing.billingCycle,
    paymentTerms: updates.paymentTerms !== undefined ? updates.paymentTerms.trim() : existing.paymentTerms,
    settlementDays: nextSettlementDays,
    notes: updates.notes !== undefined ? updates.notes.trim() : existing.notes,
  });

  await updateDoc(accRef, {
    ...safePatch,
    updatedAt: serverTimestamp(),
  });

  await logActivity(
    hotelId,
    profile,
    creditLimitChanged ? 'CITY_LEDGER_CREDIT_LIMIT_UPDATED' : 'CITY_LEDGER_ACCOUNT_UPDATED',
    'City Ledger',
    creditLimitChanged
      ? `Updated credit limit for "${existing.name}" from ${existing.creditLimit} to ${nextCreditLimit}`
      : `Updated City Ledger account details for "${existing.name}"`,
    accountId,
    {
      name: existing.name,
      accountType: getEffectiveAccountType(existing),
      creditLimit: existing.creditLimit,
      paymentTerms: existing.paymentTerms,
      billingCycle: existing.billingCycle,
    },
    {
      name: safePatch.name,
      accountType: safePatch.accountType,
      creditLimit: safePatch.creditLimit,
      paymentTerms: safePatch.paymentTerms,
      billingCycle: safePatch.billingCycle,
    },
    {
      metadata: {
        transactionRef: safePatch.accountReference || accountId,
        corporateId: accountId,
        previousValue: { creditLimit: existing.creditLimit, paymentTerms: existing.paymentTerms },
        newValue: { creditLimit: safePatch.creditLimit, paymentTerms: safePatch.paymentTerms },
      },
    }
  );

  return { ...existing, ...safePatch };
};

export const approveCityLedgerAccount = async (
  hotelId: string,
  accountId: string,
  profile: any,
  customRoles: any[] = [],
  notes?: string
): Promise<CorporateAccount> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'approve_account', customRoles)) {
    throw new Error('Access Denied: You do not have permission to approve City Ledger accounts.');
  }

  const accRef = doc(db, 'hotels', hotelId, 'corporate_accounts', accountId);
  const snap = await getDoc(accRef);
  if (!snap.exists()) {
    throw new Error('City Ledger account not found.');
  }

  const existing = { id: snap.id, ...(snap.data() as Omit<CorporateAccount, 'id'>) } as CorporateAccount;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  const actor = buildActor(profile);
  const nowISO = new Date().toISOString();
  const prevStatus = getEffectiveAccountStatus(existing);
  const prevApproval = existing.approvalStatus || 'pending';

  const patch = stripUndefined({
    status: 'active' as CityLedgerAccountStatus,
    approvalStatus: 'approved' as const,
    approvedBy: actor.uid,
    approvedByName: actor.displayName,
    approvedAt: nowISO,
    statusUpdatedAt: nowISO,
    statusUpdatedBy: actor.uid,
    statusUpdatedByName: actor.displayName,
    statusReason: notes?.trim() || 'Account approved and activated for City Ledger credit',
  });

  await updateDoc(accRef, {
    ...patch,
    updatedAt: serverTimestamp(),
  });

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_ACCOUNT_APPROVED',
    'City Ledger',
    `Approved and activated City Ledger account "${existing.name}" (${existing.accountReference || accountId})`,
    accountId,
    { status: prevStatus, approvalStatus: prevApproval },
    { status: 'active', approvalStatus: 'approved', approvedBy: actor.displayName },
    {
      metadata: {
        transactionRef: existing.accountReference || accountId,
        corporateId: accountId,
        previousValue: { status: prevStatus, approvalStatus: prevApproval },
        newValue: { status: 'active', approvalStatus: 'approved' },
      },
    }
  );

  return { ...existing, ...patch };
};

export const updateCityLedgerAccountStatus = async (
  hotelId: string,
  accountId: string,
  targetStatus: 'active' | 'suspended' | 'closed' | 'rejected',
  reason: string,
  profile: any,
  customRoles: any[] = []
): Promise<CorporateAccount> => {
  enforceCityLedgerTenantIsolation(hotelId);
  const requiredAction = targetStatus === 'active' ? 'approve_account' : 'suspend_or_close_account';
  if (!canPerformCityLedgerAction(profile, requiredAction, customRoles)) {
    throw new Error('Access Denied: You do not have permission to change City Ledger account status.');
  }

  const cleanReason = (reason || '').trim();
  if (targetStatus !== 'active' && cleanReason.length < 3) {
    throw new Error('A clear reason is required when suspending, closing, or rejecting a City Ledger account.');
  }

  const accRef = doc(db, 'hotels', hotelId, 'corporate_accounts', accountId);
  const snap = await getDoc(accRef);
  if (!snap.exists()) {
    throw new Error('City Ledger account not found.');
  }

  const existing = { id: snap.id, ...(snap.data() as Omit<CorporateAccount, 'id'>) } as CorporateAccount;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  if (targetStatus === 'closed' && (existing.currentBalance || 0) > 0.01) {
    throw new Error(
      `Cannot close account "${existing.name}" while an unpaid balance of ${roundMoney(existing.currentBalance).toFixed(2)} remains. Suspend the account instead until settled.`
    );
  }

  const actor = buildActor(profile);
  const nowISO = new Date().toISOString();
  const prevStatus = getEffectiveAccountStatus(existing);
  const prevApproval = existing.approvalStatus || (prevStatus === 'active' ? 'approved' : 'pending');

  const resolvedStatus: CityLedgerAccountStatus = targetStatus === 'rejected' ? 'closed' : targetStatus;
  const resolvedApproval =
    targetStatus === 'rejected'
      ? ('rejected' as const)
      : targetStatus === 'active'
      ? ('approved' as const)
      : existing.approvalStatus || 'approved';

  const patch = stripUndefined({
    status: resolvedStatus,
    approvalStatus: resolvedApproval,
    ...(targetStatus === 'active' && !existing.approvedAt
      ? { approvedBy: actor.uid, approvedByName: actor.displayName, approvedAt: nowISO }
      : {}),
    statusUpdatedAt: nowISO,
    statusUpdatedBy: actor.uid,
    statusUpdatedByName: actor.displayName,
    statusReason: cleanReason || `Status changed to ${resolvedStatus}`,
  });

  await updateDoc(accRef, {
    ...patch,
    updatedAt: serverTimestamp(),
  });

  const actionCode =
    targetStatus === 'suspended'
      ? 'CITY_LEDGER_ACCOUNT_SUSPENDED'
      : targetStatus === 'closed'
      ? 'CITY_LEDGER_ACCOUNT_CLOSED'
      : targetStatus === 'rejected'
      ? 'CITY_LEDGER_ACCOUNT_REJECTED'
      : 'CITY_LEDGER_ACCOUNT_REACTIVATED';

  await logActivity(
    hotelId,
    profile,
    actionCode,
    'City Ledger',
    `Changed City Ledger account "${existing.name}" status from ${prevStatus} to ${resolvedStatus}. Reason: ${patch.statusReason}`,
    accountId,
    { status: prevStatus, approvalStatus: prevApproval },
    { status: resolvedStatus, approvalStatus: resolvedApproval, reason: patch.statusReason },
    {
      metadata: {
        transactionRef: existing.accountReference || accountId,
        corporateId: accountId,
        previousValue: { status: prevStatus, approvalStatus: prevApproval },
        newValue: { status: resolvedStatus, approvalStatus: resolvedApproval },
      },
    }
  );

  return { ...existing, ...patch };
};

export interface TransferUnpaidBalanceInput {
  reservation: Reservation;
  corporateId: string;
  amount: number;
  notes?: string;
  createInvoice?: boolean;
  idempotencyKey?: string;
  allowCreditLimitOverride?: boolean;
}

/**
 * Safely transfers an eligible unpaid guest folio balance to an approved, active City Ledger account
 * reusing the existing transferToCityLedger mechanism without creating duplicate revenue.
 */
export const transferUnpaidBalanceToCityLedger = async (
  hotelId: string,
  input: TransferUnpaidBalanceInput,
  profile: any,
  customRoles: any[] = []
): Promise<{ transferKey: string; invoice?: CityLedgerInvoice }> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'transfer_balance', customRoles)) {
    throw new Error('Access Denied: You do not have permission to transfer balances to City Ledger.');
  }

  const { reservation, corporateId, notes } = input;
  const amount = roundMoney(Number(input.amount));
  if (!reservation?.id) throw new Error('A valid reservation folio is required.');
  if (!corporateId) throw new Error('Target City Ledger account is required.');
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Transfer amount must be greater than zero.');
  }

  const accSnap = await getDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId));
  if (!accSnap.exists()) {
    throw new Error('Target City Ledger account does not exist.');
  }
  const account = { id: accSnap.id, ...(accSnap.data() as Omit<CorporateAccount, 'id'>) } as CorporateAccount;
  enforceCityLedgerTenantIsolation(hotelId, account.hotelId);

  const eligibility = validateAccountReceivableEligibility(account);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || 'Target City Ledger account is not approved and active.');
  }

  const headroom = validateCreditLimitHeadroom(account, amount);
  if (headroom.exceedsLimit && !input.allowCreditLimitOverride) {
    throw new Error(
      `Transfer amount (${amount.toFixed(2)}) exceeds available credit (${headroom.availableCredit.toFixed(2)}) on "${account.name}" (Credit Limit: ${headroom.creditLimit.toFixed(2)}).`
    );
  }

  // Check for duplicate transfer on this reservation
  const existingLedgerSnap = await getDocs(
    query(collection(db, 'hotels', hotelId, 'ledger'), where('reservationId', '==', reservation.id))
  );
  const existingEntries = existingLedgerSnap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
  const transferKey =
    input.idempotencyKey ||
    `cl_xfer_${hotelId}_${reservation.id}_${corporateId}_${Math.round(amount * 100)}`;

  const dupCheck = isDuplicateCityLedgerTransfer(existingEntries, reservation.id, corporateId, amount, transferKey);
  if (dupCheck.isDuplicate) {
    throw new Error(dupCheck.reason || 'Duplicate City Ledger transfer blocked.');
  }

  const actor = buildActor(profile);
  const prevBalance = roundMoney(Number(account.currentBalance) || 0);

  // Reuse existing PMS transferToCityLedger mechanism (posts folio credit + corporate debit; zero new revenue)
  await transferToCityLedger(
    hotelId,
    reservation.guestId || '',
    reservation.id,
    amount,
    actor.uid,
    corporateId,
    actor,
    { idempotencyKey: transferKey, notes: notes?.trim(), skipDuplicateCheck: true }
  );

  const folioNumber = `FOL-${reservation.id.slice(-6).toUpperCase()}`;

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_BALANCE_TRANSFERRED',
    'City Ledger',
    `Transferred unpaid folio balance of ${amount.toFixed(2)} from ${reservation.guestName || 'Guest'} (${folioNumber}, Room ${reservation.roomNumber || 'N/A'}) to "${account.name}"`,
    reservation.id,
    { accountBalance: prevBalance, reservationId: reservation.id },
    { accountBalance: roundMoney(prevBalance + amount), corporateId, amount, transferKey },
    {
      reservationId: reservation.id,
      guestId: reservation.guestId,
      roomNumber: reservation.roomNumber,
      guestName: reservation.guestName,
      metadata: {
        transactionRef: transferKey,
        corporateId,
        folioNumber,
        previousValue: { accountBalance: prevBalance },
        newValue: { accountBalance: roundMoney(prevBalance + amount) },
        notes: notes?.trim() || undefined,
      },
    }
  );

  let invoice: CityLedgerInvoice | undefined;
  if (input.createInvoice !== false && canPerformCityLedgerAction(profile, 'create_invoice', customRoles)) {
    const originalCharges = existingEntries
      .filter(e => e.type === 'debit' && e.category !== 'refund' && e.category !== 'city_ledger' && e.category !== 'transfer')
      .map(e => ({
        description: e.description || e.category,
        category: e.category,
        date: e.timestamp,
        amount: roundMoney(Number(e.amount) || 0),
      }));

    invoice = await createCityLedgerInvoice(
      hotelId,
      {
        corporateId,
        sourceType: 'folio_transfer',
        revenueAlreadyRecognized: true,
        reservationId: reservation.id,
        guestId: reservation.guestId,
        guestName: reservation.guestName,
        roomNumber: reservation.roomNumber,
        folioNumber,
        sourceTransferKey: transferKey,
        issueDate: formatISODateOnly(new Date()),
        description:
          notes?.trim() ||
          `Transferred Guest Folio Balance - ${reservation.guestName || 'Guest'} (Room ${reservation.roomNumber || 'N/A'}, ${folioNumber})`,
        originalAmount: amount,
        lineItems: originalCharges.length > 0 ? originalCharges : undefined,
        initialStatus: 'issued',
      },
      profile,
      customRoles
    );
  }

  return { transferKey, invoice };
};

export interface CreateCityLedgerInvoiceInput {
  corporateId: string;
  sourceType: CityLedgerInvoice['sourceType'];
  revenueAlreadyRecognized?: boolean;
  reservationId?: string;
  guestId?: string;
  guestName?: string;
  roomNumber?: string;
  folioNumber?: string;
  eventReference?: string;
  sourceTransferLedgerId?: string;
  sourceTransferKey?: string;
  issueDate?: string;
  dueDate?: string;
  description: string;
  lineItems?: CityLedgerInvoice['lineItems'];
  originalAmount: number;
  initialStatus?: 'draft' | 'issued';
  notes?: string;
  /**
   * ONLY set true when raising a brand-new standalone corporate/event debit charge that has NOT been posted to the ledger yet.
   * For transferred guest folios or existing corporate stays, this MUST remain false to prevent duplicate revenue.
   */
  postNewLedgerDebit?: boolean;
}

export const createCityLedgerInvoice = async (
  hotelId: string,
  input: CreateCityLedgerInvoiceInput,
  profile: any,
  customRoles: any[] = []
): Promise<CityLedgerInvoice> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'create_invoice', customRoles)) {
    throw new Error('Access Denied: You do not have permission to create City Ledger invoices.');
  }

  const amount = roundMoney(Number(input.originalAmount));
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Invoice amount must be greater than zero.');
  }
  if (!input.description || input.description.trim().length < 2) {
    throw new Error('Invoice description is required.');
  }

  const accSnap = await getDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', input.corporateId));
  if (!accSnap.exists()) {
    throw new Error('Target City Ledger account not found.');
  }
  const account = { id: accSnap.id, ...(accSnap.data() as Omit<CorporateAccount, 'id'>) } as CorporateAccount;
  enforceCityLedgerTenantIsolation(hotelId, account.hotelId);

  const eligibility = validateAccountReceivableEligibility(account);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || 'City Ledger account must be approved and active to create invoices.');
  }

  const invoicesCol = collection(db, 'hotels', hotelId, 'city_ledger_invoices');
  const existingInvSnap = await getDocs(invoicesCol);
  const existingInvoices = existingInvSnap.docs.map(d => ({ id: d.id, ...d.data() } as CityLedgerInvoice));

  // Prevent duplicate invoice for the exact same transfer key
  if (input.sourceTransferKey) {
    const existingForTransfer = existingInvoices.find(
      inv => inv.sourceTransferKey === input.sourceTransferKey && inv.status !== 'cancelled'
    );
    if (existingForTransfer) {
      return existingForTransfer;
    }
  }

  const invoiceNumber = generateCityLedgerInvoiceNumber(
    existingInvoices.map(i => i.invoiceNumber),
    new Date()
  );

  const now = new Date();
  const nowISO = now.toISOString();
  const issueDate = input.issueDate || formatISODateOnly(now);
  const settlementDays = resolveAccountSettlementDays(account);
  const dueDate = input.dueDate || computeDueDate(issueDate, settlementDays);
  const initialStatus: CityLedgerInvoiceStatus =
    input.initialStatus === 'draft'
      ? 'draft'
      : computeCityLedgerInvoiceStatus(
          {
            status: 'issued',
            originalAmount: amount,
            amountPaid: 0,
            adjustmentsNet: 0,
            outstandingAmount: amount,
            dueDate,
          },
          now
        );

  const actor = buildActor(profile);
  const invRef = doc(invoicesCol);
  const revenueAlreadyRecognized =
    input.postNewLedgerDebit === true ? false : input.revenueAlreadyRecognized !== false;

  const invoice: CityLedgerInvoice = stripUndefined({
    id: invRef.id,
    hotelId,
    invoiceNumber,
    corporateId: account.id,
    accountName: account.name,
    accountType: getEffectiveAccountType(account),
    accountReference: account.accountReference,
    sourceType: input.sourceType,
    revenueAlreadyRecognized,
    reservationId: input.reservationId,
    guestId: input.guestId,
    guestName: input.guestName,
    roomNumber: input.roomNumber,
    folioNumber: input.folioNumber,
    eventReference: input.eventReference,
    sourceTransferLedgerId: input.sourceTransferLedgerId,
    sourceTransferKey: input.sourceTransferKey,
    issueDate,
    dueDate,
    description: input.description.trim(),
    lineItems: input.lineItems,
    originalAmount: amount,
    amountPaid: 0,
    adjustmentsNet: 0,
    outstandingAmount: amount,
    status: initialStatus,
    payments: [],
    adjustments: [],
    createdAt: nowISO,
    createdBy: actor.uid,
    createdByName: actor.displayName,
    ...(initialStatus !== 'draft'
      ? { issuedAt: nowISO, issuedBy: actor.uid, issuedByName: actor.displayName }
      : {}),
    notes: input.notes?.trim() || undefined,
    updatedAt: nowISO,
  });

  await setDoc(invRef, invoice);

  // Only post a ledger debit if explicitly raising a brand-new unposted direct service/event bill
  // (NEVER for folio transfers or already-billed stays, preventing duplicate revenue!)
  if (input.postNewLedgerDebit === true && initialStatus !== 'draft') {
    await postToLedger(
      hotelId,
      input.guestId || '',
      input.reservationId || 'CORPORATE_CHARGE',
      {
        amount,
        type: 'debit',
        category: 'corporate',
        description: `City Ledger Invoice ${invoiceNumber}: ${input.description.trim()}`,
        referenceId: invoiceNumber,
        postedBy: actor.uid,
        invoiceId: invRef.id,
        invoiceNumber,
        skipAutomaticTax: true,
        idempotencyKey: `cl_inv_debit_${invRef.id}`,
      } as any,
      actor.uid,
      account.id,
      'cash',
      actor
    );
  }

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_INVOICE_CREATED',
    'City Ledger',
    `Created City Ledger invoice ${invoiceNumber} (${initialStatus}) for "${account.name}" — Amount: ${amount.toFixed(2)}, Due: ${dueDate}`,
    invRef.id,
    null,
    {
      invoiceNumber,
      corporateId: account.id,
      originalAmount: amount,
      outstandingAmount: amount,
      status: initialStatus,
      dueDate,
      revenueAlreadyRecognized,
    },
    {
      reservationId: input.reservationId,
      guestId: input.guestId,
      metadata: {
        transactionRef: invoiceNumber,
        corporateId: account.id,
        invoiceId: invRef.id,
        previousValue: null,
        newValue: { status: initialStatus, originalAmount: amount, outstandingAmount: amount },
      },
    }
  );

  return invoice;
};

export const issueCityLedgerInvoice = async (
  hotelId: string,
  invoiceId: string,
  profile: any,
  customRoles: any[] = []
): Promise<CityLedgerInvoice> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'issue_invoice', customRoles)) {
    throw new Error('Access Denied: You do not have permission to issue City Ledger invoices.');
  }

  const invRef = doc(db, 'hotels', hotelId, 'city_ledger_invoices', invoiceId);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) throw new Error('City Ledger invoice not found.');
  const existing = { id: invSnap.id, ...(invSnap.data() as Omit<CityLedgerInvoice, 'id'>) } as CityLedgerInvoice;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  if (existing.status !== 'draft') {
    throw new Error(`Invoice ${existing.invoiceNumber} is already ${existing.status}.`);
  }

  const accSnap = await getDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', existing.corporateId));
  const account = accSnap.exists() ? ({ id: accSnap.id, ...accSnap.data() } as CorporateAccount) : null;
  const eligibility = validateAccountReceivableEligibility(account);
  if (!eligibility.eligible) {
    throw new Error(eligibility.reason || 'Account is not active and approved.');
  }

  const actor = buildActor(profile);
  const now = new Date();
  const nowISO = now.toISOString();
  const nextStatus = computeCityLedgerInvoiceStatus(
    { ...existing, status: 'issued' },
    now
  );

  const patch = {
    status: nextStatus,
    issuedAt: nowISO,
    issuedBy: actor.uid,
    issuedByName: actor.displayName,
    updatedAt: nowISO,
  };

  await updateDoc(invRef, patch);

  if (existing.revenueAlreadyRecognized === false) {
    await postToLedger(
      hotelId,
      existing.guestId || '',
      existing.reservationId || 'CORPORATE_CHARGE',
      {
        amount: existing.originalAmount,
        type: 'debit',
        category: 'corporate',
        description: `City Ledger Invoice ${existing.invoiceNumber}: ${existing.description}`,
        referenceId: existing.invoiceNumber,
        postedBy: actor.uid,
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        skipAutomaticTax: true,
        idempotencyKey: `cl_inv_debit_${existing.id}`,
      } as any,
      actor.uid,
      existing.corporateId,
      'cash',
      actor
    );
    await reconcileCorporateAccountBalance(hotelId, existing.corporateId).catch(() => {});
  }

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_INVOICE_ISSUED',
    'City Ledger',
    `Issued City Ledger invoice ${existing.invoiceNumber} for "${existing.accountName}" (${existing.originalAmount.toFixed(2)})`,
    invoiceId,
    { status: existing.status },
    { status: nextStatus, issuedAt: nowISO },
    {
      metadata: {
        transactionRef: existing.invoiceNumber,
        corporateId: existing.corporateId,
        invoiceId,
        previousValue: { status: existing.status },
        newValue: { status: nextStatus },
      },
    }
  );

  return { ...existing, ...patch };
};

export const cancelCityLedgerInvoice = async (
  hotelId: string,
  invoiceId: string,
  reason: string,
  profile: any,
  customRoles: any[] = []
): Promise<CityLedgerInvoice> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'cancel_invoice', customRoles)) {
    throw new Error('Access Denied: You do not have permission to cancel City Ledger invoices.');
  }

  const cleanReason = (reason || '').trim();
  if (cleanReason.length < 3) {
    throw new Error('A clear cancellation reason is required.');
  }

  const invRef = doc(db, 'hotels', hotelId, 'city_ledger_invoices', invoiceId);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) throw new Error('City Ledger invoice not found.');
  const existing = { id: invSnap.id, ...(invSnap.data() as Omit<CityLedgerInvoice, 'id'>) } as CityLedgerInvoice;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  if (existing.status === 'cancelled') {
    throw new Error(`Invoice ${existing.invoiceNumber} is already cancelled.`);
  }
  if ((existing.amountPaid || 0) > 0.01) {
    throw new Error(
      `Cannot cancel invoice ${existing.invoiceNumber} because payments totaling ${existing.amountPaid.toFixed(2)} have already been recorded. Apply an authorized adjustment/credit note instead.`
    );
  }

  const actor = buildActor(profile);
  const nowISO = new Date().toISOString();
  const patch = {
    status: 'cancelled' as CityLedgerInvoiceStatus,
    outstandingAmount: 0,
    cancelledAt: nowISO,
    cancelledBy: actor.uid,
    cancelledByName: actor.displayName,
    cancellationReason: cleanReason,
    updatedAt: nowISO,
  };

  await updateDoc(invRef, patch);

  if (existing.revenueAlreadyRecognized === false && existing.status !== 'draft' && (existing.outstandingAmount || 0) > 0.01) {
    await postToLedger(
      hotelId,
      existing.guestId || '',
      existing.reservationId || 'MANUAL_ADJUSTMENT',
      {
        amount: existing.outstandingAmount,
        type: 'credit',
        category: 'discount',
        description: `Cancelled City Ledger Invoice ${existing.invoiceNumber}: ${cleanReason}`,
        referenceId: existing.invoiceNumber,
        postedBy: actor.uid,
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        skipAutomaticTax: true,
        skipFinanceMirror: true,
        idempotencyKey: `cl_inv_cancel_${existing.id}`,
      } as any,
      actor.uid,
      existing.corporateId,
      'cash',
      actor
    );
    await reconcileCorporateAccountBalance(hotelId, existing.corporateId).catch(() => {});
  }

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_INVOICE_CANCELLED',
    'City Ledger',
    `Cancelled City Ledger invoice ${existing.invoiceNumber} for "${existing.accountName}". Reason: ${cleanReason}`,
    invoiceId,
    { status: existing.status, outstandingAmount: existing.outstandingAmount },
    { status: 'cancelled', outstandingAmount: 0, reason: cleanReason },
    {
      metadata: {
        transactionRef: existing.invoiceNumber,
        corporateId: existing.corporateId,
        invoiceId,
        previousValue: { status: existing.status, outstandingAmount: existing.outstandingAmount },
        newValue: { status: 'cancelled', outstandingAmount: 0 },
      },
    }
  );

  return { ...existing, ...patch };
};

export interface RecordCityLedgerPaymentInput {
  amount: number;
  paymentDate: string;
  paymentMethod: 'cash' | 'card' | 'transfer' | 'cheque' | 'other';
  reference?: string;
  notes?: string;
  idempotencyKey?: string;
}

/**
 * Records a partial or full payment against a specific City Ledger invoice.
 * Reuses the existing PMS settleLedger / postToLedger payment mechanism (NO second payment engine),
 * prevents duplicate payment posting via idempotencyKey, reconciles corporate account balance,
 * and NEVER creates duplicate revenue.
 */
export const recordCityLedgerInvoicePayment = async (
  hotelId: string,
  invoiceId: string,
  input: RecordCityLedgerPaymentInput,
  profile: any,
  customRoles: any[] = []
): Promise<{ updatedInvoice: CityLedgerInvoice; isDuplicate: boolean; ledgerEntryId?: string }> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'record_payment', customRoles)) {
    throw new Error('Access Denied: You do not have permission to record City Ledger payments.');
  }

  const invRef = doc(db, 'hotels', hotelId, 'city_ledger_invoices', invoiceId);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) throw new Error('City Ledger invoice not found.');
  const existing = { id: invSnap.id, ...(invSnap.data() as Omit<CityLedgerInvoice, 'id'>) } as CityLedgerInvoice;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  const actor = buildActor(profile);
  const idempotencyKey =
    input.idempotencyKey ||
    `clpay_${invoiceId}_${Math.round(roundMoney(input.amount) * 100)}_${input.paymentDate || formatISODateOnly(new Date())}_${(input.reference || 'noref').trim()}`;

  // Pre-validate using pure transition engine (idempotency, no overpayment, blocks draft/cancelled/paid)
  const preview = applyPaymentToCityLedgerInvoice(
    existing,
    {
      amount: input.amount,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      notes: input.notes,
      recordedBy: actor.uid,
      recordedByName: actor.displayName,
      idempotencyKey,
    },
    new Date()
  );

  if (preview.isDuplicate) {
    return {
      updatedInvoice: preview.updatedInvoice,
      isDuplicate: true,
      ledgerEntryId: preview.payment.ledgerEntryId,
    };
  }

  const mappedLedgerMethod: 'cash' | 'card' | 'transfer' =
    input.paymentMethod === 'cash'
      ? 'cash'
      : input.paymentMethod === 'card'
      ? 'card'
      : 'transfer';

  const desc = `City Ledger Payment (${existing.invoiceNumber}) via ${input.paymentMethod.toUpperCase()}${
    input.reference?.trim() ? ` [Ref: ${input.reference.trim()}]` : ''
  }${input.notes?.trim() ? ` - ${input.notes.trim()}` : ''}`;

  let postedLedgerEntry: any;
  if (existing.reservationId) {
    postedLedgerEntry = await settleLedger(
      hotelId,
      existing.guestId || '',
      existing.reservationId,
      preview.payment.amount,
      mappedLedgerMethod,
      actor.uid,
      existing.corporateId,
      input.reference?.trim() || existing.invoiceNumber,
      undefined,
      actor,
      'Front Desk',
      {
        description: desc,
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        idempotencyKey,
      } as any
    );
  } else {
    postedLedgerEntry = await postToLedger(
      hotelId,
      existing.guestId || '',
      'CORPORATE_SETTLEMENT',
      {
        amount: preview.payment.amount,
        type: 'credit',
        category: 'payment',
        description: desc,
        referenceId: existing.invoiceNumber,
        referenceCode: input.reference?.trim() || existing.invoiceNumber,
        postedBy: actor.uid,
        invoiceId: existing.id,
        invoiceNumber: existing.invoiceNumber,
        idempotencyKey,
      } as any,
      actor.uid,
      existing.corporateId,
      mappedLedgerMethod,
      actor
    );
  }

  const ledgerEntryId = postedLedgerEntry?.id;
  const finalTransition = applyPaymentToCityLedgerInvoice(
    existing,
    {
      amount: input.amount,
      paymentDate: input.paymentDate,
      paymentMethod: input.paymentMethod,
      reference: input.reference,
      notes: input.notes,
      recordedBy: actor.uid,
      recordedByName: actor.displayName,
      idempotencyKey,
      ledgerEntryId,
    },
    new Date()
  );

  await updateDoc(invRef, {
    amountPaid: finalTransition.updatedInvoice.amountPaid,
    outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
    status: finalTransition.updatedInvoice.status,
    payments: finalTransition.updatedInvoice.payments.map(p => stripUndefined(p)),
    lastPaymentAt: finalTransition.updatedInvoice.lastPaymentAt,
    updatedAt: finalTransition.updatedInvoice.updatedAt,
  });

  await reconcileCorporateAccountBalance(hotelId, existing.corporateId).catch(() => {});

  await logActivity(
    hotelId,
    profile,
    finalTransition.updatedInvoice.status === 'paid'
      ? 'CITY_LEDGER_INVOICE_PAID'
      : 'CITY_LEDGER_PARTIAL_PAYMENT_RECORDED',
    'City Ledger',
    `Recorded ${finalTransition.updatedInvoice.status === 'paid' ? 'final' : 'partial'} payment of ${preview.payment.amount.toFixed(2)} against ${existing.invoiceNumber} (${existing.accountName}). Remaining: ${finalTransition.updatedInvoice.outstandingAmount.toFixed(2)}`,
    invoiceId,
    {
      amountPaid: existing.amountPaid,
      outstandingAmount: existing.outstandingAmount,
      status: existing.status,
    },
    {
      amountPaid: finalTransition.updatedInvoice.amountPaid,
      outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
      status: finalTransition.updatedInvoice.status,
      paymentAmount: preview.payment.amount,
      paymentMethod: input.paymentMethod,
      reference: input.reference?.trim() || undefined,
    },
    {
      reservationId: existing.reservationId,
      guestId: existing.guestId,
      metadata: {
        transactionRef: input.reference?.trim() || existing.invoiceNumber,
        corporateId: existing.corporateId,
        invoiceId,
        ledgerEntryId,
        previousValue: {
          amountPaid: existing.amountPaid,
          outstandingAmount: existing.outstandingAmount,
          status: existing.status,
        },
        newValue: {
          amountPaid: finalTransition.updatedInvoice.amountPaid,
          outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
          status: finalTransition.updatedInvoice.status,
        },
      },
    }
  );

  return {
    updatedInvoice: finalTransition.updatedInvoice,
    isDuplicate: false,
    ledgerEntryId,
  };
};

export interface RecordCityLedgerAdjustmentInput {
  type: 'credit_note' | 'debit_adjustment' | 'reversal';
  amount: number;
  reason: string;
  approvedBy: string;
  idempotencyKey?: string;
}

export const applyCityLedgerInvoiceAdjustment = async (
  hotelId: string,
  invoiceId: string,
  input: RecordCityLedgerAdjustmentInput,
  profile: any,
  customRoles: any[] = []
): Promise<{ updatedInvoice: CityLedgerInvoice; isDuplicate: boolean }> => {
  enforceCityLedgerTenantIsolation(hotelId);
  if (!canPerformCityLedgerAction(profile, 'apply_adjustment', customRoles)) {
    throw new Error('Access Denied: You do not have permission to apply City Ledger adjustments.');
  }

  const invRef = doc(db, 'hotels', hotelId, 'city_ledger_invoices', invoiceId);
  const invSnap = await getDoc(invRef);
  if (!invSnap.exists()) throw new Error('City Ledger invoice not found.');
  const existing = { id: invSnap.id, ...(invSnap.data() as Omit<CityLedgerInvoice, 'id'>) } as CityLedgerInvoice;
  enforceCityLedgerTenantIsolation(hotelId, existing.hotelId);

  const actor = buildActor(profile);
  const idempotencyKey =
    input.idempotencyKey ||
    `cladj_${invoiceId}_${input.type}_${Math.round(roundMoney(input.amount) * 100)}_${Date.now()}`;

  const preview = applyAdjustmentToCityLedgerInvoice(
    existing,
    {
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      approvedBy: input.approvedBy || actor.displayName,
      recordedBy: actor.uid,
      recordedByName: actor.displayName,
      idempotencyKey,
    },
    new Date()
  );

  if (preview.isDuplicate) {
    return { updatedInvoice: preview.updatedInvoice, isDuplicate: true };
  }

  const isDebit = input.type === 'debit_adjustment';
  const postedEntry = await postToLedger(
    hotelId,
    existing.guestId || '',
    existing.reservationId || 'MANUAL_ADJUSTMENT',
    {
      amount: preview.adjustment.amount,
      type: isDebit ? 'debit' : 'credit',
      category: isDebit ? 'other' : 'discount',
      description: `City Ledger ${input.type.replace('_', ' ').toUpperCase()} (${existing.invoiceNumber}): ${input.reason.trim()} [Approved: ${preview.adjustment.approvedBy}]`,
      referenceId: existing.invoiceNumber,
      postedBy: actor.uid,
      invoiceId: existing.id,
      invoiceNumber: existing.invoiceNumber,
      skipAutomaticTax: true,
      skipFinanceMirror: true,
      idempotencyKey,
    } as any,
    actor.uid,
    existing.corporateId,
    'cash',
    actor
  );

  const finalTransition = applyAdjustmentToCityLedgerInvoice(
    existing,
    {
      type: input.type,
      amount: input.amount,
      reason: input.reason,
      approvedBy: input.approvedBy || actor.displayName,
      recordedBy: actor.uid,
      recordedByName: actor.displayName,
      idempotencyKey,
      ledgerEntryId: postedEntry?.id,
    },
    new Date()
  );

  await updateDoc(invRef, {
    adjustmentsNet: finalTransition.updatedInvoice.adjustmentsNet,
    outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
    status: finalTransition.updatedInvoice.status,
    adjustments: (finalTransition.updatedInvoice.adjustments || []).map(a => stripUndefined(a)),
    updatedAt: finalTransition.updatedInvoice.updatedAt,
  });

  await reconcileCorporateAccountBalance(hotelId, existing.corporateId).catch(() => {});

  await logActivity(
    hotelId,
    profile,
    'CITY_LEDGER_ADJUSTMENT_APPLIED',
    'City Ledger',
    `Applied ${input.type.replace('_', ' ')} of ${preview.adjustment.amount.toFixed(2)} on ${existing.invoiceNumber} (${existing.accountName}). Reason: ${input.reason.trim()}`,
    invoiceId,
    {
      outstandingAmount: existing.outstandingAmount,
      adjustmentsNet: existing.adjustmentsNet || 0,
      status: existing.status,
    },
    {
      outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
      adjustmentsNet: finalTransition.updatedInvoice.adjustmentsNet || 0,
      status: finalTransition.updatedInvoice.status,
    },
    {
      metadata: {
        transactionRef: existing.invoiceNumber,
        corporateId: existing.corporateId,
        invoiceId,
        previousValue: { outstandingAmount: existing.outstandingAmount, status: existing.status },
        newValue: {
          outstandingAmount: finalTransition.updatedInvoice.outstandingAmount,
          status: finalTransition.updatedInvoice.status,
        },
      },
    }
  );

  return { updatedInvoice: finalTransition.updatedInvoice, isDuplicate: false };
};

export const subscribeCityLedgerInvoices = (
  hotelId: string,
  callback: (invoices: CityLedgerInvoice[]) => void,
  onError?: (err: any) => void
): (() => void) => {
  if (!hotelId) {
    callback([]);
    return () => {};
  }
  const colRef = collection(db, 'hotels', hotelId, 'city_ledger_invoices');
  return onSnapshot(
    colRef,
    snap => {
      const now = new Date();
      const items = snap.docs
        .map(d => {
          const raw = { id: d.id, ...d.data() } as CityLedgerInvoice;
          return {
            ...raw,
            status: computeCityLedgerInvoiceStatus(raw, now),
          };
        })
        .sort((a, b) => new Date(b.createdAt || b.issueDate || 0).getTime() - new Date(a.createdAt || a.issueDate || 0).getTime());
      callback(items);
    },
    err => {
      console.warn('[subscribeCityLedgerInvoices] Snapshot notice:', err);
      if (onError) onError(err);
    }
  );
};
