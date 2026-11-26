import type { Hotel, LedgerEntry, Reservation, Tax } from '../types';
import { calculateBookedRoomTotal } from './rateSnapshot';
import { calculateReservationAccount } from './financialUtils';

const getSafeStr = (val: any, fallback = ''): string => {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object') return String(val.name || val.text || val.description || fallback);
  return String(val || fallback);
};

export interface ReceiptRoomTaxContext {
  activeRoomExclusiveTaxes: Tax[];
  exclusiveRoomTaxRatePct: number;
}

export function getActiveRoomExclusiveTaxes(hotel: Hotel | null | undefined): ReceiptRoomTaxContext {
  const activeRoomExclusiveTaxes = (hotel?.taxes || []).filter((t) => {
    const status = (t.status || '').toLowerCase().trim();
    const category = (t.category || '').toLowerCase().trim();
    return (
      status === 'active' &&
      !t.isInclusive &&
      (Number(t.percentage) || 0) > 0 &&
      category !== 'restaurant' &&
      category !== 'f & b' &&
      category !== 'food'
    );
  });
  const exclusiveRoomTaxRatePct = activeRoomExclusiveTaxes.reduce(
    (sum, t) => sum + (Number(t.percentage) || 0),
    0
  );
  return { activeRoomExclusiveTaxes, exclusiveRoomTaxRatePct };
}

/**
 * Pure, read-only calculation of unposted room accommodation base for ReceiptGenerator.
 * Never mutates Firestore or alters PMS business logic — only ensures stay extensions,
 * updated extension nightly rates, and pre-checkout room totals appear accurately on receipts.
 */
export function computeReceiptUnpostedRoomBase(params: {
  reservation: Reservation;
  hotel: Hotel;
  reconciledEntries: LedgerEntry[];
  roomDebits: LedgerEntry[];
  reconstructedRoomDebits: LedgerEntry[];
  folioType?: 'guest' | 'company' | 'all';
}): {
  unpostedRoomBase: number;
  postedRoomAmount: number;
  targetRoomBase: number;
  totalNights: number;
  bookedNightsCount: number;
  postedNightsCount: number;
} {
  const {
    reservation,
    hotel,
    reconciledEntries,
    roomDebits,
    reconstructedRoomDebits,
    folioType = 'all',
  } = params;

  const resAccount = calculateReservationAccount(reservation, hotel, reconciledEntries);
  const totalNights = resAccount.totalNights || reservation.nights || 1;
  const bookedNightsCount = resAccount.bookingNights || reservation.nights || 1;
  const postedNightsCount = roomDebits.length;

  const postedRoomAmount =
    reconstructedRoomDebits.length > 0
      ? reconstructedRoomDebits.reduce((sum, e) => sum + (Number(e.amount) || 0), 0)
      : roomDebits.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  // Company-only folio receipts for corporate bookings should not inject guest stay totals
  if (reservation.corporateId && folioType === 'company') {
    if (reservation.status !== 'checked_out' && totalNights > postedNightsCount) {
      const expectedTotalRoom =
        calculateBookedRoomTotal(reservation, bookedNightsCount, hotel, reconciledEntries) +
        (resAccount.totalOverstayCharges || 0);
      return {
        unpostedRoomBase: Math.max(0, Number((expectedTotalRoom - postedRoomAmount).toFixed(2))),
        postedRoomAmount,
        targetRoomBase: expectedTotalRoom,
        totalNights,
        bookedNightsCount,
        postedNightsCount,
      };
    }
    return {
      unpostedRoomBase: 0,
      postedRoomAmount,
      targetRoomBase: postedRoomAmount,
      totalNights,
      bookedNightsCount,
      postedNightsCount,
    };
  }

  const { exclusiveRoomTaxRatePct } = getActiveRoomExclusiveTaxes(hotel);
  const resTotalAmount = Math.max(0, Number(reservation.totalAmount) || 0);

  // Infer the authoritative room base implied by reservation.totalAmount (stripping active exclusive room taxes)
  const inferredBaseFromTotalAmount =
    resTotalAmount > 0
      ? exclusiveRoomTaxRatePct > 0
        ? Number((resTotalAmount / (1 + exclusiveRoomTaxRatePct / 100)).toFixed(2))
        : Number(resTotalAmount.toFixed(2))
      : 0;

  const snapshotRoomTotal =
    calculateBookedRoomTotal(reservation, bookedNightsCount, hotel, reconciledEntries) +
    (resAccount.totalOverstayCharges || 0);

  if (reservation.status !== 'checked_out') {
    const targetRoomBase = Number(
      Math.max(snapshotRoomTotal, inferredBaseFromTotalAmount).toFixed(2)
    );
    const unpostedRoomBase =
      targetRoomBase - postedRoomAmount > 0.01
        ? Number((targetRoomBase - postedRoomAmount).toFixed(2))
        : 0;

    return {
      unpostedRoomBase,
      postedRoomAmount,
      targetRoomBase,
      totalNights,
      bookedNightsCount,
      postedNightsCount,
    };
  }

  // Checked-out fallback when zero room nights exist in ledger
  if (postedNightsCount === 0 && resTotalAmount > 0) {
    const hasExtensions = Boolean(reservation.rateSnapshot?.extensions?.length);
    const stayExclusiveTax = hasExtensions
      ? Number((resTotalAmount - inferredBaseFromTotalAmount).toFixed(2))
      : (reservation.taxDetails || [])
          .filter((t) => !t.isInclusive)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0) ||
        Number((resTotalAmount - inferredBaseFromTotalAmount).toFixed(2));
    const base = Math.max(0, Number((resTotalAmount - stayExclusiveTax).toFixed(2)));
    return {
      unpostedRoomBase: base,
      postedRoomAmount: 0,
      targetRoomBase: base,
      totalNights,
      bookedNightsCount,
      postedNightsCount,
    };
  }

  return {
    unpostedRoomBase: 0,
    postedRoomAmount,
    targetRoomBase: postedRoomAmount,
    totalNights,
    bookedNightsCount,
    postedNightsCount,
  };
}

/**
 * Determines whether stored reservation.taxDetails are still aligned with the current
 * receipt subtotal, or have become stale after a stay extension / rate update.
 */
export function shouldUseStoredReservationTax(params: {
  reservation?: Reservation;
  tax: Tax;
  subtotal: number;
  storedTaxAmount: number;
}): boolean {
  const { reservation, tax, subtotal, storedTaxAmount } = params;
  if (!reservation) return false;
  if (reservation.rateSnapshot?.extensions && reservation.rateSnapshot.extensions.length > 0) {
    return false;
  }
  const pct = Number(tax.percentage) || 0;
  if (pct <= 0) return true;
  const expectedFromSubtotal = tax.isInclusive
    ? subtotal - subtotal / (1 + pct / 100)
    : subtotal * (pct / 100);
  // If stored tax differs meaningfully from subtotal-derived tax (e.g. stay extended or edited),
  // compute dynamically from the updated subtotal so receipt taxes & grand total remain accurate.
  if (Math.abs(expectedFromSubtotal - storedTaxAmount) > 1) {
    return false;
  }
  return true;
}

/**
 * Checks whether a tax applies to room accommodation charges (excludes restaurant-only taxes).
 */
export function isRoomApplicableTax(tax: Tax): boolean {
  const taxCat = getSafeStr(tax.category).toLowerCase().trim();
  return taxCat !== 'restaurant' && taxCat !== 'f & b' && taxCat !== 'food';
}
