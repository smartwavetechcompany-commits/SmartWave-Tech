import { Reservation, Hotel, LedgerEntry, Tax, Guest } from '../types';
import { startOfDay, parseISO, differenceInDays, format, addDays } from 'date-fns';
import { calculateReservationAccount } from './financialUtils';
import { calculateStayDuration, StayDuration, getGracePeriodInfo } from './dateUtils';

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

export interface FolioTaxItem {
  id?: string;
  name: string;
  percentage: number;
  isInclusive: boolean;
  amount: number;
  showOnFolio?: boolean;
  showOnReceipt?: boolean;
}

export interface FolioBreakdown {
  stayDuration: StayDuration;
  nightlyRate: number;
  tier1: {
    baseRoomGross: number; // Pre-tax room charges accrued for all nights
    ancillaryCharges: LedgerEntry[];
    ancillaryTotal: number;
    totalGrossRate: number; // baseRoomGross + ancillaryTotal
  };
  tier2: {
    taxes: FolioTaxItem[];
    totalTaxAmount: number;
    inclusiveTaxTotal: number;
    exclusiveTaxTotal: number;
  };
  tier3: {
    totalCharges: number; // Total net invoice (Gross + Excl. taxes + ancillaries)
    totalPayments: number;
    totalRefunds: number;
    outstandingBalance: number;
    netAmountDue: number;
    creditBalance: number;
    accountStatus: 'OUTSTANDING' | 'SETTLED' | 'OVERPAID' | 'ZERO_BALANCE';
  };
  isOverstaying: boolean;
  overstayNights: number;
  overstayCharge: number;
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
   * Authoritative dynamic room rate resolver.
   * Rates can be any dynamic amount configured by admin.
   */
  static getNightlyRate(res: Reservation, hotel?: Hotel | null, ledgerEntries?: LedgerEntry[]): number {
    if (res.nightlyRate && res.nightlyRate > 0) {
      return res.nightlyRate;
    }
    // Check if room charge has already posted in ledger
    if (ledgerEntries && ledgerEntries.length > 0) {
      const roomDebit = ledgerEntries.find(e => e.type === 'debit' && (e.category === 'room' || e.chargeType === 'room_rate'));
      if (roomDebit && roomDebit.amount > 0) {
        // If an inclusive tax debit also exists for this charge, add it back to find the full room rate
        const inclusiveTax = ledgerEntries.find(e => 
          e.type === 'debit' && 
          e.category === 'tax' && 
          e.description?.toLowerCase().includes('[inclusive]') &&
          (e.timestamp === roomDebit.timestamp || (roomDebit.id && e.description?.includes(roomDebit.id)))
        );
        return Number((roomDebit.amount + (inclusiveTax?.amount || 0)).toFixed(2));
      }
    }
    // Check hotel rooms collection if roomId matches
    if ((hotel as any)?.rooms && res.roomId) {
      const room = ((hotel as any).rooms as any[]).find(r => r.id === res.roomId);
      if (room && room.price > 0) {
        return room.price;
      }
    }
    // Fallback: initial reservation totalAmount divided by booked nights
    const bookedNights = Math.max(1, calculateStayDuration(res.checkIn, res.checkOut).bookedNights || res.nights || 1);
    if (res.totalAmount && res.totalAmount > 0 && res.status !== 'checked_in') {
      return Number((res.totalAmount / bookedNights).toFixed(2));
    }
    return res.totalAmount ? Number((res.totalAmount / bookedNights).toFixed(2)) : 0;
  }

  /**
   * Single authoritative stay duration calculation respecting hotel checkout time and grace period.
   */
  static calculateStay(res: Reservation, hotel?: Hotel | null, currentTime?: Date): StayDuration {
    return calculateStayDuration(
      res.checkIn,
      res.checkOut,
      res.overstayNights,
      res.status,
      { hotel, res, currentTime: currentTime || new Date() }
    );
  }

  /**
   * 1. Calculates the Room Charge: roomRate * bookedNights
   */
  static calculateRoomCharges(res: Reservation, hotel?: Hotel | null): number {
    const duration = this.calculateStay(res, hotel);
    const roomRate = this.getNightlyRate(res, hotel);
    return Number((roomRate * duration.bookedNights).toFixed(2));
  }

