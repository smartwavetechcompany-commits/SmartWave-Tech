import crypto from "crypto";
import {
  getAppUrl,
  sendEmail,
  type SendEmailParams,
  type SendEmailResult,
} from "../../../services/emailService.ts";
import {
  isHotelEmailEventEnabled,
  recordEmailDeliveryLog,
  renderMultiTenantEmail,
  resolveHotelOperationalRecipients,
  resolvePlatformBrandContext,
  resolveTrackingCodeAlertRecipients,
  type MultiTenantEmailEventType,
} from "../../../services/multiTenantEmailService.ts";
import {
  type CustomizableEmailEventType,
  type EmailRenderContext,
  type HotelEmailEventType,
} from "../shared/types.ts";
import { isValidEmail } from "../shared/validation.ts";
import { EMAIL_EVENT_CATALOG } from "./defaultTemplates.ts";
import {
  fsListCollection,
  fsPatchFields,
  fsReadDoc,
  fsReadDocWithMeta,
  fsSetDoc,
} from "./firestoreRest.ts";
import { renderHotelEmailServerSide } from "./renderer.ts";
import { resolveEffectiveTemplate } from "./resolver.ts";
import { isCustomizableEvent, normalizeHotelEmailEvent } from "./templateRegistry.ts";

export interface SendHotelEmailContext {
  reservationId?: string;
  requestId?: string;
  bearerToken?: string;
  /** Optional unique key suffix for repeatable events like booking_modified or payment_receipt */
  idempotencySuffix?: string;
  /** Optional payment amount context for payment_receipt if not stored directly on reservation */
  paymentAmount?: number;
  /** Optional hotel staff user list (for operational no_show recipient routing) */
  staffUsers?: Array<{ email?: string; role?: string; staffRole?: string; roles?: string[]; status?: string }>;
  /** Optional pre-loaded docs (used by server routes or unit tests; client never provides these) */
  preloaded?: {
    hotel?: Record<string, any> | null;
    reservation?: Record<string, any> | null;
    reservationUpdateTime?: string;
    guest?: Record<string, any> | null;
    room?: Record<string, any> | null;
    trackingRequest?: Record<string, any> | null;
    systemSettings?: Record<string, any> | null;
  };
  /** Optional dependency overrides for deterministic unit testing */
  overrides?: {
    sendEmailFn?: (params: SendEmailParams) => Promise<SendEmailResult>;
    resolveTemplateFn?: typeof resolveEffectiveTemplate;
    persistMarkerFn?: (
      hotelId: string,
      reservationId: string,
      markerKey: string,
      record: Record<string, any>,
      expectedUpdateTime?: string
    ) => Promise<boolean>;
    appUrl?: string;
  };
}

export interface SendHotelEmailResult {
  ok: boolean;
  sent: boolean;
  skipped?: boolean;
  deduplicated?: boolean;
  reason?: string;
  messageId?: string;
  logId?: string;
  deliveryState?: string;
  provider?: "resend";
  statusCode?: number;
  eventType?: HotelEmailEventType;
  usedDefaultLayout?: boolean;
  error?: string;
}

const LEGACY_EVENT_MAP: Partial<Record<CustomizableEmailEventType, MultiTenantEmailEventType>> = {
  booking_confirmation: "reservation.confirmed",
  checked_in: "reservation.checked_in",
  checked_out: "reservation.checked_out",
  booking_cancellation: "reservation.cancelled",
  no_show: "reservation.no_show",
  payment_receipt: "payment.received",
};

function computeNights(checkIn?: string, checkOut?: string): number | undefined {
  if (!checkIn || !checkOut) return undefined;
  const start = Date.parse(checkIn);
  const end = Date.parse(checkOut);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return undefined;
  return Math.max(1, Math.round((end - start) / 86_400_000));
}

