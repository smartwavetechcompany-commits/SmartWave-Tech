import { Reservation, Hotel, LedgerEntry, Guest } from '../types';
import { BillingEngine } from './billingEngine';
import { calculateStayDuration } from './dateUtils';

export interface GuestAccountSummary {
  totalCharges: number;
  totalRoomCharges: number;
  totalOverstayCharges: number;
  totalServiceCharges: number;
  totalPayments: number; // Actual payments received from guest (cash, card, bank, etc.)
  totalDiscounts: number; // Discounts / promotional concessions granted
  totalCredits: number; // Total credits reducing debt (payments + discounts + transfers)
  totalRefunds: number;
  totalTransfers: number;
  outstandingBalance: number; // Positive = guest owes money (Debt), 0 = settled, Negative = credit balance (Overpaid)
  netAmountDue: number; // Always non-negative amount owed or 0 if paid/credit
  creditBalance: number; // Always non-negative overpayment/credit or 0
  accountStatus: 'OUTSTANDING' | 'SETTLED' | 'OVERPAID' | 'ZERO_BALANCE';
  totalDays: number;
  totalNights: number;
  bookingNights: number;
  overstayNights: number;
  actualStayedNights: number;
  chargeableNights: number;
  totalSpent: number; // Actual money paid by the guest (Payments Received minus Refunds)
  revenueGenerated: number; // All charges posted to the guest (Room + Services + Taxes + Overstay)
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
  let totalPayments = 0; // Actual payments received
  let totalDiscounts = 0; // Applied discounts / concessions
  let totalCredits = 0; // All credit entries reducing charges
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
        const cat = (e.category || '').toLowerCase();
        const desc = (e.description || '').toLowerCase();
        const isDiscount = cat === 'discount' || desc.includes('discount') || desc.includes('promo');

        totalCredits += e.amount;

