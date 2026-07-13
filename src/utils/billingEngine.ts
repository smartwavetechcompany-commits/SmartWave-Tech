import { Reservation, Hotel, LedgerEntry, Tax } from '../types';
import { startOfDay, parseISO, differenceInDays, format, addDays } from 'date-fns';

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
  unpostedIncidentals?: number; // Difference between reservation totalAmount and base stay not yet posted
}

/**
 * Enterprise Billing Engine - Single Source of Truth
 */
export class BillingEngine {
  /**
   * 1. Calculates the Room Charge: roomRate * bookedNights
   */
  static calculateRoomCharges(res: Reservation): number {
    const bookedNights = res.nights || 0;
    const roomRate = res.nightlyRate || (bookedNights > 0 ? (res.totalAmount / bookedNights) : 0) || 0;
    return roomRate * bookedNights;
  }

  /**
   * 2. Calculates Overstay Charges: roomRate * overstayNights
   */
  static calculateOverstay(res: Reservation, hotel: Hotel | null, options?: any): number {
    const allowOverstayCharges = options?.allowOverstayCharges ?? hotel?.autoChargeOverstays ?? true;
    if (!allowOverstayCharges) return 0;

    const bookedNights = res.nights || 0;
    const roomRate = res.nightlyRate || (bookedNights > 0 ? (res.totalAmount / bookedNights) : 0) || 0;

    // Retrieve manual overstay nights if set, otherwise calculate dynamically
    let overstayNights = res.overstayNights !== undefined ? (res.overstayNights as number) : 0;
    
    if (res.status === 'checked_in') {
      const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';
      const checkOutDateTime = res.checkOutDateTime 
        ? new Date(res.checkOutDateTime) 
        : parseLocalDateTime(res.checkOut, checkOutTime);
      const currentTime = options?.currentTime || new Date();

      if (currentTime > checkOutDateTime) {
        const hoursPast = (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60 * 60);
        if (hoursPast > 0) {
          const graceHours = hotel?.overstayGraceHours ?? 2;
          const fullDaysPast = Math.floor(hoursPast / 24);
          const remainingHoursPast = hoursPast % 24;
          let calculatedOverstayNights = fullDaysPast;
          if (remainingHoursPast > graceHours) {
            calculatedOverstayNights += 1;
          }
          overstayNights = Math.max(overstayNights, calculatedOverstayNights);
        }
      }
    }
    return roomRate * overstayNights;
  }

  /**
   * 3. Calculates Extra Services (Incidentals / other ledger debits)
   */
  static calculateExtraServices(res: Reservation, ledgerEntries?: LedgerEntry[]): number {
    if (ledgerEntries) {
      // Incidentals are debits that are not room rate, overstay charges, or taxes
      return ledgerEntries
        .filter(e => e.type === 'debit' && e.category !== 'room' && e.category !== 'tax' && e.chargeType !== 'room_rate' && e.chargeType !== 'overstay')
        .reduce((acc, e) => acc + e.amount, 0);
    }
    // Fallback: Estimate extra charges from original reservation amounts if ledger is not yet populated
    const baseRoom = this.calculateRoomCharges(res);
    return Math.max(0, (res.totalAmount || 0) - baseRoom);
  }

  /**
   * 4. Calculates Discounts
   */
  static calculateDiscounts(res: Reservation): number {
    if (res.totalDiscount !== undefined && res.totalDiscount > 0) {
      return res.totalDiscount;
    }
    if (res.discountType === 'percentage') {
      const roomCharges = this.calculateRoomCharges(res);
      return roomCharges * ((res.discountAmount || 0) / 100);
    }
    return res.discountAmount || 0;
  }

