import { db } from '../firebase';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { LedgerEntry, Guest, Reservation, Hotel } from '../types';
import { calculateStayDuration } from '../utils/dateUtils';

export interface GuestAccountSummary {
  totalCharges: number;
  totalRoomCharges: number;
  totalOverstayCharges: number;
  totalServiceCharges: number;
  totalPayments: number;
  totalRefunds: number;
  totalTransfers: number;
  outstandingBalance: number; // Positive = guest owes money (Debt), 0 = settled, Negative = credit balance (Overpaid)
  netAmountDue: number; // Always non-negative amount owed or 0 if paid/credit
  creditBalance: number; // Always non-negative overpayment/credit or 0
  accountStatus: 'OUTSTANDING' | 'SETTLED' | 'OVERPAID' | 'ZERO_BALANCE';
  totalDays: number;
  totalNights: number;
}

export interface AccountValidationResult {
  isValid: boolean;
  violations: string[];
  summary: GuestAccountSummary;
  ledgerBalance: number;
  folioBalance: number;
  checkoutBalance: number;
  profileBalance: number;
}

/**
 * GLOBAL TRANSACTION VALIDATOR (MIDDLEWARE)
 * Rejects any transaction originating from 'projection', 'forecast', 'preview', or 'simulation' source modules
 * or marked as virtual/preview.
 */
export function validateLedgerTransaction(entry: Partial<LedgerEntry>): { isValid: boolean; reason?: string } {
  const source = ((entry as any).source || (entry as any).sourceModule || (entry as any).type_source || '').toString().toLowerCase();
  const isVirtual = (entry as any).isVirtual === true;

  const prohibitedSources = ['projection', 'forecast', 'preview', 'simulation'];
  
  if (prohibitedSources.includes(source)) {
    return {
      isValid: false,
      reason: `Transaction rejected: Source module '${source}' is prohibited from writing to the live ledger.`
    };
  }

  if (isVirtual) {
    return {
      isValid: false,
      reason: 'Transaction rejected: Virtual / projection entries cannot be posted to the live ledger.'
    };
  }

  return { isValid: true };
}

/**
 * CENTRALIZED FINANCIAL SERVICE: Calculates Guest Financial Position
 * Derives all values purely from actual transactions stored in the ledger (or provided array),
 * removing any reliance on external forecast or projection calculations.
 */
