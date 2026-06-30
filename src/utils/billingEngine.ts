import { Reservation, Hotel, LedgerEntry } from '../types';
import { startOfDay, parseISO, differenceInDays, format, addDays, isAfter } from 'date-fns';

/**
 * Safely parses a date string (YYYY-MM-DD) and optional time string (HH:MM)
 * into a Date object using the local system timezone to prevent UTC timezone mismatches.
 */
export function parseLocalDateTime(dateStr: string, timeStr: string = '12:00'): Date {
  if (!dateStr) return new Date();
  const [year, month, day] = dateStr.split('-').map(Number);
  const [hours, minutes] = (timeStr || '12:00').split(':').map(Number);
  return new Date(year, month - 1, day, hours || 0, minutes || 0, 0, 0);
}

export interface BillingState {
  nightsCount: number;         // Total nights expected (base nights + overstay nights)
  extraNights: number;         // Additional nights beyond original booked nights
  nightlyRate: number;         // Rate per night
  originalNights: number;      // Booked nights
  overstayCharge: number;      // Total overstay charge based on policy
  totalCharges: number;        // Total charges (stay + overstay + other debits)
  totalPayments: number;       // Total credits / payments
  outstandingBalance: number;  // totalCharges - totalPayments
  isOverstaying: boolean;      // True if the guest is currently overstaying
  projectedRoomCharge: number; // Charges that are due but not yet posted
  unpostedPrepayment: number;  // Paid amount not yet reflected in ledger credits
}

