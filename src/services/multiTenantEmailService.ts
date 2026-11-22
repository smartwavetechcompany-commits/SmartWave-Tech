import crypto from "crypto";
import {
  escapeHtml,
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "../utils/serverSecurity.ts";

/**
 * Strongly typed multi-tenant transactional email event catalog covering all PMS modules.
 */
export type MultiTenantEmailEventType =
  // Reservations & Bookings
  | "reservation.confirmed"
  | "reservation.checked_in"
  | "reservation.checked_out"
  | "reservation.cancelled"
  | "reservation.no_show"
  // Payments, Deposits, Invoices, Receipts & Refunds
  | "payment.received"
  | "deposit.received"
  | "invoice.issued"
  | "receipt.sent"
  | "refund.processed"
  // Restaurant / F&B
  | "fnb.order_posted"
  | "fnb.order_voided"
  // Housekeeping
  | "housekeeping.room_ready"
  | "housekeeping.inspection_failed"
  | "housekeeping.guest_request"
  // Maintenance
  | "maintenance.issue_reported"
  | "maintenance.issue_resolved"
  // Guest Management
  | "guest.profile_created"
  | "guest.blacklisted"
  // Staff Management
  | "staff.account_status_changed"
  // Hotel Registration
  | "hotel.registered"
  // Corporate Accounts & City Ledger
  | "corporate.account_created"
  | "corporate.city_ledger_transfer"
  | "corporate.payment_settled"
  | "corporate.low_balance_alert"
  // Subscriptions
  | "subscription.renewed"
  | "subscription.expiring_or_expired"
  // Tracking Code Requests
  | "tracking_code.request_submitted"
  | "tracking_code.request_status_updated"
  // Guest Loyalty & Rewards
  | "loyalty.account_activated"
  | "loyalty.points_awarded"
  | "loyalty.points_deducted"
  | "loyalty.points_redeemed"
  | "loyalty.tier_upgraded"
  | "loyalty.points_expiring"
  // Important System Events
  | "system.daily_revenue_deficit"
  | "system.operational_alert";

export type EmailRecipientAudience =
  | "guest"
  | "hotel_staff"
  | "corporate"
  | "platform_superadmin"
  | "staff_member";

export interface HotelBrandContext {
  hotelId: string;
  hotelName: string;
  senderDisplayName: string;
  logoUrl?: string;
  primaryColor: string;
  secondaryColor: string;
  supportEmail?: string;
  replyTo?: string;
  phone?: string;
  address?: string;
  website: string;
  footerNotes?: string;
  currency: string;
  isPlatformScope?: boolean;
}

export interface EmailSummaryRow {
  label: string;
  value: string;
}

export interface RenderedMultiTenantEmail {
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
}

export interface MultiTenantEmailPayload {
  title?: string;
  recipientName?: string;
  intro?: string;
  note?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  rows: EmailSummaryRow[];
  subjectOverride?: string;
}

export interface EmailDeliveryLogEntry {
  logId: string;
  hotelId: string;
  eventType: MultiTenantEmailEventType | string;
  audience: EmailRecipientAudience;
  recipients: string[];
  subject: string;
  reservationId?: string;
  guestId?: string;
  corporateId?: string;
  entityId?: string;
  idempotencyKey?: string;
  provider: "resend";
  messageId?: string;
  status:
    | "accepted_by_provider"
    | "sent"
    | "delivered"
    | "delivery_delayed"
    | "bounced"
    | "complained"
    | "opened"
    | "clicked"
    | "skipped"
    | "failed"
    | "unconfigured";
  attempts?: number;
  error?: string;
  reason?: string;
  createdAt: string;
  updatedAt: string;
  webhookEvents?: {
    type: string;
    at: string;
  }[];
}

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const MAX_EMAIL_LOGS = 2000;

const emailLogStore = new Map<string, EmailDeliveryLogEntry>();
const messageIdToLogId = new Map<string, string>();

function sanitizeHexColor(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && HEX_COLOR_RE.test(raw.trim())) {
    return raw.trim();
  }
  return fallback;
}