export function calculateGuestFinancialPosition(
  guestOrId: Guest | string | { id?: string; email?: string; ledgerBalance?: number } | null | undefined,
  reservations: Reservation[] = [],
  hotel: Hotel | null = null,
  ledgerEntries?: LedgerEntry[]
): GuestAccountSummary {
  if (!guestOrId) {
    return {
      totalCharges: 0,
      totalRoomCharges: 0,
      totalOverstayCharges: 0,
      totalServiceCharges: 0,
      totalPayments: 0,
      totalRefunds: 0,
      totalTransfers: 0,
      outstandingBalance: 0,
      netAmountDue: 0,
      creditBalance: 0,
      accountStatus: 'ZERO_BALANCE',
      totalDays: 0,
      totalNights: 0
    };
  }

  const guestId = typeof guestOrId === 'string' ? guestOrId : guestOrId.id;
  const guestEmail = typeof guestOrId === 'object' && guestOrId !== null ? guestOrId.email : undefined;

  // Filter valid real ledger entries for this guest (excluding virtual/projection entries)
  let validEntries: LedgerEntry[] = [];
  if (ledgerEntries) {
    validEntries = ledgerEntries.filter(e => {
      const isGuestMatch = (guestId && e.guestId === guestId) || 
                           (guestOrId && typeof guestOrId === 'object' && e.guestId === (guestOrId as Guest).id);
      const validator = validateLedgerTransaction(e);
      return isGuestMatch && validator.isValid;
    });
  }

  const matchingRes = reservations.filter(r => {
    if (r.status === 'cancelled') return false;
    if (guestId && r.guestId === guestId) return true;
    if (guestEmail && r.guestEmail && r.guestEmail.toLowerCase().trim() === guestEmail.toLowerCase().trim()) return true;
    return false;
  });

  let totalCharges = 0;
  let totalRoomCharges = 0;
  let totalOverstayCharges = 0;
  let totalServiceCharges = 0;
  let totalPayments = 0;
  let totalRefunds = 0;
  let totalTransfers = 0;
  let totalDays = 0;
  let totalNights = 0;

  // Compute duration stats from matching reservations
  matchingRes.forEach(res => {
    const duration = calculateStayDuration(res.checkIn, res.checkOut, res.overstayNights, res.status);
    totalDays += duration.totalDays;
    totalNights += duration.totalNights;
  });

  if (validEntries.length > 0) {
    // Authoritative calculation PURELY from posted ledger entries
    validEntries.forEach(e => {
      if (e.type === 'debit') {
        totalCharges += e.amount;
        if (e.category === 'room' || e.chargeType === 'room_rate') {
          totalRoomCharges += e.amount;
        } else if (e.chargeType === 'overstay') {
          totalOverstayCharges += e.amount;
        } else if (e.category === 'refund') {
          totalRefunds += e.amount;
        } else {
          totalServiceCharges += e.amount;
        }
      } else if (e.type === 'credit') {
        totalPayments += e.amount;
        if (e.category === 'transfer') {
          totalTransfers += e.amount;
        }
      }
    });
  } else if (matchingRes.length > 0) {
    // If ledger entries aren't passed, calculate from reservation ledger balances or amounts
    matchingRes.forEach(res => {
      if (res.ledgerBalance !== undefined) {
        if (res.ledgerBalance > 0) {
          totalCharges += res.ledgerBalance;
        } else {
          totalPayments += Math.abs(res.ledgerBalance);
        }
      } else {
        totalCharges += res.totalAmount || 0;
      }
    });
  } else {
    // Fallback for guest object with stored ledgerBalance
    const fallbackBal = typeof guestOrId === 'object' && guestOrId !== null ? (guestOrId.ledgerBalance || 0) : 0;
    if (fallbackBal > 0) totalCharges = fallbackBal;
    else if (fallbackBal < 0) totalPayments = Math.abs(fallbackBal);
  }

  totalCharges = Number(totalCharges.toFixed(2));
  totalRoomCharges = Number(totalRoomCharges.toFixed(2));
  totalOverstayCharges = Number(totalOverstayCharges.toFixed(2));
  totalServiceCharges = Number(totalServiceCharges.toFixed(2));
  totalPayments = Number(totalPayments.toFixed(2));
  totalRefunds = Number(totalRefunds.toFixed(2));
  totalTransfers = Number(totalTransfers.toFixed(2));

  const rawBalance = totalCharges - totalPayments;
  const outstandingBalance = Number(rawBalance.toFixed(2));
  const netAmountDue = Math.max(0, outstandingBalance);
  const creditBalance = Math.max(0, -outstandingBalance);

  let accountStatus: GuestAccountSummary['accountStatus'] = 'ZERO_BALANCE';
  if (outstandingBalance > 0.01) {
    accountStatus = 'OUTSTANDING';
  } else if (outstandingBalance < -0.01) {
    accountStatus = 'OVERPAID';
  } else {
    accountStatus = 'SETTLED';
  }

  return {
    totalCharges,
    totalRoomCharges,
    totalOverstayCharges,
    totalServiceCharges,
    totalPayments,
    totalRefunds,
    totalTransfers,
    outstandingBalance,
    netAmountDue,
    creditBalance,
    accountStatus,
    totalDays,
    totalNights
  };
}

/**
 * MULTI-POINT CONSISTENCY CHECK (validateGuestAccount)
 * Ensures Ledger balance equals Folio, Checkout, and Profile balances.
 * Hard gate requirement before state-changing actions like check-out or settlement.
 */
