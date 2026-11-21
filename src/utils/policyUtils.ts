import { Hotel, UserProfile, Reservation, Room, LedgerEntry, Guest } from '../types';
import { hasPermission } from './permissions';
import { differenceInDays } from 'date-fns';
import { getReservationLiveBalance } from './billingEngine';

import { validateGuestAccount } from '../services/financialService';

export const canCheckout = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  ledgerEntries?: LedgerEntry[],
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'check_out_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to check out guests.' };
  }

  // HARD REQUIREMENT: Financial Consistency Audit Gate
  if (reservation.guestId) {
    const validation = validateGuestAccount(reservation.guestId, {
      reservations: [reservation],
      hotel,
      ledgerEntries,
      folioBalance: reservation.ledgerBalance
    });

    if (!validation.isValid) {
      return {
        allowed: false,
        message: `Checkout blocked by Financial Validation Engine: ${validation.violations[0] || 'Guest account failed multi-point audit consistency check.'}`
      };
    }
  }

  const settings = hotel.settings?.checkout;
  if (!settings) return { allowed: true }; // Default behavior


  const outstandingBalance = getReservationLiveBalance(reservation, hotel);

  // Scenario 1: Guest Has Fully Paid
  if (outstandingBalance <= 0.01) {
    return { allowed: true };
  }

  // Scenario 2: Guest Owes Money (Outstanding Balance > 0)
  // Policy applies uniformly to every user with check_out_guests permission.
  if (settings.requireFullPaymentBeforeCheckout) {
    return { 
      allowed: false, 
      message: `Full payment is required before checkout as per hotel policy. Outstanding balance: ₦${Math.round(outstandingBalance).toLocaleString()}` 
    };
  }

  // Check the setting: "Allow Checkout with Outstanding Balance"
  if (!settings.allowBalanceOutstanding) {
    // Corporate postpaid override
    if (settings.allowPostpaidCheckout && (reservation.corporateId || (reservation as any).isPostpaid)) {
      return { allowed: true };
    }
    return { 
      allowed: false, 
      message: `Checkout blocked. Guest has an outstanding balance of ₦${Math.round(outstandingBalance).toLocaleString()}.` 
    };
  }

  return { allowed: true };
};

