import { 
  collection, 
  doc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  setDoc, 
  updateDoc, 
  increment, 
  arrayUnion,
  orderBy,
  onSnapshot
} from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { OutstandingDebt, OutstandingDebtAuditEntry, Reservation, Guest, CorporateAccount } from '../types';
import { format, differenceInDays, parseISO } from 'date-fns';
import { postToLedger } from './ledgerService';
import { hasPermission } from '../utils/permissions';
import { calculateGuestFinancialPosition, validateLedgerTransaction } from './financialService';
import { getReservationLiveBalance } from '../utils/billingEngine';

/**
 * Single source of truth for Debt / Accounts Receivable management.
 * Strictly decouples operational checkout from financial debt settlement.
 */

export const recordOutstandingDebt = async (
  hotelId: string,
  reservation: Reservation,
  outstandingAmount: number,
  profile: any,
  notes?: string
): Promise<OutstandingDebt> => {
  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', reservation.id);
  const existingSnap = await getDoc(debtRef);
  const now = new Date();
  const dateStr = format(now, 'yyyy-MM-dd');
  const timeStr = format(now, 'HH:mm:ss');
  const folioNum = `FOL-${reservation.id.slice(-6).toUpperCase()}`;

  const userName = profile?.displayName || profile?.name || profile?.email || 'Front Desk Staff';
  const roundedAmount = Number(outstandingAmount.toFixed(2));

  if (existingSnap.exists()) {
    const existing = existingSnap.data() as OutstandingDebt;
    const updatedDebt: Partial<OutstandingDebt> = {
      outstandingAmount: roundedAmount,
      status: roundedAmount <= 0.01 ? 'paid' : (reservation.paidAmount > 0 ? 'partially_paid' : 'outstanding'),
      updatedAt: now.toISOString()
    };
    await database.safeUpdate(debtRef, updatedDebt, {
      hotelId,
      module: 'DebtLedger',
      action: 'UPDATE_DEBT',
      details: `Updated outstanding debt to ₦${roundedAmount.toLocaleString()} for folio ${folioNum}`
    });
    return { ...existing, ...updatedDebt } as OutstandingDebt;
  }

  const initialAudit: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'created',
    date: dateStr,
    time: timeStr,
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount: roundedAmount,
    previousBalance: 0,
    newBalance: roundedAmount,
    details: `Debt registered at operational check-out for Room ${reservation.roomNumber} (Folio ${folioNum})`
  };

  const newDebt: OutstandingDebt = {
    id: reservation.id,
    hotelId,
    guestName: reservation.guestName || 'Unknown Guest',
    guestId: reservation.guestId || '',
    guestEmail: reservation.guestEmail || '',
    guestPhone: reservation.guestPhone || '',
    reservationId: reservation.id,
    folioNumber: folioNum,
    roomNumber: reservation.roomNumber || 'N/A',
    checkoutDate: reservation.checkOut || dateStr,
    checkoutTimestamp: now.toISOString(),
    originalDebt: roundedAmount,
    outstandingAmount: roundedAmount,
    status: (reservation.paidAmount || 0) > 0 ? 'partially_paid' : 'outstanding',
    notes: notes || 'Guest checked out with active outstanding balance.',
    auditHistory: [initialAudit],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString()
  };

  await database.safeSet(debtRef, newDebt, {
    hotelId,
    module: 'DebtLedger',
    action: 'CREATE_DEBT',
    details: `Created outstanding debt of ₦${roundedAmount.toLocaleString()} for ${newDebt.guestName} (${folioNum})`
  });

  return newDebt;
};

export const getOutstandingDebts = async (hotelId: string): Promise<OutstandingDebt[]> => {
  const debtsRef = collection(db, 'hotels', hotelId, 'outstanding_debt_ledger');
  const snap = await getDocs(debtsRef);
  const now = new Date();

  return snap.docs.map(d => {
    const data = d.data() as OutstandingDebt;
    let agingDays = 0;
    try {
      if (data.checkoutDate) {
        agingDays = Math.max(0, differenceInDays(now, parseISO(data.checkoutDate)));
      }
    } catch {
      agingDays = 0;
    }
    return {
      ...data,
      agingDays
    };
  });
};

