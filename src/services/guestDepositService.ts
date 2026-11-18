import { db } from '../firebase';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { database } from '../utils/database';
import { Guest, GuestDepositTransaction, Hotel, Reservation } from '../types';
import {
  postToLedger,
  recalculateReservationAccountFromLedger,
  syncKitchenOrdersForReservation,
} from './ledgerService';
import { getReservationLiveBalance } from '../utils/billingEngine';

export interface DepositUserContext {
  uid: string;
  email?: string;
  role?: string;
  displayName?: string;
}

const roundMoney = (val: number): number => Number((Number(val) || 0).toFixed(2));

const resolveStaffName = (user: DepositUserContext): string =>
  (user.displayName && user.displayName !== 'Staff' ? user.displayName : undefined) ||
  user.email ||
  user.uid ||
  'Staff';

export function getAvailableGuestDeposit(guest?: Partial<Guest> | null): number {
  if (!guest) return 0;
  return Math.max(0, roundMoney(guest.depositBalance || 0));
}

export function validateDepositApplication(
  availableDeposit: number,
  requestedAmount: number
): { isValid: boolean; error?: string; appliedAmount: number } {
  const avail = Math.max(0, roundMoney(availableDeposit));
  const req = roundMoney(requestedAmount);
  if (req <= 0) {
    return { isValid: false, error: 'Amount must be greater than zero.', appliedAmount: 0 };
  }
  if (avail <= 0.009) {
    return {
      isValid: false,
      error: 'This guest has no available deposit balance in their account.',
      appliedAmount: 0,
    };
  }
  if (req > avail + 0.01) {
    return {
      isValid: false,
      error: `Requested amount (${req.toLocaleString()}) exceeds guest's available deposit balance (${avail.toLocaleString()}).`,
      appliedAmount: 0,
    };
  }
  return {
    isValid: true,
    appliedAmount: Math.min(req, avail),
  };
}

/**
 * Records cash/card/transfer money deposited into an individual guest's personal account wallet.
 * Records income once in Finance under 'Guest Account Deposit' and leaves reservation ledgers untouched.
 */