function buildMarkerKey(eventType: CustomizableEmailEventType, suffix?: string): string {
  const base = EMAIL_EVENT_CATALOG[eventType]?.markerKey || eventType;
  if (suffix && (eventType === "booking_modified" || eventType === "payment_receipt")) {
    const clean = String(suffix)
      .replace(/[^a-zA-Z0-9_-]/g, "")
      .slice(0, 48);
    if (clean) return `${base}_${clean}`;
  }
  return base;
}

function buildRenderContextFromRecords(params: {
  hotelId: string;
  hotel: Record<string, any>;
  reservation: Record<string, any>;
  guest: Record<string, any> | null;
  room: Record<string, any> | null;
  appUrl: string;
  paymentAmount?: number;
}): EmailRenderContext {
  const { hotelId, hotel, reservation, guest, room, appUrl, paymentAmount } = params;
  const branding = (hotel?.branding && typeof hotel.branding === "object"
    ? hotel.branding
    : {}) as Record<string, any>;

  const hotelName =
    (typeof branding.organizationName === "string" && branding.organizationName.trim()) ||
    (typeof hotel?.name === "string" && hotel.name.trim()) ||
    "Hotel Property";

  const roomNumber =
    (typeof room?.roomNumber === "string" && room.roomNumber.trim()) ||
    (typeof reservation?.roomNumber === "string" && reservation.roomNumber.trim()) ||
    "";
  const roomType =
    (typeof room?.type === "string" && room.type.trim()) ||
    (typeof reservation?.roomTypeName === "string" && reservation.roomTypeName.trim()) ||
    (typeof reservation?.roomType === "string" && reservation.roomType.trim()) ||
    "";
  const roomName = roomNumber
    ? `Room ${roomNumber}`
    : roomType || (typeof reservation?.roomId === "string" ? reservation.roomId : "Assigned Room");

  const bookingReference = String(reservation?.id || "").slice(0, 8).toUpperCase();
  const totalAmount =
    typeof reservation?.totalAmount === "number" && Number.isFinite(reservation.totalAmount)
      ? reservation.totalAmount
      : undefined;
  const depositAmount =
    typeof paymentAmount === "number" && Number.isFinite(paymentAmount) && paymentAmount > 0
      ? paymentAmount
      : typeof reservation?.paidAmount === "number" && Number.isFinite(reservation.paidAmount)
        ? reservation.paidAmount
        : undefined;
  const balanceDue =
    totalAmount !== undefined
      ? Math.max(0, totalAmount - (typeof reservation?.paidAmount === "number" ? reservation.paidAmount : 0))
      : undefined;

  // Read REAL loyalty fields ONLY if they exist on guest or reservation; NEVER invent points
  const rawEarned =
    reservation?.loyaltyPointsEarned ?? guest?.loyaltyPointsEarned ?? null;
  const rawBalance =
    guest?.loyaltyPointsBalance ?? reservation?.loyaltyPointsBalance ?? null;
  const rawTier = guest?.loyaltyTier ?? reservation?.loyaltyTier ?? null;

  return {
    hotelId,
    hotelName,
    hotelPhone:
      (typeof branding.phone === "string" && branding.phone.trim()) ||
      (typeof hotel?.phone === "string" && hotel.phone.trim()) ||
      undefined,
    hotelAddress:
      (typeof branding.address === "string" && branding.address.trim()) ||
      (typeof hotel?.address === "string" && hotel.address.trim()) ||
      undefined,
    hotelEmail:
      (typeof branding.email === "string" && branding.email.trim()) ||
      (typeof hotel?.email === "string" && hotel.email.trim()) ||
      undefined,
    hotelWebsite:
      (typeof branding.website === "string" && branding.website.trim()) ||
      (typeof hotel?.website === "string" && hotel.website.trim()) ||
      undefined,
    hotelLogoUrl:
      typeof branding.logoUrl === "string" && branding.logoUrl.trim()
        ? branding.logoUrl.trim()
        : undefined,
    hotelPrimaryColor:
      typeof branding.primaryColor === "string" ? branding.primaryColor.trim() : undefined,
    hotelSecondaryColor:
      typeof branding.secondaryColor === "string" ? branding.secondaryColor.trim() : undefined,
    hotelFooterNotes:
      typeof branding.footerNotes === "string" ? branding.footerNotes.trim() : undefined,
    currencyCode:
      typeof hotel?.defaultCurrency === "string" && hotel.defaultCurrency.trim()
        ? hotel.defaultCurrency.trim()
        : "NGN",
    appUrl: appUrl.replace(/\/+$/, ""),
    guestName:
      (typeof guest?.name === "string" && guest.name.trim()) ||
      (typeof reservation?.guestName === "string" && reservation.guestName.trim()) ||
      "Guest",
    guestEmail:
      (typeof guest?.email === "string" && guest.email.trim()) ||
      (typeof reservation?.guestEmail === "string" && reservation.guestEmail.trim()) ||
      undefined,
    guestLanguage:
      (typeof guest?.language === "string" && guest.language.trim()) ||
      (typeof reservation?.guestLanguage === "string" && reservation.guestLanguage.trim()) ||
      undefined,
    roomName,
    roomType: roomType || undefined,
    checkInDate: typeof reservation?.checkIn === "string" ? reservation.checkIn : undefined,
    checkInTime: typeof reservation?.checkInTime === "string" ? reservation.checkInTime : undefined,
    checkOutDate: typeof reservation?.checkOut === "string" ? reservation.checkOut : undefined,
    checkOutTime: typeof reservation?.checkOutTime === "string" ? reservation.checkOutTime : undefined,
    nights:
      typeof reservation?.nights === "number" && reservation.nights > 0
        ? reservation.nights
        : computeNights(reservation?.checkIn, reservation?.checkOut),
    bookingReference,
    totalAmount,
    depositAmount,
    balanceDue,
    loyaltyPointsEarned:
      rawEarned !== null && rawEarned !== undefined && Number.isFinite(Number(rawEarned))
        ? Number(rawEarned)
        : null,
    loyaltyPointsBalance:
      rawBalance !== null && rawBalance !== undefined && Number.isFinite(Number(rawBalance))
        ? Number(rawBalance)
        : null,
    loyaltyTier: typeof rawTier === "string" && rawTier.trim() ? rawTier.trim() : null,
  };
}