/**
 * Real-time listener for the hotel's accounts receivable / debt ledger.
 * Automatically computes live aging days and unsubscribes cleanly.
 */
export const subscribeOutstandingDebts = (
  hotelId: string,
  callback: (debts: OutstandingDebt[]) => void,
  onError?: (error: any) => void
): (() => void) => {
  const debtsRef = collection(db, 'hotels', hotelId, 'outstanding_debt_ledger');
  return onSnapshot(debtsRef, (snap) => {
    const now = new Date();
    const debts = snap.docs.map(d => {
      const data = d.data() as OutstandingDebt;
      let agingDays = 0;
      try {
        if (data.checkoutDate) {
          agingDays = Math.max(0, differenceInDays(now, parseISO(data.checkoutDate)));
        }
      } catch {
        agingDays = 0;
      }
      return {
        ...data,
        agingDays
      };
    });
    callback(debts);
  }, (err) => {
    console.error("Outstanding debts real-time listener error:", err);
    if (onError) onError(err);
  });
};

export const receiveDebtPayment = async (
  hotelId: string,
  debtId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  profile: any,
  notes?: string
): Promise<{ success: boolean; newBalance: number }> => {
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero.");
  }

  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', debtId);
  const debtSnap = await getDoc(debtRef);

  if (!debtSnap.exists()) {
    throw new Error("Outstanding debt record not found.");
  }

  const debt = debtSnap.data() as OutstandingDebt;
  const prevBalance = debt.outstandingAmount;
  const newBalance = Math.max(0, Number((prevBalance - amount).toFixed(2)));
  const newStatus = newBalance <= 0.01 ? 'paid' : 'partially_paid';

  const now = new Date();
  const userName = profile?.displayName || profile?.name || profile?.email || 'Cashier';

  const auditEntry: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'payment',
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm:ss'),
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount: Number(amount.toFixed(2)),
    previousBalance: prevBalance,
    newBalance: newBalance,
    details: `Payment collected via ${paymentMethod.toUpperCase()}${notes ? ' - ' + notes : ''}`
  };

  // 1. Update debt ledger document
  await database.safeUpdate(debtRef, {
    outstandingAmount: newBalance,
    status: newStatus,
    auditHistory: arrayUnion(auditEntry),
    updatedAt: now.toISOString()
  }, {
    hotelId,
    module: 'DebtLedger',
    action: 'RECEIVE_PAYMENT',
    details: `Collected ₦${amount.toLocaleString()} payment for folio ${debt.folioNumber}`
  });

  // 2. Post actual credit payment to reservation folio
  await postToLedger(hotelId, debt.guestId, debt.reservationId, {
    amount,
    type: 'credit',
    category: 'payment',
    description: `AR Payment: Debt settlement for Folio ${debt.folioNumber}${notes ? ` (${notes})` : ''}`,
    referenceId: debt.reservationId,
    postedBy: profile?.uid || 'cashier',
    paymentMethod
  }, profile?.uid || 'cashier');

  return { success: true, newBalance };
};

