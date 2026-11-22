import { Hotel, UserProfile, Reservation, Room, LedgerEntry, Guest } from '../types';
import { hasPermission } from './permissions';
import { differenceInDays } from 'date-fns';
import { getReservationLiveBalance } from './billingEngine';

import { validateGuestAccount } from '../services/financialService';

export interface PolicyBlockDetail {
  /** Standard heading shown in UI & logs */
  title: string;
  /** Exact configured Admin Control Policy or RBAC rule name */
  policyName: string;
  /** Policy category in Admin Control Policy */
  policyCategory: string;
  /** Exact Admin Control Policy navigation path / section */
  policySection: string;
  /** Active configured threshold, rule, or toggle value from hotel.settings */
  configuredCondition?: string;
  /** Specific runtime reason the operation was blocked */
  reason: string;
  /** Safe suggested next step for staff or Hotel Administrator */
  suggestedAction: string;
  /** True when blocked by RBAC role permission rather than a hotel policy toggle */
  isPermissionBlock?: boolean;
}

export interface PolicyCheckResult {
  allowed: boolean;
  message?: string;
  detail?: PolicyBlockDetail;
}

const POLICY_CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: '₦',
  USD: '$',
  EUR: '€',
  GBP: '£',
  GHS: '₵',
  KES: 'KSh ',
  ZAR: 'R',
};

function formatPolicyCurrency(amount: number, hotel?: Hotel | null): string {
  const code = String(hotel?.defaultCurrency || 'NGN').toUpperCase();
  const sym = POLICY_CURRENCY_SYMBOLS[code] || `${code} `;
  return `${sym}${Math.round(Number(amount) || 0).toLocaleString()}`;
}

export function buildPolicyBlockResult(
  input: Omit<PolicyBlockDetail, 'title'> & { title?: string }
): PolicyCheckResult {
  const detail: PolicyBlockDetail = {
    title: input.title || 'Operation Blocked by Hotel Policy',
    policyName: input.policyName,
    policyCategory: input.policyCategory,
    policySection: input.policySection,
    configuredCondition: input.configuredCondition,
    reason: input.reason,
    suggestedAction: input.suggestedAction,
    isPermissionBlock: input.isPermissionBlock,
  };

  const parts: string[] = [
    detail.title,
    `Policy: ${detail.policyName} (${detail.policySection})`,
  ];
  if (detail.configuredCondition) {
    parts.push(`Condition: ${detail.configuredCondition}`);
  }
  parts.push(`Reason: ${detail.reason}`);
  parts.push(`Action: ${detail.suggestedAction}`);

  return {
    allowed: false,
    message: parts.join(' — '),
    detail,
  };
}