export const BillingService = {
  /**
   * Calculates the stay window, check-in, and check-out Date objects based on configuration.
   */
  calculateStayWindow(res: Reservation, hotel: Hotel | null) {
    const checkInTime = res.checkInTime || hotel?.defaultCheckInTime || '14:00';
    const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';

    const checkInDateTime = res.checkInDateTime 
      ? new Date(res.checkInDateTime) 
      : parseLocalDateTime(res.checkIn, checkInTime);

    const checkOutDateTime = res.checkOutDateTime 
      ? new Date(res.checkOutDateTime) 
      : parseLocalDateTime(res.checkOut, checkOutTime);

    const originalNights = res.nights || Math.max(1, differenceInDays(
      startOfDay(parseISO(res.checkOut)),
      startOfDay(parseISO(res.checkIn))
    ));

    return {
      checkInDateTime,
      checkOutDateTime,
      originalNights
    };
  },

  /**
   * Calculates the room rate / base stay charge up to the current time.
   * Based entirely on the stay window duration, not midnight rollover.
   */
  calculateRoomCharge(res: Reservation, hotel: Hotel | null, currentTime: Date = new Date()): number {
    if (res.status === 'pending' || res.status === 'confirmed' || res.status === 'cancelled' || res.status === 'no_show') {
      return 0;
    }

    const { checkInDateTime, originalNights } = this.calculateStayWindow(res, hotel);
    const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;

    if (currentTime < checkInDateTime && res.status !== 'checked_in' && res.status !== 'checked_out') {
      return 0;
    }

    // Night 1 is immediately charged upon check-in.
    // Additional base nights are charged sequentially as each subsequent stay period of 24 hours begins (set to checkout hour).
    const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';
    let nightsCharged = 1;

    for (let i = 2; i <= originalNights; i++) {
      const targetDateStr = format(addDays(checkInDateTime, i - 1), 'yyyy-MM-dd');
      const nextChargeTime = parseLocalDateTime(targetDateStr, checkOutTime);
      if (currentTime >= nextChargeTime) {
        nightsCharged++;
      } else {
        break;
      }
    }

    return nightsCharged * nightlyRate;
  },

  /**
   * Evaluates the hotel's configured overstay policy and calculates additional charges.
   */
  calculateOverstayCharge(res: Reservation, hotel: Hotel | null, currentTime: Date = new Date()): number {
    if (res.status !== 'checked_in') {
      return 0;
    }

    const { checkOutDateTime, originalNights } = this.calculateStayWindow(res, hotel);
    const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;

    const gracePeriodMinutes = hotel?.settings?.checkout?.gracePeriod ?? 0;
    const minutesPast = (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60);
    if (minutesPast <= gracePeriodMinutes) {
      return 0;
    }

    const hoursPast = (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60 * 60);
    if (hoursPast <= 0) {
      return 0;
    }

    const policy = hotel?.overstayPolicy || 'grace';
    const graceHours = hotel?.overstayGraceHours ?? 2;
    const partialHours = hotel?.overstayPartialHours ?? 3;
    const partialPercentage = hotel?.overstayPartialPercentage ?? 50;
    const fullHours = hotel?.overstayFullHours ?? 6;

    let overstayNights = 0;

    // Split into full 24-hour days past checkout, and the remaining fractional hours of the current day
    const fullDaysPast = Math.floor(hoursPast / 24);
    const remainingHoursPast = hoursPast % 24;

    overstayNights += fullDaysPast;

    if (remainingHoursPast > 0) {
      if (policy === 'grace') {
        if (remainingHoursPast > graceHours) {
          overstayNights += 1;
        }
      } else if (policy === 'partial') {
        if (remainingHoursPast > fullHours) {
          overstayNights += 1;
        } else if (remainingHoursPast > partialHours) {
          overstayNights += (partialPercentage / 100);
        }
      } else if (policy === 'full') {
        if (remainingHoursPast > fullHours) {
          overstayNights += 1;
        }
      } else if (policy === 'full_night' || policy === 'immediate_full') {
        overstayNights += 1;
      } else {
        // Fallback default: Grace Period
        if (remainingHoursPast > graceHours) {
          overstayNights += 1;
        }
      }
    }

    return overstayNights * nightlyRate;
  },

  /**
   * Determines the exact timestamp of the next expected charge boundary.
   * Used by automated billing deduction systems instead of midnight cron jobs.
   */
  calculateNextChargeDateTime(res: Reservation, hotel: Hotel | null, nightsChargedCount?: number): Date {
    const { checkInDateTime, checkOutDateTime, originalNights } = this.calculateStayWindow(res, hotel);
    const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';

    const charged = nightsChargedCount !== undefined 
      ? nightsChargedCount 
      : (res.lastChargeDateTime ? (res.nights || 1) : 1);

    if (charged < originalNights) {
      // Base nights are charged relative to the check-in date
      const targetDateStr = format(addDays(checkInDateTime, charged), 'yyyy-MM-dd');
      return parseLocalDateTime(targetDateStr, checkOutTime);
    } else {
      // All original nights are charged. The next charge is an overstay charge.
      const policy = hotel?.overstayPolicy || 'grace';
      const graceHours = hotel?.overstayGraceHours ?? 2;
      const partialHours = hotel?.overstayPartialHours ?? 3;
      const fullHours = hotel?.overstayFullHours ?? 6;

      if (policy === 'grace') {
        return new Date(checkOutDateTime.getTime() + graceHours * 60 * 60 * 1000);
      } else if (policy === 'partial') {
        const overstayNightsCharged = charged - originalNights;
        if (overstayNightsCharged === 0) {
          return new Date(checkOutDateTime.getTime() + partialHours * 60 * 60 * 1000);
        } else if (overstayNightsCharged <= 0.5) {
          return new Date(checkOutDateTime.getTime() + fullHours * 60 * 60 * 1000);
        } else {
          return new Date(checkOutDateTime.getTime() + (overstayNightsCharged + 1) * 24 * 60 * 60 * 1000);
        }
      } else if (policy === 'full') {
        return new Date(checkOutDateTime.getTime() + fullHours * 60 * 60 * 1000);
      } else {
        return checkOutDateTime;
      }
    }
  },

  /**
   * Returns a complete calculation of stay limits, expected charges, payments, and outstanding balance.
   */
  calculateOutstandingBalance(
    res: Reservation,
    hotel: Hotel | null,
    ledgerEntries?: LedgerEntry[],
    currentTime: Date = new Date()
  ): BillingState {
    const { checkInDateTime, checkOutDateTime, originalNights } = this.calculateStayWindow(res, hotel);
    const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;

    const baseRoomCharge = this.calculateRoomCharge(res, hotel, currentTime);
    const overstayCharge = this.calculateOverstayCharge(res, hotel, currentTime);
    const totalStayCharge = baseRoomCharge + overstayCharge;

    const isOverstaying = res.status === 'checked_in' && currentTime > checkOutDateTime;

    // Total nights stayed / expected
    const expectedNightsCount = nightlyRate > 0 ? (totalStayCharge / nightlyRate) : originalNights;
    const extraNights = Math.max(0, expectedNightsCount - originalNights);

    // Calculate exclusive tax on base stay
    let baseExclusiveTax = 0;
    const activeTaxes = (hotel?.taxes || []).filter((t: any) => {
      const status = (t.status || '').toLowerCase().trim();
      const taxCat = (t.category || '').toLowerCase().trim();
      return status === 'active' && (taxCat === 'all' || taxCat === 'room' || taxCat === 'service');
    });

    for (const tax of activeTaxes) {
      if (!tax.isInclusive) {
        baseExclusiveTax += baseRoomCharge * (tax.percentage / 100);
      }
    }

    const baseStayWithTaxes = baseRoomCharge + baseExclusiveTax;

    // Calculate exclusive tax on overstay charge
    let overstayExclusiveTax = 0;
    for (const tax of activeTaxes) {
      if (!tax.isInclusive) {
        overstayExclusiveTax += overstayCharge * (tax.percentage / 100);
      }
    }

    let incidentalCharges = 0;
    let totalCharges = 0;
    let totalPayments = 0;
    let projectedRoomCharge = 0;
    let unpostedPrepayment = 0;

    if (ledgerEntries !== undefined) {
      const debits = ledgerEntries.filter(e => e.type === 'debit');
      const credits = ledgerEntries.filter(e => e.type === 'credit');

      const totalPostedDebits = debits.reduce((acc, e) => acc + e.amount, 0);
      const ledgerCreditsSum = credits.reduce((acc, e) => acc + e.amount, 0);

      const postedRoomChargesSum = debits
        .filter(e => {
          const cat = e.category?.toLowerCase();
          if (cat === 'room') return true;
          if (e.chargeType === 'room_rate' || e.chargeType === 'overstay') return true;
          return false;
        })
        .reduce((acc, e) => acc + e.amount, 0);

      projectedRoomCharge = Math.max(0, totalStayCharge - postedRoomChargesSum);
      const projectedRoomTax = Math.max(0, (projectedRoomCharge * overstayExclusiveTax) / (overstayCharge || 1));
      
      unpostedPrepayment = Math.max(0, (res.paidAmount || 0) - ledgerCreditsSum);

      totalCharges = totalPostedDebits + projectedRoomCharge + projectedRoomTax;
      totalPayments = ledgerCreditsSum + unpostedPrepayment + (res.totalDiscount || 0);
    } else {
      // Deduce incidental charges from reservation totalAmount
      incidentalCharges = Math.max(0, (res.totalAmount || 0) - baseStayWithTaxes);

      // Total charges is the base stay + exclusive overstay + exclusive taxes + incidentals
      totalCharges = baseStayWithTaxes + overstayCharge + overstayExclusiveTax + incidentalCharges;
      totalPayments = (res.paidAmount || 0) + (res.totalDiscount || 0);

      // Deduce projected/unposted room charge based on ledgerBalance if available
      if (res.ledgerBalance !== undefined) {
        const postedRoomChargesSum = Math.max(0, (res.ledgerBalance || 0) + (res.paidAmount || 0) - (res.totalAmount || 0) + baseStayWithTaxes);
        projectedRoomCharge = Math.max(0, totalStayCharge - postedRoomChargesSum);
      } else {
        let estimatedPostedCharges = 0;
        if (res.status === 'checked_out') {
          estimatedPostedCharges = totalStayCharge;
        } else if (res.status === 'checked_in') {
          estimatedPostedCharges = res.autoNightDeduction ? baseRoomCharge : nightlyRate;
        }
        projectedRoomCharge = Math.max(0, totalStayCharge - estimatedPostedCharges);
      }
    }

    // Safety checks
    if (isNaN(projectedRoomCharge) || projectedRoomCharge < 0) projectedRoomCharge = 0;
    if (isNaN(totalCharges) || totalCharges < 0) totalCharges = 0;
    if (isNaN(totalPayments) || totalPayments < 0) totalPayments = 0;

    const outstandingBalance = totalCharges - totalPayments;

    return {
      nightsCount: Number(expectedNightsCount.toFixed(2)),
      extraNights: Number(extraNights.toFixed(2)),
      nightlyRate,
      originalNights,
      overstayCharge: Number(overstayCharge.toFixed(2)),
      totalCharges: Number(totalCharges.toFixed(2)),
      totalPayments: Number(totalPayments.toFixed(2)),
      outstandingBalance: Number((isNaN(outstandingBalance) ? 0 : outstandingBalance).toFixed(2)),
      isOverstaying,
      projectedRoomCharge: Number(projectedRoomCharge.toFixed(2)),
      unpostedPrepayment: Number(unpostedPrepayment.toFixed(2))
    };
  },

  /**
   * Duplicate charge check.
   */
  isChargeDuplicate(
    ledgerEntries: LedgerEntry[],
    reservationId: string,
    chargePeriodStart: string,
    chargePeriodEnd: string,
    chargeType: string
  ): boolean {
    return ledgerEntries.some(entry => 
      entry.reservationId === reservationId &&
      entry.chargePeriodStart === chargePeriodStart &&
      entry.chargePeriodEnd === chargePeriodEnd &&
      entry.chargeType === chargeType &&
      entry.type === 'debit'
    );
  }
};

/**
 * Backward compatibility wrapper for calculateBilling.
 */
export function calculateBilling(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): BillingState {
  return BillingService.calculateOutstandingBalance(res, hotel, ledgerEntries);
}

/**
 * Backward compatibility wrapper for getReservationLiveBalance.
 */
export function getReservationLiveBalance(res: Reservation, hotel: Hotel | null): number {
  if (res.status === 'checked_out' || res.status === 'cancelled') {
    return res.ledgerBalance !== undefined ? res.ledgerBalance : 0;
  }
  const billing = BillingService.calculateOutstandingBalance(res, hotel);
  return billing.outstandingBalance;
}
