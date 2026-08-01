import { Guest, Reservation, Hotel, LedgerEntry } from '../types';
import { calculateGuestAccount, calculateReservationAccount, GuestAccountSummary } from './financialUtils';

export interface AuditMismatchReport {
  guestId: string;
  guestName: string;
  calculatedAccount: GuestAccountSummary;
  storedLedgerBalance?: number;
  hasMismatch: boolean;
  discrepancies: string[];
}

/**
 * Diagnostic utility to audit guest account balances across modules
 */
export function auditGuestAccount(
  guest: Guest,
  reservations: Reservation[],
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): AuditMismatchReport {
  const account = calculateGuestAccount(guest, reservations, hotel, ledgerEntries);
  const discrepancies: string[] = [];

  const storedBalance = guest.ledgerBalance || 0;
  if (Math.abs(account.outstandingBalance - storedBalance) > 0.01) {
    discrepancies.push(
      `Guest Card stored balance (₦${storedBalance.toLocaleString()}) does not match transaction engine calculated balance (₦${account.outstandingBalance.toLocaleString()})`
    );
  }

  // Audit reservations for this guest
  const matchingRes = reservations.filter(r => r.guestId === guest.id && r.status !== 'cancelled');
  matchingRes.forEach(r => {
    const resAcc = calculateReservationAccount(r, hotel, ledgerEntries);
    if (r.ledgerBalance !== undefined && Math.abs(r.ledgerBalance - resAcc.outstandingBalance) > 0.01) {
      discrepancies.push(
        `Reservation #${r.id.slice(-6).toUpperCase()} stored ledgerBalance (₦${(r.ledgerBalance || 0).toLocaleString()}) does not match engine balance (₦${resAcc.outstandingBalance.toLocaleString()})`
      );
    }
  });

  const hasMismatch = discrepancies.length > 0;
  if (hasMismatch) {
    console.warn(`[Financial Audit Discrepancy Detected for Guest: ${guest.name} (${guest.id})]`, discrepancies);
  }

  return {
    guestId: guest.id,
    guestName: guest.name,
    calculatedAccount: account,
    storedLedgerBalance: storedBalance,
    hasMismatch,
    discrepancies
  };
}

/**
 * Diagnostic utility to audit all guests in the system
 */
export function auditAllGuestAccounts(
  guests: Guest[],
  reservations: Reservation[],
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): AuditMismatchReport[] {
  return guests.map(g => auditGuestAccount(g, reservations, hotel, ledgerEntries));
}