export const canCheckout = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  ledgerEntries?: LedgerEntry[],
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'check_out_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Check-Out Permission (check_out_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: check_out_guests',
      reason: 'Your assigned staff role does not include permission to check out guests.',
      suggestedAction: 'Ask a Hotel Administrator or authorized Front Desk supervisor to complete checkout or update your role permissions.',
      isPermissionBlock: true,
    });
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
      return buildPolicyBlockResult({
        policyName: 'Financial Consistency Audit Gate',
        policyCategory: 'Checkout & Financial Integrity',
        policySection: 'Admin Control Policy → Checkout Policies',
        configuredCondition: 'Multi-point guest folio & ledger consistency check must pass before checkout',
        reason: validation.violations[0] || 'Guest account failed multi-point audit consistency check.',
        suggestedAction: 'Open the Guest Folio to reconcile the balance and ledger entries, or request Finance / Hotel Administrator review before retrying checkout.',
      });
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
    return buildPolicyBlockResult({
      policyName: 'Hard Pay-First Rule (Require Full Payment Before Checkout)',
      policyCategory: 'Checkout Policies',
      policySection: 'Admin Control Policy → Checkout Policies',
      configuredCondition: 'Require Full Payment Before Checkout is enabled (Balance must be 0)',
      reason: `Guest still has an outstanding balance of ${formatPolicyCurrency(outstandingBalance, hotel)}.`,
      suggestedAction: 'Collect and post the remaining balance on the Guest Folio before checkout, or have a Hotel Administrator review the Hard Pay-First Rule in Admin Control Policy → Checkout Policies.',
    });
  }

  // Check the setting: "Allow Checkout with Outstanding Balance"
  if (!settings.allowBalanceOutstanding) {
    // Corporate postpaid override
    if (settings.allowPostpaidCheckout && (reservation.corporateId || (reservation as any).isPostpaid)) {
      return { allowed: true };
    }
    return buildPolicyBlockResult({
      policyName: 'Allow Checkout with Outstanding Balance',
      policyCategory: 'Checkout Policies',
      policySection: 'Admin Control Policy → Checkout Policies',
      configuredCondition: settings.allowPostpaidCheckout
        ? 'Checkout with unpaid balance is disabled (except linked Corporate Postpaid bookings)'
        : 'Checkout with unpaid balance is disabled',
      reason: `Guest has an unpaid outstanding balance of ${formatPolicyCurrency(outstandingBalance, hotel)}.`,
      suggestedAction: 'Settle the outstanding balance in Guest Folio (or transfer to an approved Corporate Account if applicable), or ask a Hotel Administrator to review Checkout Policies.',
    });
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
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };

  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'check_in_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Check-In Permission (check_in_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: check_in_guests',
      reason: 'Your assigned staff role does not include permission to check in guests.',
      suggestedAction: 'Contact your Hotel Administrator or an authorized Front Desk staff member to perform check-in.',
      isPermissionBlock: true,
    });
  }

  // 1. HARD AVAILABILITY BLOCK: Prevent check-in if another guest is already checked into this room
  if (allReservations && allReservations.length > 0) {
    const activeCheckedInGuest = allReservations.find(r => 
      r.roomId === reservation.roomId && 
      r.status === 'checked_in' && 
      r.id !== reservation.id
    );
    if (activeCheckedInGuest) {
      return buildPolicyBlockResult({
        policyName: 'Room Occupancy Integrity Lock',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: 'A room cannot host two simultaneous checked-in reservations',
        reason: `Room ${room?.roomNumber || reservation.roomNumber} is currently occupied by in-house guest "${activeCheckedInGuest.guestName}".`,
        suggestedAction: 'Check out the current in-house guest first, or reassign this arrival to an available clean room.',
      });
    }
  }
  
  const settings = hotel.settings?.checkIn;

  // Enforce allowEarlyCheckIn when explicitly disabled
  if (settings?.allowEarlyCheckIn === false && reservation.checkIn) {
    const scheduledTimeRaw = (reservation.checkInTime || hotel.defaultCheckInTime || '14:00').trim();
    const scheduledTime = /^\d{2}:\d{2}$/.test(scheduledTimeRaw) ? scheduledTimeRaw : '14:00';
    const scheduledStart = new Date(`${reservation.checkIn}T${scheduledTime}:00`);
    if (!isNaN(scheduledStart.getTime()) && new Date() < scheduledStart) {
      return buildPolicyBlockResult({
        policyName: 'Permit Early Check-In',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: `Early Check-In is disabled; standard check-in opens at ${reservation.checkIn} ${scheduledTime}`,
        reason: `Attempted check-in before the scheduled check-in time (${reservation.checkIn} ${scheduledTime}).`,
        suggestedAction: 'Wait until the scheduled check-in time, or ask a Hotel Administrator to enable "Permit Early Check-In" in Admin Control Policy → Check-In Protocols.',
      });
    }
  }

  // Check Blacklist (DNR)
  if (hotel.settings?.guests?.allowBlacklisting && guest) {
    if ((guest.tags || []).includes('DNR')) {
      return buildPolicyBlockResult({
        policyName: 'Blacklist Management (Do Not Rent / DNR)',
        policyCategory: 'CRM & Profiles',
        policySection: 'Admin Control Policy → CRM & Profiles',
        configuredCondition: 'Blacklist Management is enabled and guest profile carries the DNR flag',
        reason: `Guest "${guest.name || reservation.guestName}" is flagged as Do Not Rent (DNR) / Blacklisted.`,
        suggestedAction: 'Escalate to a Hotel Administrator or Manager to review the guest DNR status in Guest Management before proceeding.',
      });
    }
  }

  if (room) {
    if (room.status === 'occupied') {
      return buildPolicyBlockResult({
        policyName: 'Occupied Room Check-In Lock',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: 'Room status must not be Occupied',
        reason: `Room ${room.roomNumber} is currently marked as Occupied.`,
        suggestedAction: 'Complete checkout for the current occupant or assign an available clean room.',
      });
    }

    const isDirty = (room.status === 'cleaning' || room.housekeepingStatus === 'cleaning' || room.housekeepingStatus === 'failed')
      ? true
      : (room.status === 'clean' || room.housekeepingStatus === 'ready' || (room.housekeepingStatus as string) === 'clean')
        ? false
        : (room.status === 'dirty' || room.housekeepingStatus === 'dirty');

    const preventDirty = settings ? settings.preventCheckInDirty !== false : true;
    if (preventDirty && isDirty) {
      return buildPolicyBlockResult({
        policyName: 'Strict Hygiene Check (Prevent Check-In to Dirty Rooms)',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: 'Prevent Check-In to Dirty/Cleaning Rooms is enabled',
        reason: `Room ${room.roomNumber} is currently dirty, undergoing housekeeping, or failed inspection.`,
        suggestedAction: 'Have Housekeeping service and mark the room Clean/Ready, assign another clean room, or ask a Hotel Administrator to review Check-In Protocols.',
      });
    }

    const preventMaintenance = settings ? settings.preventCheckInMaintenance !== false : true;
    if (preventMaintenance && (room.status === 'maintenance' || room.status === 'out_of_service' || room.status === 'out_of_order')) {
      return buildPolicyBlockResult({
        policyName: 'Block Maintenance Check-In',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: 'Prevent Check-In to Maintenance / Out-of-Order Rooms is enabled',
        reason: `Room ${room.roomNumber} is currently marked as ${room.status.replace(/_/g, ' ')}.`,
        suggestedAction: 'Assign a different available room or wait for Maintenance to resolve the issue and return the room to Clean status.',
      });
    }

    if (settings?.requireRoomInspection && room.status !== 'clean' && room.status !== 'vacant' && room.status !== 'inspected' && room.housekeepingStatus !== 'ready' && (room.housekeepingStatus as string) !== 'clean') {
      if (!settings.allowManualRoomOverride || !hasPermission(profile, 'manage_rooms', customRoles)) {
        return buildPolicyBlockResult({
          policyName: 'Room Clean Lock (Require Room Inspection)',
          policyCategory: 'Check-In Protocols',
          policySection: 'Admin Control Policy → Check-In Protocols',
          configuredCondition: 'Rooms must pass Housekeeping inspection (Clean / Ready / Inspected) before check-in',
          reason: `Room ${room.roomNumber} has status "${room.status}" and has not been marked Clean & Inspected.`,
          suggestedAction: 'Ask Housekeeping to inspect and clear Room ' + room.roomNumber + ', or request a Manager with room management authority to review.',
        });
      }
    }
  }

  const totalAmount = reservation.totalAmount || 0;
  const paidAmount = (reservation.paidAmount || 0) + (reservation.totalDiscount || 0);
  if (settings?.requirePaymentBeforeCheckIn) {
    if (settings.allowCheckInPendingBalance === false) {
      if (paidAmount + 0.01 < totalAmount) {
        return buildPolicyBlockResult({
          policyName: 'Pre-payment Requirement + Disallow Pending Balance Check-In',
          policyCategory: 'Check-In Protocols',
          policySection: 'Admin Control Policy → Check-In Protocols',
          configuredCondition: 'Full payment is required prior to check-in (Allow Pending Balance Check-In is disabled)',
          reason: `Booking requires ${formatPolicyCurrency(totalAmount, hotel)} in full; paid/credited so far is ${formatPolicyCurrency(paidAmount, hotel)}.`,
          suggestedAction: 'Collect the remaining balance in Guest Folio before checking the guest in, or ask a Hotel Administrator to adjust Check-In Protocols.',
        });
      }
    } else if (totalAmount > 0.01 && paidAmount <= 0.01) {
      return buildPolicyBlockResult({
        policyName: 'Pre-payment Requirement',
        policyCategory: 'Check-In Protocols',
        policySection: 'Admin Control Policy → Check-In Protocols',
        configuredCondition: 'A minimum deposit or upfront payment is required before check-in',
        reason: `No upfront payment or deposit has been posted yet against the ${formatPolicyCurrency(totalAmount, hotel)} booking total.`,
        suggestedAction: 'Record a deposit or upfront payment on the reservation before completing check-in, or ask a Hotel Administrator to review Pre-payment Requirement.',
      });
    }
  } else if (settings?.allowCheckInPendingBalance === false && totalAmount > 0.01 && paidAmount <= 0.01) {
    return buildPolicyBlockResult({
      policyName: 'Allow Pending Balance Check-In',
      policyCategory: 'Check-In Protocols',
      policySection: 'Admin Control Policy → Check-In Protocols',
      configuredCondition: 'Allow Pending Balance Check-In is disabled (zero upfront payment not permitted)',
      reason: `Booking has zero upfront payment recorded against ${formatPolicyCurrency(totalAmount, hotel)}.`,
      suggestedAction: 'Collect an upfront payment first, or ask a Hotel Administrator to enable "Allow Pending Balance Check-In" in Admin Control Policy → Check-In Protocols.',
    });
  }

  const guestSettings = hotel.settings?.guests;
  if (guestSettings?.requireIdVerification) {
    if (!reservation.idNumber || !reservation.idType) {
      return buildPolicyBlockResult({
        policyName: 'ID Attachment Lock (Require ID Verification)',
        policyCategory: 'CRM & Profiles',
        policySection: 'Admin Control Policy → CRM & Profiles',
        configuredCondition: 'Guest ID Type and ID Number are required before check-in',
        reason: 'The reservation is missing valid guest ID Type or ID Number details.',
        suggestedAction: 'Update the reservation with the guest ID type and number, then retry check-in.',
      });
    }
  }

  if (guestSettings?.requirePhoneVerification) {
    if (!reservation.guestPhone) {
      return buildPolicyBlockResult({
        policyName: 'Valid Phone Requirement (Require Phone Verification)',
        policyCategory: 'CRM & Profiles',
        policySection: 'Admin Control Policy → CRM & Profiles',
        configuredCondition: 'A valid guest phone number is required before check-in',
        reason: 'The reservation does not have a guest phone number recorded.',
        suggestedAction: 'Add the guest phone number to the reservation or guest profile, then retry check-in.',
      });
    }
  }

  return { allowed: true };
};