  /**
   * 2. Calculates Overstay Charges: roomRate * overstayNights
   */
  static calculateOverstay(res: Reservation, hotel: Hotel | null, options?: any): number {
    if (res.autoNightDeduction === false) return 0;
    const allowOverstayCharges = options?.allowOverstayCharges ?? hotel?.autoChargeOverstays ?? true;
    if (!allowOverstayCharges) return 0;

    const currentTime = options?.currentTime || new Date();
    const duration = this.calculateStay(res, hotel, currentTime);
    const roomRate = this.getNightlyRate(res, hotel);

    return Number((roomRate * duration.overstayNights).toFixed(2));
  }

  /**
   * 3. Calculates Extra Services (Incidentals / other ledger debits)
   */
  static calculateExtraServices(res: Reservation, ledgerEntries?: LedgerEntry[]): number {
    if (ledgerEntries) {
      // Incidentals are debits that are not room rate, overstay charges, or taxes
      return ledgerEntries
        .filter(e => e.type === 'debit' && e.category !== 'room' && e.category !== 'tax' && e.category !== 'refund' && e.chargeType !== 'room_rate' && e.chargeType !== 'overstay')
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
   * Strictly calculates taxes ONLY ONCE on stay revenue.
   */
  static calculateTax(subtotal: number, hotel: Hotel | null, options?: any): { amount: number; isInclusive: boolean; rate: number } {
    const activeTaxes = (hotel?.taxes || []).filter(t => (t.status || '').toLowerCase() === 'active' && (t.category || '').toLowerCase() !== 'restaurant');
    const taxEnabled = options?.taxEnabled ?? (activeTaxes.length > 0);
    if (!taxEnabled || activeTaxes.length === 0) {
      return { amount: 0, isInclusive: false, rate: 0 };
    }

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

    return { amount: Number(amount.toFixed(2)), isInclusive: taxInclusive, rate: taxRate };
  }

  /**
   * 6. Calculates Service Charge based on subtotal
   */
  static calculateServiceCharge(subtotal: number, hotel: Hotel | null, options?: any): { amount: number; isInclusive: boolean; rate: number } {
    const activeServiceCharges = (hotel?.taxes || []).filter(t => (t.status || '').toLowerCase() === 'active' && ((t.category || '').toLowerCase() === 'service' || t.name.toLowerCase().includes('service')));
    const serviceChargeEnabled = options?.serviceChargeEnabled ?? (activeServiceCharges.length > 0);
    if (!serviceChargeEnabled || activeServiceCharges.length === 0) {
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

    return { amount: Number(amount.toFixed(2)), isInclusive: serviceChargeInclusive, rate: serviceChargeRate };
  }

  /**
   * Comprehensive Folio Breakdown - Single Source of Truth
   * Eliminates all discrepancies between Folio Tiers, Guest Ledger, and Invoices.
   */
  static calculateFolioBreakdown(
    res: Reservation,
    hotel: Hotel | null,
    ledgerEntries?: LedgerEntry[],
    currentTime: Date = new Date()
  ): FolioBreakdown {
    const stayDuration = this.calculateStay(res, hotel, currentTime);
    const nightlyRate = this.getNightlyRate(res, hotel, ledgerEntries);

    const activeTaxes = (hotel?.taxes || []).filter(t => 
      (t.status || '').toLowerCase() === 'active' && 
      (t.category || '').toLowerCase() !== 'restaurant'
    );

    const resLedger = ledgerEntries ? ledgerEntries.filter(e => e.reservationId === res.id) : undefined;

    let baseRoomGross = 0;
    let ancillaryCharges: LedgerEntry[] = [];
    let ancillaryTotal = 0;
    let totalGrossRate = 0;

    let folioTaxes: FolioTaxItem[] = [];
    let totalTaxAmount = 0;
    let inclusiveTaxTotal = 0;
    let exclusiveTaxTotal = 0;

    let totalCharges = 0;
    let totalPayments = 0;
    let totalRefunds = 0;

    if (resLedger && resLedger.length > 0) {
      // 1. Authoritative calculation from actual ledger entries
      const roomDebits = resLedger.filter(e => e.type === 'debit' && (e.category === 'room' || e.chargeType === 'room_rate' || e.chargeType === 'overstay'));
      const taxDebits = resLedger.filter(e => e.type === 'debit' && e.category === 'tax');
      ancillaryCharges = resLedger.filter(e => e.type === 'debit' && e.category !== 'room' && e.category !== 'tax' && e.category !== 'refund' && e.chargeType !== 'room_rate' && e.chargeType !== 'overstay');
      const refundDebits = resLedger.filter(e => e.type === 'debit' && e.category === 'refund');
      const creditEntries = resLedger.filter(e => e.type === 'credit');

      ancillaryTotal = ancillaryCharges.reduce((sum, e) => sum + e.amount, 0);
      totalPayments = creditEntries.reduce((sum, e) => sum + e.amount, 0);
      totalRefunds = refundDebits.reduce((sum, e) => sum + e.amount, 0);

      // Ledger debits total
      totalCharges = resLedger.filter(e => e.type === 'debit' && e.category !== 'refund').reduce((sum, e) => sum + e.amount, 0);

      const postedRoomChargesSum = roomDebits.reduce((sum, e) => sum + e.amount, 0);
      const postedTaxChargesSum = taxDebits.reduce((sum, e) => sum + e.amount, 0);

      // Determine how taxes and base gross are structured in ledger
      const hasInclusiveTaxDebits = taxDebits.some(t => t.description?.toLowerCase().includes('[inclusive]'));
      if (hasInclusiveTaxDebits) {
        // Room debits were posted as pre-tax base, and taxes as separate entries
        baseRoomGross = postedRoomChargesSum;
        inclusiveTaxTotal = taxDebits.filter(t => t.description?.toLowerCase().includes('[inclusive]')).reduce((sum, t) => sum + t.amount, 0);
        exclusiveTaxTotal = taxDebits.filter(t => !t.description?.toLowerCase().includes('[inclusive]')).reduce((sum, t) => sum + t.amount, 0);
      } else if (activeTaxes.some(t => t.isInclusive)) {
        // Room debits represent gross inclusive stay; extract base and tax
        const totalRoomStay = postedRoomChargesSum;
        const incRate = activeTaxes.filter(t => t.isInclusive).reduce((sum, t) => sum + t.percentage, 0);
        inclusiveTaxTotal = totalRoomStay - (totalRoomStay / (1 + incRate / 100));
        baseRoomGross = totalRoomStay - inclusiveTaxTotal;
        exclusiveTaxTotal = postedTaxChargesSum;
      } else {
        baseRoomGross = postedRoomChargesSum;
        inclusiveTaxTotal = 0;
        exclusiveTaxTotal = postedTaxChargesSum;
      }

      // Generate clean itemized tax rows calculated exactly once
      const staySubjectAmount = baseRoomGross + inclusiveTaxTotal;
      folioTaxes = activeTaxes.map(tax => {
        const amt = tax.isInclusive 
          ? staySubjectAmount - (staySubjectAmount / (1 + tax.percentage / 100))
          : staySubjectAmount * (tax.percentage / 100);
        return {
          id: tax.id,
          name: tax.name,
          percentage: tax.percentage,
          isInclusive: tax.isInclusive,
          amount: Number(amt.toFixed(2)),
          showOnFolio: tax.showOnFolio !== false,
          showOnReceipt: tax.showOnReceipt !== false
        };
      });

      totalTaxAmount = inclusiveTaxTotal + exclusiveTaxTotal;
    } else {
      // 2. Unposted fallback: compute from stay duration and rate
      const totalRoomStay = nightlyRate * stayDuration.totalNights;
      let calculatedTaxTotal = 0;
      let calcIncTotal = 0;
      let calcExclTotal = 0;

      folioTaxes = activeTaxes.map(tax => {
        const amt = tax.isInclusive 
          ? totalRoomStay - (totalRoomStay / (1 + tax.percentage / 100))
          : totalRoomStay * (tax.percentage / 100);
        calculatedTaxTotal += amt;
        if (tax.isInclusive) calcIncTotal += amt;
        else calcExclTotal += amt;
        return {
          id: tax.id,
          name: tax.name,
          percentage: tax.percentage,
          isInclusive: tax.isInclusive,
          amount: Number(amt.toFixed(2)),
          showOnFolio: tax.showOnFolio !== false,
          showOnReceipt: tax.showOnReceipt !== false
        };
      });

      inclusiveTaxTotal = calcIncTotal;
      exclusiveTaxTotal = calcExclTotal;
      totalTaxAmount = calculatedTaxTotal;
      baseRoomGross = totalRoomStay - inclusiveTaxTotal;
      ancillaryTotal = 0;
      ancillaryCharges = [];
      totalCharges = totalRoomStay + exclusiveTaxTotal;
      totalPayments = res.paidAmount || 0;
      totalRefunds = 0;
    }

    baseRoomGross = Number(baseRoomGross.toFixed(2));
    ancillaryTotal = Number(ancillaryTotal.toFixed(2));
    totalGrossRate = Number((baseRoomGross + ancillaryTotal).toFixed(2));
    inclusiveTaxTotal = Number(inclusiveTaxTotal.toFixed(2));
    exclusiveTaxTotal = Number(exclusiveTaxTotal.toFixed(2));
    totalTaxAmount = Number(totalTaxAmount.toFixed(2));
    totalCharges = Number(totalCharges.toFixed(2));
    totalPayments = Number(totalPayments.toFixed(2));
    totalRefunds = Number(totalRefunds.toFixed(2));

    const netPayments = Math.max(0, totalPayments - totalRefunds);
    const rawBalance = totalCharges - netPayments;
    const outstandingBalance = Number(rawBalance.toFixed(2));
    const netAmountDue = Math.max(0, outstandingBalance);
    const creditBalance = Math.max(0, -outstandingBalance);

    let accountStatus: FolioBreakdown['tier3']['accountStatus'] = 'ZERO_BALANCE';
    if (outstandingBalance > 0.01) {
      accountStatus = 'OUTSTANDING';
    } else if (outstandingBalance < -0.01) {
      accountStatus = 'OVERPAID';
    } else {
      accountStatus = 'SETTLED';
    }

    const overstayCharge = Number((nightlyRate * stayDuration.overstayNights).toFixed(2));
    const isOverstaying = res.status === 'checked_in' && stayDuration.overstayNights > 0;

    return {
      stayDuration,
      nightlyRate,
      tier1: {
        baseRoomGross,
        ancillaryCharges,
        ancillaryTotal,
        totalGrossRate
      },
      tier2: {
        taxes: folioTaxes,
        totalTaxAmount,
        inclusiveTaxTotal,
        exclusiveTaxTotal
      },
      tier3: {
        totalCharges,
        totalPayments,
        totalRefunds,
        outstandingBalance,
        netAmountDue,
        creditBalance,
        accountStatus
      },
      isOverstaying,
      overstayNights: stayDuration.overstayNights,
      overstayCharge
    };
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

    const duration = calculateStayDuration(res.checkIn, res.checkOut);
    const originalNights = duration.bookedNights > 0 ? duration.bookedNights : (res.nights || 1);

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
      const graceInfo = getGracePeriodInfo(res, hotel);
      return graceInfo.effectiveDeadlineDateTime;
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
 * Single source of truth wrapper for calculateBilling.
 * Derives accounting state from actual ledger entries or stored reservation ledger balance.
 */
export function calculateBilling(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): BillingState {
  const account = calculateReservationAccount(res, hotel, ledgerEntries);
  const nightlyRate = res.nightlyRate || (account.totalNights > 0 ? account.totalRoomCharges / account.totalNights : 0);
  const duration = calculateStayDuration(res.checkIn, res.checkOut);
  const originalNights = duration.bookedNights > 0 ? duration.bookedNights : (res.nights || 1);
  return {
    nightsCount: account.totalNights,
    extraNights: 0,
    nightlyRate,
    originalNights,
    overstayCharge: account.totalOverstayCharges,
    totalCharges: account.totalCharges,
    totalPayments: account.totalPayments,
    outstandingBalance: account.outstandingBalance,
    isOverstaying: res.status === 'checked_in' && account.totalOverstayCharges > 0,
    projectedRoomCharge: 0,
    unpostedPrepayment: 0,
    unpostedIncidentals: 0
  };
}

/**
 * Single source of truth wrapper for getReservationLiveBalance.
 * Strictly returns the authoritative ledger outstanding balance.
 */
export function getReservationLiveBalance(
  res: Reservation,
  hotel: Hotel | null,
  ledgerEntries?: LedgerEntry[]
): number {
  if (res.ledgerBalance !== undefined && (!ledgerEntries || ledgerEntries.length === 0)) {
    return Number(res.ledgerBalance.toFixed(2));
  }
  return calculateReservationAccount(res, hotel, ledgerEntries).outstandingBalance;
}

export { calculateStayDuration };

export { calculateGuestAccount, calculateReservationAccount } from './financialUtils';
export type { GuestAccountSummary } from './financialUtils';



