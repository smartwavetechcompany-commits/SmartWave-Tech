import { Hotel, UserProfile, Reservation, Room, LedgerEntry, Guest } from '../types';
import { hasPermission } from './permissions';
import { differenceInDays } from 'date-fns';

export const canCheckout = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.checkout;
  if (!settings) return { allowed: true }; // Default behavior

  const balance = reservation.ledgerBalance || 0;
  const isOwing = balance > 0.01;

  if (isOwing) {
    if (settings.allowPostpaidCheckout && (reservation.corporateId || (reservation as any).isPostpaid)) {
      return { allowed: true };
    }

    if (settings.allowBalanceOutstanding) {
      return { allowed: true };
    }

    if (!settings.allowPartialPaymentCheckout && reservation.paidAmount > 0 && reservation.paidAmount < (reservation.totalAmount || 0)) {
      if (!hasPermission(profile, 'void_transaction')) {
        return { allowed: false, message: 'Partial payment checkout is disabled by hotel configuration.' };
      }
    }

    if (settings.requireFullPaymentBeforeCheckout) {
      return { allowed: false, message: 'Full payment is required before checkout as per hotel policy.' };
    }
    
    if (settings.preventOwingGuestCheckout) {
      if (!hasPermission(profile, 'void_transaction')) {
        return { allowed: false, message: 'Policy prevents checkout for guests with outstanding balances without admin approval.' };
      }
    }

    if (settings.requireApprovalForDebtCheckout) {
      if (!hasPermission(profile, 'void_transaction')) {
        return { allowed: false, message: 'Manager approval is required to checkout a guest with debt.' };
      }
    }

    // If Allow Checkout with Outstanding Balance is disabled, and no override matched, block checkout.
    return { allowed: false, message: 'Policy restricts checkout with outstanding balances. Please settle guest ledger first.' };
  }

  return { allowed: true };
};

export const canCheckIn = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation,
  room: Room | undefined,
  guest?: Guest | null
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.checkIn;
  if (!settings) return { allowed: true };

  // Check Blacklist (DNR)
  if (hotel.settings?.guests?.allowBlacklisting && guest) {
    if ((guest.tags || []).includes('DNR')) {
      return { allowed: false, message: 'Check-in denied: Guest is on Do Not Rent (DNR) / Blacklist.' };
    }
  }

  if (room) {
    if (room.status === 'occupied') {
      return { allowed: false, message: 'Cannot check-in. This room is currently occupied by another guest.' };
    }

    if (settings.preventCheckInDirty && (room.status === 'dirty' || room.status === 'cleaning')) {
      return { allowed: false, message: 'Cannot check-in to a dirty / readying room. Housekeeping must clear it first.' };
    }

    if (settings.preventCheckInMaintenance && (room.status === 'maintenance' || room.status === 'out_of_service' || room.status === 'out_of_order')) {
      return { allowed: false, message: 'Cannot check-in. This room is currently down for maintenance or out of order.' };
    }

    if (settings.requireRoomInspection && room.status !== 'inspected') {
      if (!settings.allowManualRoomOverride || !hasPermission(profile, 'manage_rooms')) {
        return { allowed: false, message: 'Room must be inspected before check-in.' };
      }
    }
  }

  if (settings.requirePaymentBeforeCheckIn) {
    const totalAmount = reservation.totalAmount || 0;
    const paidAmount = (reservation.paidAmount || 0) + (reservation.totalDiscount || 0);
    if (paidAmount < totalAmount) {
      if (!settings.allowCheckInPendingBalance) {
        return { allowed: false, message: 'Full payment is required before check-in as per hotel policy.' };
      }
    }
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
  reservation: Reservation
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowEditing && !hasPermission(profile, 'edit_reservation')) {
    return { allowed: false, message: 'Reservation editing is currently disabled by administrator.' };
  }

  if (settings.requireApprovalForEdits && !hasPermission(profile, 'edit_reservation')) {
    return { allowed: false, message: 'Manager approval required to edit reservations.' };
  }

  return { allowed: true };
};

export const canCancelReservation = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.allowCancellation && !hasPermission(profile, 'delete_reservation')) {
    return { allowed: false, message: 'Cancellations are currently disabled by administrator.' };
  }

  return { allowed: true };
};

export const canUpdateRoomStatus = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  room: Room,
  newStatus: Room['status']
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.housekeeping;
  if (!settings) return { allowed: true };

  if (!settings.allowStatusUpdates && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Room status updates are currently disabled by administrator.' };
  }

  if (settings.preventOccupiedOverride && room.status === 'occupied' && !hasPermission(profile, 'manage_rooms')) {
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
  amount: number
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowRefunds && !hasPermission(profile, 'void_transaction')) {
    return { allowed: false, message: 'Refund processing is currently disabled by administrator.' };
  }

  if (settings.requireApprovalForRefunds && !hasPermission(profile, 'void_transaction')) {
    return { allowed: false, message: 'Manager approval is required to process refunds.' };
  }

  return { allowed: true };
};