export const canEditReservation = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'edit_reservations', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Edit Reservations Permission (edit_reservations)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: edit_reservations',
      reason: 'Your assigned staff role does not include permission to edit reservations.',
      suggestedAction: 'Request an authorized Front Desk Manager or Hotel Administrator to edit this reservation or update your role permissions.',
      isPermissionBlock: true,
    });
  }

  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowEditing) {
    return buildPolicyBlockResult({
      policyName: 'Allow Reservation Editing',
      policyCategory: 'Reservation Policies',
      policySection: 'Admin Control Policy → Reservation Policies',
      configuredCondition: 'Reservation editing is disabled for this property',
      reason: 'Modifications to existing reservations are currently disabled by hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to enable "Allow Reservation Editing" in Admin Control Policy → Reservation Policies if edits are needed.',
    });
  }

  const isApprover =
    profile.role === 'hotelAdmin' ||
    profile.role === 'superAdmin' ||
    profile.staffRole === 'manager' ||
    hasPermission(profile, 'override_checkout', customRoles);
  if (settings.requireApprovalForEdits && !isApprover) {
    return buildPolicyBlockResult({
      policyName: 'Edits Require Approval',
      policyCategory: 'Reservation Policies',
      policySection: 'Admin Control Policy → Reservation Policies',
      configuredCondition: 'Manager or Hotel Administrator approval is required to modify reservations',
      reason: 'Your role cannot edit reservations directly while "Edits Require Approval" is active.',
      suggestedAction: 'Ask a Manager or Hotel Administrator to approve/apply this reservation edit, or review "Edits Require Approval" in Admin Control Policy → Reservation Policies.',
    });
  }

  return { allowed: true };
};