function sanitizeHttpUrl(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") {
      return parsed.toString().replace(/\/+$/, "");
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function sanitizeEmail(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed && isValidEmailAddress(trimmed) ? trimmed : undefined;
}

export function sanitizeEmailList(input: unknown): string[] {
  const arr = Array.isArray(input) ? input : typeof input === "string" ? [input] : [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of arr) {
    const valid = sanitizeEmail(item);
    if (valid && !seen.has(valid.toLowerCase())) {
      seen.add(valid.toLowerCase());
      out.push(valid);
    }
  }
  return out;
}

/**
 * Dynamically resolves a tenant hotel's branding, sender identity, and contact info
 * strictly from that hotel's own Firestore document. Never hardcodes any specific hotel.
 */
export function resolveHotelBrandContext(
  hotelId: string,
  hotelDoc: Record<string, any> | null | undefined,
  appUrl: string
): HotelBrandContext {
  const cleanAppUrl = appUrl.replace(/\/+$/, "");
  const branding = (hotelDoc?.branding && typeof hotelDoc.branding === "object"
    ? hotelDoc.branding
    : {}) as Record<string, any>;
  const emailConfig = (hotelDoc?.emailConfig && typeof hotelDoc.emailConfig === "object"
    ? hotelDoc.emailConfig
    : {}) as Record<string, any>;

  const hotelName =
    (typeof branding.organizationName === "string" && branding.organizationName.trim()) ||
    (typeof hotelDoc?.name === "string" && hotelDoc.name.trim()) ||
    "Hotel Property";

  const senderDisplayName = sanitizeEmailHeaderValue(
    (typeof emailConfig.senderDisplayName === "string" && emailConfig.senderDisplayName.trim()) ||
      hotelName,
    "Hotel Notifications"
  );

  const supportEmail =
    sanitizeEmail(emailConfig.supportEmail) ||
    sanitizeEmail(branding.email) ||
    sanitizeEmail(hotelDoc?.email);

  const replyTo =
    sanitizeEmail(emailConfig.replyToEmail) || supportEmail;

  const phone =
    (typeof branding.phone === "string" && branding.phone.trim()) ||
    (typeof hotelDoc?.phone === "string" && hotelDoc.phone.trim()) ||
    undefined;

  const address =
    (typeof branding.address === "string" && branding.address.trim()) ||
    (typeof hotelDoc?.address === "string" && hotelDoc.address.trim()) ||
    undefined;

  const rawConfiguredWebsite =
    sanitizeHttpUrl(branding.website) || sanitizeHttpUrl(hotelDoc?.website) || "";
  const website =
    rawConfiguredWebsite &&
    rawConfiguredWebsite.replace(/\/+$/, "").toLowerCase() !== cleanAppUrl.toLowerCase()
      ? rawConfiguredWebsite
      : "";

  const logoUrl = sanitizeHttpUrl(branding.logoUrl);

  const footerNotes =
    typeof branding.footerNotes === "string" && branding.footerNotes.trim()
      ? branding.footerNotes.trim()
      : undefined;

  return {
    hotelId,
    hotelName,
    senderDisplayName,
    logoUrl,
    primaryColor: sanitizeHexColor(branding.primaryColor, "#059669"),
    secondaryColor: sanitizeHexColor(branding.secondaryColor, "#18181b"),
    supportEmail,
    replyTo,
    phone,
    address,
    website,
    footerNotes,
    currency:
      typeof hotelDoc?.defaultCurrency === "string" && hotelDoc.defaultCurrency.trim()
        ? hotelDoc.defaultCurrency.trim()
        : "NGN",
    isPlatformScope: false,
  };
}

/**
 * Neutral platform branding context for platform-wide SuperAdmin notifications
 * (never branded as any individual tenant hotel).
 */
export function resolvePlatformBrandContext(
  systemSettings: Record<string, any> | null | undefined,
  appUrl: string
): HotelBrandContext {
  const cleanAppUrl = appUrl.replace(/\/+$/, "");
  const platformName =
    (typeof systemSettings?.platformName === "string" && systemSettings.platformName.trim()) ||
    (typeof process !== "undefined" && typeof process.env?.PLATFORM_NAME === "string" && process.env.PLATFORM_NAME.trim()) ||
    "Hotel Management Platform";
  const supportEmail =
    sanitizeEmail(systemSettings?.supportEmail) ||
    sanitizeEmail(process.env?.PLATFORM_ADMIN_EMAIL) ||
    sanitizeEmail(process.env?.ADMIN_ALERT_EMAIL);

  return {
    hotelId: "SYSTEM",
    hotelName: platformName,
    senderDisplayName: sanitizeEmailHeaderValue(platformName, "Hotel Notifications"),
    primaryColor: "#059669",
    secondaryColor: "#18181b",
    supportEmail,
    replyTo: supportEmail,
    website: cleanAppUrl,
    currency: "NGN",
    isPlatformScope: true,
  };
}

/**
 * Evaluates a specific hotel's notification preferences (`emailConfig.enabledEvents`,
 * `settings.notifications.*`, `settings.payments.autoSendReceipts`, and
 * `settings.guests.allowEmailCommunication`). Each hotel operates independently.
 */
export function isHotelEmailEventEnabled(
  hotelDoc: Record<string, any> | null | undefined,
  eventType: MultiTenantEmailEventType,
  audience: EmailRecipientAudience
): { enabled: boolean; reason?: string } {
  if (!hotelDoc) return { enabled: true };

  const emailConfig = (hotelDoc.emailConfig && typeof hotelDoc.emailConfig === "object"
    ? hotelDoc.emailConfig
    : {}) as Record<string, any>;
  const notifications = (hotelDoc.settings?.notifications &&
  typeof hotelDoc.settings.notifications === "object"
    ? hotelDoc.settings.notifications
    : {}) as Record<string, any>;
  const payments = (hotelDoc.settings?.payments &&
  typeof hotelDoc.settings.payments === "object"
    ? hotelDoc.settings.payments
    : {}) as Record<string, any>;
  const guests = (hotelDoc.settings?.guests &&
  typeof hotelDoc.settings.guests === "object"
    ? hotelDoc.settings.guests
    : {}) as Record<string, any>;

  // Explicit per-event hotel override takes highest precedence
  if (
    emailConfig.enabledEvents &&
    typeof emailConfig.enabledEvents === "object" &&
    typeof emailConfig.enabledEvents[eventType] === "boolean"
  ) {
    if (!emailConfig.enabledEvents[eventType]) {
      return {
        enabled: false,
        reason: `Hotel disabled email notifications for event '${eventType}'.`,
      };
    }
    return { enabled: true };
  }

  // Respect guest communication preference for guest-facing emails
  if (audience === "guest" && guests.allowEmailCommunication === false) {
    return {
      enabled: false,
      reason: "Hotel settings have guest email communication disabled.",
    };
  }

  // Respect hotel-wide operational email bridge toggle for internal staff alerts
  if (audience === "hotel_staff" && notifications.enableEmail === false) {
    return {
      enabled: false,
      reason: "Hotel settings have staff email notifications disabled.",
    };
  }

  // Module-specific existing HotelSettings toggles
  switch (eventType) {
    case "reservation.no_show":
      if (notifications.sendNoShowAlerts === false) {
        return { enabled: false, reason: "Hotel disabled no-show alerts." };
      }
      break;
    case "payment.received":
    case "receipt.sent":
      if (audience === "guest" && payments.autoSendReceipts === false) {
        return { enabled: false, reason: "Hotel disabled automatic receipt emails." };
      }
      if (audience === "hotel_staff" && notifications.sendPaymentAlerts === false) {
        return { enabled: false, reason: "Hotel disabled payment alerts." };
      }
      break;
    case "maintenance.issue_reported":
    case "maintenance.issue_resolved":
      if (notifications.sendMaintenanceAlerts === false) {
        return { enabled: false, reason: "Hotel disabled maintenance alerts." };
      }
      break;
    case "housekeeping.room_ready":
    case "housekeeping.inspection_failed":
    case "housekeeping.guest_request":
      if (notifications.sendRoomStatusAlerts === false) {
        return { enabled: false, reason: "Hotel disabled housekeeping/room status alerts." };
      }
      break;
    case "corporate.low_balance_alert":
      if (notifications.enableLowBalanceAlerts === false) {
        return { enabled: false, reason: "Hotel disabled corporate low balance alerts." };
      }
      break;
    case "system.daily_revenue_deficit":
      if (notifications.enableDailyRevenueAlert === false) {
        return { enabled: false, reason: "Hotel disabled daily revenue deficit alerts." };
      }
      break;
    case "loyalty.account_activated":
    case "loyalty.points_awarded":
    case "loyalty.points_deducted":
    case "loyalty.points_redeemed":
    case "loyalty.tier_upgraded":
    case "loyalty.points_expiring": {
      const loyaltyCfg = (hotelDoc.settings?.loyalty && typeof hotelDoc.settings.loyalty === "object"
        ? hotelDoc.settings.loyalty
        : {}) as Record<string, any>;
      if (loyaltyCfg.notifyGuestsByEmail === false) {
        return { enabled: false, reason: "Hotel disabled guest loyalty email notifications." };
      }
      break;
    }
    default:
      break;
  }

  return { enabled: true };
}

/**
 * Maps an operational event to the relevant hotel department key and target staff roles.
 */
export function getOperationalRoutingTarget(eventType: MultiTenantEmailEventType): {
  department:
    | "frontDesk"
    | "finance"
    | "restaurant"
    | "housekeeping"
    | "maintenance"
    | "corporate"
    | "hr"
    | "admin";
  roles: string[];
} {
  switch (eventType) {
    case "reservation.confirmed":
    case "reservation.checked_in":
    case "reservation.checked_out":
    case "reservation.cancelled":
    case "reservation.no_show":
    case "guest.blacklisted":
      return { department: "frontDesk", roles: ["hotelAdmin", "admin", "manager", "frontDesk", "receptionist"] };
    case "payment.received":
    case "deposit.received":
    case "invoice.issued":
    case "receipt.sent":
    case "refund.processed":
    case "system.daily_revenue_deficit":
      return { department: "finance", roles: ["hotelAdmin", "admin", "manager", "accountant"] };
    case "fnb.order_posted":
    case "fnb.order_voided":
      return { department: "restaurant", roles: ["hotelAdmin", "admin", "manager", "kitchen", "accountant"] };
    case "housekeeping.room_ready":
    case "housekeeping.inspection_failed":
    case "housekeeping.guest_request":
      return { department: "housekeeping", roles: ["hotelAdmin", "admin", "manager", "housekeeper", "frontDesk"] };
    case "maintenance.issue_reported":
    case "maintenance.issue_resolved":
      return { department: "maintenance", roles: ["hotelAdmin", "admin", "manager", "maintenance"] };
    case "corporate.account_created":
    case "corporate.city_ledger_transfer":
    case "corporate.payment_settled":
    case "corporate.low_balance_alert":
      return { department: "corporate", roles: ["hotelAdmin", "admin", "manager", "accountant", "corporate"] };
    case "staff.account_status_changed":
      return { department: "hr", roles: ["hotelAdmin", "admin", "manager"] };
    default:
      return { department: "admin", roles: ["hotelAdmin", "admin", "manager"] };
  }
}

/**
 * Resolves hotel operational staff/admin recipients strictly within the given hotel's tenant boundary.
 */
export function resolveHotelOperationalRecipients(
  hotelDoc: Record<string, any> | null | undefined,
  eventType: MultiTenantEmailEventType,
  queriedHotelStaff: Array<{ email?: string; role?: string; staffRole?: string; roles?: string[]; status?: string }>
): string[] {
  const emailConfig = (hotelDoc?.emailConfig && typeof hotelDoc.emailConfig === "object"
    ? hotelDoc.emailConfig
    : {}) as Record<string, any>;
  const routing = getOperationalRoutingTarget(eventType);

  // 1. Explicit department recipients configured on the hotel
  const deptConfigured = sanitizeEmailList(
    emailConfig.departmentRecipients?.[routing.department]
  );
  if (deptConfigured.length > 0) return deptConfigured.slice(0, 10);

  // 2. Explicit hotel admin recipients configured on the hotel
  const adminConfigured = sanitizeEmailList(emailConfig.adminRecipients);
  if (adminConfigured.length > 0) return adminConfigured.slice(0, 10);

  // 3. Active matching staff/admins belonging exclusively to this hotel
  const allowedRoleSet = new Set(routing.roles.map((r) => r.toLowerCase()));
  const matchedStaffEmails: string[] = [];
  for (const member of queriedHotelStaff) {
    const status = String(member.status || "active").toLowerCase();
    if (status === "suspended" || status === "disabled" || status === "inactive") continue;
    const memberRoles = [
      member.role,
      member.staffRole,
      ...(Array.isArray(member.roles) ? member.roles : []),
    ]
      .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
      .map((r) => r.trim().toLowerCase());
    if (memberRoles.some((r) => allowedRoleSet.has(r))) {
      const valid = sanitizeEmail(member.email);
      if (valid) matchedStaffEmails.push(valid);
    }
  }
  const uniqueStaff = sanitizeEmailList(matchedStaffEmails);
  if (uniqueStaff.length > 0) return uniqueStaff.slice(0, 10);

  // 4. Fallback to hotel's own support/branding email
  const fallback = sanitizeEmailList([
    emailConfig.supportEmail,
    hotelDoc?.branding?.email,
    hotelDoc?.email,
  ]);
  return fallback.slice(0, 10);
}

/**
 * Resolves platform-wide SuperAdmin alert recipients (never hardcoded to a single tenant hotel).
 */
export function resolvePlatformAdminRecipients(
  systemSettings: Record<string, any> | null | undefined
): string[] {
  const envAdmins =
    typeof process !== "undefined" && typeof process.env?.PLATFORM_ADMIN_EMAIL === "string"
      ? process.env.PLATFORM_ADMIN_EMAIL.split(",")
      : [];
  const legacyEnv =
    typeof process !== "undefined" && typeof process.env?.ADMIN_ALERT_EMAIL === "string"
      ? process.env.ADMIN_ALERT_EMAIL.split(",")
      : [];

  return sanitizeEmailList([
    systemSettings?.supportEmail,
    ...envAdmins,
    ...legacyEnv,
  ]).slice(0, 10);
}

/**
 * Resolves Tracking Code Request alert recipients following platform & hotel rules:
 * - New registration requests: platform superadmin recipients.
 * - Renewal requests associated with an existing hotelId: platform superadmin recipients
 *   plus any hotel-configured trackingCodeAlertRecipients.
 */
export function resolveTrackingCodeAlertRecipients(
  systemSettings: Record<string, any> | null | undefined,
  hotelDoc?: Record<string, any> | null
): string[] {
  const platformRecipients = resolvePlatformAdminRecipients(systemSettings);
  const hotelRenewalRecipients = hotelDoc
    ? sanitizeEmailList(hotelDoc?.emailConfig?.trackingCodeAlertRecipients)
    : [];
  return sanitizeEmailList([...platformRecipients, ...hotelRenewalRecipients]).slice(0, 10);
}

function getDefaultMetaForEvent(
  eventType: MultiTenantEmailEventType,
  brand: HotelBrandContext
): { subjectPrefix: string; heading: string; defaultIntro: string } {
  const name = brand.hotelName;
  switch (eventType) {
    case "reservation.confirmed":
      return {
        subjectPrefix: `Booking Confirmation - ${name}`,
        heading: "Booking Confirmation",
        defaultIntro: `Your reservation at ${name} has been confirmed. Please review your stay details below.`,
      };
    case "reservation.checked_in":
      return {
        subjectPrefix: `Check-In Confirmation - ${name}`,
        heading: "Welcome & Check-In Confirmation",
        defaultIntro: `You have been checked in at ${name}. Below is your stay summary for reference.`,
      };
    case "reservation.checked_out":
      return {
        subjectPrefix: `Check-Out Summary - ${name}`,
        heading: "Thank You for Staying With Us",
        defaultIntro: `Your check-out at ${name} is complete. Below is a summary of your stay.`,
      };
    case "reservation.cancelled":
      return {
        subjectPrefix: `Booking Cancellation - ${name}`,
        heading: "Booking Cancellation Notice",
        defaultIntro: `Your reservation at ${name} has been cancelled. Cancelled booking details are listed below.`,
      };
    case "reservation.no_show":
      return {
        subjectPrefix: `[Operations] No-Show Recorded - ${name}`,
        heading: "Reservation Marked as No-Show",
        defaultIntro: `A reservation at ${name} has been marked as a no-show and room inventory has been updated.`,
      };
    case "payment.received":
      return {
        subjectPrefix: `Payment Confirmation - ${name}`,
        heading: "Payment Received",
        defaultIntro: `A payment has been recorded at ${name}. Transaction details are provided below.`,
      };
    case "deposit.received":
      return {
        subjectPrefix: `Deposit Received – ${name}`,
        heading: "Deposit Received",
        defaultIntro: `Thank you! Your deposit has been received and credited to your guest account at ${name}. Below are your deposit confirmation details.`,
      };
    case "invoice.issued":
      return {
        subjectPrefix: `Invoice Issued - ${name}`,
        heading: "Folio Invoice Statement",
        defaultIntro: `An invoice statement has been issued by ${name}. Please review the details below.`,
      };
    case "receipt.sent":
      return {
        subjectPrefix: `Official Receipt - ${name}`,
        heading: "Official Payment Receipt",
        defaultIntro: `Thank you for your payment at ${name}. Below is your official receipt summary.`,
      };
    case "refund.processed":
      return {
        subjectPrefix: `Refund Confirmation - ${name}`,
        heading: "Refund Processed",
        defaultIntro: `A refund has been processed at ${name}. Reference details are included below.`,
      };
    case "fnb.order_posted":
      return {
        subjectPrefix: `Restaurant & F&B Charge Notice - ${name}`,
        heading: "F&B Order Posted to Folio",
        defaultIntro: `A restaurant / F&B order at ${name} has been posted to your room folio.`,
      };
    case "fnb.order_voided":
      return {
        subjectPrefix: `[F&B Alert] Order Voided - ${name}`,
        heading: "F&B Order Voided",
        defaultIntro: `An F&B order at ${name} was voided and associated financials were reversed.`,
      };
    case "housekeeping.room_ready":
      return {
        subjectPrefix: `[Housekeeping] Room Ready for Arrival - ${name}`,
        heading: "Room Inspected & Ready",
        defaultIntro: `Housekeeping inspection passed and the room is now marked clean and ready.`,
      };
    case "housekeeping.inspection_failed":
      return {
        subjectPrefix: `[Housekeeping Alert] Inspection Failed - ${name}`,
        heading: "Room Inspection Failed",
        defaultIntro: `A room failed housekeeping inspection and requires corrective cleaning.`,
      };
    case "housekeeping.guest_request":
      return {
        subjectPrefix: `[Housekeeping] Guest Request Logged - ${name}`,
        heading: "New Housekeeping Guest Request",
        defaultIntro: `A new guest housekeeping request has been logged and awaits fulfilment.`,
      };
    case "maintenance.issue_reported":
      return {
        subjectPrefix: `[Maintenance Alert] New Issue Reported - ${name}`,
        heading: "New Maintenance Ticket Reported",
        defaultIntro: `A technical/maintenance issue has been reported at ${name}.`,
      };
    case "maintenance.issue_resolved":
      return {
        subjectPrefix: `[Maintenance] Issue Completed - ${name}`,
        heading: "Maintenance Ticket Completed",
        defaultIntro: `A maintenance request at ${name} has been marked as completed.`,
      };
    case "guest.profile_created":
      return {
        subjectPrefix: `Guest Registration Confirmation - ${name}`,
        heading: "Guest Profile Created",
        defaultIntro: `Your guest profile has been registered with ${name}.`,
      };
    case "guest.blacklisted":
      return {
        subjectPrefix: `[Compliance Alert] Guest Status Restricted - ${name}`,
        heading: "Guest Account Restricted",
        defaultIntro: `A guest profile at ${name} has been flagged/restricted. Review details below.`,
      };
    case "staff.account_status_changed":
      return {
        subjectPrefix: `Staff Account Status Update - ${name}`,
        heading: "Staff Account Status Updated",
        defaultIntro: `A staff account status change has been recorded at ${name}.`,
      };
    case "hotel.registered":
      return {
        subjectPrefix: `Hotel Registration Completed - ${name}`,
        heading: "Hotel Organization Registered",
        defaultIntro: `A new hotel organization (${name}) has been registered and provisioned on the platform.`,
      };
    case "corporate.account_created":
      return {
        subjectPrefix: `Corporate Account Established - ${name}`,
        heading: "Corporate Account Created",
        defaultIntro: `A corporate billing account has been established with ${name}.`,
      };
    case "corporate.city_ledger_transfer":
      return {
        subjectPrefix: `City Ledger Transfer Notice - ${name}`,
        heading: "Balance Transferred to City Ledger",
        defaultIntro: `A folio balance has been transferred to the corporate City Ledger at ${name}.`,
      };
    case "corporate.payment_settled":
      return {
        subjectPrefix: `Corporate Payment Settlement - ${name}`,
        heading: "Corporate Account Payment Settled",
        defaultIntro: `A corporate account payment settlement has been recorded at ${name}.`,
      };
    case "corporate.low_balance_alert":
      return {
        subjectPrefix: `[Finance Alert] Corporate Credit Threshold Warning - ${name}`,
        heading: "Corporate Available Credit Alert",
        defaultIntro: `A corporate account at ${name} has crossed its configured credit monitoring threshold.`,
      };
    case "subscription.renewed":
      return {
        subjectPrefix: `Subscription Renewed - ${name}`,
        heading: "Subscription Successfully Renewed",
        defaultIntro: `The PMS subscription for ${name} has been renewed and activated.`,
      };
    case "subscription.expiring_or_expired":
      return {
        subjectPrefix: `Subscription Status Notice - ${name}`,
        heading: "Subscription Status Alert",
        defaultIntro: `Important subscription status update for ${name}.`,
      };
    case "tracking_code.request_submitted":
      return {
        subjectPrefix: `[Admin Alert] Tracking Code Request`,
        heading: "New Tracking Code Request",
        defaultIntro: `A tracking code request has been submitted and is awaiting administrator review.`,
      };
    case "tracking_code.request_status_updated":
      return {
        subjectPrefix: `Tracking Code Request Update`,
        heading: "Tracking Code Request Status Update",
        defaultIntro: `There has been an update to your tracking code request.`,
      };
    case "loyalty.account_activated":
      return {
        subjectPrefix: `Welcome to ${name} Loyalty & Rewards`,
        heading: "Your Loyalty Account Is Now Active",
        defaultIntro: `Welcome to the ${name} Loyalty & Rewards programme. You can now earn rewards, track your points balance, and enjoy exclusive membership benefits.`,
      };
    case "loyalty.points_awarded":
      return {
        subjectPrefix: `Loyalty Points Awarded - ${name}`,
        heading: "Loyalty Points Awarded",
        defaultIntro: `Great news! Loyalty points have been credited to your rewards account at ${name}. Your updated transaction summary is shown below.`,
      };
    case "loyalty.points_deducted":
      return {
        subjectPrefix: `Loyalty Points Adjustment Notice - ${name}`,
        heading: "Loyalty Points Adjusted",
        defaultIntro: `A loyalty points adjustment has been recorded on your rewards account at ${name}. Please review the updated balance details below.`,
      };
    case "loyalty.points_redeemed":
      return {
        subjectPrefix: `Loyalty Points Redeemed - ${name}`,
        heading: "Loyalty Points Redemption Confirmation",
        defaultIntro: `Your loyalty points redemption at ${name} has been confirmed. Please review your redemption summary and remaining balance below.`,
      };
    case "loyalty.tier_upgraded":
      return {
        subjectPrefix: `Congratulations on Your Membership Upgrade - ${name}`,
        heading: "Membership Level Upgraded",
        defaultIntro: `Congratulations! You have reached a new loyalty membership level at ${name}. Review your upgraded tier details and rewards summary below.`,
      };
    case "loyalty.points_expiring":
      return {
        subjectPrefix: `Reminder: Your Loyalty Points Are Approaching Expiry - ${name}`,
        heading: "Loyalty Points Approaching Expiry",
        defaultIntro: `Some of your loyalty points at ${name} are approaching their expiry date. Review your points summary below so you don't miss out on your rewards.`,
      };
    case "system.daily_revenue_deficit":
      return {
        subjectPrefix: `[Finance Alert] Daily Revenue Below Target - ${name}`,
        heading: "Daily Revenue Deficit Alert",
        defaultIntro: `Daily collected revenue at ${name} is currently below the configured daily target threshold.`,
      };
    case "system.operational_alert":
    default:
      return {
        subjectPrefix: `[System Notification] ${name}`,
        heading: "System Notification",
        defaultIntro: `An important system event has been recorded for ${name}.`,
      };
  }
}

/**
 * Renders responsive, HTML-escaped transactional HTML + plain-text email dynamically
 * styled with the target hotel's own branding (logo, colors, name, contact info, footer).
 */
export function renderMultiTenantEmail(
  eventType: MultiTenantEmailEventType,
  brand: HotelBrandContext,
  payload: MultiTenantEmailPayload
): RenderedMultiTenantEmail {
  const defaults = getDefaultMetaForEvent(eventType, brand);
  const heading = payload.title || defaults.heading;
  const intro = payload.intro || defaults.defaultIntro;
  const subject = sanitizeEmailHeaderValue(
    payload.subjectOverride || defaults.subjectPrefix,
    defaults.subjectPrefix
  );
  const cleanWebsite = brand.website ? brand.website.replace(/\/+$/, "") : "";
  const ctaUrl = sanitizeHttpUrl(payload.ctaUrl) || (brand.isPlatformScope ? cleanWebsite : "");
  const ctaLabel = payload.ctaLabel || (brand.isPlatformScope ? "Admin Portal" : "Hotel Website");
  const rows = payload.rows.filter(
    (r) => r && typeof r.label === "string" && typeof r.value === "string" && r.value.trim().length > 0
  );

  const logoBlock = brand.logoUrl
    ? `<div style="margin-bottom: 14px;"><img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.hotelName)}" style="max-height: 48px; max-width: 180px; display: block; border: 0;" /></div>`
    : "";

  const rowsHtml =
    rows.length > 0
      ? `<table width="100%" cellpadding="10" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e4e4e7; border-radius: 6px; font-size: 14px; margin-top: 16px;">
          ${rows
            .map(
              (row, idx) =>
                `<tr style="${idx < rows.length - 1 ? "border-bottom: 1px solid #e4e4e7;" : ""}"><td style="color: #71717a; width: 40%; vertical-align: top;">${escapeHtml(row.label)}</td><td style="color: #18181b; font-weight: 600; vertical-align: top;">${escapeHtml(row.value)}</td></tr>`
            )
            .join("")}
        </table>`
      : "";

  const contactHtmlParts: string[] = [];
  const contactTextParts: string[] = [];
  if (brand.address) {
    contactHtmlParts.push(`<div>Address: ${escapeHtml(brand.address)}</div>`);
    contactTextParts.push(`Address: ${brand.address}`);
  }
  if (brand.phone) {
    contactHtmlParts.push(`<div>Phone: ${escapeHtml(brand.phone)}</div>`);
    contactTextParts.push(`Phone: ${brand.phone}`);
  }
  if (brand.supportEmail) {
    contactHtmlParts.push(`<div>Email: ${escapeHtml(brand.supportEmail)}</div>`);
    contactTextParts.push(`Email: ${brand.supportEmail}`);
  }

  const contactHtml =
    contactHtmlParts.length > 0
      ? `<div style="margin-top: 22px; padding-top: 16px; border-top: 1px solid #e4e4e7; font-size: 13px; color: #52525b; line-height: 1.5;"><strong style="color: #18181b;">${escapeHtml(brand.hotelName)} Contact</strong>${contactHtmlParts.join("")}</div>`
      : "";

  const footerNoteHtml = brand.footerNotes
    ? `<p style="margin: 14px 0 0; font-size: 12px; color: #71717a; line-height: 1.5;">${escapeHtml(brand.footerNotes)}</p>`
    : "";

  const greetingHtml = payload.recipientName
    ? `<p style="margin: 0 0 14px; font-size: 14px; line-height: 1.6;">Hello ${escapeHtml(payload.recipientName)},</p>`
    : "";

  const noteHtml = payload.note
    ? `<p style="margin: 18px 0 0; font-size: 13px; color: #52525b; line-height: 1.6;">${escapeHtml(payload.note)}</p>`
    : "";

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 24px 12px; background-color: #f4f4f5; font-family: Arial, Helvetica, sans-serif; color: #18181b;">
  <div style="max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; overflow: hidden;">
    <div style="height: 5px; background-color: ${escapeHtml(brand.primaryColor)};"></div>
    <div style="padding: 28px;">
      ${logoBlock}
      <div style="font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: ${escapeHtml(brand.primaryColor)}; margin-bottom: 6px;">${escapeHtml(brand.hotelName)}</div>
      <h2 style="margin: 0 0 16px; font-size: 20px; color: ${escapeHtml(brand.secondaryColor)};">${escapeHtml(heading)}</h2>
      ${greetingHtml}
      <p style="margin: 0 0 12px; font-size: 14px; line-height: 1.6; color: #27272a;">${escapeHtml(intro)}</p>
      ${rowsHtml}
      ${noteHtml}
      ${ctaUrl ? `<p style="margin: 22px 0 0; font-size: 14px;">${escapeHtml(ctaLabel)}: <a href="${escapeHtml(ctaUrl)}" style="color: ${escapeHtml(brand.primaryColor)}; text-decoration: underline;">${escapeHtml(ctaUrl)}</a></p>` : ""}
      ${contactHtml}
      ${footerNoteHtml}
    </div>
  </div>
</body>
</html>`;

  const textLines: string[] = [
    `${heading} - ${brand.hotelName}`,
    "",
    ...(payload.recipientName ? [`Hello ${payload.recipientName},`, ""] : []),
    intro,
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(payload.note ? ["", payload.note] : []),
    ...(ctaUrl ? ["", `${ctaLabel}: ${ctaUrl}`] : []),
    ...(contactTextParts.length > 0 ? ["", `${brand.hotelName} Contact:`, ...contactTextParts] : []),
    ...(brand.footerNotes ? ["", brand.footerNotes] : []),
  ];

  return {
    subject,
    html,
    text: textLines.join("\n").trim(),
    fromName: brand.senderDisplayName,
    replyTo: brand.replyTo,
  };
}