/**
 * SINGLE ENTRY POINT for all hotel transactional emails.
 *
 * Security & Reliability Guarantees:
 * - Loads hotel, reservation, guest, room, and template strictly server-side (never trusts client HTML/to/from).
 * - Checks per-event toggle & feature flag (`EMAIL_CUSTOMIZATION_ENABLED`).
 * - Falls back to exact default email layout for uncustomized hotels.
 * - Enforces persistent `reservations/{id}.emailsSent.<markerKey>` deduplication (written ONLY after Resend succeeds).
 * - Wraps all operations in try/catch so email issues never block or fail any PMS workflow.
 */
export async function sendHotelEmail(
  hotelId: string,
  rawEventType: string,
  context: SendHotelEmailContext = {}
): Promise<SendHotelEmailResult> {
  try {
    const normalizedEvent = normalizeHotelEmailEvent(rawEventType);
    if (!normalizedEvent) {
      return { ok: false, sent: false, statusCode: 400, error: `Unsupported email event type: ${rawEventType}` };
    }

    const sendFn = context.overrides?.sendEmailFn || sendEmail;
    let appUrl = "";
    try {
      appUrl = (context.overrides?.appUrl || getAppUrl()).replace(/\/+$/, "");
    } catch (cfgErr: any) {
      return { ok: false, sent: false, statusCode: 503, error: cfgErr?.message || "APP_URL is not configured." };
    }

    // ── System fixed event: Tracking Code Request Alert (non-customizable) ──
    if (normalizedEvent === "tracking_code_request_alert") {
      const reqId = String(context.requestId || "").trim();
      if (!reqId) {
        return { ok: false, sent: false, statusCode: 400, error: "requestId is required for tracking_code_request_alert." };
      }

      const trackingDoc =
        context.preloaded?.trackingRequest !== undefined
          ? context.preloaded.trackingRequest
          : await fsReadDoc(`trackingCodeRequests/${reqId}`, context.bearerToken);
      if (!trackingDoc) {
        return { ok: false, sent: false, statusCode: 404, error: "Tracking code request not found." };
      }

      const requestStatus = String(trackingDoc.status || "pending").toLowerCase();
      if (requestStatus !== "pending") {
        return {
          ok: true,
          sent: false,
          skipped: true,
          eventType: normalizedEvent,
          reason: "Tracking code request is no longer pending.",
        };
      }

      if (trackingDoc.alertEmailSentAt) {
        return {
          ok: true,
          sent: false,
          skipped: true,
          deduplicated: true,
          eventType: normalizedEvent,
          reason: "already_sent",
        };
      }

      const requestHotelId =
        typeof trackingDoc.hotelId === "string" &&
        trackingDoc.hotelId !== "unknown" &&
        /^[a-zA-Z0-9_-]{1,128}$/.test(trackingDoc.hotelId)
          ? trackingDoc.hotelId
          : "";

      const [systemSettings, requestHotelDoc] = await Promise.all([
        context.preloaded?.systemSettings !== undefined
          ? Promise.resolve(context.preloaded.systemSettings)
          : fsReadDoc("system/settings", context.bearerToken).catch(() => null),
        context.preloaded?.hotel !== undefined
          ? Promise.resolve(context.preloaded.hotel)
          : requestHotelId
            ? fsReadDoc(`hotels/${requestHotelId}`, context.bearerToken).catch(() => null)
            : Promise.resolve(null),
      ]);

      const recipients = resolveTrackingCodeAlertRecipients(systemSettings, requestHotelDoc);
      if (recipients.length === 0) {
        return {
          ok: true,
          sent: false,
          skipped: true,
          eventType: normalizedEvent,
          reason: "No valid platform or hotel tracking code alert recipient configured.",
        };
      }

      const platformBrand = resolvePlatformBrandContext(systemSettings, appUrl);
      const isRenewal =
        String(trackingDoc.type || trackingDoc.requestType || "").toLowerCase() === "renewal";
      const reqHotelName =
        (typeof trackingDoc.hotelName === "string" && trackingDoc.hotelName.trim()) ||
        (requestHotelDoc && typeof requestHotelDoc.name === "string" && requestHotelDoc.name.trim()) ||
        "Prospective Hotel";
      const submittedAt =
        (typeof trackingDoc.timestamp === "string" && trackingDoc.timestamp.trim()) ||
        (typeof trackingDoc.createdAt === "string" && trackingDoc.createdAt.trim()) ||
        "";

      const rendered = renderMultiTenantEmail("tracking_code.request_submitted", platformBrand, {
        title: isRenewal ? "Subscription Renewal Code Request" : "New Tracking Code Request",
        subjectOverride: `[Platform Admin] ${
          isRenewal ? "Renewal Code Request" : "New Tracking Code Request"
        } - ${reqHotelName}`,
        intro: isRenewal
          ? `An existing hotel organization (${reqHotelName}) submitted a subscription renewal code request.`
          : `A new hotel registration tracking code request has been submitted for ${reqHotelName}.`,
        rows: [
          { label: "Request ID", value: reqId },
          {
            label: "Request Type",
            value: isRenewal ? "Subscription Renewal" : "New Hotel Registration",
          },
          { label: "Hotel Name", value: reqHotelName },
          ...(requestHotelId ? [{ label: "Hotel ID", value: requestHotelId }] : []),
          {
            label: "Requester Email",
            value:
              (typeof trackingDoc.email === "string" && trackingDoc.email.trim()) || "Not provided",
          },
          ...(typeof trackingDoc.phone === "string" && trackingDoc.phone.trim()
            ? [{ label: "Phone", value: trackingDoc.phone.trim() }]
            : []),
          ...(typeof trackingDoc.plan === "string" && trackingDoc.plan.trim()
            ? [{ label: "Requested Plan", value: trackingDoc.plan.trim() }]
            : []),
          ...(typeof trackingDoc.message === "string" && trackingDoc.message.trim()
            ? [{ label: "Notes", value: trackingDoc.message.trim() }]
            : []),
          ...(submittedAt ? [{ label: "Submitted At", value: submittedAt }] : []),
        ],
        ctaLabel: "Review in Admin Portal",
        ctaUrl: appUrl,
      });

      const requesterReplyTo =
        typeof trackingDoc.email === "string" && isValidEmail(trackingDoc.email.trim())
          ? trackingDoc.email.trim()
          : platformBrand.replyTo;

      const logId = `em_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
      const nowIso = new Date().toISOString();
      const dedupeKey = `tracking-code-req:${reqId}`;

      const sendRes = await sendFn({
        to: recipients,
        subject: rendered.subject,
        html: rendered.html,
        text: rendered.text,
        fromName: rendered.fromName,
        replyTo: requesterReplyTo,
        idempotencyKey: dedupeKey,
        tags: [
          { name: "hotelId", value: requestHotelId || "SYSTEM" },
          { name: "eventType", value: "tracking_code.request_submitted" },
          { name: "audience", value: "platform_superadmin" },
          { name: "logId", value: logId },
        ],
      });

      try {
        recordEmailDeliveryLog({
          logId,
          hotelId: requestHotelId || "SYSTEM",
          eventType: "tracking_code.request_submitted",
          audience: "platform_superadmin",
          recipients,
          subject: rendered.subject,
          entityId: reqId,
          idempotencyKey: dedupeKey,
          provider: "resend",
          messageId: sendRes.messageId,
          status: sendRes.success
            ? "accepted_by_provider"
            : sendRes.deliveryState === "unconfigured"
              ? "unconfigured"
              : "failed",
          attempts: sendRes.attempts,
          error: sendRes.error,
          createdAt: nowIso,
          updatedAt: new Date().toISOString(),
        });
      } catch {
        // Never fail alert dispatch due to logging
      }

      if (sendRes.success && !context.overrides?.sendEmailFn) {
        await fsPatchFields(
          `trackingCodeRequests/${reqId}`,
          { alertEmailSentAt: nowIso },
          ["alertEmailSentAt"],
          context.bearerToken
        ).catch(() => {});
      }

      return {
        ok: sendRes.success,
        sent: sendRes.success,
        messageId: sendRes.messageId,
        logId,
        deliveryState: sendRes.deliveryState,
        provider: sendRes.provider,
        statusCode: sendRes.statusCode,
        eventType: normalizedEvent,
        usedDefaultLayout: true,
        error: sendRes.error,
      };
    }

    // ── Hotel-customizable reservation events ──
    if (!isCustomizableEvent(normalizedEvent)) {
      return { ok: false, sent: false, statusCode: 400, error: `Event "${normalizedEvent}" is not supported.` };
    }

    const reservationId = String(context.reservationId || "").trim();
    if (!hotelId || !reservationId) {
      return { ok: false, sent: false, statusCode: 400, error: "hotelId and reservationId are required." };
    }

    const bearer = context.bearerToken;
    const hotelDoc =
      context.preloaded?.hotel !== undefined
        ? context.preloaded.hotel
        : await fsReadDoc(`hotels/${hotelId}`, bearer);

    let reservationDoc: Record<string, any> | null;
    let reservationUpdateTime: string | undefined = context.preloaded?.reservationUpdateTime;

    if (context.preloaded?.reservation !== undefined) {
      reservationDoc = context.preloaded.reservation;
    } else {
      const resMeta = await fsReadDocWithMeta(
        `hotels/${hotelId}/reservations/${reservationId}`,
        bearer
      );
      reservationDoc = resMeta?.data || null;
      reservationUpdateTime = resMeta?.updateTime;
    }

    if (!reservationDoc) {
      return { ok: false, sent: false, statusCode: 404, error: "Reservation not found." };
    }

    if (reservationDoc.hotelId && String(reservationDoc.hotelId) !== hotelId) {
      return {
        ok: false,
        sent: false,
        statusCode: 403,
        error: "Forbidden: Reservation does not belong to the specified hotel.",
      };
    }

    // Persistent idempotency check (survives restarts & duplicate edits/re-saves)
    const markerKey = buildMarkerKey(normalizedEvent, context.idempotencySuffix);
    const existingEmailsSent =
      reservationDoc.emailsSent && typeof reservationDoc.emailsSent === "object"
        ? reservationDoc.emailsSent
        : {};
    if (existingEmailsSent[markerKey]) {
      return {
        ok: true,
        sent: false,
        skipped: true,
        deduplicated: true,
        eventType: normalizedEvent,
        reason: "already_sent",
      };
    }

    // Load guest & room records server-side
    const guestDoc =
      context.preloaded?.guest !== undefined
        ? context.preloaded.guest
        : reservationDoc.guestId
          ? await fsReadDoc(`hotels/${hotelId}/guests/${reservationDoc.guestId}`, bearer).catch(
              () => null
            )
          : null;

    const roomDoc =
      context.preloaded?.room !== undefined
        ? context.preloaded.room
        : reservationDoc.roomId
          ? await fsReadDoc(`hotels/${hotelId}/rooms/${reservationDoc.roomId}`, bearer).catch(
              () => null
            )
          : null;

    const renderCtx = buildRenderContextFromRecords({
      hotelId,
      hotel: hotelDoc || { id: hotelId, name: "Hotel Property" },
      reservation: { ...reservationDoc, id: reservationId },
      guest: guestDoc,
      room: roomDoc,
      appUrl,
      paymentAmount: context.paymentAmount,
    });

    const eventMeta = EMAIL_EVENT_CATALOG[normalizedEvent];
    const audience = eventMeta.audience;

    // Preserve existing hotel-level emailConfig preferences for legacy events
    const legacyEventType = LEGACY_EVENT_MAP[normalizedEvent];
    if (legacyEventType) {
      const legacyPref = isHotelEmailEventEnabled(hotelDoc, legacyEventType, audience);
      if (!legacyPref.enabled) {
        return {
          ok: true,
          sent: false,
          skipped: true,
          eventType: normalizedEvent,
          reason: legacyPref.reason || "event_disabled_in_hotel_preferences",
        };
      }
    }

    // Resolve recipients strictly server-side (never from client payload)
    let recipients: string[] = [];
    if (audience === "guest") {
      if (renderCtx.guestEmail && isValidEmail(renderCtx.guestEmail)) {
        recipients = [renderCtx.guestEmail.trim()];
      }
    } else {
      const staffList = context.staffUsers || [];
      recipients = resolveHotelOperationalRecipients(
        hotelDoc,
        legacyEventType || "reservation.no_show",
        staffList
      );
    }

    if (recipients.length === 0) {
      return {
        ok: true,
        sent: false,
        skipped: true,
        eventType: normalizedEvent,
        reason: audience === "guest" ? "no_guest_email" : "no_staff_recipient",
      };
    }

    // Resolve template & per-event toggle
    const resolveFn = context.overrides?.resolveTemplateFn || resolveEffectiveTemplate;
    const resolved = await resolveFn(
      hotelId,
      normalizedEvent,
      hotelDoc,
      renderCtx.guestLanguage,
      bearer
    );

    if (!resolved.enabled) {
      return {
        ok: true,
        sent: false,
        skipped: true,
        eventType: normalizedEvent,
        reason: "event_disabled",
      };
    }

    // Preserve legacy hotel.emailConfig sender/reply-to if emailSettings/default left them blank
    const legacyEmailConfig =
      hotelDoc?.emailConfig && typeof hotelDoc.emailConfig === "object"
        ? (hotelDoc.emailConfig as Record<string, any>)
        : {};
    const effectiveSettings = {
      ...resolved.settings,
      senderDisplayName:
        resolved.settings.senderDisplayName ||
        (typeof legacyEmailConfig.senderDisplayName === "string"
          ? legacyEmailConfig.senderDisplayName.trim()
          : ""),
      replyToEmail:
        resolved.settings.replyToEmail ||
        (typeof legacyEmailConfig.replyToEmail === "string" &&
        isValidEmail(legacyEmailConfig.replyToEmail.trim())
          ? legacyEmailConfig.replyToEmail.trim()
          : ""),
    };

    // Render server-side with defense-in-depth HTML sanitization
    const rendered = renderHotelEmailServerSide({
      variant: resolved.variant,
      context: renderCtx,
      settings: effectiveSettings,
      language: resolved.language,
      usedDefaultLayout: resolved.usedDefaultLayout,
    });

    const idempotencyKey = `hotel-${hotelId}-res-${reservationId}-${markerKey}`.slice(0, 128);
    const logId = `em_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    const nowIso = new Date().toISOString();

    const sendRes = await sendFn({
      to: recipients,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      idempotencyKey,
      tags: [
        { name: "hotelId", value: hotelId },
        { name: "event", value: normalizedEvent },
        { name: "reservationId", value: reservationId },
        { name: "logId", value: logId },
      ],
    });

    // Record persistent deduplication marker ONLY after Resend succeeds
    // Patch ONLY `emailsSent.<markerKey>` so concurrent sends on the same reservation never clobber sibling markers
    if (sendRes.success) {
      const markerPayload = {
        sentAt: nowIso,
        messageId: sendRes.messageId || "",
        eventType: normalizedEvent,
        version: resolved.publishedVersion,
        usedDefaultLayout: resolved.usedDefaultLayout,
      };
      if (context.overrides?.persistMarkerFn) {
        await context.overrides
          .persistMarkerFn(hotelId, reservationId, markerKey, markerPayload, reservationUpdateTime)
          .catch(() => {});
      } else {
        const markerPatch = { emailsSent: { [markerKey]: markerPayload } };
        const markerMask = [`emailsSent.${markerKey}`];
        const patchRes = await fsPatchFields(
          `hotels/${hotelId}/reservations/${reservationId}`,
          markerPatch,
          markerMask,
          bearer,
          reservationUpdateTime
        ).catch(() => ({ ok: false, status: 500 }));

        if (!patchRes.ok) {
          await fsPatchFields(
            `hotels/${hotelId}/reservations/${reservationId}`,
            markerPatch,
            markerMask,
            bearer
          ).catch(() => {});
        }
      }
    }

    // Non-blocking audit log (no secrets)
    try {
      recordEmailDeliveryLog({
        logId,
        hotelId,
        eventType: legacyEventType || normalizedEvent,
        audience,
        recipients,
        subject: rendered.subject,
        reservationId,
        guestId: typeof reservationDoc.guestId === "string" ? reservationDoc.guestId : undefined,
        idempotencyKey,
        provider: "resend",
        messageId: sendRes.messageId,
        status: sendRes.success
          ? "accepted_by_provider"
          : sendRes.deliveryState === "unconfigured"
            ? "unconfigured"
            : "failed",
        attempts: sendRes.attempts,
        error: sendRes.error,
        createdAt: nowIso,
        updatedAt: nowIso,
      });

      if (bearer && !context.overrides?.sendEmailFn) {
        await fsSetDoc(
          `hotels/${hotelId}/emailNotifications/${logId}`,
          {
            logId,
            hotelId,
            reservationId,
            eventType: normalizedEvent,
            audience,
            status: sendRes.success ? "accepted_by_provider" : "failed",
            messageId: sendRes.messageId || "",
            usedDefaultLayout: resolved.usedDefaultLayout,
            templateVersion: resolved.publishedVersion,
            error: sendRes.error ? String(sendRes.error).slice(0, 160) : "",
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          bearer
        ).catch(() => {});
      }
    } catch {
      // Never fail main flow due to logging
    }

    return {
      ok: sendRes.success,
      sent: sendRes.success,
      messageId: sendRes.messageId,
      logId,
      deliveryState: sendRes.deliveryState,
      provider: sendRes.provider,
      statusCode: sendRes.statusCode,
      eventType: normalizedEvent,
      usedDefaultLayout: resolved.usedDefaultLayout,
      error: sendRes.error,
    };
  } catch (err: any) {
    // Email failures must NEVER throw or break bookings, check-ins, or check-outs
    return {
      ok: false,
      sent: false,
      statusCode: 500,
      error: String(err?.message || "Unexpected email dispatch error.").slice(0, 200),
    };
  }
}

function addDaysYmd(baseDate: Date, deltaDays: number): string {
  const d = new Date(baseDate.getTime() + deltaDays * 86_400_000);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Scheduled job runner for `pre_arrival_reminder` and `post_stay_feedback_request`.
 * Designed to be triggered once daily via Hostinger Cron calling `POST /api/email-customization/cron/run`.
 * Uses persistent `emailsSent` markers so repeated runs never duplicate emails.
 */
export async function runScheduledHotelEmails(options: {
  bearerToken?: string;
  now?: Date;
  hotelIds?: string[];
  dryRun?: boolean;
}): Promise<{
  hotelsScanned: number;
  preArrivalSent: number;
  postStaySent: number;
  skipped: number;
  errors: number;
}> {
  const now = options.now || new Date();
  let hotelsScanned = 0;
  let preArrivalSent = 0;
  let postStaySent = 0;
  let skipped = 0;
  let errors = 0;

  let hotelDocs: Array<Record<string, any> & { id: string }> = [];
  if (Array.isArray(options.hotelIds) && options.hotelIds.length > 0) {
    for (const hid of options.hotelIds) {
      const h = await fsReadDoc(`hotels/${hid}`, options.bearerToken).catch(() => null);
      if (h) hotelDocs.push({ ...h, id: hid });
    }
  } else {
    hotelDocs = await fsListCollection("hotels", options.bearerToken, 200).catch(() => []);
  }

  for (const hotel of hotelDocs) {
    const hotelId = hotel.id;
    if (!hotelId || hotel.status === "suspended") continue;
    hotelsScanned += 1;

    const settingsDoc = await fsReadDoc(
      `hotels/${hotelId}/emailSettings/default`,
      options.bearerToken
    ).catch(() => null);
    const preDays = Number.isInteger(settingsDoc?.preArrivalDaysBefore)
      ? Number(settingsDoc.preArrivalDaysBefore)
      : 1;
    const postDays = Number.isInteger(settingsDoc?.postStayDaysAfter)
      ? Number(settingsDoc.postStayDaysAfter)
      : 1;

    const targetCheckInYmd = addDaysYmd(now, preDays);
    const targetCheckOutYmd = addDaysYmd(now, -postDays);

    const reservations = await fsListCollection(
      `hotels/${hotelId}/reservations`,
      options.bearerToken,
      300
    ).catch(() => []);

    for (const resDoc of reservations) {
      const status = String(resDoc.status || "");
      const checkInYmd = String(resDoc.checkIn || "").slice(0, 10);
      const checkOutYmd = String(resDoc.checkOut || "").slice(0, 10);

      if (status === "confirmed" && checkInYmd === targetCheckInYmd) {
        if (options.dryRun) {
          preArrivalSent += 1;
        } else {
          const r = await sendHotelEmail(hotelId, "pre_arrival_reminder", {
            reservationId: resDoc.id,
            bearerToken: options.bearerToken,
          });
          if (r.sent) preArrivalSent += 1;
          else if (r.skipped) skipped += 1;
          else errors += 1;
        }
      }

      if (status === "checked_out" && checkOutYmd === targetCheckOutYmd) {
        if (options.dryRun) {
          postStaySent += 1;
        } else {
          const r = await sendHotelEmail(hotelId, "post_stay_feedback_request", {
            reservationId: resDoc.id,
            bearerToken: options.bearerToken,
          });
          if (r.sent) postStaySent += 1;
          else if (r.skipped) skipped += 1;
          else errors += 1;
        }
      }
    }
  }

  return { hotelsScanned, preArrivalSent, postStaySent, skipped, errors };
}