export const canCancelReservation = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'cancel_reservations', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Cancel Reservations Permission (cancel_reservations)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: cancel_reservations',
      reason: 'Your assigned staff role does not include permission to cancel reservations.',
      suggestedAction: 'Ask a Manager or Hotel Administrator with cancellation privileges to cancel this reservation.',
      isPermissionBlock: true,
    });
  }

  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowCancellation) {
    return buildPolicyBlockResult({
      policyName: 'Allow Reservation Cancellation',
      policyCategory: 'Reservation Policies',
      policySection: 'Admin Control Policy → Reservation Policies',
      configuredCondition: 'Reservation cancellations are disabled for this property',
      reason: 'Cancelling reservations is currently blocked by the active hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to review "Allow Cancellation" in Admin Control Policy → Reservation Policies.',
    });
  }

  return { allowed: true };
};

export const canMarkNoShow = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };

  if (!hasPermission(profile, 'cancel_reservations', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'No-Show / Cancellation Permission (cancel_reservations)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: cancel_reservations',
      reason: 'Your assigned staff role does not include permission to mark reservations as No-Show.',
      suggestedAction: 'Ask a Manager or Hotel Administrator to mark this reservation as No-Show or grant the required permission.',
      isPermissionBlock: true,
    });
  }

  const settings = hotel.settings?.reservations;
  if (settings && settings.allowNoShow === false) {
    return buildPolicyBlockResult({
      policyName: 'No-Show Attribution',
      policyCategory: 'Reservation Policies',
      policySection: 'Admin Control Policy → Reservation Policies',
      configuredCondition: 'No-Show Attribution is disabled',
      reason: 'Marking reservations as No-Show is currently disabled in the hotel configuration.',
      suggestedAction: 'Ask a Hotel Administrator to enable "No-Show Attribution" in Admin Control Policy → Reservation Policies.',
    });
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
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Hotel Admin & Super Admin always have full authority
  const isAdmin = profile.role === 'hotelAdmin' || profile.role === 'superAdmin' || profile.staffRole === 'admin';
  if (!isAdmin) {
    // Granular Action Permission Check: Must have explicit 'change_room_status' permission
    const hasStatusChangePerm = hasPermission(profile, 'change_room_status', customRoles);
    if (!hasStatusChangePerm) {
      return buildPolicyBlockResult({
        policyName: 'Change Room Status Permission (change_room_status)',
        policyCategory: 'Role & Access Control',
        policySection: 'Staff Management → Role-Based Access Control',
        configuredCondition: 'Required permission: change_room_status',
        reason: `Your role does not have permission to change Room ${room.roomNumber} status to "${newStatus}".`,
        suggestedAction: 'Contact your Hotel Administrator to grant the "change_room_status" permission or have Housekeeping/Management update the room status.',
        isPermissionBlock: true,
      });
    }
  }

  const settings = hotel.settings?.housekeeping;
  if (!settings) return { allowed: true };

  if (!settings.allowStatusUpdates && !hasPermission(profile, 'manage_rooms', customRoles) && !isAdmin) {
    return buildPolicyBlockResult({
      policyName: 'Mobile Status Updates (Allow Room Status Updates)',
      policyCategory: 'Housekeeping Policies',
      policySection: 'Admin Control Policy → Housekeeping',
      configuredCondition: 'Staff room status updates are disabled for non-managers',
      reason: `Unable to update Room ${room.roomNumber} status because room status updates are currently disabled by policy.`,
      suggestedAction: 'Ask a Manager with room management privileges to update the room, or have a Hotel Administrator enable "Mobile Status Updates" in Admin Control Policy → Housekeeping.',
    });
  }

  if (settings.preventOccupiedOverride && room.status === 'occupied' && !hasPermission(profile, 'manage_rooms', customRoles) && !isAdmin) {
    return buildPolicyBlockResult({
      policyName: 'Occupied Room Shield (Prevent Occupied Override)',
      policyCategory: 'Housekeeping Policies',
      policySection: 'Admin Control Policy → Housekeeping',
      configuredCondition: 'Prevent status overrides on rooms currently marked Occupied',
      reason: `Room ${room.roomNumber} is currently Occupied and protected from status overrides.`,
      suggestedAction: 'Wait until the guest checks out, or ask a Hotel Administrator / Manager with room management rights to review.',
    });
  }

  if (!settings.allowDirtyToCleanChanges && room.status === 'dirty' && newStatus === 'clean') {
    return buildPolicyBlockResult({
      policyName: 'Enable Dirty-to-Clean Flow',
      policyCategory: 'Housekeeping Policies',
      policySection: 'Admin Control Policy → Housekeeping',
      configuredCondition: 'Direct Dirty → Clean transitions are disabled; Cleaning intermediate stage is required',
      reason: `Room ${room.roomNumber} cannot be changed directly from "Dirty" to "Clean".`,
      suggestedAction: 'Set Room ' + room.roomNumber + ' to "Cleaning" first before marking it "Clean", or ask a Hotel Administrator to enable "Enable Dirty-to-Clean Flow" in Admin Control Policy → Housekeeping.',
    });
  }

  return { allowed: true };
};