/**
 * Verifies Resend (Svix) webhook HMAC-SHA256 signatures.
 * Spec: signed_content = `${svix-id}.${svix-timestamp}.${rawBody}`;
 * secret starts with `whsec_` followed by base64 key material.
 */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  webhookSecret: string,
  toleranceSeconds = 300
): { valid: boolean; error?: string } {
  const getHeader = (name: string): string => {
    const val = headers[name] ?? headers[name.toLowerCase()];
    if (Array.isArray(val)) return String(val[0] || "").trim();
    return typeof val === "string" ? val.trim() : "";
  };

  const svixId = getHeader("svix-id");
  const svixTimestamp = getHeader("svix-timestamp");
  const svixSignature = getHeader("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return { valid: false, error: "Missing required Svix webhook signature headers." };
  }

  const tsNum = Number(svixTimestamp);
  if (!Number.isFinite(tsNum)) {
    return { valid: false, error: "Invalid svix-timestamp header." };
  }

  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - tsNum) > toleranceSeconds) {
    return { valid: false, error: "Webhook timestamp outside allowed replay window." };
  }

  const cleanSecret = webhookSecret.trim();
  const base64Key = cleanSecret.startsWith("whsec_")
    ? cleanSecret.slice("whsec_".length)
    : cleanSecret;
  if (!base64Key) {
    return { valid: false, error: "Invalid webhook secret configuration." };
  }

  const keyBytes = Buffer.from(base64Key, "base64");
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const expectedSig = crypto
    .createHmac("sha256", keyBytes)
    .update(signedContent)
    .digest("base64");

  const providedSigs = svixSignature
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const commaIdx = part.indexOf(",");
      return commaIdx >= 0 ? part.slice(commaIdx + 1) : part;
    });

  const expectedBuf = Buffer.from(expectedSig, "utf8");
  for (const sig of providedSigs) {
    const providedBuf = Buffer.from(sig, "utf8");
    if (
      providedBuf.length === expectedBuf.length &&
      crypto.timingSafeEqual(providedBuf, expectedBuf)
    ) {
      return { valid: true };
    }
  }

  return { valid: false, error: "Webhook signature verification failed." };
}