  /**
   * 5. Calculates Tax based on specific parameters and Inclusive/Exclusive flags
   */
  static calculateTax(subtotal: number, hotel: Hotel | null, options?: any): { amount: number; isInclusive: boolean; rate: number } {
    const taxEnabled = options?.taxEnabled ?? (hotel?.taxes?.some(t => t.status === 'active' && t.category !== 'service') ?? true);
    if (!taxEnabled) {
      return { amount: 0, isInclusive: false, rate: 0 };
    }

    const activeTaxes = (hotel?.taxes || []).filter(t => t.status === 'active' && t.category !== 'service');
    const taxInclusive = options?.taxInclusive ?? activeTaxes.some(t => t.isInclusive);
    const taxRate = options?.taxRate ?? activeTaxes.reduce((acc, t) => acc + t.percentage, 0);

    let amount = 0;
    if (taxInclusive) {
      // Extract tax from total (subtotal is inclusive of tax)
      amount = subtotal - (subtotal / (1 + taxRate / 100));
    } else {
      // Add tax to subtotal (exclusive tax)
      amount = subtotal * (taxRate / 100);
    }

    return { amount, isInclusive: taxInclusive, rate: taxRate };
  }

  /**
   * 6. Calculates Service Charge based on subtotal
   */
  static calculateServiceCharge(subtotal: number, hotel: Hotel | null, options?: any): { amount: number; isInclusive: boolean; rate: number } {
    const activeServiceCharges = (hotel?.taxes || []).filter(t => t.status === 'active' && (t.category === 'service' || t.name.toLowerCase().includes('service')));
    const serviceChargeEnabled = options?.serviceChargeEnabled ?? (activeServiceCharges.length > 0);
    if (!serviceChargeEnabled) {
      return { amount: 0, isInclusive: false, rate: 0 };
    }

    const serviceChargeInclusive = options?.serviceChargeInclusive ?? activeServiceCharges.some(t => t.isInclusive);
    const serviceChargeRate = options?.serviceChargeRate ?? activeServiceCharges.reduce((acc, t) => acc + t.percentage, 0);

    let amount = 0;
    if (serviceChargeInclusive) {
      amount = subtotal - (subtotal / (1 + serviceChargeRate / 100));
    } else {
      amount = subtotal * (serviceChargeRate / 100);
    }

    return { amount, isInclusive: serviceChargeInclusive, rate: serviceChargeRate };
  }

  /**
   * 8. Calculates Total Payments stored in payments list or ledger entries
   */
  static calculatePayments(res: Reservation, ledgerEntries?: LedgerEntry[]): number {
    if (ledgerEntries) {
      return ledgerEntries
        .filter(e => {
          if (e.type !== 'credit') return false;
          // Exclude room rate discount/adjustment credits to prevent double counting
          if (e.category === 'room') {
            const desc = (e.description || '').toLowerCase();
            if (desc.includes('discount') || desc.includes('adjust') || desc.includes('correction') || desc.includes('rate')) {
              return false;
            }
          }
          // Exclude general folio discounts / service adjustment credits to prevent double counting
          if (e.category === 'discount' || e.category === 'service') {
            return false;
          }
          return true;
        })
        .reduce((acc, e) => acc + e.amount, 0);
    }
    return res.paidAmount || 0;
  }

  /**
   * 9. Calculates Balance: max(0, grandTotal - totalPaid)
   */
  static calculateBalance(grandTotal: number, totalPaid: number): number {
    return Math.max(0, grandTotal - totalPaid);
  }

  /**
   * Helper to reconstruct ledger entries with inclusive taxes merged back to parents.
   */
  static reconstructInclusiveTaxes(entries: LedgerEntry[]): LedgerEntry[] {
    const result = entries.map(e => ({ ...e }));
    
    // Find all inclusive tax entries (debits in category 'tax' with '[Inclusive]' in description)
    const inclusiveTaxes = result.filter(e => 
      e.type === 'debit' && 
      e.category === 'tax' && 
      e.description?.toLowerCase().includes('[inclusive]')
    );
    
    for (const tax of inclusiveTaxes) {
      const forIndex = tax.description?.toLowerCase().lastIndexOf(' for ');
      if (forIndex !== undefined && forIndex !== -1) {
        const parentDesc = tax.description.slice(forIndex + 5).trim().toLowerCase();
        
        // Find parent entry (matching description and timestamp)
        const parent = result.find(p => {
          if (p.type !== 'debit' || p.category === 'tax') return false;
          
          const descMatches = p.description?.toLowerCase() === parentDesc ||
                              parentDesc.includes(p.description?.toLowerCase() || '') ||
                              (p.description?.toLowerCase() || '').includes(parentDesc);
          
          const timeMatches = p.timestamp === tax.timestamp || 
                              Math.abs(new Date(p.timestamp).getTime() - new Date(tax.timestamp).getTime()) < 5000;
          
          return descMatches && timeMatches;
        });
        
        if (parent) {
          parent.amount += tax.amount;
          tax.amount = 0;
        }
      }
    }
    
    return result.filter(e => e.amount > 0 || e.type === 'credit');
  }