export const canProcessRefund = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  amount: number,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Granular Action Permission Check (Rule 2)
  if (!hasPermission(profile, 'process_refunds', customRoles) && !hasPermission(profile, 'approve_refund', customRoles) && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return buildPolicyBlockResult({
      policyName: 'Refund Processing Permission (process_refunds / approve_refund)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: process_refunds or approve_refund',
      reason: 'Your assigned staff role does not include permission to process guest refunds.',
      suggestedAction: 'Request an authorized Finance Manager or Hotel Administrator to process this refund.',
      isPermissionBlock: true,
    });
  }

  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowRefunds) {
    return buildPolicyBlockResult({
      policyName: 'Enable Refund Processing',
      policyCategory: 'Accounting Policies',
      policySection: 'Admin Control Policy → Accounting Policies',
      configuredCondition: 'Refund processing is currently disabled for this hotel',
      reason: `Refund of ${formatPolicyCurrency(amount, hotel)} cannot be processed while refunds are disabled.`,
      suggestedAction: 'Ask a Hotel Administrator to enable "Enable Refund Processing" in Admin Control Policy → Accounting Policies.',
    });
  }

  if (settings.requireApprovalForRefunds && !hasPermission(profile, 'void_transaction', customRoles) && !hasPermission(profile, 'approve_refund', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Refunds Require Approval',
      policyCategory: 'Accounting Policies',
      policySection: 'Admin Control Policy → Accounting Policies',
      configuredCondition: 'Manager/Admin approval (approve_refund or void_transaction) is required for all refunds',
      reason: `Your account requires manager approval to issue a refund of ${formatPolicyCurrency(amount, hotel)}.`,
      suggestedAction: 'Escalate to a Manager or Hotel Administrator with refund approval authority, or review "Refunds Require Approval" in Admin Control Policy → Accounting Policies.',
    });
  }

  return { allowed: true };
};