export const canCheckIn = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  room: Room | undefined,
  guest?: Guest | null,
  allReservations: Reservation[] = [],
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };

  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'check_in_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to check in guests.' };
  }

  // 1. HARD AVAILABILITY BLOCK: Prevent check-in if another guest is already checked into this room
  if (allReservations && allReservations.length > 0) {
    const activeCheckedInGuest = allReservations.find(r => 
      r.roomId === reservation.roomId && 
      r.status === 'checked_in' && 
      r.id !== reservation.id
    );
    if (activeCheckedInGuest) {
      return { 
        allowed: false, 
        message: `Cannot check in to Room ${room?.roomNumber || reservation.roomNumber}. It is currently occupied by in-house guest "${activeCheckedInGuest.guestName}". They must check out before a new guest can check in.` 
      };
    }
  }
  
  const settings = hotel.settings?.checkIn;

  // Enforce allowEarlyCheckIn when explicitly disabled
  if (settings?.allowEarlyCheckIn === false && reservation.checkIn) {
    const scheduledTimeRaw = (reservation.checkInTime || hotel.defaultCheckInTime || '14:00').trim();
    const scheduledTime = /^\d{2}:\d{2}$/.test(scheduledTimeRaw) ? scheduledTimeRaw : '14:00';
    const scheduledStart = new Date(`${reservation.checkIn}T${scheduledTime}:00`);
    if (!isNaN(scheduledStart.getTime()) && new Date() < scheduledStart) {
      return {
        allowed: false,
        message: `Early check-in is disabled by hotel policy. Scheduled check-in opens at ${reservation.checkIn} ${scheduledTime}.`
      };
    }
  }

  // Check Blacklist (DNR)
  if (hotel.settings?.guests?.allowBlacklisting && guest) {
    if ((guest.tags || []).includes('DNR')) {
      return { allowed: false, message: 'Check-in denied: Guest is on Do Not Rent (DNR) / Blacklist.' };
    }
  }

  if (room) {
    if (room.status === 'occupied') {
      return { allowed: false, message: `Cannot check-in. Room ${room.roomNumber} is currently occupied by another guest.` };
    }

    const isDirty = (room.status === 'cleaning' || room.housekeepingStatus === 'cleaning' || room.housekeepingStatus === 'failed')
      ? true
      : (room.status === 'clean' || room.housekeepingStatus === 'ready' || (room.housekeepingStatus as string) === 'clean')
        ? false
        : (room.status === 'dirty' || room.housekeepingStatus === 'dirty');

    const preventDirty = settings ? settings.preventCheckInDirty !== false : true;
    if (preventDirty && isDirty) {
      return { 
        allowed: false, 
        message: `Cannot check in to Room ${room.roomNumber}: Room is currently dirty or undergoing housekeeping. Housekeeping must service and inspect the room before check-in.` 
      };
    }

    const preventMaintenance = settings ? settings.preventCheckInMaintenance !== false : true;
    if (preventMaintenance && (room.status === 'maintenance' || room.status === 'out_of_service' || room.status === 'out_of_order')) {
      return { allowed: false, message: `Cannot check-in. Room ${room.roomNumber} is currently down for maintenance or out of order.` };
    }

    if (settings?.requireRoomInspection && room.status !== 'clean' && room.status !== 'vacant' && room.status !== 'inspected' && room.housekeepingStatus !== 'ready' && (room.housekeepingStatus as string) !== 'clean') {
      if (!settings.allowManualRoomOverride || !hasPermission(profile, 'manage_rooms', customRoles)) {
        return { allowed: false, message: `Room ${room.roomNumber} must be clean and inspected before check-in.` };
      }
    }
  }

  const totalAmount = reservation.totalAmount || 0;
  const paidAmount = (reservation.paidAmount || 0) + (reservation.totalDiscount || 0);
  if (settings?.requirePaymentBeforeCheckIn) {
    if (settings.allowCheckInPendingBalance === false) {
      if (paidAmount + 0.01 < totalAmount) {
        return { allowed: false, message: 'Full payment is required before check-in as per hotel policy.' };
      }
    } else if (totalAmount > 0.01 && paidAmount <= 0.01) {
      return { allowed: false, message: 'A minimum deposit or upfront payment is required before check-in as per hotel policy.' };
    }
  } else if (settings?.allowCheckInPendingBalance === false && totalAmount > 0.01 && paidAmount <= 0.01) {
    return { allowed: false, message: 'Check-in with zero upfront payment is disabled by hotel policy. Please collect a payment first.' };
  }

  const guestSettings = hotel.settings?.guests;
  if (guestSettings?.requireIdVerification) {
    if (!reservation.idNumber || !reservation.idType) {
      return { allowed: false, message: 'Guest ID verification is required for check-in. Please update the reservation with ID details.' };
    }
  }

  if (guestSettings?.requirePhoneVerification) {
    if (!reservation.guestPhone) {
      return { allowed: false, message: 'Guest phone verification is required for check-in. Please update reservation with guest phone number.' };
    }
  }

  return { allowed: true };
};

export const canEditReservation = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'edit_reservations', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to edit reservations.' };
  }

  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowEditing) {
    return { allowed: false, message: 'Reservation editing is currently disabled by administrator.' };
  }

  const isApprover =
    profile.role === 'hotelAdmin' ||
    profile.role === 'superAdmin' ||
    profile.staffRole === 'manager' ||
    hasPermission(profile, 'override_checkout', customRoles);
  if (settings.requireApprovalForEdits && !isApprover) {
    return { allowed: false, message: 'Manager approval required to edit reservations.' };
  }

  return { allowed: true };
};

