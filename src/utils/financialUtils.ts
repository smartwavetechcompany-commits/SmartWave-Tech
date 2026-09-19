import { Reservation, Hotel, LedgerEntry, Guest } from '../types';
import { BillingEngine } from './billingEngine';
import { calculateStayDuration } from './dateUtils';

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

/**
 * Single Source of Truth for calculating Reservation Account Summary
 * Reads directly from actual ledger entries when available.
 * NEVER creates correction credits, balancing entries, or projected negative credits.
 */
export function calculateReservationAccount(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): GuestAccountSummary {
  const duration = calculateStayDuration(res.checkIn, res.checkOut, res.overstayNights, res.status, { hotel, res });
  const totalNights = duration.totalNights;
  const totalDays = duration.totalDays;

  // Filter ledger entries specifically for this reservation
  const resLedger = ledgerEntries ? ledgerEntries.filter(e => e.reservationId === res.id) : undefined;

  let totalCharges = 0;
  let totalRoomCharges = 0;
  let totalOverstayCharges = 0;
  let totalServiceCharges = 0;
  let totalPayments = 0;
  let totalRefunds = 0;
  let totalTransfers = 0;

  if (resLedger && resLedger.length > 0) {
    // 1. Authoritative computation directly from Posted Ledger Entries
    resLedger.forEach(e => {
      if (e.type === 'debit') {
        if (e.category === 'refund') {
          totalRefunds += e.amount;
        } else {
          totalCharges += e.amount;
          if (e.category === 'room' || e.chargeType === 'room_rate') {
            totalRoomCharges += e.amount;
          } else if (e.chargeType === 'overstay') {
            totalOverstayCharges += e.amount;
          } else {
            totalServiceCharges += e.amount;
          }
        }
      } else if (e.type === 'credit') {
        // ONLY real posted credits (payments, valid discounts, transfers)
        if (e.category === 'payment') {
          totalPayments += e.amount;
        } else if (e.category === 'transfer') {
          totalTransfers += e.amount;
          totalPayments += e.amount;
        } else if (e.category === 'city_ledger') {
          // City ledger transfer credit reduces guest direct liability
          totalPayments += e.amount;
        } else {
          // Discounts or other valid ledger credits
          totalPayments += e.amount;
        }
      }
    });

    // Handle unposted base room charge ONLY if no room debits have been posted at all yet (e.g. before night audit or initial posting)
    const roomDebitsPosted = resLedger.some(e => e.type === 'debit' && (e.category === 'room' || e.chargeType === 'room_rate'));
    if (!roomDebitsPosted && res.status === 'checked_in' && totalCharges === 0) {
      const nightly = BillingEngine.getNightlyRate(res, hotel, ledgerEntries);
      const baseRoom = nightly * duration.totalNights;
      totalCharges += baseRoom;
      totalRoomCharges += baseRoom;
    }
  } else {
    // Fallback: If no ledger entries exist yet, compute from reservation rate breakdown without unposted overstay projections
    const nightly = BillingEngine.getNightlyRate(res, hotel);
    const baseRoom = nightly * duration.totalNights;
    totalCharges = baseRoom;
    totalRoomCharges = baseRoom;
    totalOverstayCharges = 0;
    totalServiceCharges = 0;
    totalPayments = res.paidAmount || 0;
  }

  // Round all values to 2 decimal places to prevent float precision drift
  totalCharges = Number(totalCharges.toFixed(2));
  totalRoomCharges = Number(totalRoomCharges.toFixed(2));
  totalOverstayCharges = Number(totalOverstayCharges.toFixed(2));
  totalServiceCharges = Number(totalServiceCharges.toFixed(2));
  totalPayments = Number(totalPayments.toFixed(2));
  totalRefunds = Number(totalRefunds.toFixed(2));
  totalTransfers = Number(totalTransfers.toFixed(2));

  // Outstanding balance: Total Charges - Net Payments (Payments Received minus Refunds)
  const netPayments = Math.max(0, totalPayments - totalRefunds);
  const rawBalance = totalCharges - netPayments;
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
 * Single Source of Truth for calculating Guest Account Summary across all reservations and ledger history
 */
export function calculateGuestAccount(
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

  const matchingRes = reservations.filter(r => {
    if (r.status === 'cancelled') return false;
    if (guestId && r.guestId === guestId) return true;
    if (guestEmail && r.guestEmail && r.guestEmail.toLowerCase().trim() === guestEmail.toLowerCase().trim()) return true;
    return false;
  });

  if (matchingRes.length > 0) {
    let totalCharges = 0;
    let totalRoomCharges = 0;
    let totalOverstayCharges = 0;
    let totalServiceCharges = 0;
    let totalPayments = 0;
    let totalRefunds = 0;
    let totalTransfers = 0;
    let totalDays = 0;
    let totalNights = 0;

    matchingRes.forEach(res => {
      const acc = calculateReservationAccount(res, hotel, ledgerEntries);
      totalCharges += acc.totalCharges;
      totalRoomCharges += acc.totalRoomCharges;
      totalOverstayCharges += acc.totalOverstayCharges;
      totalServiceCharges += acc.totalServiceCharges;
      totalPayments += acc.totalPayments;
      totalRefunds += acc.totalRefunds;
      totalTransfers += acc.totalTransfers;
      totalDays += acc.totalDays;
      totalNights += acc.totalNights;
    });

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

  // If no matching reservations found, calculate directly from ledger entries if provided
  if (ledgerEntries && guestId) {
    const guestEntries = ledgerEntries.filter(e => e.guestId === guestId);
    if (guestEntries.length > 0) {
      let debits = 0;
      let credits = 0;
      let roomCharges = 0;
      let overstayCharges = 0;
      let serviceCharges = 0;
      let refunds = 0;
      let transfers = 0;

      guestEntries.forEach(e => {
        if (e.type === 'debit') {
          debits += e.amount;
          if (e.category === 'room' || e.chargeType === 'room_rate') roomCharges += e.amount;
          else if (e.chargeType === 'overstay') overstayCharges += e.amount;
          else if (e.category === 'refund') refunds += e.amount;
          else serviceCharges += e.amount;
        } else if (e.type === 'credit') {
          credits += e.amount;
          if (e.category === 'transfer') transfers += e.amount;
        }
      });

      debits = Number(debits.toFixed(2));
      credits = Number(credits.toFixed(2));
      const rawBal = debits - credits;
      const outstandingBalance = Number(rawBal.toFixed(2));
      const netAmountDue = Math.max(0, outstandingBalance);
      const creditBalance = Math.max(0, -outstandingBalance);

      let accountStatus: GuestAccountSummary['accountStatus'] = 'ZERO_BALANCE';
      if (outstandingBalance > 0.01) accountStatus = 'OUTSTANDING';
      else if (outstandingBalance < -0.01) accountStatus = 'OVERPAID';
      else accountStatus = 'SETTLED';

      return {
        totalCharges: debits,
        totalRoomCharges: roomCharges,
        totalOverstayCharges: overstayCharges,
        totalServiceCharges: serviceCharges,
        totalPayments: credits,
        totalRefunds: refunds,
        totalTransfers: transfers,
        outstandingBalance,
        netAmountDue,
        creditBalance,
        accountStatus,
        totalDays: 0,
        totalNights: 0
      };
    }
  }

  // Fallback for static guest balance if no active reservations or ledger available
  const fallbackBal = typeof guestOrId === 'object' && guestOrId !== null ? Number((guestOrId.ledgerBalance || 0).toFixed(2)) : 0;
  const netAmountDue = Math.max(0, fallbackBal);
  const creditBalance = Math.max(0, -fallbackBal);
  let accountStatus: GuestAccountSummary['accountStatus'] = 'ZERO_BALANCE';
  if (fallbackBal > 0.01) accountStatus = 'OUTSTANDING';
  else if (fallbackBal < -0.01) accountStatus = 'OVERPAID';
  else accountStatus = 'SETTLED';

  return {
    totalCharges: fallbackBal > 0 ? fallbackBal : 0,
    totalRoomCharges: 0,
    totalOverstayCharges: 0,
    totalServiceCharges: 0,
    totalPayments: fallbackBal < 0 ? Math.abs(fallbackBal) : 0,
    totalRefunds: 0,
    totalTransfers: 0,
    outstandingBalance: fallbackBal,
    netAmountDue,
    creditBalance,
    accountStatus,
    totalDays: 0,
    totalNights: 0
  };
}

/**
 * FINANCIAL INTEGRITY VALIDATOR
 * Audits guest and reservation state to prevent contradictory financial realities.
 * Flags impossible states:
 * - OUTSTANDING + ACCOUNT SETTLED
 * - OVERPAID + MONEY OWED
 * - CREDIT BALANCE + DEBT BALANCE
 * - SETTLED + CHECKOUT SHOWING DEBT
 */
export {
  calculateGuestFinancialPosition,
  validateGuestAccount,
  validateLedgerTransaction
} from '../services/financialService';