export const canApplyDiscount = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  amount: number,
  totalAmount: number,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowDiscounts) {
    return buildPolicyBlockResult({
      policyName: 'Enable Discount Engine',
      policyCategory: 'Accounting Policies',
      policySection: 'Admin Control Policy → Accounting Policies',
      configuredCondition: 'Manual discounts are currently disabled for this property',
      reason: `Cannot apply a discount of ${formatPolicyCurrency(amount, hotel)} while the Discount Engine is disabled.`,
      suggestedAction: 'Ask a Hotel Administrator to enable "Enable Discount Engine" in Admin Control Policy → Accounting Policies.',
    });
  }

  const percentage = totalAmount > 0 ? (amount / totalAmount) * 100 : 0;
  if (settings.requireApprovalForLargeDiscounts && percentage > (settings.largeDiscountThreshold || 10)) {
    if (!hasPermission(profile, 'void_transaction', customRoles)) {
      const limitPct = settings.largeDiscountThreshold || 10;
      return buildPolicyBlockResult({
        policyName: 'Large Discount Approval Policy (Cap Discount Visibility)',
        policyCategory: 'Accounting Policies',
        policySection: 'Admin Control Policy → Accounting Policies',
        configuredCondition: `Discounts above ${limitPct}% require Manager/Admin approval`,
        reason: `Requested discount of ${percentage.toFixed(1)}% (${formatPolicyCurrency(amount, hotel)}) exceeds the configured ${limitPct}% self-approval limit.`,
        suggestedAction: `Reduce the discount to ${limitPct}% or less, or ask a Manager / Hotel Administrator to approve this discount or adjust "Large Discount Limit (%)" in Admin Control Policy → Accounting Policies.`,
      });
    }
  }

  return { allowed: true };
};