export const canCancelReservation = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'cancel_reservations', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to cancel reservations.' };
  }

  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowCancellation) {
    return { allowed: false, message: 'Cancellations are currently disabled by administrator.' };
  }

  return { allowed: true };
};

export const canMarkNoShow = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };

  if (!hasPermission(profile, 'cancel_reservations', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to mark reservations as no-show.' };
  }

  const settings = hotel.settings?.reservations;
  if (settings && settings.allowNoShow === false) {
    return { allowed: false, message: 'Marking reservations as No-Show is currently disabled by administrator.' };
  }

  return { allowed: true };
};

export type PenaltyFeeType = 'fixed' | 'percentage';

export interface PenaltyPolicyConfig {
  enabled: boolean;
  feeType: PenaltyFeeType;
  amount: number;
}

/**
 * Single source of truth for No-Show financial penalty policy from hotel Admin Control Policy.
 * Safe default: disabled (₦0 automatic liability).
 */
export const getNoShowPenaltyPolicy = (hotel?: Hotel | null): PenaltyPolicyConfig => {
  const resSettings = hotel?.settings?.reservations;
  const enabled = resSettings?.enableNoShowPenalty === true;
  const feeType: PenaltyFeeType = resSettings?.noShowPenaltyType === 'percentage' ? 'percentage' : 'fixed';
  const rawAmount = Number(resSettings?.noShowPenaltyAmount ?? 0);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  return { enabled, feeType, amount };
};

/**
 * Single source of truth for Cancellation financial fee policy from hotel Admin Control Policy.
 * Safe default: disabled (₦0 automatic liability).
 */
export const getCancellationFeePolicy = (hotel?: Hotel | null): PenaltyPolicyConfig => {
  const resSettings = hotel?.settings?.reservations;
  const enabled = resSettings?.enableCancellationFee === true;
  const feeType: PenaltyFeeType = resSettings?.cancellationFeeType === 'percentage' ? 'percentage' : 'fixed';
  const rawAmount = Number(resSettings?.cancellationFeeAmount ?? 0);
  const amount = Number.isFinite(rawAmount) && rawAmount > 0 ? rawAmount : 0;
  return { enabled, feeType, amount };
};

/**
 * Computes the monetary penalty for a given Admin Control Policy configuration.
 * Returns 0 when policy is disabled or amount is <= 0.
 */
export const calculatePolicyPenaltyAmount = (
  policy: PenaltyPolicyConfig,
  bookingTotal: number = 0
): number => {
  if (!policy.enabled || !Number.isFinite(policy.amount) || policy.amount <= 0) {
    return 0;
  }
  if (policy.feeType === 'percentage') {
    const clampedPct = Math.min(100, Math.max(0, policy.amount));
    const base = Math.max(0, Number(bookingTotal) || 0);
    return Number(((base * clampedPct) / 100).toFixed(2));
  }
  return Number(policy.amount.toFixed(2));
};

/**
 * Returns true if a ledger entry is an explicitly posted No-Show penalty debit.
 * Never classifies regular room, overstay, or tax charges as No-Show penalties.
 */
export const isPostedNoShowPenaltyEntry = (entry: Partial<LedgerEntry>): boolean => {
  if (!entry || entry.type !== 'debit') return false;
  const cat = (entry.category || '').toLowerCase();
  if (cat === 'refund' || cat === 'room' || cat === 'tax') return false;

  const chargeType = (entry.chargeType || '').toLowerCase();
  if (chargeType === 'room_rate' || chargeType === 'overstay') return false;
  if (chargeType === 'no_show_penalty' || cat === 'no_show_penalty') return true;

  const desc = (entry.description || '').toLowerCase();
  if (
    desc.includes('no-show penalty') ||
    desc.includes('no show penalty') ||
    desc.includes('noshow penalty') ||
    desc.includes('no-show fee') ||
    desc.includes('no show fee') ||
    desc.includes('noshow fee') ||
    desc.includes('no-show charge') ||
    desc.includes('no show charge')
  ) {
    return true;
  }

  if (cat === 'penalty' && !desc.includes('cancel')) {
    return true;
  }

  return false;
};

