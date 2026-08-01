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
  outstandingBalance: number;
  totalDays: number;
  totalNights: number;
}

/**
 * Single Source of Truth for calculating Reservation Account Summary
 */
export function calculateReservationAccount(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): GuestAccountSummary {
  const billing = BillingEngine.calculateReservation(res, hotel, ledgerEntries);
  const duration = calculateStayDuration(res.checkIn, res.checkOut, res.overstayNights, res.status);
  const totalNights = duration.totalNights;
  const totalDays = duration.totalDays;

  const resLedger = ledgerEntries ? ledgerEntries.filter(e => e.reservationId === res.id) : undefined;
  let totalRefunds = 0;
  let totalTransfers = 0;
  if (resLedger) {
    totalRefunds = resLedger.filter(e => e.type === 'debit' && e.category === 'refund').reduce((a, e) => a + e.amount, 0);
    totalTransfers = resLedger.filter(e => e.category === 'transfer').reduce((a, e) => a + e.amount, 0);
  }

  return {
    totalCharges: billing.totalCharges,
    totalRoomCharges: billing.roomCharge,
    totalOverstayCharges: billing.overstayCharge,
    totalServiceCharges: billing.extraServices + billing.taxAmount + billing.serviceChargeAmount,
    totalPayments: billing.totalPayments,
    totalRefunds,
    totalTransfers,
    outstandingBalance: billing.outstandingBalance,
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

    const outstandingBalance = Math.max(0, totalCharges - totalPayments);

    return {
      totalCharges: Number(totalCharges.toFixed(2)),
      totalRoomCharges: Number(totalRoomCharges.toFixed(2)),
      totalOverstayCharges: Number(totalOverstayCharges.toFixed(2)),
      totalServiceCharges: Number(totalServiceCharges.toFixed(2)),
      totalPayments: Number(totalPayments.toFixed(2)),
      totalRefunds: Number(totalRefunds.toFixed(2)),
      totalTransfers: Number(totalTransfers.toFixed(2)),
      outstandingBalance: Number(outstandingBalance.toFixed(2)),
      totalDays,
      totalNights
    };
  }

  // If no matching reservations found, calculate directly from ledger entries if provided
  if (ledgerEntries && guestId) {
    const guestEntries = ledgerEntries.filter(e => e.guestId === guestId);
    if (guestEntries.length > 0) {
      const debits = guestEntries.filter(e => e.type === 'debit').reduce((a, e) => a + e.amount, 0);
      const credits = guestEntries.filter(e => e.type === 'credit').reduce((a, e) => a + e.amount, 0);
      const roomCharges = guestEntries.filter(e => e.type === 'debit' && e.category === 'room' && e.chargeType !== 'overstay').reduce((a, e) => a + e.amount, 0);
      const overstayCharges = guestEntries.filter(e => e.type === 'debit' && e.chargeType === 'overstay').reduce((a, e) => a + e.amount, 0);
      const serviceCharges = guestEntries.filter(e => e.type === 'debit' && e.category !== 'room').reduce((a, e) => a + e.amount, 0);
      const refunds = guestEntries.filter(e => e.type === 'debit' && e.category === 'refund').reduce((a, e) => a + e.amount, 0);
      const transfers = guestEntries.filter(e => e.category === 'transfer').reduce((a, e) => a + e.amount, 0);

      return {
        totalCharges: debits,
        totalRoomCharges: roomCharges,
        totalOverstayCharges: overstayCharges,
        totalServiceCharges: serviceCharges,
        totalPayments: credits,
        totalRefunds: refunds,
        totalTransfers: transfers,
        outstandingBalance: Math.max(0, debits - credits),
        totalDays: 0,
        totalNights: 0
      };
    }
  }

  // Fallback for static guest balance if no active reservations or ledger available
  const fallbackBal = typeof guestOrId === 'object' && guestOrId !== null ? Math.max(0, guestOrId.ledgerBalance || 0) : 0;
  return {
    totalCharges: fallbackBal,
    totalRoomCharges: 0,
    totalOverstayCharges: 0,
    totalServiceCharges: 0,
    totalPayments: 0,
    totalRefunds: 0,
    totalTransfers: 0,
    outstandingBalance: fallbackBal,
    totalDays: 0,
    totalNights: 0
  };
}
