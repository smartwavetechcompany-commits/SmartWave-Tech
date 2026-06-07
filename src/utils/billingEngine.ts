import { Reservation, Hotel, LedgerEntry } from '../types';
import { startOfDay, parseISO, differenceInDays, format, isAfter } from 'date-fns';

export interface BillingState {
  nightsCount: number;         // Total nights they have expected (covering elapsed + overstays)
  extraNights: number;         // Math.max(0, nightsCount - originalNights)
  nightlyRate: number;         // Rate per night
  originalNights: number;      // reservation.nights || 1
  overstayCharge: number;      // extraNights * nightlyRate
  
  // Totals
  totalCharges: number;        // total contract stay + overstay charges + ancillary posted
  totalPayments: number;       // total collections / prepayments
  outstandingBalance: number;  // totalCharges - totalPayments
  isOverstaying: boolean;

  // Detailed breakdowns for Folio views
  projectedRoomCharge: number;
  unpostedPrepayment: number;
}

/**
 * Single source of truth for all PMS billing calculations.
 */
export function calculateBilling(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): BillingState {
  const originalNights = res.nights || 1;
  let expectedNightsCount = originalNights;
  let isOverstaying = false;

  if (res.status === 'checked_in') {
    try {
      const today = startOfDay(new Date());
      const checkInDate = startOfDay(parseISO(res.checkIn));
      const elapsedNights = Math.max(0, differenceInDays(today, checkInDate));
      
      expectedNightsCount = Math.max(expectedNightsCount, elapsedNights);
      
      const overstayTime = hotel?.overstayChargeTime || hotel?.defaultCheckOutTime || '12:00';
      const checkOutDateStr = res.checkOut;
      const todayStr = format(new Date(), 'yyyy-MM-dd');
      const checkOutDateTime = new Date(`${checkOutDateStr}T${overstayTime}`);
      
      // Overstay occurs if today's date is past scheduled checkOut date, OR if today is scheduled checkOut date but we are past checked-out/overstay hour
      isOverstaying = checkOutDateStr < todayStr || (checkOutDateStr === todayStr && new Date() > checkOutDateTime);
      
      if (isOverstaying) {
        expectedNightsCount = Math.max(expectedNightsCount, elapsedNights + 1);
      }
    } catch (e) {
      console.error("Error computing billing expected nights:", e);
    }
  }

  const grossBaseStayAmount = res.totalAmount - (res.taxDetails?.reduce((acc, t) => acc + (t.amount || 0), 0) || 0);
  const nightlyRate = res.nightlyRate || (originalNights > 0 ? (grossBaseStayAmount / originalNights) : 0) || 0;
  const extraNights = Math.max(0, expectedNightsCount - originalNights);
  const overstayCharge = extraNights * nightlyRate;

  let totalCharges = (res.totalAmount || 0) + overstayCharge;
  let totalPayments = (res.paidAmount || 0) + (res.totalDiscount || 0);

  let projectedRoomCharge = overstayCharge;
  let unpostedPrepayment = 0;

  // If ledger entries are loaded, we can refine calculations using the detailed transactions
  if (ledgerEntries !== undefined) {
    const debits = ledgerEntries.filter(e => e.type === 'debit');
    const credits = ledgerEntries.filter(e => e.type === 'credit');

    const totalPostedDebits = debits.reduce((acc, e) => acc + e.amount, 0);
    const ledgerCreditsSum = credits.reduce((acc, e) => acc + e.amount, 0);

    const postedRoomChargesSum = debits
      .filter(e => e.category?.toLowerCase() === 'room')
      .reduce((acc, e) => acc + e.amount, 0);

    // Dynamic unposted stay cost is the expected stay liability minus room charges already posted in ledger
    projectedRoomCharge = Math.max(0, (expectedNightsCount * nightlyRate) - postedRoomChargesSum);
    
    // Prepayment/deposit applied on the reservation that hasn't been written to ledger yet
    unpostedPrepayment = Math.max(0, (res.paidAmount || 0) - ledgerCreditsSum);

    totalCharges = totalPostedDebits + projectedRoomCharge;
    totalPayments = ledgerCreditsSum + unpostedPrepayment;
  }

  const outstandingBalance = totalCharges - totalPayments;

  return {
    nightsCount: expectedNightsCount,
    extraNights,
    nightlyRate,
    originalNights,
    overstayCharge,
    totalCharges: Number(totalCharges.toFixed(2)),
    totalPayments: Number(totalPayments.toFixed(2)),
    outstandingBalance: Number(outstandingBalance.toFixed(2)),
    isOverstaying,
    projectedRoomCharge: Number(projectedRoomCharge.toFixed(2)),
    unpostedPrepayment: Number(unpostedPrepayment.toFixed(2))
  };
}