export const transferDebt = async (
  hotelId: string,
  debtId: string,
  transferData: {
    targetType: 'corporate' | 'city_ledger' | 'house_account' | 'travel_agent' | 'master_folio';
    targetId?: string;
    targetName: string;
    amount: number;
    notes: string;
  },
  profile: any
): Promise<{ success: boolean }> => {
  const { targetType, targetId, targetName, amount, notes } = transferData;

  if (amount <= 0) {
    throw new Error("Transfer amount must be greater than zero.");
  }

  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', debtId);
  const debtSnap = await getDoc(debtRef);

  if (!debtSnap.exists()) {
    throw new Error("Debt record not found.");
  }

  const debt = debtSnap.data() as OutstandingDebt;
  const prevBalance = debt.outstandingAmount;
  if (amount > prevBalance + 0.01) {
    throw new Error(`Cannot transfer ₦${amount.toLocaleString()} because remaining debt is ₦${prevBalance.toLocaleString()}`);
  }

  const newBalance = Math.max(0, Number((prevBalance - amount).toFixed(2)));
  const newStatus = newBalance <= 0.01 ? 'transferred' : debt.status;
  const now = new Date();
  const userName = profile?.displayName || profile?.name || profile?.email || 'Accounts';

  const auditEntry: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'transfer',
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm:ss'),
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount: Number(amount.toFixed(2)),
    previousBalance: prevBalance,
    newBalance: newBalance,
    details: `Transferred ₦${amount.toLocaleString()} to ${targetName} (${targetType.replace('_', ' ').toUpperCase()}). Reason: ${notes}`
  };

  // If transferring to corporate account
  if (targetType === 'corporate' && targetId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', targetId);
    await database.safeUpdate(corpRef, {
      currentBalance: increment(amount),
      totalDebits: increment(amount)
    }, {
      hotelId,
      module: 'Corporate',
      action: 'DEBT_TRANSFER_IN',
      details: `Received transferred debt of ₦${amount.toLocaleString()} from guest ${debt.guestName} (${debt.folioNumber})`
    });

    // Post to corporate ledger
    await postToLedger(hotelId, debt.guestId, debt.reservationId, {
      amount,
      type: 'debit',
      category: 'city_ledger',
      description: `Debt transfer from Guest Folio ${debt.folioNumber} (${debt.guestName})`,
      referenceId: debt.reservationId,
      postedBy: profile?.uid || 'accounts'
    }, profile?.uid || 'accounts', targetId);
  }

  // If transferring to a master group folio / another reservation
  if (targetType === 'master_folio' && targetId) {
    await postToLedger(hotelId, '', targetId, {
      amount,
      type: 'debit',
      category: 'transfer',
      description: `Debt transferred from individual folio ${debt.folioNumber} (${debt.guestName})`,
      referenceId: debt.reservationId,
      postedBy: profile?.uid || 'accounts'
    }, profile?.uid || 'accounts');
  }

  // Post transfer credit on the original reservation folio with full audit trail
  await postToLedger(hotelId, debt.guestId, debt.reservationId, {
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Debt transferred to ${targetName} (${targetType.replace('_', ' ').toUpperCase()}) - ${notes}`,
    referenceId: debt.reservationId,
    postedBy: profile?.uid || 'accounts'
  }, profile?.uid || 'accounts');

  // Update debt ledger record
  await database.safeUpdate(debtRef, {
    outstandingAmount: newBalance,
    status: newStatus,
    transferredTo: {
      type: targetType,
      targetId: targetId || '',
      targetName: targetName,
      transferredAt: now.toISOString(),
      transferredBy: userName
    },
    auditHistory: arrayUnion(auditEntry),
    updatedAt: now.toISOString()
  }, {
    hotelId,
    module: 'DebtLedger',
    action: 'TRANSFER_DEBT',
    details: `Transferred ₦${amount.toLocaleString()} from folio ${debt.folioNumber} to ${targetName}`
  });

  return { success: true };
};

export const writeOffDebt = async (
  hotelId: string,
  debtId: string,
  writeOffData: {
    amount: number;
    reason: string;
    approvedBy: string;
    approvalNotes?: string;
  },
  profile: any
): Promise<{ success: boolean }> => {
  const isAuthorized = 
    profile?.role === 'superAdmin' || 
    profile?.role === 'hotelAdmin' || 
    hasPermission(profile, 'write_off_debt');

  if (!isAuthorized) {
    throw new Error("Access Denied: Only Hotel Admins and Authorized Managers can write off debt.");
  }

  const { amount, reason, approvedBy, approvalNotes } = writeOffData;

  if (!reason || reason.trim().length < 3) {
    throw new Error("A specific, mandatory reason is required to write off debt.");
  }

  if (!approvedBy || approvedBy.trim().length < 2) {
    throw new Error("Designated approval authority name is required.");
  }

  if (amount <= 0) {
    throw new Error("Write-off amount must be greater than zero.");
  }

  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', debtId);
  const debtSnap = await getDoc(debtRef);

  if (!debtSnap.exists()) {
    throw new Error("Debt record not found.");
  }

  const debt = debtSnap.data() as OutstandingDebt;
  const prevBalance = debt.outstandingAmount;
  if (amount > prevBalance + 0.01) {
    throw new Error(`Cannot write off ₦${amount.toLocaleString()} because remaining debt is ₦${prevBalance.toLocaleString()}`);
  }

  const newBalance = Math.max(0, Number((prevBalance - amount).toFixed(2)));
  const newStatus = newBalance <= 0.01 ? 'written_off' : debt.status;
  const now = new Date();
  const userName = profile?.displayName || profile?.name || profile?.email || 'Admin';

  const auditEntry: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'write_off',
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm:ss'),
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount: Number(amount.toFixed(2)),
    previousBalance: prevBalance,
    newBalance: newBalance,
    details: `Authorized write-off: ${reason} (Approved by: ${approvedBy})${approvalNotes ? ' - ' + approvalNotes : ''}`
  };

  // Post write-off entry to the reservation folio
  await postToLedger(hotelId, debt.guestId, debt.reservationId, {
    amount,
    type: 'credit',
    category: 'discount',
    description: `Authorized Write-Off: ${reason} [Approved: ${approvedBy}]`,
    referenceId: debt.reservationId,
    postedBy: profile?.uid || 'admin'
  }, profile?.uid || 'admin');

  // Update debt ledger record
  await database.safeUpdate(debtRef, {
    outstandingAmount: newBalance,
    status: newStatus,
    writtenOffBy: {
      userId: profile?.uid || '',
      userName,
      reason,
      approvedBy,
      date: now.toISOString()
    },
    auditHistory: arrayUnion(auditEntry),
    updatedAt: now.toISOString()
  }, {
    hotelId,
    module: 'DebtLedger',
    action: 'WRITE_OFF_DEBT',
    details: `Wrote off ₦${amount.toLocaleString()} for folio ${debt.folioNumber}. Reason: ${reason} (Approved by ${approvedBy})`
  });

  return { success: true };
};

export const adjustDebt = async (
  hotelId: string,
  debtId: string,
  adjustData: {
    type: 'reduction' | 'increase';
    amount: number;
    reason: string;
    approvedBy: string;
  },
  profile: any
): Promise<{ success: boolean }> => {
  const isAuthorized = 
    profile?.role === 'superAdmin' || 
    profile?.role === 'hotelAdmin' || 
    hasPermission(profile, 'adjust_debt');

  if (!isAuthorized) {
    throw new Error("Access Denied: Only Hotel Admins and Authorized Managers can adjust debt.");
  }

  const { type, amount, reason, approvedBy } = adjustData;

  if (!reason || reason.trim().length < 3) {
    throw new Error("A specific reason is required for balance adjustments.");
  }

  if (amount <= 0) {
    throw new Error("Adjustment amount must be greater than zero.");
  }

  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', debtId);
  const debtSnap = await getDoc(debtRef);

  if (!debtSnap.exists()) {
    throw new Error("Debt record not found.");
  }

  const debt = debtSnap.data() as OutstandingDebt;
  const prevBalance = debt.outstandingAmount;
  const delta = type === 'reduction' ? -amount : amount;
  const newBalance = Math.max(0, Number((prevBalance + delta).toFixed(2)));
  const newStatus = newBalance <= 0.01 ? 'paid' : (debt.status === 'written_off' ? 'written_off' : 'outstanding');

  const now = new Date();
  const userName = profile?.displayName || profile?.name || profile?.email || 'Admin';

  const auditEntry: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'adjustment',
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm:ss'),
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount: Number(amount.toFixed(2)),
    previousBalance: prevBalance,
    newBalance: newBalance,
    details: `Approved ${type}: ${reason} (Approved by: ${approvedBy})`
  };

  if (type === 'reduction') {
    await postToLedger(hotelId, debt.guestId, debt.reservationId, {
      amount,
      type: 'credit',
      category: 'discount',
      description: `Adjustment Credit Note: ${reason} (Approved: ${approvedBy})`,
      referenceId: debt.reservationId,
      postedBy: profile?.uid || 'admin'
    }, profile?.uid || 'admin');
  } else {
    await postToLedger(hotelId, debt.guestId, debt.reservationId, {
      amount,
      type: 'debit',
      category: 'other',
      description: `Adjustment Debit: ${reason} (Approved: ${approvedBy})`,
      referenceId: debt.reservationId,
      postedBy: profile?.uid || 'admin'
    }, profile?.uid || 'admin');
  }

  await database.safeUpdate(debtRef, {
    outstandingAmount: newBalance,
    status: newStatus,
    auditHistory: arrayUnion(auditEntry),
    updatedAt: now.toISOString()
  }, {
    hotelId,
    module: 'DebtLedger',
    action: 'ADJUST_DEBT',
    details: `Adjusted debt by ${type === 'reduction' ? '-' : '+'}₦${amount.toLocaleString()} for folio ${debt.folioNumber}`
  });

  return { success: true };
};

export const checkReturningGuestDebt = async (
  hotelId: string,
  guestId?: string,
  guestEmail?: string,
  guestPhone?: string,
  guestName?: string
): Promise<{
  hasDebt: boolean;
  debts: OutstandingDebt[];
  totalDebt: number;
}> => {
  if (!hotelId) return { hasDebt: false, debts: [], totalDebt: 0 };

  const debtsRef = collection(db, 'hotels', hotelId, 'outstanding_debt_ledger');
  const snap = await getDocs(debtsRef);
  const now = new Date();

  const matchingDebts: OutstandingDebt[] = [];

  snap.forEach(d => {
    const data = d.data() as OutstandingDebt;
    if (data.status !== 'outstanding' && data.status !== 'partially_paid') return;
    if (data.outstandingAmount <= 0.01) return;

    let isMatch = false;
    if (guestId && data.guestId && data.guestId === guestId) isMatch = true;
    if (guestEmail && data.guestEmail && data.guestEmail.toLowerCase().trim() === guestEmail.toLowerCase().trim()) isMatch = true;
    if (guestPhone && data.guestPhone && data.guestPhone.replace(/\D/g, '') === guestPhone.replace(/\D/g, '')) isMatch = true;
    if (!isMatch && guestName && data.guestName && data.guestName.toLowerCase().trim() === guestName.toLowerCase().trim()) isMatch = true;

    if (isMatch) {
      let agingDays = 0;
      try {
        if (data.checkoutDate) {
          agingDays = Math.max(0, differenceInDays(now, parseISO(data.checkoutDate)));
        }
      } catch {
        agingDays = 0;
      }
      matchingDebts.push({ ...data, agingDays });
    }
  });

  // Also check past checked_out reservations for this guest in case any were checked out prior to debt collection creation
  if (matchingDebts.length === 0 && (guestId || guestEmail)) {
    const resRef = collection(db, 'hotels', hotelId, 'reservations');
    const resSnap = await getDocs(resRef);
    resSnap.forEach(r => {
      const resData = r.data() as Reservation;
      if (resData.status !== 'checked_out') return;
      let matches = false;
      if (guestId && resData.guestId === guestId) matches = true;
      if (guestEmail && resData.guestEmail && resData.guestEmail.toLowerCase().trim() === guestEmail.toLowerCase().trim()) matches = true;
      
      if (matches) {
        const bal = resData.ledgerBalance !== undefined ? resData.ledgerBalance : Math.max(0, (resData.totalAmount || 0) - (resData.paidAmount || 0));
        if (bal > 0.01) {
          const folioNum = `FOL-${resData.id.slice(-6).toUpperCase()}`;
          let agingDays = 0;
          try {
            if (resData.checkOut) agingDays = Math.max(0, differenceInDays(now, parseISO(resData.checkOut)));
          } catch {
            agingDays = 0;
          }
          matchingDebts.push({
            id: resData.id,
            hotelId,
            guestName: resData.guestName,
            guestId: resData.guestId || '',
            guestEmail: resData.guestEmail || '',
            guestPhone: resData.guestPhone || '',
            reservationId: resData.id,
            folioNumber: folioNum,
            roomNumber: resData.roomNumber || 'N/A',
            checkoutDate: resData.checkOut || format(now, 'yyyy-MM-dd'),
            checkoutTimestamp: now.toISOString(),
            originalDebt: bal,
            outstandingAmount: bal,
            status: (resData.paidAmount || 0) > 0 ? 'partially_paid' : 'outstanding',
            agingDays,
            auditHistory: [],
            createdAt: now.toISOString(),
            updatedAt: now.toISOString()
          });
        }
      }
    });
  }

  const totalDebt = matchingDebts.reduce((sum, d) => sum + d.outstandingAmount, 0);
  return {
    hasDebt: matchingDebts.length > 0 && totalDebt > 0.01,
    debts: matchingDebts,
    totalDebt: Number(totalDebt.toFixed(2))
  };
};

export const transferDebtToNewFolio = async (
  hotelId: string,
  previousDebt: OutstandingDebt,
  newReservation: Reservation,
  profile: any
): Promise<{ success: boolean }> => {
  const amount = previousDebt.outstandingAmount;
  if (amount <= 0.01) return { success: true };

  const now = new Date();
  const userName = profile?.displayName || profile?.name || profile?.email || 'Front Desk';
  const newFolioNum = `FOL-${newReservation.id.slice(-6).toUpperCase()}`;

  // 1. Post debit onto the NEW reservation folio
  await postToLedger(hotelId, newReservation.guestId || previousDebt.guestId, newReservation.id, {
    amount,
    type: 'debit',
    category: 'transfer',
    description: `Debt Carried Forward from Stay Folio ${previousDebt.folioNumber} (Room ${previousDebt.roomNumber})`,
    referenceId: previousDebt.reservationId,
    postedBy: profile?.uid || 'front_desk'
  }, profile?.uid || 'front_desk');

  // 2. Post transfer credit on the PREVIOUS reservation folio to balance it out
  await postToLedger(hotelId, previousDebt.guestId, previousDebt.reservationId, {
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Balance transferred to new stay Folio ${newFolioNum} (Room ${newReservation.roomNumber})`,
    referenceId: newReservation.id,
    postedBy: profile?.uid || 'front_desk'
  }, profile?.uid || 'front_desk');

  // 3. Mark the debt record as transferred in outstanding_debt_ledger
  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', previousDebt.id);
  const auditEntry: OutstandingDebtAuditEntry = {
    id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
    action: 'transfer',
    date: format(now, 'yyyy-MM-dd'),
    time: format(now, 'HH:mm:ss'),
    user: userName,
    userId: profile?.uid,
    userRole: profile?.role,
    amount,
    previousBalance: amount,
    newBalance: 0,
    details: `Transferred debt to new stay reservation ${newReservation.id} (${newFolioNum}, Room ${newReservation.roomNumber})`
  };

  await database.safeUpdate(debtRef, {
    outstandingAmount: 0,
    status: 'transferred',
    transferredTo: {
      type: 'master_folio',
      targetId: newReservation.id,
      targetName: `New Stay Folio ${newFolioNum} (Room ${newReservation.roomNumber})`,
      transferredAt: now.toISOString(),
      transferredBy: userName
    },
    auditHistory: arrayUnion(auditEntry),
    updatedAt: now.toISOString()
  }, {
    hotelId,
    module: 'DebtLedger',
    action: 'TRANSFER_TO_NEW_FOLIO',
    details: `Transferred ₦${amount.toLocaleString()} from ${previousDebt.folioNumber} to new stay ${newFolioNum}`
  });

  return { success: true };
};