export const canManageGuest = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  action: 'create' | 'edit' | 'delete' | 'blacklist' | 'export',
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  // Strict Granular Permission Check (Rule 2)
  if (action === 'create' && !hasPermission(profile, 'add_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Add Guests Permission (add_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: add_guests',
      reason: 'Your assigned staff role does not include permission to create guest profiles.',
      suggestedAction: 'Contact your Hotel Administrator to grant the "add_guests" permission.',
      isPermissionBlock: true,
    });
  }
  if (action === 'edit' && !hasPermission(profile, 'edit_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Edit Guests Permission (edit_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: edit_guests',
      reason: 'Your assigned staff role does not include permission to edit guest profiles.',
      suggestedAction: 'Contact your Hotel Administrator to grant the "edit_guests" permission.',
      isPermissionBlock: true,
    });
  }
  if (action === 'delete' && !hasPermission(profile, 'delete_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Delete Guests Permission (delete_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: delete_guests',
      reason: 'Your assigned staff role does not include permission to delete guest profiles.',
      suggestedAction: 'Contact your Hotel Administrator if a guest record must be removed.',
      isPermissionBlock: true,
    });
  }
  if (action === 'export' && !hasPermission(profile, 'export_guests', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Export Guests Permission (export_guests)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: export_guests',
      reason: 'Your assigned staff role does not include permission to export guest records.',
      suggestedAction: 'Ask a Hotel Administrator to export the guest list or grant the "export_guests" permission.',
      isPermissionBlock: true,
    });
  }

  const settings = hotel.settings?.guests;
  if (!settings) return { allowed: true };

  if (action === 'edit' && !settings.allowProfileEditing && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return buildPolicyBlockResult({
      policyName: 'Enable Profile Updates',
      policyCategory: 'CRM & Profiles',
      policySection: 'Admin Control Policy → CRM & Profiles',
      configuredCondition: 'Guest profile editing by non-admin staff is disabled',
      reason: 'Editing guest profile details is currently restricted to Hotel Administrators.',
      suggestedAction: 'Ask a Hotel Administrator to update this guest profile or enable "Enable Profile Updates" in Admin Control Policy → CRM & Profiles.',
    });
  }

  if (action === 'delete' && !settings.allowDeletion && profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') {
    return buildPolicyBlockResult({
      policyName: 'Enable Guest Deletion',
      policyCategory: 'CRM & Profiles',
      policySection: 'Admin Control Policy → CRM & Profiles',
      configuredCondition: 'Guest record deletion by non-admin staff is disabled',
      reason: 'Deleting guest records is restricted under the current hotel CRM policy.',
      suggestedAction: 'Request a Hotel Administrator to delete the record or review "Enable Guest Deletion" in Admin Control Policy → CRM & Profiles.',
    });
  }

  if (action === 'blacklist' && !settings.allowBlacklisting && !hasPermission(profile, 'manage_staff', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Blacklist Management',
      policyCategory: 'CRM & Profiles',
      policySection: 'Admin Control Policy → CRM & Profiles',
      configuredCondition: 'Blacklist Management (DNR flagging) is disabled',
      reason: 'Flagging guests as Do Not Rent (DNR) / Blacklisted is currently disabled by hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to enable "Blacklist Management" in Admin Control Policy → CRM & Profiles.',
    });
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
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowBlocking) {
    return buildPolicyBlockResult({
      policyName: 'Global Room Blocking',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Global Room Blocking is disabled',
      reason: 'Placing rooms out of service / blocked is currently disabled by hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to enable "Global Room Blocking" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  if (settings.requireReasonForBlock && !reason) {
    return buildPolicyBlockResult({
      policyName: 'Mandatory Block Reason',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'A block reason or category is required before taking a room out of inventory',
      reason: 'No block reason or category was provided.',
      suggestedAction: 'Select a valid block reason/category and submit the room block again.',
    });
  }

  if (reason === 'maintenance' && !settings.allowMaintenanceBlocks) {
    return buildPolicyBlockResult({
      policyName: 'Allow Maintenance Categorization',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Maintenance room blocks are disabled',
      reason: 'Creating room blocks with the "Maintenance" category is disabled by hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to enable "Allow Maintenance Categorization" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  if (reason === 'housekeeping' && !settings.allowHousekeepingBlocks) {
    return buildPolicyBlockResult({
      policyName: 'Allow Cleaning Blocks',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Housekeeping cleaning blocks are disabled',
      reason: 'Creating room blocks with the "Housekeeping" category is disabled by hotel policy.',
      suggestedAction: 'Ask a Hotel Administrator to enable "Allow Cleaning Blocks" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  if (frequency && frequency !== 'once' && !settings.allowRecurringBlocks) {
    return buildPolicyBlockResult({
      policyName: 'Enable Recurring Blocks',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Recurring room blocks are disabled (only single one-time blocks permitted)',
      reason: `Recurring room block frequency ("${frequency}") is not allowed under the current policy.`,
      suggestedAction: 'Use a single one-time room block, or ask a Hotel Administrator to enable "Enable Recurring Blocks" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  if (hasPartialTimes && !settings.allowPartialDayBlocks) {
    return buildPolicyBlockResult({
      policyName: 'Partial-day Blocking',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Partial-day (hourly) room blocks are disabled',
      reason: 'Blocking rooms for specific hours within a day is disabled by hotel policy.',
      suggestedAction: 'Create a full-day room block instead, or ask a Hotel Administrator to enable "Partial-day Blocking" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  const duration = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  const maxDur = settings.maxBlockDuration || 30;
  if (duration > maxDur) {
    return buildPolicyBlockResult({
      policyName: 'Maximum Block Duration (Days)',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: `Maximum allowed room block duration is ${maxDur} consecutive day(s)`,
      reason: `Requested block spans ${duration} days (${startDate} to ${endDate}), exceeding the ${maxDur}-day limit.`,
      suggestedAction: `Shorten the block duration to ${maxDur} days or fewer, or ask a Hotel Administrator to increase "Maximum Block Duration (Days)" in Admin Control Policy → Room Blocking Settings.`,
    });
  }

  return { allowed: true };
};

export const canUnblockRoom = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowUnblocking && !hasPermission(profile, 'remove_room_blocks', customRoles) && !hasPermission(profile, 'unblock_rooms', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Enable Unblocking',
      policyCategory: 'Room Blocking Settings',
      policySection: 'Admin Control Policy → Room Blocking Settings',
      configuredCondition: 'Unblocking rooms is restricted to administrators or staff with unblock_rooms / remove_room_blocks permission',
      reason: 'Your account is not permitted to lift room blocks while "Enable Unblocking" is disabled.',
      suggestedAction: 'Ask a Hotel Administrator to unblock the room or enable "Enable Unblocking" in Admin Control Policy → Room Blocking Settings.',
    });
  }

  return { allowed: true };
};

export const canVoidTransaction = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  entry: LedgerEntry,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!hasPermission(profile, 'void_transaction', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Void Transaction Permission (void_transaction)',
      policyCategory: 'Role & Access Control',
      policySection: 'Staff Management → Role-Based Access Control',
      configuredCondition: 'Required permission: void_transaction',
      reason: 'Your assigned staff role does not have permission to void financial ledger transactions.',
      suggestedAction: 'Request a Manager or Hotel Administrator with void authority to void or reverse this transaction.',
      isPermissionBlock: true,
    });
  }

  return { allowed: true };
};

export const canEditInvoice = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const financialSettings = hotel.settings?.financial;
  const checkoutSettings = hotel.settings?.checkout;

  // Policy: Lock Invoices After Checkout
  // Check both financial and checkout settings (defaults to true if not explicitly disabled)
  const isInvoiceLocked = financialSettings?.lockInvoicesAfterCheckout ?? checkoutSettings?.lockInvoicesAfterCheckout ?? true;

  if (reservation.status === 'checked_out' && isInvoiceLocked && !hasPermission(profile, 'void_transaction', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Lock Invoices After Checkout',
      policyCategory: 'Accounting & Checkout Policies',
      policySection: 'Admin Control Policy → Accounting Policies / Checkout Policies',
      configuredCondition: 'Invoices are automatically locked after guest checkout (Manager override required)',
      reason: 'This reservation has already checked out and its folio/invoice is locked against post-checkout edits.',
      suggestedAction: 'Request a Manager or Hotel Administrator with override authority (void_transaction), or review "Lock Invoices After Checkout" in Admin Control Policy.',
    });
  }

  const allowInvoiceEditingAfterPayment = financialSettings?.allowInvoiceEditingAfterPayment ?? false;
  if (reservation.ledgerBalance === 0 && !allowInvoiceEditingAfterPayment && !hasPermission(profile, 'void_transaction', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Allow Invoice Editing After Payment',
      policyCategory: 'Accounting Policies',
      policySection: 'Admin Control Policy → Accounting Policies',
      configuredCondition: 'Editing fully paid / settled invoices is disabled (Manager override required)',
      reason: 'This invoice has a zero balance (fully settled) and cannot be edited without manager override.',
      suggestedAction: 'Request a Manager or Hotel Administrator to perform the adjustment, or review "Allow Invoice Editing After Payment" in Admin Control Policy → Accounting Policies.',
    });
  }

  return { allowed: true };
};

export const canReleaseNoShow = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  customRoles: any[] = []
): PolicyCheckResult => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.autoReleaseNoShow && !hasPermission(profile, 'manage_rooms', customRoles)) {
    return buildPolicyBlockResult({
      policyName: 'Auto-release No-shows',
      policyCategory: 'Reservation Policies',
      policySection: 'Admin Control Policy → Reservation Policies',
      configuredCondition: 'Auto-release No-shows is disabled; releasing no-show inventory requires manage_rooms permission',
      reason: 'Your account does not have room management authority to manually release No-Show rooms.',
      suggestedAction: 'Ask a Manager or Hotel Administrator to release the room, or enable "Auto-release No-shows" in Admin Control Policy → Reservation Policies.',
    });
  }

  return { allowed: true };
};
