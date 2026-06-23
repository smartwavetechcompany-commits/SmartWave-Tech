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

  if (res.status === 'checked_in' || res.status === 'checked_out') {
    try {
      const today = res.status === 'checked_out' 
        ? startOfDay(parseISO(res.checkOut)) 
        : startOfDay(new Date());
      const checkInDate = startOfDay(parseISO(res.checkIn));
      const elapsedNights = Math.max(0, differenceInDays(today, checkInDate));
      
      expectedNightsCount = Math.max(expectedNightsCount, elapsedNights);
      
      if (res.status === 'checked_in') {
        const overstayTime = hotel?.overstayChargeTime || hotel?.defaultCheckOutTime || '12:00';
        const checkOutDateStr = res.checkOut;
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const checkOutDateTime = new Date(`${checkOutDateStr}T${overstayTime}`);
        
        // Overstay occurs if today's date is past scheduled checkOut date, OR if today is scheduled checkOut date but we are past checked-out/overstay hour
        isOverstaying = checkOutDateStr < todayStr || (checkOutDateStr === todayStr && new Date() > checkOutDateTime);
        
        if (isOverstaying) {
          const todayCheckOutDateTime = new Date(`${todayStr}T${overstayTime}`);
          const pastTodayCheckoutHour = new Date() > todayCheckOutDateTime;
          if (pastTodayCheckoutHour) {
            expectedNightsCount = Math.max(originalNights, elapsedNights + 1);
          } else {
            expectedNightsCount = Math.max(originalNights, elapsedNights);
          }
        } else {
          expectedNightsCount = originalNights;
        }
      } else {
        // For checked out status, expected nights is exactly what was stayed (which is elapsedNights)
        expectedNightsCount = Math.max(originalNights, elapsedNights);
      }
    } catch (e) {
      console.error("Error computing billing expected nights:", e);
    }
  }

  // Inclusive Taxes: Rule 1 dictates all room rates are inclusive of tax. Do not subtract taxes to compute nightly rate.
  const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;
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
      .filter(e => {
        const cat = e.category?.toLowerCase();
        if (cat === 'room') return true;
        if (cat === 'tax') {
          const desc = e.description?.toLowerCase() || '';
          return desc.includes('inclusive') && (desc.includes('room') || desc.includes('stay'));
        }
        return false;
      })
      .reduce((acc, e) => acc + e.amount, 0);

    // Dynamic unposted stay cost is the expected stay liability minus room charges already posted in ledger
    projectedRoomCharge = Math.max(0, (expectedNightsCount * nightlyRate) - postedRoomChargesSum);
    
    // Prepayment/deposit applied on the reservation that hasn't been written to ledger yet
    unpostedPrepayment = Math.max(0, (res.paidAmount || 0) - ledgerCreditsSum);

    totalCharges = totalPostedDebits + projectedRoomCharge;
    totalPayments = ledgerCreditsSum + unpostedPrepayment;
  } else {
    // Estimate posted room charges based on physical stay status in the database to prevent double counting
    let postedRoomChargesSum = 0;
    if (res.status === 'checked_out') {
      postedRoomChargesSum = expectedNightsCount * nightlyRate;
    } else if (res.status === 'checked_in') {
      if (res.autoNightDeduction) {
        try {
          const today = startOfDay(new Date());
          const checkInDate = startOfDay(parseISO(res.checkIn));
          const elapsedNights = Math.max(0, differenceInDays(today, checkInDate));
          const scheduledNights = res.nights || 1;
          
          let targetCharges = elapsedNights;
          if (hotel && hotel.autoChargeOverstays !== false) {
            const overstayTime = hotel.overstayChargeTime || hotel.defaultCheckOutTime || '12:00';
            const [hours, minutes] = overstayTime.split(':').map(Number);
            const now = new Date();
            const todayOverstayThreshold = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours || 12, minutes || 0, 0, 0);
            
            if (now.getTime() > todayOverstayThreshold.getTime()) {
              targetCharges += 1;
            }
          }
          targetCharges = Math.max(targetCharges, Math.min(scheduledNights, elapsedNights + 1));
          
          postedRoomChargesSum = targetCharges * nightlyRate;
        } catch (e) {
          console.error("Error estimating posted room charges:", e);
        }
      } else {
        // If autoNightDeduction is disabled, assume at least 1 night (or elapsed) was posted on check-in
        try {
          const today = startOfDay(new Date());
          const checkInDate = startOfDay(parseISO(res.checkIn));
          const elapsedNights = Math.max(0, differenceInDays(today, checkInDate));
          postedRoomChargesSum = Math.max(1, elapsedNights) * nightlyRate;
        } catch (e) {
          postedRoomChargesSum = nightlyRate;
        }
      }
    }
    projectedRoomCharge = Math.max(0, (expectedNightsCount * nightlyRate) - postedRoomChargesSum);
  }

  // Fallbacks to prevent NaN
  if (isNaN(projectedRoomCharge) || projectedRoomCharge < 0) {
    projectedRoomCharge = 0;
  }
  if (isNaN(totalCharges)) {
    totalCharges = 0;
  }
  if (isNaN(totalPayments)) {
    totalPayments = 0;
  }

  const outstandingBalance = totalCharges - totalPayments;
  const safeOutstandingBalance = isNaN(outstandingBalance) ? 0 : outstandingBalance;

  return {
    nightsCount: expectedNightsCount,
    extraNights,
    nightlyRate,
    originalNights,
    overstayCharge,
    totalCharges: Number((isNaN(totalCharges) ? 0 : totalCharges).toFixed(2)),
    totalPayments: Number((isNaN(totalPayments) ? 0 : totalPayments).toFixed(2)),
    outstandingBalance: Number(safeOutstandingBalance.toFixed(2)),
    isOverstaying,
    projectedRoomCharge: Number(projectedRoomCharge.toFixed(2)),
    unpostedPrepayment: Number((isNaN(unpostedPrepayment) ? 0 : unpostedPrepayment).toFixed(2))
  };
}

/**
 * Calculates a live reservation balance by combining the ledger balance (actual posted debits/credits)
 * and the unposted room charges to ensure no double-counting occurs.
 */
export function getReservationLiveBalance(res: Reservation, hotel: Hotel | null): number {
  if (res.ledgerBalance === undefined) {
    const billing = calculateBilling(res, hotel);
    return billing.outstandingBalance;
  }
  
  if (res.status === 'checked_out' || res.status === 'cancelled') {
    return res.ledgerBalance;
  }
  
  if (res.status === 'checked_in') {
    const billing = calculateBilling(res, hotel);
    return res.ledgerBalance + billing.projectedRoomCharge;
  }
  
  // Pending, Confirmed, Cancelled, No Show
  const billing = calculateBilling(res, hotel);
  return billing.outstandingBalance;
}