/**
 * Returns true if a ledger entry is an explicitly posted Cancellation fee debit.
 * Never classifies regular room, overstay, or tax charges as Cancellation fees.
 */
export const isPostedCancellationFeeEntry = (entry: Partial<LedgerEntry>): boolean => {
  if (!entry || entry.type !== 'debit') return false;
  const cat = (entry.category || '').toLowerCase();
  if (cat === 'refund' || cat === 'room' || cat === 'tax') return false;

  const chargeType = (entry.chargeType || '').toLowerCase();
  if (chargeType === 'room_rate' || chargeType === 'overstay') return false;
  if (chargeType === 'cancellation_fee' || cat === 'cancellation_fee') return true;

  const desc = (entry.description || '').toLowerCase();
  if (
    desc.includes('cancellation fee') ||
    desc.includes('cancellation penalty') ||
    desc.includes('cancellation charge') ||
    desc.includes('cancel fee') ||
    desc.includes('cancel penalty') ||
    desc.includes('deposit forfeiture') ||
    desc.includes('forfeited deposit')
  ) {
    return true;
  }

  if (cat === 'penalty' && desc.includes('cancel')) {
    return true;
  }

  return false;
};

/**
 * Determines whether a ledger debit represents a legitimately posted financial penalty/fee
 * for a No-Show or Cancelled reservation.
 */
export const isPostedPenaltyLedgerEntry = (
  entry: Partial<LedgerEntry>,
  reservationStatus?: Reservation['status']
): boolean => {
  if (!entry || entry.type !== 'debit') return false;
  if (reservationStatus === 'no_show') {
    return isPostedNoShowPenaltyEntry(entry);
  }
  if (reservationStatus === 'cancelled') {
    return isPostedCancellationFeeEntry(entry);
  }
  return isPostedNoShowPenaltyEntry(entry) || isPostedCancellationFeeEntry(entry);
};

/**
 * Duplicate-prevention guard: returns true if a penalty of the specified type
 * has already been posted to the ledger for the given reservation.
 */
export const hasExistingPostedPenalty = (
  ledgerEntries: LedgerEntry[] = [],
  reservationId: string,
  penaltyType: 'no_show_penalty' | 'cancellation_fee'
): boolean => {
  if (!reservationId || !ledgerEntries.length) return false;
  const expectedKey = `${penaltyType}:${reservationId}`;
  return ledgerEntries.some((entry) => {
    if (entry.idempotencyKey && entry.idempotencyKey === expectedKey) return true;
    if (entry.reservationId !== reservationId) return false;
    return penaltyType === 'no_show_penalty'
      ? isPostedNoShowPenaltyEntry(entry)
      : isPostedCancellationFeeEntry(entry);
  });
};

/**
 * Builds a deterministic, duplicate-safe penalty ledger entry strictly governed by
 * the hotel's active Admin Control Policy. Returns null if the policy is disabled,
 * the calculated amount is <= 0, or a penalty has already been posted.
 */
export const buildPolicyPenaltyLedgerEntry = (
  res: Reservation,
  hotel: Hotel | null,
  penaltyType: 'no_show_penalty' | 'cancellation_fee',
  postedBy: string,
  existingLedgerEntries: LedgerEntry[] = []
): Omit<LedgerEntry, 'id'> | null => {
  if (!res?.id || !hotel?.id) return null;

  const policy =
    penaltyType === 'no_show_penalty'
      ? getNoShowPenaltyPolicy(hotel)
      : getCancellationFeePolicy(hotel);

  if (!policy.enabled) return null;

  const amount = calculatePolicyPenaltyAmount(policy, res.totalAmount || 0);
  if (amount <= 0) return null;

  if (hasExistingPostedPenalty(existingLedgerEntries, res.id, penaltyType)) {
    return null;
  }

  const label = penaltyType === 'no_show_penalty' ? 'No-Show Penalty' : 'Cancellation Fee';
  const basisNote =
    policy.feeType === 'percentage'
      ? ` (${policy.amount}% of booking value)`
      : ' (Fixed policy fee)';

  return {
    guestId: res.guestId || '',
    hotelId: hotel.id,
    reservationId: res.id,
    referenceId: res.id,
    type: 'debit',
    amount,
    category: penaltyType,
    chargeType: penaltyType,
    description: `${label} - Room ${res.roomNumber || 'N/A'}${basisNote}`,
    timestamp: new Date().toISOString(),
    postedBy,
    idempotencyKey: `${penaltyType}:${res.id}`,
    skipAutomaticTax: true,
  };
};