export const canApplyDiscount = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  amount: number,
  totalAmount: number
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!settings.allowDiscounts && !hasPermission(profile, 'edit_reservation')) {
    return { allowed: false, message: 'Discounts are currently disabled by administrator.' };
  }

  const percentage = (amount / totalAmount) * 100;
  if (settings.requireApprovalForLargeDiscounts && percentage > (settings.largeDiscountThreshold || 10)) {
    if (!hasPermission(profile, 'void_transaction')) {
      return { allowed: false, message: `Discounts above ${settings.largeDiscountThreshold}% require manager approval.` };
    }
  }

  return { allowed: true };
};

export const canManageGuest = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  action: 'edit' | 'delete' | 'blacklist'
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.guests;
  if (!settings) return { allowed: true };

  if (action === 'edit' && !settings.allowProfileEditing && !hasPermission(profile, 'edit_guest_profiles')) {
    return { allowed: false, message: 'Guest profile editing is currently disabled by administrator.' };
  }

  if (action === 'delete' && !settings.allowDeletion && !hasPermission(profile, 'edit_guest_profiles')) {
    return { allowed: false, message: 'Guest record deletion is currently restricted.' };
  }

  if (action === 'blacklist' && !settings.allowBlacklisting && !hasPermission(profile, 'manage_staff')) {
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
  hasPartialTimes?: boolean
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowBlocking && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Room blocking is currently disabled by administrator.' };
  }

  if (settings.requireReasonForBlock && !reason) {
    return { allowed: false, message: 'A reason or category is required for room blocking.' };
  }

  if (reason === 'maintenance' && !settings.allowMaintenanceBlocks && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Maintenance blocks are currently disabled.' };
  }

  if (reason === 'housekeeping' && !settings.allowHousekeepingBlocks && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Housekeeping cleaning blocks are currently disabled.' };
  }

  if (frequency && frequency !== 'once' && !settings.allowRecurringBlocks && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Recurring room blocks are disabled by configuration.' };
  }

  if (hasPartialTimes && !settings.allowPartialDayBlocks && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Partial-day room blocking is disabled by configuration.' };
  }

  const duration = differenceInDays(new Date(endDate), new Date(startDate)) + 1;
  const maxDur = settings.maxBlockDuration || 30;
  if (duration > maxDur && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: `Policy limits room blocks to a maximum of ${maxDur} days.` };
  }

  return { allowed: true };
};

export const canUnblockRoom = (
  hotel: Hotel | null,
  profile: UserProfile | null
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.roomBlocking;
  if (!settings) return { allowed: true };

  if (!settings.allowUnblocking && !hasPermission(profile, 'remove_room_blocks')) {
    return { allowed: false, message: 'Unblocking rooms is currently restricted to administrators.' };
  }

  return { allowed: true };
};

export const canVoidTransaction = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  entry: LedgerEntry
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (!hasPermission(profile, 'void_transaction')) {
    return { allowed: false, message: 'You do not have permission to void transactions.' };
  }

  const invoiceLocking = settings.lockInvoicesAfterCheckout;
  // If we had a checkout status on reservation, we'd check it here.
  // For now, let's assume we check if the entry is old or if there are other flags.

  return { allowed: true };
};

export const canEditInvoice = (
  hotel: Hotel | null,
  profile: UserProfile | null,
  reservation: Reservation
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.financial;
  if (!settings) return { allowed: true };

  if (reservation.status === 'checked_out' && settings.lockInvoicesAfterCheckout && !hasPermission(profile, 'void_transaction')) {
    return { allowed: false, message: 'Invoices are locked for checked-out reservations. Manager override required.' };
  }

  if (reservation.ledgerBalance === 0 && !settings.allowInvoiceEditingAfterPayment && !hasPermission(profile, 'void_transaction')) {
     return { allowed: false, message: 'Editing is disabled for fully paid invoices. Manager override required.' };
  }

  return { allowed: true };
};

export const canReleaseNoShow = (
  hotel: Hotel | null,
  profile: UserProfile | null
): { allowed: boolean; message?: string } => {
  if (!hotel || !profile) return { allowed: false, message: 'System error: Missing context' };
  
  const settings = hotel.settings?.reservations;
  if (!settings) return { allowed: true };

  if (!settings.autoReleaseNoShow && !hasPermission(profile, 'manage_rooms')) {
    return { allowed: false, message: 'Manual release of no-shows is restricted.' };
  }

  return { allowed: true };
};