/**
 * Bounded, tenant-isolated server-side email delivery log registry.
 */
export function recordEmailDeliveryLog(entry: EmailDeliveryLogEntry): void {
  if (emailLogStore.size >= MAX_EMAIL_LOGS) {
    const oldestKey = emailLogStore.keys().next().value;
    if (oldestKey) {
      const oldest = emailLogStore.get(oldestKey);
      if (oldest?.messageId) messageIdToLogId.delete(oldest.messageId);
      emailLogStore.delete(oldestKey);
    }
  }
  emailLogStore.set(entry.logId, entry);
  if (entry.messageId) {
    messageIdToLogId.set(entry.messageId, entry.logId);
  }
}

export function updateEmailDeliveryStatusFromWebhook(params: {
  webhookType: string;
  messageId?: string;
  tags?: Record<string, string>;
  eventTimestamp?: string;
}): EmailDeliveryLogEntry | null {
  const statusMap: Record<string, EmailDeliveryLogEntry["status"]> = {
    "email.sent": "sent",
    "email.delivered": "delivered",
    "email.delivery_delayed": "delivery_delayed",
    "email.bounced": "bounced",
    "email.complained": "complained",
    "email.opened": "opened",
    "email.clicked": "clicked",
  };
  const mappedStatus = statusMap[params.webhookType];
  if (!mappedStatus) return null;

  const now = params.eventTimestamp || new Date().toISOString();
  const matchedLogId =
    (params.tags?.logId && emailLogStore.has(params.tags.logId) ? params.tags.logId : undefined) ||
    (params.messageId ? messageIdToLogId.get(params.messageId) : undefined);

  if (matchedLogId) {
    const existing = emailLogStore.get(matchedLogId);
    if (existing) {
      const updated: EmailDeliveryLogEntry = {
        ...existing,
        status: mappedStatus,
        updatedAt: now,
        webhookEvents: [
          ...(existing.webhookEvents || []).slice(-19),
          { type: params.webhookType, at: now },
        ],
      };
      emailLogStore.set(matchedLogId, updated);
      return updated;
    }
  }

  // If server restarted since send, reconstruct tenant-isolated record from Resend tags
  const taggedHotelId = params.tags?.hotelId;
  if (taggedHotelId && params.messageId) {
    const reconstructed: EmailDeliveryLogEntry = {
      logId: params.tags?.logId || `wh_${params.messageId}`,
      hotelId: taggedHotelId,
      eventType: params.tags?.eventType || "unknown",
      audience: (params.tags?.audience as EmailRecipientAudience) || "guest",
      recipients: [],
      subject: "",
      reservationId: params.tags?.reservationId,
      guestId: params.tags?.guestId,
      provider: "resend",
      messageId: params.messageId,
      status: mappedStatus,
      createdAt: now,
      updatedAt: now,
      webhookEvents: [{ type: params.webhookType, at: now }],
    };
    recordEmailDeliveryLog(reconstructed);
    return reconstructed;
  }

  return null;
}

export function getTenantEmailLogs(hotelId: string, limit = 100): EmailDeliveryLogEntry[] {
  const safeLimit = Math.max(1, Math.min(200, limit));
  const out: EmailDeliveryLogEntry[] = [];
  for (const entry of emailLogStore.values()) {
    if (entry.hotelId === hotelId) {
      out.push(entry);
    }
  }
  return out
    .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
    .slice(0, safeLimit);
}

export function clearEmailLogStoreForTest(): void {
  emailLogStore.clear();
  messageIdToLogId.clear();
}