export const canUpdateRoomStatus = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  room: Room,
  newStatus: Room['status'],
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Hotel Admin & Super Admin always have full authority
  const isAdmin = profile.role === 'hotelAdmin' || profile.role === 'superAdmin' || profile.staffRole === 'admin';
  if (!isAdmin) {
    // Granular Action Permission Check: Must have explicit 'change_room_status' permission
    const hasStatusChangePerm = hasPermission(profile, 'change_room_status', customRoles);
    if (!hasStatusChangePerm) {
      return { 
        allowed: false, 
        message: 'Permission denied: You do not have permission to change room status (e.g., from clean to dirty). Please contact your Hotel Administrator to grant this permission.' 
      };
    }
  }

  const settings = hotel.settings?.housekeeping;
  if (!settings) return { allowed: true };

  if (!settings.allowStatusUpdates && !hasPermission(profile, 'manage_rooms', customRoles) && !isAdmin) {
    return { allowed: false, message: 'Room status updates are currently disabled by administrator.' };
  }

  if (settings.preventOccupiedOverride && room.status === 'occupied' && !hasPermission(profile, 'manage_rooms', customRoles) && !isAdmin) {
    return { allowed: false, message: 'Cannot change the status of an occupied room from here.' };
  }

  if (!settings.allowDirtyToCleanChanges && room.status === 'dirty' && newStatus === 'clean') {
    return { allowed: false, message: 'Policy prevents direct "Dirty" to "Clean" status changes. Please use "Cleaning" status first.' };
  }

  return { allowed: true };
};

export const canProcessRefund = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  amount: number,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'process_refunds', customRoles) && !hasPermission(profile, 'approve_refund', customRoles) && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return { allowed: false, message: 'Access denied: You do not have permission to process refunds.' };
  }

  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowRefunds) {
    return { allowed: false, message: 'Refund processing is currently disabled by administrator.' };
  }

  if (settings.requireApprovalForRefunds && !hasPermission(profile, 'void_transaction', customRoles) && !hasPermission(profile, 'approve_refund', customRoles)) {
    return { allowed: false, message: 'Manager approval is required to process refunds.' };
  }

  return { allowed: true };
};

export const canApplyDiscount = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  amount: number,
  totalAmount: number,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowDiscounts) {
    return { allowed: false, message: 'Discounts are currently disabled by administrator.' };
  }

  const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
  if (settings.requireApprovalForLargeDiscounts && percentage > (settings.largeDiscountThreshold || 10)) {
    if (!hasPermission(profile, 'void_transaction', customRoles)) {
      return { allowed: false, message: `Discounts above ${settings.largeDiscountThreshold}% require manager approval.` };
    }
  }

  return { allowed: true };
};