  /**
   * Full comprehensive reservation billing calculation using the strict order of operations:
   * 1. Room Charges
   * 2. Overstay Charges
   * 3. Extra Services
   * 4. Discounts
   * 5. Tax
   * 6. Service Charge
   * 7. Total
   * 8. Payments
   * 9. Balance
   */
  static calculateReservation(
    res: Reservation,
    hotel: Hotel | null,
    ledgerEntries?: LedgerEntry[],
    options?: any
  ): BillingState & {
    roomCharge: number;
    overstayCharge: number;
    extraServices: number;
    discount: number;
    subtotal: number;
    taxAmount: number;
    serviceChargeAmount: number;
    grandTotal: number;
    totalPaid: number;
    balance: number;
  } {
    const roundTotals = options?.roundTotals ?? true;
    const precision = options?.currencyPrecision ?? 2;
    const factor = Math.pow(10, precision);

    const bookedNights = res.nights || 0;
    const roomRate = res.nightlyRate || (bookedNights > 0 ? (res.totalAmount / bookedNights) : 0) || 0;

    const reconstructedLedger = ledgerEntries ? this.reconstructInclusiveTaxes(ledgerEntries) : undefined;

    // 1. Room Charges
    const roomCharge = this.calculateRoomCharges(res);

    // 2. Overstay Charges
    const overstayCharge = this.calculateOverstay(res, hotel, options);

    // 3. Extra Services
    const extraServices = this.calculateExtraServices(res, reconstructedLedger);

    // 4. Discounts
    const discount = this.calculateDiscounts(res);

    // Subtotal before taxes and service charges
    const subtotalBeforeDiscount = roomCharge + overstayCharge + extraServices;
    const subtotalAfterDiscount = Math.max(0, subtotalBeforeDiscount - discount);

    // 5. Tax
    const taxInfo = this.calculateTax(subtotalAfterDiscount, hotel, options);
    let taxAmount = taxInfo.amount;

    // 6. Service Charge
    const serviceChargeInfo = this.calculateServiceCharge(subtotalAfterDiscount, hotel, options);
    let serviceChargeAmount = serviceChargeInfo.amount;

    // 7. Total
    let grandTotal = subtotalAfterDiscount;
    if (taxInfo.rate > 0 && !taxInfo.isInclusive) {
      grandTotal += taxAmount;
    }
    if (serviceChargeInfo.rate > 0 && !serviceChargeInfo.isInclusive) {
      grandTotal += serviceChargeAmount;
    }

    if (roundTotals) {
      grandTotal = Math.round(grandTotal * factor) / factor;
      taxAmount = Math.round(taxAmount * factor) / factor;
      serviceChargeAmount = Math.round(serviceChargeAmount * factor) / factor;
    }

    // 8. Payments
    const totalPaid = this.calculatePayments(res, reconstructedLedger);

    // 9. Balance
    const balance = this.calculateBalance(grandTotal, totalPaid);

    // Map backwards-compatible fields
    const overstayNights = roomRate > 0 ? overstayCharge / roomRate : 0;
    const expectedNightsCount = bookedNights + overstayNights;
    const isOverstaying = res.status === 'checked_in' && overstayCharge > 0;

    // Calculate projectedRoomCharge (difference between calculated room charge up to now and what has been posted)
    let projectedRoomCharge = 0;
    if (reconstructedLedger) {
      const postedRoomChargesSum = reconstructedLedger
        .filter(e => e.type === 'debit' && (e.category === 'room' || e.chargeType === 'room_rate' || e.chargeType === 'overstay'))
        .reduce((acc, e) => acc + e.amount, 0);
      projectedRoomCharge = (roomCharge + overstayCharge) - postedRoomChargesSum;
    }

    return {
      nightsCount: Number(expectedNightsCount.toFixed(precision)),
      extraNights: Number(overstayNights.toFixed(precision)),
      nightlyRate: roomRate,
      originalNights: bookedNights,
      overstayCharge: Number(overstayCharge.toFixed(precision)),
      totalCharges: Number(grandTotal.toFixed(precision)),
      totalPayments: Number(totalPaid.toFixed(precision)),
      outstandingBalance: Number((grandTotal - totalPaid).toFixed(precision)),
      isOverstaying,
      projectedRoomCharge: Number(projectedRoomCharge.toFixed(precision)),
      unpostedPrepayment: 0,
      unpostedIncidentals: 0,
      
      // Extended fields
      roomCharge: Number(roomCharge.toFixed(precision)),
      extraServices: Number(extraServices.toFixed(precision)),
      discount: Number(discount.toFixed(precision)),
      subtotal: Number(subtotalAfterDiscount.toFixed(precision)),
      taxAmount: Number(taxAmount.toFixed(precision)),
      serviceChargeAmount: Number(serviceChargeAmount.toFixed(precision)),
      grandTotal: Number(grandTotal.toFixed(precision)),
      totalPaid: Number(totalPaid.toFixed(precision)),
      balance: Number(balance.toFixed(precision))
    };
  }
}