export function validateGuestAccount(
  guestId: string,
  options: {
    reservations?: Reservation[];
    hotel?: Hotel | null;
    ledgerEntries?: LedgerEntry[];
    guestProfile?: Guest | null;
    folioBalance?: number;
    checkoutBalance?: number;
  } = {}
): AccountValidationResult {
  const {
    reservations = [],
    hotel = null,
    ledgerEntries = [],
    guestProfile = null,
    folioBalance,
    checkoutBalance
  } = options;

  // 1. Calculate authoritative ledger financial position
  const summary = calculateGuestFinancialPosition(guestProfile || guestId, reservations, hotel, ledgerEntries);
  const ledgerBalance = summary.outstandingBalance;

  // 2. Derive compare balances
  const profileBalance = guestProfile ? Number((guestProfile.ledgerBalance || 0).toFixed(2)) : ledgerBalance;
  const currentFolioBalance = folioBalance !== undefined ? Number(folioBalance.toFixed(2)) : ledgerBalance;
  const currentCheckoutBalance = checkoutBalance !== undefined ? Number(checkoutBalance.toFixed(2)) : ledgerBalance;

  const violations: string[] = [];

  // Check A: Multi-point Balance Consistency (Ledger == Folio == Checkout == Profile)
  if (Math.abs(ledgerBalance - profileBalance) > 0.5) {
    violations.push(`PROFILE DISCREPANCY: Stored Guest Profile balance (₦${profileBalance.toLocaleString()}) does not match Ledger balance (₦${ledgerBalance.toLocaleString()}).`);
  }

  if (folioBalance !== undefined && Math.abs(ledgerBalance - currentFolioBalance) > 0.5) {
    violations.push(`FOLIO DISCREPANCY: Folio view balance (₦${currentFolioBalance.toLocaleString()}) does not match Ledger balance (₦${ledgerBalance.toLocaleString()}).`);
  }

  if (checkoutBalance !== undefined && Math.abs(ledgerBalance - currentCheckoutBalance) > 0.5) {
    violations.push(`CHECKOUT DISCREPANCY: Checkout total balance (₦${currentCheckoutBalance.toLocaleString()}) does not match Ledger balance (₦${ledgerBalance.toLocaleString()}).`);
  }

  // Check B: Contradictory Financial States
  if (summary.outstandingBalance > 0.01 && summary.accountStatus === 'SETTLED') {
    violations.push(`CRITICAL: Guest owes ₦${summary.outstandingBalance.toLocaleString()} but account is marked SETTLED.`);
  }

  if (summary.creditBalance > 0.01 && summary.netAmountDue > 0.01) {
    violations.push(`CRITICAL: Simultaneous Credit Balance (₦${summary.creditBalance.toLocaleString()}) and Debt (₦${summary.netAmountDue.toLocaleString()}).`);
  }

  // Check C: Unverified/Corrupted Ledger Entries (from prohibited projection/forecast sources)
  if (ledgerEntries && ledgerEntries.length > 0) {
    const corruptedCount = ledgerEntries.filter(e => !validateLedgerTransaction(e).isValid).length;
    if (corruptedCount > 0) {
      violations.push(`INVALID TRANSACTIONS DETECTED: ${corruptedCount} transaction(s) originate from projection/forecast sources.`);
    }
  }

  return {
    isValid: violations.length === 0,
    violations,
    summary,
    ledgerBalance,
    folioBalance: currentFolioBalance,
    checkoutBalance: currentCheckoutBalance,
    profileBalance
  };
}

/**
 * Async helper to fetch guest ledger entries directly from Firestore if not in state
 */
export async function fetchGuestLedgerEntries(hotelId: string, guestId: string): Promise<LedgerEntry[]> {
  try {
    const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
    const q = query(ledgerRef, where('guestId', '==', guestId));
    const snap = await getDocs(q);
    return snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry));
  } catch (err) {
    console.error('Failed to fetch guest ledger entries:', err);
    return [];
  }
}