/**
 * Diagnostic & repair function for past reservations where an erroneous
 * "Transfer to City Ledger (Folio Credit)" was posted without an actual corporate account,
 * restoring the correct outstanding debt to the reservation and accounts receivable ledger.
 */
export const repairErroneousFolioCredit = async (
  hotelId: string,
  reservationId: string,
  profile: any
): Promise<{ repaired: boolean; restoredAmount: number }> => {
  const ledgerQ = query(
    collection(db, 'hotels', hotelId, 'ledger'),
    where('reservationId', '==', reservationId),
    where('category', '==', 'city_ledger'),
    where('type', '==', 'credit')
  );
  const snap = await getDocs(ledgerQ);
  if (snap.empty) {
    return { repaired: false, restoredAmount: 0 };
  }

  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resSnap = await getDoc(resRef);
  if (!resSnap.exists()) return { repaired: false, restoredAmount: 0 };

  const res = resSnap.data() as Reservation;
  let totalBogusCredit = 0;

  for (const entryDoc of snap.docs) {
    const data = entryDoc.data();
    if (data.description?.includes('Transfer to City Ledger (Folio Credit)') && !res.corporateId) {
      totalBogusCredit += data.amount;
      // Post a debit reversal to counteract this fake credit
      await postToLedger(hotelId, res.guestId || '', reservationId, {
        amount: data.amount,
        type: 'debit',
        category: 'other',
        description: `Correction: Reversal of erroneous checkout folio credit (Ref: ${entryDoc.id.slice(-6).toUpperCase()})`,
        referenceId: reservationId,
        postedBy: profile?.uid || 'admin'
      }, profile?.uid || 'admin');
    }
  }

  if (totalBogusCredit > 0) {
    const freshResSnap = await getDoc(resRef);
    const freshRes = freshResSnap.data() as Reservation;
    const balance = freshRes.ledgerBalance || totalBogusCredit;
    
    await recordOutstandingDebt(
      hotelId,
      freshRes,
      balance,
      profile,
      'Restored outstanding debt after correcting erroneous checkout city ledger credit.'
    );
    return { repaired: true, restoredAmount: totalBogusCredit };
  }

  return { repaired: false, restoredAmount: 0 };
};