export const BillingService = {
  calculateStayWindow(res: Reservation, hotel: Hotel | null) {
    const checkInTime = res.checkInTime || hotel?.defaultCheckInTime || '14:00';
    const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';

    const checkInDateTime = res.checkInDateTime 
      ? new Date(res.checkInDateTime) 
      : parseLocalDateTime(res.checkIn, checkInTime);

    const checkOutDateTime = res.checkOutDateTime 
      ? new Date(res.checkOutDateTime) 
      : parseLocalDateTime(res.checkOut, checkOutTime);

    const originalNights = res.nights || calculateStayDuration(res.checkIn, res.checkOut).totalNights;

    return {
      checkInDateTime,
      checkOutDateTime,
      originalNights
    };
  },

  calculateRoomCharge(res: Reservation, hotel: Hotel | null, currentTime: Date = new Date()): number {
    return BillingEngine.calculateRoomCharges(res);
  },

  calculateOverstayCharge(res: Reservation, hotel: Hotel | null, currentTime: Date = new Date()): number {
    return BillingEngine.calculateOverstay(res, hotel, { currentTime });
  },

  calculateNextChargeDateTime(res: Reservation, hotel: Hotel | null, nightsChargedCount?: number): Date {
    const { checkInDateTime, checkOutDateTime, originalNights } = this.calculateStayWindow(res, hotel);
    const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';

    const charged = nightsChargedCount !== undefined 
      ? nightsChargedCount 
      : (res.lastChargeDateTime ? (res.nights || 1) : 1);

    if (charged < originalNights) {
      const targetDateStr = format(addDays(checkInDateTime, charged), 'yyyy-MM-dd');
      return parseLocalDateTime(targetDateStr, checkOutTime);
    } else {
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

  calculateOutstandingBalance(
    res: Reservation,
    hotel: Hotel | null,
    ledgerEntries?: LedgerEntry[],
    currentTime: Date = new Date()
  ): BillingState {
    return BillingEngine.calculateReservation(res, hotel, ledgerEntries, { currentTime });
  },

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
  return BillingEngine.calculateReservation(res, hotel, ledgerEntries);
}

/**
 * Backward compatibility wrapper for getReservationLiveBalance.
 */
export function getReservationLiveBalance(res: Reservation, hotel: Hotel | null): number {
  const billing = BillingEngine.calculateReservation(res, hotel);
  return billing.outstandingBalance;
}

export function calculateStayDuration(checkInDate: string | Date, checkoutDate: string | Date) {
  const parseDate = (d: string | Date): Date => {
    if (d instanceof Date) return d;
    if (typeof d === 'string') {
      if (d.includes('T')) {
        return parseISO(d);
      }
      const parts = d.split('-');
      if (parts.length === 3) {
        return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
      }
      return new Date(d);
    }
    return new Date();
  };

  const cin = startOfDay(parseDate(checkInDate));
  const cout = startOfDay(parseDate(checkoutDate));
  const totalNights = Math.max(0, differenceInDays(cout, cin));
  const totalDays = totalNights + 1;

  return {
    totalDays,
    totalNights
  };
}