        if (cat === 'payment' && !isDiscount) {
          totalPayments += e.amount;
        } else if (isDiscount) {
          totalDiscounts += e.amount;
        } else if (cat === 'transfer' || cat === 'city_ledger') {
          totalTransfers += e.amount;
        } else {
          // Other credit adjustment
          totalPayments += e.amount;
        }
      }
    });

    // If reservation has a recorded discount on its document that is not reflected in ledger credits:
    const hasDiscountInLedger = resLedger.some(e => e.type === 'credit' && (e.category === 'discount' || (e.description || '').toLowerCase().includes('discount')));
    const unpostedDiscount = !hasDiscountInLedger ? Math.max(0, res.totalDiscount || res.discountAmount || 0) : 0;
    if (unpostedDiscount > 0) {
      totalDiscounts += unpostedDiscount;
      totalCredits += unpostedDiscount;
    }

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
    totalCharges = (res.totalAmount && res.totalAmount > 0) ? res.totalAmount : baseRoom;
    totalRoomCharges = baseRoom;
    totalOverstayCharges = 0;
    totalServiceCharges = 0;
    
    // Explicitly track legitimate credits: direct payments received vs discounts granted
    const discountCredits = Math.max(0, res.totalDiscount || res.discountAmount || 0);
    const directPayments = res.paidAmount || 0;
    totalDiscounts = discountCredits;
    totalPayments = directPayments;
    totalCredits = directPayments + discountCredits;

    if (res.paymentStatus === 'paid') {
      totalCredits = Math.max(totalCharges, directPayments + discountCredits);
      totalPayments = Math.max(0, totalCredits - discountCredits);
    }
  }

  // Round all values to 2 decimal places to prevent float precision drift
  totalCharges = Number(totalCharges.toFixed(2));
  totalRoomCharges = Number(totalRoomCharges.toFixed(2));
  totalOverstayCharges = Number(totalOverstayCharges.toFixed(2));
  totalServiceCharges = Number(totalServiceCharges.toFixed(2));
  totalPayments = Number(totalPayments.toFixed(2));
  totalDiscounts = Number(totalDiscounts.toFixed(2));
  totalCredits = Number(totalCredits.toFixed(2));
  totalRefunds = Number(totalRefunds.toFixed(2));
  totalTransfers = Number(totalTransfers.toFixed(2));

  // Outstanding balance: Total Charges - Net Credits (Payments + Discounts + Transfers minus Refunds)
  const netCredits = Math.max(0, totalCredits - totalRefunds);
  const rawBalance = totalCharges - netCredits;
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
    totalDiscounts,
    totalCredits,
    totalRefunds,
    totalTransfers,
    outstandingBalance,
    netAmountDue,
    creditBalance,
    accountStatus,
    totalDays,
    totalNights: duration.actualStayedNights || duration.chargeableNights || totalNights,
    bookingNights: duration.bookingNights,
    overstayNights: duration.overstayNights,
    actualStayedNights: duration.actualStayedNights,
    chargeableNights: duration.chargeableNights,
    totalSpent: Number(Math.max(0, totalPayments - totalRefunds).toFixed(2)),
    revenueGenerated: Number(totalCharges.toFixed(2))
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
      totalDiscounts: 0,
      totalCredits: 0,
      totalRefunds: 0,
      totalTransfers: 0,
      outstandingBalance: 0,
      netAmountDue: 0,
      creditBalance: 0,
      accountStatus: 'ZERO_BALANCE',
      totalDays: 0,
      totalNights: 0,
      bookingNights: 0,
      overstayNights: 0,
      actualStayedNights: 0,
      chargeableNights: 0,
      totalSpent: 0,
      revenueGenerated: 0
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
    let totalDiscounts = 0;
    let totalCredits = 0;
    let totalRefunds = 0;
    let totalTransfers = 0;
    let totalDays = 0;
    let totalNights = 0;
    let totalBookingNights = 0;
    let totalOverstayNights = 0;
    let totalActualStayedNights = 0;
    let totalChargeableNights = 0;

    matchingRes.forEach(res => {
      const acc = calculateReservationAccount(res, hotel, ledgerEntries);
      totalCharges += acc.totalCharges;
      totalRoomCharges += acc.totalRoomCharges;
      totalOverstayCharges += acc.totalOverstayCharges;
      totalServiceCharges += acc.totalServiceCharges;
      totalPayments += acc.totalPayments;
      totalDiscounts += acc.totalDiscounts;
      totalCredits += acc.totalCredits;
      totalRefunds += acc.totalRefunds;
      totalTransfers += acc.totalTransfers;
      totalDays += acc.totalDays;
      totalNights += acc.totalNights;
      totalBookingNights += acc.bookingNights || 0;
      totalOverstayNights += acc.overstayNights || 0;
      totalActualStayedNights += acc.actualStayedNights || 0;
      totalChargeableNights += acc.chargeableNights || 0;
    });

    totalCharges = Number(totalCharges.toFixed(2));
    totalRoomCharges = Number(totalRoomCharges.toFixed(2));
    totalOverstayCharges = Number(totalOverstayCharges.toFixed(2));
    totalServiceCharges = Number(totalServiceCharges.toFixed(2));
    totalPayments = Number(totalPayments.toFixed(2));
    totalDiscounts = Number(totalDiscounts.toFixed(2));
    totalCredits = Number(totalCredits.toFixed(2));
    totalRefunds = Number(totalRefunds.toFixed(2));
    totalTransfers = Number(totalTransfers.toFixed(2));

    const netCredits = Math.max(0, totalCredits - totalRefunds);
    const rawBalance = totalCharges - netCredits;
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
      totalDiscounts,
      totalCredits,
      totalRefunds,
      totalTransfers,
      outstandingBalance,
      netAmountDue,
      creditBalance,
      accountStatus,
      totalDays,
      totalNights: totalActualStayedNights || totalChargeableNights || totalNights,
      bookingNights: totalBookingNights,
      overstayNights: totalOverstayNights,
      actualStayedNights: totalActualStayedNights,
      chargeableNights: totalChargeableNights,
      totalSpent: Number(Math.max(0, totalPayments - totalRefunds).toFixed(2)),
      revenueGenerated: Number(totalCharges.toFixed(2))
    };
  }

  // If no matching reservations found, calculate directly from ledger entries if provided
  if (ledgerEntries && guestId) {
    const guestEntries = ledgerEntries.filter(e => e.guestId === guestId);
    if (guestEntries.length > 0) {
      let debits = 0;
      let credits = 0;
      let directPayments = 0;
      let discounts = 0;
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
          const cat = (e.category || '').toLowerCase();
          const desc = (e.description || '').toLowerCase();
          if (cat === 'discount' || desc.includes('discount') || desc.includes('promo')) {
            discounts += e.amount;
          } else if (cat === 'payment') {
            directPayments += e.amount;
          } else if (cat === 'transfer') {
            transfers += e.amount;
          } else {
            directPayments += e.amount;
          }
        }
      });

      debits = Number(debits.toFixed(2));
      credits = Number(credits.toFixed(2));
      directPayments = Number(directPayments.toFixed(2));
      discounts = Number(discounts.toFixed(2));
      const netCredits = Math.max(0, credits - refunds);
      const rawBal = debits - netCredits;
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
        totalPayments: directPayments,
        totalDiscounts: discounts,
        totalCredits: credits,
        totalRefunds: refunds,
        totalTransfers: transfers,
        outstandingBalance,
        netAmountDue,
        creditBalance,
        accountStatus,
        totalDays: 0,
        totalNights: 0,
        bookingNights: 0,
        overstayNights: 0,
        actualStayedNights: 0,
        chargeableNights: 0,
        totalSpent: Number(Math.max(0, directPayments - refunds).toFixed(2)),
        revenueGenerated: Number(debits.toFixed(2))
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
    totalRoomCharges: fallbackBal > 0 ? fallbackBal : 0,
    totalOverstayCharges: 0,
    totalServiceCharges: 0,
    totalPayments: fallbackBal < 0 ? Math.abs(fallbackBal) : 0,
    totalDiscounts: 0,
    totalCredits: fallbackBal < 0 ? Math.abs(fallbackBal) : 0,
    totalRefunds: 0,
    totalTransfers: 0,
    outstandingBalance: fallbackBal,
    netAmountDue,
    creditBalance,
    accountStatus,
    totalDays: 0,
    totalNights: 0,
    bookingNights: 0,
    overstayNights: 0,
    actualStayedNights: 0,
    chargeableNights: 0,
    totalSpent: fallbackBal < 0 ? Math.abs(fallbackBal) : 0,
    revenueGenerated: fallbackBal > 0 ? fallbackBal : 0
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