/**
 * Synchronizes an existing outstanding_debt_ledger document with the live reservation status
 * and ledger balance without altering any underlying accounting formulas.
 * Ensures checked-out settled, cancelled, deleted, or transferred folios are removed from active AR.
 */
export const syncOutstandingDebtWithReservation = async (
  hotelId: string,
  reservationId: string,
  options?: {
    statusHint?: 'paid' | 'transferred';
    reason?: string;
    userContext?: { uid?: string; displayName?: string; role?: string };
  }
): Promise<{ synced: boolean; status?: OutstandingDebt['status']; outstandingAmount?: number }> => {
  if (!hotelId || !reservationId) return { synced: false };

  const debtRef = doc(db, 'hotels', hotelId, 'outstanding_debt_ledger', reservationId);
  const debtSnap = await getDoc(debtRef);
  if (!debtSnap.exists()) return { synced: false };

  const debt = debtSnap.data() as OutstandingDebt;
  const now = new Date();
  const userName = options?.userContext?.displayName || 'System Sync';

  const [resSnap, hotelSnap, ledgerSnap] = await Promise.all([
    getDoc(doc(db, 'hotels', hotelId, 'reservations', reservationId)),
    getDoc(doc(db, 'hotels', hotelId)),
    getDocs(query(collection(db, 'hotels', hotelId, 'ledger'), where('reservationId', '==', reservationId)))
  ]);

  if (!resSnap.exists()) {
    const resolvedStatus: OutstandingDebt['status'] =
      debt.status === 'written_off' || debt.status === 'transferred' ? debt.status : 'paid';
    if ((debt.outstandingAmount || 0) > 0.01 || debt.status === 'outstanding' || debt.status === 'partially_paid') {
      const auditEntry: OutstandingDebtAuditEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
        action: 'adjustment',
        date: format(now, 'yyyy-MM-dd'),
        time: format(now, 'HH:mm:ss'),
        user: userName,
        userId: options?.userContext?.uid,
        userRole: options?.userContext?.role,
        amount: debt.outstandingAmount || 0,
        previousBalance: debt.outstandingAmount || 0,
        newBalance: 0,
        details: options?.reason || 'Automatically closed: linked reservation no longer exists'
      };
      await database.safeUpdate(debtRef, {
        outstandingAmount: 0,
        status: resolvedStatus,
        auditHistory: arrayUnion(auditEntry),
        updatedAt: now.toISOString()
      }, {
        hotelId,
        module: 'DebtLedger',
        action: 'SYNC_DEBT_CLOSED',
        details: `Closed debt ledger ${debt.folioNumber} (linked reservation removed)`
      });
    }
    return { synced: true, status: resolvedStatus, outstandingAmount: 0 };
  }

  const res = { id: resSnap.id, ...resSnap.data() } as Reservation;
  const hotel = hotelSnap.exists() ? ({ id: hotelSnap.id, ...hotelSnap.data() } as any) : null;
  const validEntries = ledgerSnap.docs
    .map(d => ({ id: d.id, ...d.data() } as any))
    .filter(e => validateLedgerTransaction(e).isValid);

  const liveBalance = getReservationLiveBalance(res, hotel, validEntries);
  const isInactiveStatus = res.status === 'cancelled' || res.status === 'no_show' || res.status !== 'checked_out';
  const isSettled = liveBalance <= 0.01 || (validEntries.length === 0 && (res.paymentStatus === 'paid' || res.financialStatus === 'SETTLED'));

  if (isInactiveStatus || isSettled) {
    const resolvedStatus: OutstandingDebt['status'] =
      debt.status === 'written_off'
        ? 'written_off'
        : debt.status === 'transferred'
        ? 'transferred'
        : (options?.statusHint || (res.corporateId ? 'transferred' : 'paid'));

    if ((debt.outstandingAmount || 0) > 0.01 || debt.status !== resolvedStatus) {
      const reasonText =
        options?.reason ||
        (isInactiveStatus
          ? `Synchronized with reservation status (${res.status})`
          : 'Automatically settled via folio ledger reconciliation');
      const auditEntry: OutstandingDebtAuditEntry = {
        id: crypto.randomUUID ? crypto.randomUUID() : `audit-${Date.now()}`,
        action: resolvedStatus === 'transferred' ? 'transfer' : 'payment',
        date: format(now, 'yyyy-MM-dd'),
        time: format(now, 'HH:mm:ss'),
        user: userName,
        userId: options?.userContext?.uid,
        userRole: options?.userContext?.role,
        amount: debt.outstandingAmount || 0,
        previousBalance: debt.outstandingAmount || 0,
        newBalance: 0,
        details: reasonText
      };
      await database.safeUpdate(debtRef, {
        outstandingAmount: 0,
        status: resolvedStatus,
        auditHistory: arrayUnion(auditEntry),
        updatedAt: now.toISOString()
      }, {
        hotelId,
        module: 'DebtLedger',
        action: 'SYNC_DEBT_SETTLED',
        details: `Synchronized ${debt.folioNumber} as ${resolvedStatus} (${reasonText})`
      });
    }
    return { synced: true, status: resolvedStatus, outstandingAmount: 0 };
  }

  // Reservation is checked_out with active live balance > 0.01
  if (debt.status !== 'written_off' && debt.status !== 'transferred') {
    const roundedLive = Number(liveBalance.toFixed(2));
    const newStatus: OutstandingDebt['status'] =
      (res.paidAmount || 0) > 0 || roundedLive < (debt.originalDebt || 0) - 0.01
        ? 'partially_paid'
        : 'outstanding';

    if (Math.abs((debt.outstandingAmount || 0) - roundedLive) > 0.01 || debt.status !== newStatus) {
      await database.safeUpdate(debtRef, {
        outstandingAmount: roundedLive,
        status: newStatus,
        updatedAt: now.toISOString()
      }, {
        hotelId,
        module: 'DebtLedger',
        action: 'SYNC_DEBT_BALANCE',
        details: `Synchronized ${debt.folioNumber} balance to ${roundedLive}`
      });
    }
    return { synced: true, status: newStatus, outstandingAmount: roundedLive };
  }

  return { synced: true, status: debt.status, outstandingAmount: debt.outstandingAmount };
};