export const canManageGuest = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  action: 'create' | 'edit' | 'delete' | 'blacklist' | 'export',
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Strict Granular Permission Check (Rule 2)
  if (action === 'create' && !hasPermission(profile, 'add_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to add guests.' };
  }
  if (action === 'edit' && !hasPermission(profile, 'edit_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to edit guests.' };
  }
  if (action === 'delete' && !hasPermission(profile, 'delete_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to delete guests.' };
  }
  if (action === 'export' && !hasPermission(profile, 'export_guests', customRoles)) {
    return { allowed: false, message: 'Access denied: You do not have permission to export guests.' };
  }

  const settings = hotel.settings?.guests;
  if (!settings) return { allowed: true };

  if (action === 'edit' && !settings.allowProfileEditing && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return { allowed: false, message: 'Guest profile editing is currently disabled by administrator.' };
  }

  if (action === 'delete' && !settings.allowDeletion && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return { allowed: false, message: 'Guest record deletion is currently restricted.' };
  }

  if (action === 'blacklist' && !settings.allowBlacklisting && !hasPermission(profile, 'manage_staff', customRoles)) {
    return { allowed: false, message: 'Blacklisting functionality is currently disabled.' };
  }

  return { allowed: true };
};

export const canBlockRoom = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  startDate: string,
  endDate: string,
  reason: string,
  frequency?: string,
  hasPartialTimes?: boolean,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowBlocking) {
    return { allowed: false, message: 'Room blocking is currently disabled by administrator.' };
  }

  if (settings.requireReasonForBlock && !reason) {
    return { allowed: false, message: 'A reason or category is required for room blocking.' };
  }

  if (reason === 'maintenance' && !settings.allowMaintenanceBlocks) {
    return { allowed: false, message: 'Maintenance blocks are currently disabled.' };
  }

  if (reason === 'housekeeping' && !settings.allowHousekeepingBlocks) {
    return { allowed: false, message: 'Housekeeping cleaning blocks are currently disabled.' };
  }

  if (frequency && frequency !== 'once' && !settings.allowRecurringBlocks) {
    return { allowed: false, message: 'Recurring room blocks are disabled by configuration.' };
  }

  if (hasPartialTimes && !settings.allowPartialDayBlocks) {
    return { allowed: false, message: 'Partial-day room blocking is disabled by configuration.' };
  }

  const duration = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  const maxDur = settings.maxBlockDuration || 30;
  if (duration > maxDur) {
    return { allowed: false, message: `Policy limits room blocks to a maximum of ${maxDur} days.` };
  }

  return { allowed: true };
};

export const canUnblockRoom = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowUnblocking && !hasPermission(profile, 'remove_room_blocks', customRoles) && !hasPermission(profile, 'unblock_rooms', customRoles)) {
    return { allowed: false, message: 'Unblocking rooms is currently restricted to administrators.' };
  }

  return { allowed: true };
};

export const canVoidTransaction = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  entry: LedgerEntry,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!hasPermission(profile, 'void_transaction', customRoles)) {
    return { allowed: false, message: 'You do not have permission to void transactions.' };
  }

  return { allowed: true };
};

export const canEditInvoice = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const financialSettings = hotel.settings?.financial;
  const checkoutSettings = hotel.settings?.checkout;

  // Policy: Lock Invoices After Checkout
  // Check both financial and checkout settings (defaults to true if not explicitly disabled)
  const isInvoiceLocked = financialSettings?.lockInvoicesAfterCheckout ?? checkoutSettings?.lockInvoicesAfterCheckout ?? true;

  if (reservation.status === 'checked_out' && isInvoiceLocked && !hasPermission(profile, 'void_transaction', customRoles)) {
    return { allowed: false, message: 'Invoices are locked for checked-out reservations. Manager override required.' };
  }

  const allowInvoiceEditingAfterPayment = financialSettings?.allowInvoiceEditingAfterPayment ?? false;
  if (reservation.ledgerBalance === 0 && !allowInvoiceEditingAfterPayment && !hasPermission(profile, 'void_transaction', customRoles)) {
     return { allowed: false, message: 'Editing is disabled for fully paid invoices. Manager override required.' };
  }

  return { allowed: true };
};

export const canReleaseNoShow = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  customRoles: any[] = []
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.autoReleaseNoShow && !hasPermission(profile, 'manage_rooms', customRoles)) {
    return { allowed: false, message: 'Manual release of no-shows is restricted.' };
  }

  return { allowed: true };
};
