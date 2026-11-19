import { auth } from '../firebase';

export type ReservationEmailEventType = 'booking_confirmation' | 'booking_cancellation';

/**
 * Triggers a server-side transactional reservation email using only the
 * reservation identifier and event type. The server loads reservation & hotel
 * data, authorizes the caller, builds the email, and dispatches via Resend.
 * Errors are caught and logged without secrets so bookings/cancellations never fail.
 */
export async function notifyReservationEmailEvent(
  hotelId: string,
  reservationId: string,
  eventType: ReservationEmailEventType
): Promise<void> {
  if (!hotelId || !reservationId) return;

  try {
    const currentUser = auth.currentUser;
    if (!currentUser) return;
    const idToken = await currentUser.getIdToken();
    if (!idToken) return;

    const resp = await fetch('/api/emails/reservation-event', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
      body: JSON.stringify({ hotelId, reservationId, eventType }),
    });

    if (!resp.ok) {
      let detail = `HTTP ${resp.status}`;
      try {
        const data = await resp.json();
        if (data?.error) detail = String(data.error);
      } catch {
        // Ignore JSON parse errors on non-JSON failure responses
      }
      console.warn(`[TransactionalEmail] ${eventType} notification notice (${reservationId}): ${detail}`);
    }
  } catch (err: any) {
    console.warn(`[TransactionalEmail] ${eventType} dispatch skipped:`, err?.message || 'Network error');
  }
}

/**
 * Triggers a server-side admin alert for a newly created trackingCodeRequests
 * document. Sends only the Firestore requestId; the server reads the request
 * and admin recipient from Firestore and dispatches via Resend.
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
    console.warn('[TransactionalEmail] Tracking code alert skipped:', err?.message || 'Network error');
  }
}