export async function depositToGuestAccount(
  hotelId: string,
  guestId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  userContext: DepositUserContext,
  options?: {
    referenceCode?: string;
    description?: string;
    timestamp?: string;
  }
): Promise<{ transaction: GuestDepositTransaction; balanceBefore: number; balanceAfter: number }> {
  if (!hotelId || !guestId) {
    throw new Error('Hotel and guest identifiers are required.');
  }
  const cleanAmount = roundMoney(amount);
  if (cleanAmount <= 0) {
    throw new Error('Deposit amount must be greater than zero.');
  }

  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const guestSnap = await getDoc(guestRef);
  if (!guestSnap.exists()) {
    throw new Error('Guest profile not found.');
  }

  const guestData = guestSnap.data() as Guest;
  const balanceBefore = Math.max(0, roundMoney(guestData.depositBalance || 0));
  const balanceAfter = roundMoney(balanceBefore + cleanAmount);
  const totalDeposited = roundMoney((guestData.totalDeposited || 0) + cleanAmount);
  const nowISO = options?.timestamp || new Date().toISOString();
  const staffName = resolveStaffName(userContext);

  const txCol = collection(db, 'hotels', hotelId, 'guest_deposit_transactions');
  const txRef = doc(txCol);
  const financeRef = doc(collection(db, 'hotels', hotelId, 'finance'));

  const description =
    options?.description?.trim() ||
    `Guest Account Deposit (${paymentMethod.toUpperCase()})${options?.referenceCode ? ` • Ref: ${options.referenceCode.trim()}` : ''}`;

  const txRecord: GuestDepositTransaction = {
    id: txRef.id,
    hotelId,
    guestId,
    guestName: guestData.name || 'Guest',
    type: 'deposit',
    amount: cleanAmount,
    balanceBefore,
    balanceAfter,
    paymentMethod,
    ...(options?.referenceCode?.trim() ? { referenceCode: options.referenceCode.trim() } : {}),
    description,
    timestamp: nowISO,
    postedBy: userContext.uid,
    postedByName: staffName,
  };

  const batch = writeBatch(db);
  batch.set(
    guestRef,
    {
      depositBalance: balanceAfter,
      totalDeposited,
      lastDepositAt: nowISO,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(txRef, {
    ...txRecord,
    createdAt: serverTimestamp(),
  });

  batch.set(
    financeRef,
    Object.fromEntries(
      Object.entries({
        type: 'income',
        amount: cleanAmount,
        category: 'Guest Account Deposit',
        description: `${guestData.name || 'Guest'} — ${description}`,
        timestamp: nowISO,
        paymentMethod,
        settlementSource: 'Front Desk',
        guestId,
        guestName: guestData.name || 'Guest',
        referenceId: txRef.id,
        referenceCode: options?.referenceCode?.trim() || undefined,
        status: 'completed',
        postedBy: userContext.uid,
        postedByName: staffName,
        processedBy: {
          uid: userContext.uid,
          name: staffName,
          role: userContext.role || 'staff',
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).filter(([, v]) => v !== undefined)
    )
  );

  await database.commitBatch(hotelId, batch, {
    module: 'Guest Management',
    action: 'GUEST_ACCOUNT_DEPOSIT',
    details: `Deposited ${cleanAmount} (${paymentMethod.toUpperCase()}) into ${guestData.name || 'Guest'}'s account wallet. New balance: ${balanceAfter}`,
    userContext: {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
    },
  });

  return { transaction: txRecord, balanceBefore, balanceAfter };
}

/**
 * Refunds unused money from a guest's personal deposit wallet back to the guest.
 */
export async function refundGuestDeposit(
  hotelId: string,
  guestId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  reason: string,
  userContext: DepositUserContext,
  options?: {
    referenceCode?: string;
    timestamp?: string;
  }
): Promise<{ transaction: GuestDepositTransaction; balanceBefore: number; balanceAfter: number }> {
  if (!hotelId || !guestId) {
    throw new Error('Hotel and guest identifiers are required.');
  }
  if (!reason || !reason.trim()) {
    throw new Error('Please provide a reason for the deposit refund.');
  }

  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const guestSnap = await getDoc(guestRef);
  if (!guestSnap.exists()) {
    throw new Error('Guest profile not found.');
  }

  const guestData = guestSnap.data() as Guest;
  const balanceBefore = Math.max(0, roundMoney(guestData.depositBalance || 0));
  const check = validateDepositApplication(balanceBefore, amount);
  if (!check.isValid) {
    throw new Error(check.error || 'Invalid refund amount.');
  }

  const finalAmount = check.appliedAmount;
  const balanceAfter = Math.max(0, roundMoney(balanceBefore - finalAmount));
  const totalDepositRefunded = roundMoney((guestData.totalDepositRefunded || 0) + finalAmount);
  const nowISO = options?.timestamp || new Date().toISOString();
  const staffName = resolveStaffName(userContext);

  const txCol = collection(db, 'hotels', hotelId, 'guest_deposit_transactions');
  const txRef = doc(txCol);
  const financeRef = doc(collection(db, 'hotels', hotelId, 'finance'));

  const description = `Guest Deposit Refund (${paymentMethod.toUpperCase()}): ${reason.trim()}${options?.referenceCode ? ` • Ref: ${options.referenceCode.trim()}` : ''}`;

  const txRecord: GuestDepositTransaction = {
    id: txRef.id,
    hotelId,
    guestId,
    guestName: guestData.name || 'Guest',
    type: 'refund',
    amount: finalAmount,
    balanceBefore,
    balanceAfter,
    paymentMethod,
    ...(options?.referenceCode?.trim() ? { referenceCode: options.referenceCode.trim() } : {}),
    description,
    timestamp: nowISO,
    postedBy: userContext.uid,
    postedByName: staffName,
  };

  const batch = writeBatch(db);
  batch.set(
    guestRef,
    {
      depositBalance: balanceAfter,
      totalDepositRefunded,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );

  batch.set(txRef, {
    ...txRecord,
    createdAt: serverTimestamp(),
  });

  batch.set(
    financeRef,
    Object.fromEntries(
      Object.entries({
        type: 'expense',
        amount: finalAmount,
        category: 'Guest Deposit Refund',
        description: `${guestData.name || 'Guest'} — ${description}`,
        timestamp: nowISO,
        paymentMethod,
        refundMethod: paymentMethod,
        refundReason: reason.trim(),
        settlementSource: 'Front Desk',
        guestId,
        guestName: guestData.name || 'Guest',
        referenceId: txRef.id,
        referenceCode: options?.referenceCode?.trim() || undefined,
        status: 'completed',
        postedBy: userContext.uid,
        postedByName: staffName,
        processedBy: {
          uid: userContext.uid,
          name: staffName,
          role: userContext.role || 'staff',
        },
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).filter(([, v]) => v !== undefined)
    )
  );

  await database.commitBatch(hotelId, batch, {
    module: 'Guest Management',
    action: 'GUEST_DEPOSIT_REFUND',
    details: `Refunded ${finalAmount} (${paymentMethod.toUpperCase()}) from ${guestData.name || 'Guest'}'s account wallet. Remaining balance: ${balanceAfter}`,
    userContext: {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
    },
  });

  return { transaction: txRecord, balanceBefore, balanceAfter };
}

/**
 * Applies/deducts funds from the guest's deposited account balance to pay/settle a reservation folio.
 * Posts a payment credit to the reservation folio with skipFinanceMirror=true so Finance cash is not double-counted.
 */
export async function applyGuestDepositToReservation(
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  userContext: DepositUserContext,
  options?: {
    referenceCode?: string;
    description?: string;
    settlementSource?: 'Front Desk' | 'F&B Outlet';
    masterReservationId?: string;
    sourceRoomNumber?: string;
    sourceReservationId?: string;
  }
): Promise<{ transaction: GuestDepositTransaction; balanceBefore: number; balanceAfter: number }> {
  if (!hotelId || !guestId || !reservationId) {
    throw new Error('Hotel, guest, and reservation identifiers are required.');
  }

  const [guestSnap, resSnap] = await Promise.all([
    getDoc(doc(db, 'hotels', hotelId, 'guests', guestId)),
    getDoc(doc(db, 'hotels', hotelId, 'reservations', reservationId)),
  ]);

  if (!guestSnap.exists()) {
    throw new Error('Guest profile not found.');
  }
  if (!resSnap.exists()) {
    throw new Error('Reservation not found.');
  }

  const guestData = guestSnap.data() as Guest;
  const resData = resSnap.data() as Reservation;
  const balanceBefore = Math.max(0, roundMoney(guestData.depositBalance || 0));
  const check = validateDepositApplication(balanceBefore, amount);
  if (!check.isValid) {
    throw new Error(check.error || 'Insufficient guest deposit balance.');
  }

  const finalAmount = check.appliedAmount;
  const balanceAfter = Math.max(0, roundMoney(balanceBefore - finalAmount));
  const totalDepositUsed = roundMoney((guestData.totalDepositUsed || 0) + finalAmount);
  const nowISO = new Date().toISOString();
  const staffName = resolveStaffName(userContext);

  const txCol = collection(db, 'hotels', hotelId, 'guest_deposit_transactions');
  const txRef = doc(txCol);

  const ledgerDescription =
    options?.description ||
    `Paid from Guest Account Deposit${resData.roomNumber ? ` (Room ${resData.roomNumber})` : ''}${options?.referenceCode ? ` • Ref: ${options.referenceCode}` : ''}`;

  const txRecord: GuestDepositTransaction = {
    id: txRef.id,
    hotelId,
    guestId,
    guestName: guestData.name || resData.guestName || 'Guest',
    type: 'charge_deduction',
    amount: finalAmount,
    balanceBefore,
    balanceAfter,
    paymentMethod: 'deposit',
    reservationId,
    roomNumber: resData.roomNumber,
    ...(options?.referenceCode ? { referenceCode: options.referenceCode } : {}),
    description: ledgerDescription,
    timestamp: nowISO,
    postedBy: userContext.uid,
    postedByName: staffName,
  };

  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const batch = writeBatch(db);
  batch.set(
    guestRef,
    {
      depositBalance: balanceAfter,
      totalDepositUsed,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(txRef, {
    ...txRecord,
    createdAt: serverTimestamp(),
  });

  await database.commitBatch(hotelId, batch, {
    module: 'Guest Management',
    action: 'GUEST_DEPOSIT_APPLIED',
    details: `Applied ${finalAmount} from ${guestData.name || 'Guest'}'s account deposit to Reservation ${reservationId} (Room ${resData.roomNumber || 'N/A'})`,
    userContext: {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
    },
  });

  await postToLedger(
    hotelId,
    guestId,
    reservationId,
    {
      amount: finalAmount,
      type: 'credit',
      category: 'payment',
      paymentMethod: 'deposit',
      fromGuestDeposit: true,
      skipFinanceMirror: true,
      description: ledgerDescription,
      referenceId: txRef.id,
      ...(options?.referenceCode ? { referenceCode: options.referenceCode } : {}),
      settlementSource: options?.settlementSource || 'Front Desk',
      postedBy: userContext.uid,
      postedByName: staffName,
      ...(options?.masterReservationId ? { masterReservationId: options.masterReservationId } : {}),
      ...(options?.sourceRoomNumber ? { sourceRoomNumber: options.sourceRoomNumber } : {}),
      ...(options?.sourceReservationId ? { sourceReservationId: options.sourceReservationId } : {}),
    },
    userContext.uid,
    resData.corporateId || undefined,
    'deposit',
    {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
      displayName: staffName,
    }
  );

  await syncKitchenOrdersForReservation(
    hotelId,
    reservationId,
    finalAmount,
    'deposit',
    userContext.uid,
    options?.referenceCode || txRef.id.slice(-6).toUpperCase(),
    {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
      displayName: staffName,
    },
    'Guest Account Deposit Settlement'
  ).catch(() => {});

  await recalculateReservationAccountFromLedger(hotelId, reservationId).catch(() => {});

  return { transaction: txRecord, balanceBefore, balanceAfter };
}

/**
 * Allocates guest account deposit funds across a Master room and its linked rooms in debt-first order.
 */
export async function applyGuestDepositToGroup(
  hotelId: string,
  guestId: string,
  masterReservation: Reservation,
  linkedReservations: Reservation[],
  amount: number,
  hotel: Hotel | null,
  userContext: DepositUserContext,
  options?: { referenceCode?: string; notes?: string }
): Promise<{ balanceAfter: number }> {
  const guestSnap = await getDoc(doc(db, 'hotels', hotelId, 'guests', guestId));
  if (!guestSnap.exists()) throw new Error('Guest profile not found.');
  const guestData = guestSnap.data() as Guest;
  const check = validateDepositApplication(guestData.depositBalance || 0, amount);
  if (!check.isValid) throw new Error(check.error || 'Insufficient guest deposit balance.');

  let remaining = check.appliedAmount;
  const targets = [masterReservation, ...linkedReservations];
  let latestBalanceAfter = Math.max(0, roundMoney(guestData.depositBalance || 0));

  for (const res of targets) {
    if (remaining <= 0.01) break;
    const owed = Math.max(0, getReservationLiveBalance(res, hotel));
    if (owed <= 0.01) continue;
    const alloc = roundMoney(Math.min(remaining, owed));
    if (alloc <= 0.01) continue;

    const isChild = res.id !== masterReservation.id;
    const result = await applyGuestDepositToReservation(hotelId, guestId, res.id, alloc, userContext, {
      referenceCode: options?.referenceCode,
      description: isChild
        ? `Paid from Guest Account Deposit (Allocated from Master Room ${masterReservation.roomNumber})`
        : options?.notes?.trim() || `Paid from Guest Account Deposit (Room ${res.roomNumber})`,
      masterReservationId: masterReservation.id,
      sourceRoomNumber: res.roomNumber,
      sourceReservationId: res.id,
    });
    latestBalanceAfter = result.balanceAfter;
    remaining = roundMoney(remaining - alloc);
  }

  if (remaining > 0.01) {
    const result = await applyGuestDepositToReservation(
      hotelId,
      guestId,
      masterReservation.id,
      remaining,
      userContext,
      {
        referenceCode: options?.referenceCode,
        description: `Guest Account Deposit Credit (Master Room ${masterReservation.roomNumber})`,
        masterReservationId: masterReservation.id,
        sourceRoomNumber: masterReservation.roomNumber,
        sourceReservationId: masterReservation.id,
      }
    );
    latestBalanceAfter = result.balanceAfter;
  }

  return { balanceAfter: latestBalanceAfter };
}

/**
 * Deducts funds directly from a guest's deposit wallet to settle an F&B order at POS without double-counting finance cash.
 */
export async function chargeGuestDepositForOrder(
  hotelId: string,
  guestId: string,
  orderId: string,
  amount: number,
  userContext: DepositUserContext,
  options?: {
    roomNumber?: string;
    billNumber?: string;
    description?: string;
  }
): Promise<{ transaction: GuestDepositTransaction; balanceBefore: number; balanceAfter: number }> {
  if (!hotelId || !guestId || !orderId) {
    throw new Error('Hotel, guest, and order identifiers are required.');
  }

  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const guestSnap = await getDoc(guestRef);
  if (!guestSnap.exists()) {
    throw new Error('Guest profile not found.');
  }

  const guestData = guestSnap.data() as Guest;
  const balanceBefore = Math.max(0, roundMoney(guestData.depositBalance || 0));
  const check = validateDepositApplication(balanceBefore, amount);
  if (!check.isValid) {
    throw new Error(check.error || 'Insufficient guest deposit balance.');
  }

  const finalAmount = check.appliedAmount;
  const balanceAfter = Math.max(0, roundMoney(balanceBefore - finalAmount));
  const totalDepositUsed = roundMoney((guestData.totalDepositUsed || 0) + finalAmount);
  const nowISO = new Date().toISOString();
  const staffName = resolveStaffName(userContext);

  const txRef = doc(collection(db, 'hotels', hotelId, 'guest_deposit_transactions'));
  const txRecord: GuestDepositTransaction = {
    id: txRef.id,
    hotelId,
    guestId,
    guestName: guestData.name || 'Guest',
    type: 'charge_deduction',
    amount: finalAmount,
    balanceBefore,
    balanceAfter,
    paymentMethod: 'deposit',
    kitchenOrderId: orderId,
    roomNumber: options?.roomNumber,
    ...(options?.billNumber ? { referenceCode: options.billNumber } : {}),
    description:
      options?.description ||
      `F&B Order Settlement${options?.billNumber ? ` (#${options.billNumber})` : ''}${options?.roomNumber && options.roomNumber !== 'Walk-in' ? ` — Room ${options.roomNumber}` : ' — Walk-in'}`,
    timestamp: nowISO,
    postedBy: userContext.uid,
    postedByName: staffName,
  };

  const batch = writeBatch(db);
  batch.set(
    guestRef,
    {
      depositBalance: balanceAfter,
      totalDepositUsed,
      updatedAt: serverTimestamp(),
    },
    { merge: true }
  );
  batch.set(txRef, {
    ...txRecord,
    createdAt: serverTimestamp(),
  });

  await database.commitBatch(hotelId, batch, {
    module: 'F & B',
    action: 'GUEST_DEPOSIT_POS_CHARGE',
    details: `Deducted ${finalAmount} from ${guestData.name || 'Guest'}'s account deposit for F&B order ${options?.billNumber || orderId}`,
    userContext: {
      uid: userContext.uid,
      email: userContext.email,
      role: userContext.role || 'staff',
    },
  });

  return { transaction: txRecord, balanceBefore, balanceAfter };
}
