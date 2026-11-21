import { auth } from '../firebase';

export type ReservationNotifyEvent =
  | 'confirmation'
  | 'checked_in'
  | 'checked_out'
  | 'cancelled'
  | 'no_show'
  | 'booking_modified'
  | 'payment_receipt';

// Backward-compatible alias for earlier callers
export type ReservationEmailEventType =
  | ReservationNotifyEvent
  | 'booking_confirmation'
  | 'booking_cancellation';

export type PlatformNotificationEventType =
  | 'payment.received'
  | 'invoice.issued'
  | 'receipt.sent'
  | 'refund.processed'
  | 'fnb.order_posted'
  | 'fnb.order_voided'
  | 'housekeeping.room_ready'
  | 'housekeeping.inspection_failed'
  | 'housekeeping.guest_request'
  | 'maintenance.issue_reported'
  | 'maintenance.issue_resolved'
  | 'guest.profile_created'
  | 'guest.blacklisted'
  | 'staff.account_status_changed'
  | 'hotel.registered'
  | 'corporate.account_created'
  | 'corporate.city_ledger_transfer'
  | 'corporate.payment_settled'
  | 'corporate.low_balance_alert'
  | 'subscription.renewed'
  | 'subscription.expiring_or_expired'
  | 'tracking_code.request_status_updated'
  | 'loyalty.account_activated'
  | 'loyalty.points_awarded'
  | 'loyalty.points_deducted'
  | 'loyalty.points_redeemed'
  | 'loyalty.tier_upgraded'
  | 'loyalty.points_expiring'
  | 'system.daily_revenue_deficit'
  | 'system.operational_alert';

function normalizeReservationEvent(eventType: ReservationEmailEventType): ReservationNotifyEvent {
  if (eventType === 'booking_confirmation') return 'confirmation';
  if (eventType === 'booking_cancellation') return 'cancelled';
  return eventType;
}

/**
 * Triggers the dedicated server-side reservation notification endpoint
 * (`POST /api/reservations/:id/notify`) using ONLY the reservation ID, hotelId,
 * and event name. The browser never supplies `to`, `subject`, or `html`.
 * Always fire-and-forget wrapped in try/catch so email failures never disrupt PMS operations.
 */
export async function notifyReservationEmailEvent(
  hotelId: string,
  reservationId: string,
  eventType: ReservationEmailEventType,
  options?: { idempotencySuffix?: string; paymentAmount?: number }
): Promise<void> {
  if (!hotelId || !reservationId) return;

  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    if (!idToken) return;

    const normalizedEvent = normalizeReservationEvent(eventType);

    const resp = await fetch(`/api/reservations/${encodeURIComponent(reservationId)}/notify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        hotelId,
        event: normalizedEvent,
        ...(options?.idempotencySuffix ? { idempotencySuffix: options.idempotencySuffix } : {}),
        ...(typeof options?.paymentAmount === 'number' ? { paymentAmount: options.paymentAmount } : {}),
      }),
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error) detail = String(data.error);
      } catch {
        // Ignore parse errors on non-JSON failure responses
      }
      console.warn(
        `[TransactionalEmail] reservation.${normalizedEvent} notice (${reservationId}): ${detail}`
      );
    }
  } catch (err: any) {
    console.warn(
      `[TransactionalEmail] reservation.${eventType} dispatch skipped:`,
      err?.message || 'Network error'
    );
  }
}

export interface NotifyPlatformEventParams {
  hotelId: string;
  eventType: PlatformNotificationEventType;
  entityId?: string;
  reservationId?: string;
  guestId?: string;
  corporateId?: string;
  staffUid?: string;
  idempotencyKey?: string;
  metadata?: Record<string, string | number | boolean | undefined>;
}

/**
 * Triggers a server-side multi-tenant module notification (`POST /api/notifications/events`).
 * Sends only tenant/entity identifiers and lightweight non-HTML metadata; the server verifies
 * authentication & hotel isolation, loads authoritative Firestore records, dynamically renders
 * the tenant hotel's branded email, and dispatches via Resend.
 */
export async function notifyPlatformEvent(params: NotifyPlatformEventParams): Promise<void> {
  if (!params?.hotelId || !params?.eventType) return;

  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    if (!idToken) return;

    const resp = await fetch('/api/notifications/events', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({
        hotelId: params.hotelId,
        eventType: params.eventType,
        entityId: params.entityId,
        reservationId: params.reservationId,
        guestId: params.guestId,
        corporateId: params.corporateId,
        staffUid: params.staffUid,
        idempotencyKey: params.idempotencyKey,
        metadata: params.metadata,
      }),
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error) detail = String(data.error);
      } catch {
        // Ignore parse errors
      }
      console.warn(`[TransactionalEmail] ${params.eventType} notice: ${detail}`);
    }
  } catch (err: any) {
    console.warn(
      `[TransactionalEmail] ${params.eventType} dispatch skipped:`,
      err?.message || 'Network error'
    );
  }
}

/**
 * Triggers a server-side admin alert for a newly created trackingCodeRequests document.
 * Sends only the Firestore requestId; the server reads the request and configured
 * platform/hotel recipients from Firestore and dispatches via Resend.
 */
export async function notifyTrackingCodeRequestAlert(requestId: string): Promise<void> {
  if (!requestId) return;

  try {
    const resp = await fetch('/api/emails/tracking-code-request-alert', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ requestId }),
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error) detail = String(data.error);
      } catch {
        // Ignore parse errors
      }
      console.warn(`[TransactionalEmail] Tracking code alert notice (${requestId}): ${detail}`);
    }
  } catch (err: any) {
    console.warn(
      '[TransactionalEmail] Tracking code alert skipped:',
      err?.message || 'Network error'
    );
  }
}
