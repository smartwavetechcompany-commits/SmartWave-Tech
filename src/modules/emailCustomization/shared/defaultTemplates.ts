import {
  ALLOWED_TEMPLATE_VARIABLES,
  type AllowedTemplateVariable,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailTemplateBranding,
  type EmailTemplateVariant,
  type EventCatalogEntry,
  type SupportedEmailLanguage,
} from "./types.ts";

const COMMON_HOTEL_VARS: AllowedTemplateVariable[] = [
  "hotel_name",
  "hotel_phone",
  "hotel_address",
  "hotel_email",
  "hotel_website",
  "legal_imprint",
];

const GUEST_STAY_VARS: AllowedTemplateVariable[] = [
  "guest_name",
  "guest_first_name",
  ...COMMON_HOTEL_VARS,
  "room_name",
  "room_number",
  "room_type",
  "check_in_date",
  "check_in_time",
  "check_out_date",
  "check_out_time",
  "nights",
  "booking_reference",
  "reservation_number",
  "total_amount",
  "original_amount",
  "discount_amount",
  "amount_paid",
  "deposit_amount",
  "balance_due",
  "remaining_balance",
  "payment_status",
  "loyalty_points_earned",
  "loyalty_points_balance",
  "loyalty_tier",
  "booking_link",
  "portal_link",
  "review_link",
  "directions_link",
  "wifi_guide_link",
  "social_instagram",
  "social_facebook",
  "social_x",
  "social_linkedin",
];

const BILLING_VARS: AllowedTemplateVariable[] = [
  "guest_name",
  "guest_first_name",
  ...COMMON_HOTEL_VARS,
  "room_name",
  "room_number",
  "booking_reference",
  "reservation_number",
  "total_amount",
  "original_amount",
  "discount_amount",
  "amount_paid",
  "deposit_amount",
  "deposit_balance",
  "refund_amount",
  "balance_due",
  "remaining_balance",
  "payment_status",
  "payment_method",
  "transaction_reference",
  "transaction_date",
  "reason",
  "corporate_name",
];

const LOYALTY_VARS: AllowedTemplateVariable[] = [
  "guest_name",
  "guest_first_name",
  ...COMMON_HOTEL_VARS,
  "loyalty_points",
  "loyalty_points_earned",
  "loyalty_points_balance",
  "points_balance",
  "loyalty_tier",
  "previous_tier",
  "redemption_value",
  "expiry_date",
  "transaction_date",
  "reason",
];

const CORPORATE_VARS: AllowedTemplateVariable[] = [
  "corporate_name",
  "guest_name",
  ...COMMON_HOTEL_VARS,
  "booking_reference",
  "reservation_number",
  "total_amount",
  "amount_paid",
  "balance_due",
  "remaining_balance",
  "payment_method",
  "transaction_reference",
  "transaction_date",
];

const STAFF_OPS_VARS: AllowedTemplateVariable[] = [
  ...COMMON_HOTEL_VARS,
  "staff_name",
  "staff_status",
  "guest_name",
  "room_name",
  "room_number",
  "booking_reference",
  "reservation_number",
  "check_in_date",
  "check_out_date",
  "nights",
  "total_amount",
  "amount_paid",
  "outlet_name",
  "bill_number",
  "issue_summary",
  "priority",
  "reason",
  "transaction_date",
  "action_link",
  "app_url",
];

export const EMAIL_EVENT_CATALOG: Record<CustomizableEmailEventType, EventCatalogEntry> = {
  // ── Guest Stays & Reservations ──
  booking_confirmation: {
    eventType: "booking_confirmation",
    name: "Booking Confirmation",
    description: "Sent immediately when a new reservation is created and confirmed.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "confirmation",
    allowedVariables: GUEST_STAY_VARS,
  },
  booking_modified: {
    eventType: "booking_modified",
    name: "Booking Modified",
    description: "Sent when reservation dates or assigned room are updated.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "modified",
    allowedVariables: GUEST_STAY_VARS,
  },
  booking_cancellation: {
    eventType: "booking_cancellation",
    name: "Booking Cancellation",
    description: "Sent when a reservation transitions to cancelled status.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "cancelled",
    allowedVariables: GUEST_STAY_VARS,
  },
  checked_in: {
    eventType: "checked_in",
    name: "Check-In Confirmation",
    description: "Sent immediately when a guest checks in (including walk-ins checked in directly).",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "checkedIn",
    allowedVariables: GUEST_STAY_VARS,
  },
  checked_out: {
    eventType: "checked_out",
    name: "Check-Out Summary",
    description: "Sent immediately after guest check-out with stay and billing summary.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "checkedOut",
    allowedVariables: GUEST_STAY_VARS,
  },
  pre_arrival_reminder: {
    eventType: "pre_arrival_reminder",
    name: "Pre-Arrival Reminder",
    description: "Sent before check-in date via the scheduled reminder job (configurable days ahead).",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    requiresScheduler: true,
    markerKey: "preArrivalReminder",
    allowedVariables: GUEST_STAY_VARS,
  },
  post_stay_feedback_request: {
    eventType: "post_stay_feedback_request",
    name: "Post-Stay Feedback Request",
    description: "Sent after guest check-out via the scheduled feedback job (configurable days after).",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    requiresScheduler: true,
    markerKey: "postStayFeedback",
    allowedVariables: GUEST_STAY_VARS,
  },
  guest_profile_created: {
    eventType: "guest_profile_created",
    name: "Guest Profile Welcome",
    description: "Sent when a new guest profile is registered in Guest Management.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "guestProfileCreated",
    allowedVariables: ["guest_name", "guest_first_name", ...COMMON_HOTEL_VARS],
  },
  fnb_order_posted: {
    eventType: "fnb_order_posted",
    name: "Restaurant / F&B Folio Charge Notice",
    description: "Sent to the guest when a restaurant or room-service charge is posted to their folio.",
    category: "guest_stays",
    audience: "guest",
    canDisable: true,
    markerKey: "fnbOrderPosted",
    allowedVariables: [
      "guest_name",
      "guest_first_name",
      ...COMMON_HOTEL_VARS,
      "room_name",
      "room_number",
      "outlet_name",
      "bill_number",
      "total_amount",
      "transaction_date",
    ],
  },

  // ── Payments, Deposits, Discounts & Refunds ──
  payment_receipt: {
    eventType: "payment_receipt",
    name: "Payment Confirmation / Receipt",
    description: "Sent when a reservation payment is recorded, showing original amount, discount granted, amount paid, and actual remaining balance.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "paymentReceipt",
    allowedVariables: BILLING_VARS,
  },
  deposit_received: {
    eventType: "deposit_received",
    name: "Guest Account Deposit Received",
    description: "Sent immediately to the guest after a successful deposit into their guest deposit wallet.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "depositReceived",
    allowedVariables: BILLING_VARS,
  },
  refund_processed: {
    eventType: "refund_processed",
    name: "Refund Processed Confirmation",
    description: "Sent to the guest (and finance copy) when a folio or deposit refund is completed.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "refundProcessed",
    allowedVariables: BILLING_VARS,
  },
  invoice_issued: {
    eventType: "invoice_issued",
    name: "Folio Invoice Statement",
    description: "Sent when a guest or corporate folio invoice statement is issued.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "invoiceIssued",
    allowedVariables: BILLING_VARS,
  },
  receipt_sent: {
    eventType: "receipt_sent",
    name: "Official Payment Receipt",
    description: "Sent when an official receipt is dispatched to a guest.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "receiptSent",
    allowedVariables: BILLING_VARS,
  },
  discount_settlement_confirmation: {
    eventType: "discount_settlement_confirmation",
    name: "Discount & Full Settlement Confirmation",
    description: "Sent when a discounted reservation balance is fully settled, clearly showing original charge, discount granted, amount paid, and zero balance.",
    category: "payments_billing",
    audience: "guest",
    canDisable: true,
    markerKey: "discountSettlement",
    allowedVariables: BILLING_VARS,
  },

  // ── Guest Loyalty & Rewards ──
  loyalty_account_activated: {
    eventType: "loyalty_account_activated",
    name: "Loyalty Account Activated",
    description: "Sent when a guest's Loyalty & Rewards membership is activated.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyActivated",
    allowedVariables: LOYALTY_VARS,
  },
  loyalty_points_awarded: {
    eventType: "loyalty_points_awarded",
    name: "Loyalty Points Awarded",
    description: "Sent when loyalty points are credited to a guest's account.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyAwarded",
    allowedVariables: LOYALTY_VARS,
  },
  loyalty_points_deducted: {
    eventType: "loyalty_points_deducted",
    name: "Loyalty Points Adjusted / Deducted",
    description: "Sent when a loyalty points adjustment or deduction is recorded.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyDeducted",
    allowedVariables: LOYALTY_VARS,
  },
  loyalty_points_redeemed: {
    eventType: "loyalty_points_redeemed",
    name: "Loyalty Points Redeemed",
    description: "Sent when a guest redeems loyalty points for stay value or rewards.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyRedeemed",
    allowedVariables: LOYALTY_VARS,
  },
  loyalty_tier_upgraded: {
    eventType: "loyalty_tier_upgraded",
    name: "Loyalty Membership Level Upgraded",
    description: "Sent when a guest reaches a higher loyalty membership tier.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyTierUpgraded",
    allowedVariables: LOYALTY_VARS,
  },
  loyalty_points_expiring: {
    eventType: "loyalty_points_expiring",
    name: "Loyalty Points Expiring Reminder",
    description: "Sent to remind guests when loyalty points are approaching expiry.",
    category: "loyalty_rewards",
    audience: "guest",
    canDisable: true,
    markerKey: "loyaltyExpiring",
    allowedVariables: LOYALTY_VARS,
  },

  // ── Corporate & City Ledger ──
  corporate_account_created: {
    eventType: "corporate_account_created",
    name: "Corporate Account Created",
    description: "Sent when a new corporate billing account is established.",
    category: "corporate",
    audience: "corporate",
    canDisable: true,
    markerKey: "corporateCreated",
    allowedVariables: CORPORATE_VARS,
  },
  corporate_city_ledger_transfer: {
    eventType: "corporate_city_ledger_transfer",
    name: "City Ledger Transfer Notice",
    description: "Sent when a guest folio balance is transferred to a corporate City Ledger.",
    category: "corporate",
    audience: "corporate",
    canDisable: true,
    markerKey: "corporateCityLedger",
    allowedVariables: CORPORATE_VARS,
  },
  corporate_payment_settled: {
    eventType: "corporate_payment_settled",
    name: "Corporate Payment Settled",
    description: "Sent when a corporate account payment settlement is recorded.",
    category: "corporate",
    audience: "corporate",
    canDisable: true,
    markerKey: "corporatePaymentSettled",
    allowedVariables: CORPORATE_VARS,
  },
  corporate_low_balance_alert: {
    eventType: "corporate_low_balance_alert",
    name: "Corporate Credit Threshold Alert",
    description: "Internal finance alert when a corporate account reaches its credit monitoring threshold.",
    category: "corporate",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "corporateLowBalance",
    allowedVariables: CORPORATE_VARS,
  },

  // ── Staff & Hotel Operations ──
  no_show: {
    eventType: "no_show",
    name: "No-Show Operations Notice",
    description: "Sent to hotel front desk staff when a reservation is marked as No-Show.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "noShow",
    allowedVariables: GUEST_STAY_VARS,
  },
  staff_account_activation: {
    eventType: "staff_account_activation",
    name: "Staff Account Activation / Invite",
    description: "Sent when a new staff account is created. Always preserves the secure activation link.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: false,
    markerKey: "staffActivation",
    allowedVariables: STAFF_OPS_VARS,
  },
  staff_password_reset: {
    eventType: "staff_password_reset",
    name: "Staff Password Reset Email",
    description: "Sent when an admin triggers a staff password reset. Always preserves the secure reset link.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: false,
    markerKey: "staffPasswordReset",
    allowedVariables: STAFF_OPS_VARS,
  },
  staff_account_status_changed: {
    eventType: "staff_account_status_changed",
    name: "Staff Account Status Update",
    description: "Sent to a staff member when their account status is updated.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "staffStatusChanged",
    allowedVariables: STAFF_OPS_VARS,
  },
  fnb_order_voided: {
    eventType: "fnb_order_voided",
    name: "F&B Order Voided Alert",
    description: "Internal alert sent to management/finance when an F&B order is voided.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "fnbOrderVoided",
    allowedVariables: STAFF_OPS_VARS,
  },
  housekeeping_room_ready: {
    eventType: "housekeeping_room_ready",
    name: "Housekeeping: Room Ready",
    description: "Operational notice when a room passes inspection and is ready for arrival.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "hkRoomReady",
    allowedVariables: STAFF_OPS_VARS,
  },
  housekeeping_inspection_failed: {
    eventType: "housekeeping_inspection_failed",
    name: "Housekeeping: Inspection Failed Alert",
    description: "Operational alert when a room fails housekeeping inspection.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "hkInspectionFailed",
    allowedVariables: STAFF_OPS_VARS,
  },
  housekeeping_guest_request: {
    eventType: "housekeeping_guest_request",
    name: "Housekeeping: Guest Request Logged",
    description: "Operational alert when a new guest housekeeping request is created.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "hkGuestRequest",
    allowedVariables: STAFF_OPS_VARS,
  },
  maintenance_issue_reported: {
    eventType: "maintenance_issue_reported",
    name: "Maintenance: New Issue Reported",
    description: "Operational alert when a new maintenance ticket is logged.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "maintReported",
    allowedVariables: STAFF_OPS_VARS,
  },
  maintenance_issue_resolved: {
    eventType: "maintenance_issue_resolved",
    name: "Maintenance: Issue Completed",
    description: "Operational update when a maintenance ticket is marked resolved.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "maintResolved",
    allowedVariables: STAFF_OPS_VARS,
  },
  guest_blacklisted: {
    eventType: "guest_blacklisted",
    name: "Compliance: Guest Restricted (DNR)",
    description: "Internal compliance alert when a guest profile is flagged or restricted.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "guestBlacklisted",
    allowedVariables: STAFF_OPS_VARS,
  },
  daily_revenue_deficit_alert: {
    eventType: "daily_revenue_deficit_alert",
    name: "Finance: Daily Revenue Deficit Alert",
    description: "Internal alert when daily collected revenue is below the configured daily target.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "dailyRevenueDeficit",
    allowedVariables: STAFF_OPS_VARS,
  },
  operational_alert: {
    eventType: "operational_alert",
    name: "System Operational Alert",
    description: "General operational alert dispatched to hotel administrators.",
    category: "staff_operations",
    audience: "hotel_staff",
    canDisable: true,
    markerKey: "operationalAlert",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
};

export function createDefaultBranding(overrides?: Partial<EmailTemplateBranding>): EmailTemplateBranding {
  return {
    accentBarEnabled: true,
    accentBarColor: overrides?.accentBarColor || "#059669",
    accentBarThicknessPx: 5,
    showEyebrow: true,
    eyebrowText: "{{hotel_name}}",
    primaryColor: overrides?.primaryColor || "#059669",
    secondaryColor: overrides?.secondaryColor || "#18181b",
    buttonColor: overrides?.buttonColor || overrides?.primaryColor || "#059669",
    buttonTextColor: "#ffffff",
    fontFamily: "arial",
    showLogo: true,
    logoUrl: overrides?.logoUrl || "",
    logoAlt: "{{hotel_name}}",
    logoWidthPx: 160,
  };
}

function defaultContactFooter(lang: SupportedEmailLanguage): EmailBlock {
  return {
    id: "blk_footer",
    type: "footer",
    showContactBlock: true,
    contactTitle: lang === "de" ? "{{hotel_name}} Kontakt" : "{{hotel_name}} Contact",
    fields: [
      { id: "cf_address", key: "address", label: lang === "de" ? "Adresse" : "Address", valueTemplate: "{{hotel_address}}", visible: true },
      { id: "cf_phone", key: "phone", label: lang === "de" ? "Telefon" : "Phone", valueTemplate: "{{hotel_phone}}", visible: true },
      { id: "cf_email", key: "email", label: "Email", valueTemplate: "{{hotel_email}}", visible: true },
      { id: "cf_website", key: "website", label: lang === "de" ? "Webseite" : "Website", valueTemplate: "{{hotel_website}}", visible: true },
    ],
    legalImprintText: "",
    footerNote: "",
  };
}

function makeSimpleVariant(params: {
  branding: EmailTemplateBranding;
  language: SupportedEmailLanguage;
  subject: string;
  preheader: string;
  heading: string;
  greeting?: string;
  intro: string;
  rows: Array<{ id: string; label: string; valueTemplate: string }>;
  note?: string;
  actionButton?: { label: string; url: string };
}): EmailTemplateVariant {
  const blocks: EmailBlock[] = [
    {
      id: "blk_heading",
      type: "heading",
      level: 2,
      text: params.heading,
      align: "left",
    },
  ];
  if (params.greeting) {
    blocks.push({
      id: "blk_greeting",
      type: "paragraph",
      text: params.greeting,
      align: "left",
      tone: "default",
    });
  }
  blocks.push({
    id: "blk_intro",
    type: "paragraph",
    text: params.intro,
    align: "left",
    tone: "default",
  });
  if (params.rows.length > 0) {
    blocks.push({
      id: "blk_table",
      type: "booking_details_table",
      rows: params.rows.map((r) => ({ ...r, visible: true })),
    });
  }
  if (params.actionButton) {
    blocks.push({
      id: "blk_action_btn",
      type: "button",
      displayStyle: "solid",
      label: params.actionButton.label,
      url: params.actionButton.url,
      align: "left",
    });
  }
  if (params.note) {
    blocks.push({
      id: "blk_note",
      type: "paragraph",
      text: params.note,
      align: "left",
      tone: "muted",
    });
  }
  blocks.push(defaultContactFooter(params.language));

  return {
    subject: params.subject,
    preheader: params.preheader,
    branding: params.branding,
    blocks,
  };
}

/**
 * Builds clean, hotel-branded default templates for EVERY customizable PMS email event.
 * - Guest-facing templates NEVER auto-append internal PMS URLs.
 * - Financial templates clearly distinguish original charge, discount granted, amount paid, and actual remaining balance.
 * - Security templates (staff activation / password reset) preserve {{action_link}}.
 */
export function buildDefaultTemplateVariant(
  eventType: CustomizableEmailEventType,
  language: SupportedEmailLanguage = "en",
  brandingOverrides?: Partial<EmailTemplateBranding>
): EmailTemplateVariant {
  const branding = createDefaultBranding(brandingOverrides);
  const isDe = language === "de";

  switch (eventType) {
    case "booking_confirmation":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Buchungsbestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Booking Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde bestätigt."
          : "Your reservation at {{hotel_name}} has been confirmed.",
        heading: isDe ? "Buchungsbestätigung" : "Booking Confirmation",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde bestätigt. Bitte überprüfen Sie unten Ihre Aufenthaltsdaten."
          : "Your reservation at {{hotel_name}} has been confirmed. Please review your stay details below.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
          { id: "row_total", label: isDe ? "Gesamtbetrag" : "Total Amount", valueTemplate: "{{total_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
        ],
      });

    case "checked_in":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Check-In-Bestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Check-In Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Willkommen im {{hotel_name}}. Ihr Check-in ist abgeschlossen."
          : "You have been checked in at {{hotel_name}}.",
        heading: isDe ? "Willkommen & Check-In-Bestätigung" : "Welcome & Check-In Confirmation",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Sie wurden im {{hotel_name}} eingecheckt. Unten finden Sie Ihre Aufenthaltsübersicht."
          : "You have been checked in at {{hotel_name}}. Below is your stay summary for reference.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
        ],
      });

    case "checked_out":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Vielen Dank & Check-Out-Übersicht - {{hotel_name}} ({{booking_reference}})"
          : "Thank You & Check-Out Summary - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihr Check-out im {{hotel_name}} ist abgeschlossen."
          : "Your check-out at {{hotel_name}} is complete.",
        heading: isDe ? "Vielen Dank für Ihren Aufenthalt" : "Thank You for Staying With Us",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihr Check-out im {{hotel_name}} ist abgeschlossen. Unten finden Sie eine Zusammenfassung Ihres Aufenthalts."
          : "Your check-out at {{hotel_name}} is complete. Below is a summary of your stay and final settlement.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
          { id: "row_orig", label: isDe ? "Ursprünglicher Betrag" : "Original Amount", valueTemplate: "{{original_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Paid", valueTemplate: "{{amount_paid}}" },
          { id: "row_balance", label: isDe ? "Restbetrag" : "Remaining Balance", valueTemplate: "{{remaining_balance}}" },
          { id: "row_status", label: isDe ? "Zahlungsstatus" : "Payment Status", valueTemplate: "{{payment_status}}" },
        ],
        note: isDe
          ? "Vielen Dank, dass Sie bei uns waren. Wir freuen uns darauf, Sie bald wieder begrüßen zu dürfen."
          : "Thank you for choosing us. We look forward to welcoming you again.",
      });

    case "booking_cancellation":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Stornierungsbestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Booking Cancellation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde storniert."
          : "Your reservation at {{hotel_name}} has been cancelled.",
        heading: isDe ? "Stornierungsbestätigung" : "Booking Cancellation Notice",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde storniert. Die stornierten Buchungsdetails sind unten aufgeführt."
          : "Your reservation at {{hotel_name}} has been cancelled. Cancelled booking details are listed below.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
        ],
        note: isDe
          ? "Falls diese Stornierung unerwartet war, kontaktieren Sie das Hotel bitte direkt."
          : "If this cancellation was unexpected, please contact the hotel directly.",
      });

    case "booking_modified":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Aktualisierte Buchungsdetails - {{hotel_name}} ({{booking_reference}})"
          : "Booking Update Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde aktualisiert."
          : "Your reservation details at {{hotel_name}} have been updated.",
        heading: isDe ? "Reservierung aktualisiert" : "Reservation Updated",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde geändert. Unten finden Sie Ihre aktuellen Aufenthaltsdaten."
          : "Your reservation at {{hotel_name}} has been modified. Please review your updated stay details below.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
          { id: "row_total", label: isDe ? "Gesamtbetrag" : "Total Amount", valueTemplate: "{{total_amount}}" },
        ],
      });

    case "pre_arrival_reminder":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Wir freuen uns auf Ihre Anreise - {{hotel_name}} ({{booking_reference}})"
          : "Pre-Arrival Reminder - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihr Aufenthalt im {{hotel_name}} beginnt am {{check_in_date}}."
          : "Your upcoming stay at {{hotel_name}} starts on {{check_in_date}}.",
        heading: isDe ? "Wir freuen uns auf Sie" : "We Look Forward to Welcoming You",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihr Aufenthalt im {{hotel_name}} steht kurz bevor. Hier sind die wichtigsten Details für eine reibungslose Anreise."
          : "Your upcoming stay at {{hotel_name}} is just around the corner. Here are your reservation details ahead of arrival.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_balance", label: isDe ? "Offener Betrag" : "Remaining Balance", valueTemplate: "{{remaining_balance}}" },
        ],
      });

    case "post_stay_feedback_request":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Wie war Ihr Aufenthalt im {{hotel_name}}?"
          : "How Was Your Stay at {{hotel_name}}?",
        preheader: isDe
          ? "Vielen Dank für Ihren Besuch im {{hotel_name}}. Wir freuen uns über Ihr Feedback."
          : "Thank you for staying with {{hotel_name}}. Share your feedback with us.",
        heading: isDe ? "Vielen Dank für Ihren Besuch" : "Thank You for Visiting {{hotel_name}}",
        greeting: isDe ? "Hallo {{guest_first_name}}," : "Hello {{guest_first_name}},",
        intro: isDe
          ? "Wir hoffen, Sie hatten einen angenehmen Aufenthalt im {{hotel_name}}. Ihre Rückmeldung hilft uns, unseren Service weiter zu verbessern."
          : "We hope you enjoyed your recent stay at {{hotel_name}}. We would appreciate a brief moment to hear about your experience.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}}" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}}" },
        ],
      });

    case "guest_profile_created":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Willkommen bei {{hotel_name}}"
          : "Welcome to {{hotel_name}} – Guest Profile Created",
        preheader: isDe
          ? "Ihr Gästeprofil bei {{hotel_name}} wurde erstellt."
          : "Your guest profile has been registered with {{hotel_name}}.",
        heading: isDe ? "Gästeprofil erstellt" : "Welcome to {{hotel_name}}",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihr Gästeprofil bei {{hotel_name}} wurde erfolgreich angelegt. Wir freuen uns, Sie bald willkommen zu heißen."
          : "Your guest profile has been registered with {{hotel_name}}. We look forward to hosting you.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
        ],
      });

    case "fnb_order_posted":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Restaurant- & F&B-Buchung - {{hotel_name}}"
          : "Restaurant & F&B Charge Notice - {{hotel_name}}",
        preheader: isDe
          ? "Eine Restaurantbuchung wurde Ihrem Zimmerkonto im {{hotel_name}} belastet."
          : "A restaurant or F&B order has been posted to your room folio at {{hotel_name}}.",
        heading: isDe ? "F&B-Bestellung verbucht" : "F&B Order Posted to Folio",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Eine Restaurant- / F&B-Bestellung im {{hotel_name}} wurde Ihrem Zimmerkonto gutgeschrieben."
          : "A restaurant / F&B order at {{hotel_name}} has been posted to your room folio.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_outlet", label: isDe ? "Bereich" : "Outlet", valueTemplate: "{{outlet_name}}" },
          { id: "row_bill", label: isDe ? "Belegnummer" : "Order / Bill #", valueTemplate: "{{bill_number}}" },
          { id: "row_amt", label: isDe ? "Betrag" : "Amount Posted", valueTemplate: "{{total_amount}}" },
        ],
      });

    // ── Payments, Deposits, Discounts & Refunds ──
    case "payment_receipt":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Zahlungsbeleg - {{hotel_name}} ({{booking_reference}})"
          : "Payment Receipt - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Vielen Dank für Ihre Zahlung im {{hotel_name}}."
          : "Thank you for your payment at {{hotel_name}}.",
        heading: isDe ? "Zahlungsbestätigung" : "Payment Received",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Eine Zahlung für Ihren Aufenthalt im {{hotel_name}} wurde verbucht. Unten finden Sie Ihre vollständige Belegübersicht."
          : "A payment has been recorded at {{hotel_name}}. Your receipt and settlement summary is provided below.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_orig", label: isDe ? "Ursprünglicher Betrag" : "Original Amount", valueTemplate: "{{original_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Paid / Settled", valueTemplate: "{{amount_paid}}" },
          { id: "row_method", label: isDe ? "Zahlungsart" : "Payment Method", valueTemplate: "{{payment_method}}" },
          { id: "row_txref", label: isDe ? "Referenz" : "Transaction Reference", valueTemplate: "{{transaction_reference}}" },
          { id: "row_balance", label: isDe ? "Restbetrag" : "Remaining Balance", valueTemplate: "{{remaining_balance}}" },
          { id: "row_status", label: isDe ? "Zahlungsstatus" : "Payment Status", valueTemplate: "{{payment_status}}" },
        ],
      });

    case "deposit_received":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Anzahlung eingegangen – {{hotel_name}}"
          : "Deposit Received – {{hotel_name}}",
        preheader: isDe
          ? "Ihre Einzahlung von {{deposit_amount}} auf Ihr Gästekonto im {{hotel_name}} wurde bestätigt."
          : "Your deposit of {{deposit_amount}} has been credited to your guest account at {{hotel_name}}.",
        heading: isDe ? "Einzahlungsbestätigung" : "Deposit Received",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Vielen Dank! Wir bestätigen den Eingang Ihrer Einzahlung auf Ihr Gästekonto im {{hotel_name}}. Unten finden Sie die Details Ihrer Einzahlung und Ihren aktualisierten Kontostand."
          : "Thank you! We are pleased to confirm that your deposit has been received and credited to your guest account at {{hotel_name}}. Below are your deposit confirmation details.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
          { id: "row_amount", label: isDe ? "Einzahlungsbetrag" : "Deposit Amount", valueTemplate: "{{deposit_amount}}" },
          { id: "row_date", label: isDe ? "Datum" : "Deposit Date", valueTemplate: "{{transaction_date}}" },
          { id: "row_method", label: isDe ? "Zahlungsart" : "Payment Method", valueTemplate: "{{payment_method}}" },
          { id: "row_ref", label: isDe ? "Referenznummer" : "Deposit Reference", valueTemplate: "{{transaction_reference}}" },
          { id: "row_bal", label: isDe ? "Neuer Kontostand" : "Updated Deposit Balance", valueTemplate: "{{deposit_balance}}" },
        ],
        note: isDe
          ? "Ihr Guthaben steht für Ihre aktuellen oder zukünftigen Buchungen im {{hotel_name}} zur Verfügung."
          : "Your deposit balance is available for use toward your current or future stays at {{hotel_name}}.",
      });

    case "refund_processed":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Rückerstattungsbestätigung - {{hotel_name}}"
          : "Refund Processed - {{hotel_name}}",
        preheader: isDe
          ? "Eine Rückerstattung von {{refund_amount}} wurde von {{hotel_name}} verarbeitet."
          : "A refund of {{refund_amount}} has been processed by {{hotel_name}}.",
        heading: isDe ? "Rückerstattung verarbeitet" : "Refund Processed",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Eine Rückerstattung im {{hotel_name}} wurde erfolgreich verarbeitet. Unten finden Sie Ihre Referenzdaten."
          : "A refund has been processed at {{hotel_name}}. Your refund confirmation details are listed below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_amount", label: isDe ? "Rückerstattungsbetrag" : "Refund Amount", valueTemplate: "{{refund_amount}}" },
          { id: "row_method", label: isDe ? "Zahlungsart" : "Refund Method", valueTemplate: "{{payment_method}}" },
          { id: "row_txref", label: isDe ? "Referenz" : "Transaction Reference", valueTemplate: "{{transaction_reference}}" },
          { id: "row_date", label: isDe ? "Datum" : "Date", valueTemplate: "{{transaction_date}}" },
          { id: "row_reason", label: isDe ? "Grund" : "Reason", valueTemplate: "{{reason}}" },
        ],
      });

    case "invoice_issued":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Rechnung ausgestellt - {{hotel_name}} ({{booking_reference}})"
          : "Invoice Issued - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Eine Rechnung von {{hotel_name}} liegt für Sie bereit."
          : "An invoice statement has been issued by {{hotel_name}}.",
        heading: isDe ? "Rechnungsübersicht" : "Folio Invoice Statement",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Eine Rechnungsübersicht wurde von {{hotel_name}} erstellt. Bitte prüfen Sie die nachfolgenden Beträge."
          : "An invoice statement has been issued by {{hotel_name}}. Please review the summary below.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_orig", label: isDe ? "Ursprünglicher Betrag" : "Original Amount", valueTemplate: "{{original_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Paid", valueTemplate: "{{amount_paid}}" },
          { id: "row_balance", label: isDe ? "Restbetrag" : "Remaining Balance", valueTemplate: "{{remaining_balance}}" },
          { id: "row_status", label: isDe ? "Zahlungsstatus" : "Payment Status", valueTemplate: "{{payment_status}}" },
        ],
      });

    case "receipt_sent":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Offizieller Zahlungsbeleg - {{hotel_name}} ({{booking_reference}})"
          : "Official Receipt - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Vielen Dank für Ihre Zahlung im {{hotel_name}}."
          : "Below is your official payment receipt from {{hotel_name}}.",
        heading: isDe ? "Offizieller Zahlungsbeleg" : "Official Payment Receipt",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Vielen Dank für Ihre Zahlung im {{hotel_name}}. Nachfolgend finden Sie Ihren offiziellen Beleg."
          : "Thank you for your payment at {{hotel_name}}. Below is your official receipt summary.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_orig", label: isDe ? "Ursprünglicher Betrag" : "Original Amount", valueTemplate: "{{original_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Paid / Settled", valueTemplate: "{{amount_paid}}" },
          { id: "row_balance", label: isDe ? "Restbetrag" : "Remaining Balance", valueTemplate: "{{remaining_balance}}" },
          { id: "row_status", label: isDe ? "Zahlungsstatus" : "Payment Status", valueTemplate: "{{payment_status}}" },
        ],
      });

    case "discount_settlement_confirmation":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Abrechnungs- & Rabattbestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Settlement & Discount Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihr Konto im {{hotel_name}} ist vollständig ausgeglichen."
          : "Your discounted folio at {{hotel_name}} is fully settled.",
        heading: isDe ? "Vollständige Abrechnung bestätigt" : "Folio Settlement & Discount Summary",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Wir bestätigen Ihre Zahlung sowie den gewährten Rabatt im {{hotel_name}}. Unten finden Sie die genaue Aufschlüsselung."
          : "We confirm your payment and approved discount at {{hotel_name}}. Below is your complete settlement breakdown.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_orig", label: isDe ? "Ursprünglicher Betrag" : "Original Amount", valueTemplate: "{{original_amount}}" },
          { id: "row_discount", label: isDe ? "Gewährter Rabatt" : "Discount Granted", valueTemplate: "{{discount_amount}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Paid / Settled", valueTemplate: "{{amount_paid}}" },
          { id: "row_balance", label: isDe ? "Offener Restbetrag" : "Actual Remaining Balance", valueTemplate: "{{remaining_balance}}" },
          { id: "row_status", label: isDe ? "Zahlungsstatus" : "Payment Status", valueTemplate: "{{payment_status}}" },
        ],
      });

    // ── Guest Loyalty & Rewards ──
    case "loyalty_account_activated":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Willkommen im {{hotel_name}} Treueprogramm"
          : "Welcome to {{hotel_name}} Loyalty & Rewards",
        preheader: isDe
          ? "Ihr Treuekonto bei {{hotel_name}} ist jetzt aktiv."
          : "Your Loyalty & Rewards account at {{hotel_name}} is now active.",
        heading: isDe ? "Ihr Treuekonto ist jetzt aktiv" : "Your Loyalty Account Is Now Active",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Willkommen im {{hotel_name}} Treueprogramm! Ab sofort können Sie Punkte sammeln und exklusive Vorteile genießen."
          : "Welcome to the {{hotel_name}} Loyalty & Rewards programme. You can now earn rewards, track your points balance, and enjoy exclusive membership benefits.",
        rows: [
          { id: "row_guest", label: isDe ? "Mitglied" : "Member Name", valueTemplate: "{{guest_name}}" },
          { id: "row_tier", label: isDe ? "Mitgliedsstufe" : "Membership Level", valueTemplate: "{{loyalty_tier}}" },
          { id: "row_bal", label: isDe ? "Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
          { id: "row_date", label: isDe ? "Aktivierungsdatum" : "Date", valueTemplate: "{{transaction_date}}" },
        ],
      });

    case "loyalty_points_awarded":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Treuepunkte gutgeschrieben - {{hotel_name}}"
          : "Loyalty Points Awarded - {{hotel_name}}",
        preheader: isDe
          ? "{{loyalty_points}} wurden Ihrem Treuekonto im {{hotel_name}} gutgeschrieben."
          : "{{loyalty_points}} credited to your loyalty account at {{hotel_name}}.",
        heading: isDe ? "Treuepunkte gutgeschrieben" : "Loyalty Points Awarded",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Gute Nachrichten! Ihrem Treuekonto im {{hotel_name}} wurden Punkte gutgeschrieben. Unten finden Sie Ihre aktuelle Übersicht."
          : "Great news! Loyalty points have been credited to your rewards account at {{hotel_name}}. Your updated summary is shown below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_pts", label: isDe ? "Gutgeschriebene Punkte" : "Points Awarded", valueTemplate: "{{loyalty_points}}" },
          { id: "row_tier", label: isDe ? "Mitgliedsstufe" : "Membership Level", valueTemplate: "{{loyalty_tier}}" },
          { id: "row_bal", label: isDe ? "Aktueller Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
          { id: "row_date", label: isDe ? "Datum" : "Date", valueTemplate: "{{transaction_date}}" },
          { id: "row_reason", label: isDe ? "Grund" : "Reason", valueTemplate: "{{reason}}" },
        ],
      });

    case "loyalty_points_deducted":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Treuepunkte-Anpassung - {{hotel_name}}"
          : "Loyalty Points Adjustment Notice - {{hotel_name}}",
        preheader: isDe
          ? "Ihr Treuepunktestand im {{hotel_name}} wurde aktualisiert."
          : "A loyalty points adjustment was recorded on your account at {{hotel_name}}.",
        heading: isDe ? "Treuepunkte angepasst" : "Loyalty Points Adjusted",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Auf Ihrem Treuekonto im {{hotel_name}} wurde eine Punkteanpassung vorgenommen. Unten finden Sie Ihren aktuellen Stand."
          : "A loyalty points adjustment has been recorded on your rewards account at {{hotel_name}}. Please review your updated balance below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_pts", label: isDe ? "Angepasste Punkte" : "Points Adjusted", valueTemplate: "{{loyalty_points}}" },
          { id: "row_tier", label: isDe ? "Mitgliedsstufe" : "Membership Level", valueTemplate: "{{loyalty_tier}}" },
          { id: "row_bal", label: isDe ? "Verfügbarer Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
          { id: "row_date", label: isDe ? "Datum" : "Date", valueTemplate: "{{transaction_date}}" },
          { id: "row_reason", label: isDe ? "Grund" : "Reason", valueTemplate: "{{reason}}" },
        ],
      });

    case "loyalty_points_redeemed":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Treuepunkte eingelöst - {{hotel_name}}"
          : "Loyalty Points Redeemed - {{hotel_name}}",
        preheader: isDe
          ? "Ihre Punkteeinlösung im {{hotel_name}} wurde bestätigt."
          : "Your loyalty points redemption at {{hotel_name}} has been confirmed.",
        heading: isDe ? "Bestätigung der Punkteeinlösung" : "Loyalty Points Redemption Confirmation",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ihre Einlösung von Treuepunkten im {{hotel_name}} wurde bestätigt. Unten finden Sie die Details und Ihren verbleibenden Punktestand."
          : "Your loyalty points redemption at {{hotel_name}} has been confirmed. Please review your redemption summary and remaining balance below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_pts", label: isDe ? "Eingelöste Punkte" : "Points Redeemed", valueTemplate: "{{loyalty_points}}" },
          { id: "row_val", label: isDe ? "Einlösewert" : "Redemption Value", valueTemplate: "{{redemption_value}}" },
          { id: "row_tier", label: isDe ? "Mitgliedsstufe" : "Membership Level", valueTemplate: "{{loyalty_tier}}" },
          { id: "row_bal", label: isDe ? "Verbleibender Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
          { id: "row_date", label: isDe ? "Datum" : "Date", valueTemplate: "{{transaction_date}}" },
          { id: "row_reason", label: isDe ? "Verwendung" : "Details", valueTemplate: "{{reason}}" },
        ],
      });

    case "loyalty_tier_upgraded":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Glückwunsch zum Status-Upgrade - {{hotel_name}}"
          : "Congratulations on Your Membership Upgrade - {{hotel_name}}",
        preheader: isDe
          ? "Sie haben die Mitgliedsstufe {{loyalty_tier}} im {{hotel_name}} erreicht."
          : "You have reached {{loyalty_tier}} membership at {{hotel_name}}.",
        heading: isDe ? "Mitgliedsstufe aufgewertet" : "Membership Level Upgraded",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Herzlichen Glückwunsch! Sie haben eine neue Treuestufe im {{hotel_name}} erreicht."
          : "Congratulations! You have reached a new loyalty membership level at {{hotel_name}}. Review your upgraded tier details below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_prev", label: isDe ? "Vorherige Stufe" : "Previous Level", valueTemplate: "{{previous_tier}}" },
          { id: "row_tier", label: isDe ? "Neue Stufe" : "New Membership Level", valueTemplate: "{{loyalty_tier}}" },
          { id: "row_bal", label: isDe ? "Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
          { id: "row_date", label: isDe ? "Datum" : "Date", valueTemplate: "{{transaction_date}}" },
        ],
      });

    case "loyalty_points_expiring":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Erinnerung: Ihre Treuepunkte verfallen bald - {{hotel_name}}"
          : "Reminder: Your Loyalty Points Are Approaching Expiry - {{hotel_name}}",
        preheader: isDe
          ? "Einige Ihrer Treuepunkte im {{hotel_name}} verfallen bald."
          : "Some of your loyalty points at {{hotel_name}} are approaching their expiry date.",
        heading: isDe ? "Treuepunkte laufen bald ab" : "Loyalty Points Approaching Expiry",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Einige Ihrer Treuepunkte im {{hotel_name}} nähern sich dem Ablaufdatum. Lösen Sie Ihre Punkte rechtzeitig ein."
          : "Some of your loyalty points at {{hotel_name}} are approaching their expiry date. Review your points summary below so you don't miss out on your rewards.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_pts", label: isDe ? "Verfallende Punkte" : "Expiring Points", valueTemplate: "{{loyalty_points}}" },
          { id: "row_exp", label: isDe ? "Ablaufdatum" : "Expiry Date", valueTemplate: "{{expiry_date}}" },
          { id: "row_bal", label: isDe ? "Aktueller Punktestand" : "Available Points Balance", valueTemplate: "{{points_balance}}" },
        ],
      });

    // ── Corporate & City Ledger ──
    case "corporate_account_created":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Firmenkonto eingerichtet - {{hotel_name}}"
          : "Corporate Account Established - {{hotel_name}}",
        preheader: isDe
          ? "Ein Firmenkonto für {{corporate_name}} wurde eingerichtet."
          : "A corporate billing account has been established with {{hotel_name}}.",
        heading: isDe ? "Firmenkonto erstellt" : "Corporate Account Created",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ein Firmen-Abrechnungskonto für {{corporate_name}} wurde im {{hotel_name}} eingerichtet."
          : "A corporate billing account for {{corporate_name}} has been established with {{hotel_name}}.",
        rows: [
          { id: "row_corp", label: isDe ? "Firmenkonto" : "Corporate Account", valueTemplate: "{{corporate_name}}" },
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
          { id: "row_bal", label: isDe ? "Aktueller Saldo" : "Current Balance", valueTemplate: "{{remaining_balance}}" },
        ],
      });

    case "corporate_city_ledger_transfer":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "City-Ledger-Übertragung - {{hotel_name}}"
          : "City Ledger Transfer Notice - {{hotel_name}}",
        preheader: isDe
          ? "Ein Foliosaldo wurde auf das Firmenkonto {{corporate_name}} übertragen."
          : "A folio balance has been transferred to your corporate City Ledger at {{hotel_name}}.",
        heading: isDe ? "Saldo auf City Ledger übertragen" : "Balance Transferred to City Ledger",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Ein Foliosaldo wurde im {{hotel_name}} auf das Firmenkonto {{corporate_name}} übertragen."
          : "A folio balance has been transferred to the corporate City Ledger at {{hotel_name}}.",
        rows: [
          { id: "row_corp", label: isDe ? "Firmenkonto" : "Corporate Account", valueTemplate: "{{corporate_name}}" },
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_amt", label: isDe ? "Übertragener Betrag" : "Transfer Amount", valueTemplate: "{{total_amount}}" },
          { id: "row_bal", label: isDe ? "Aktueller Saldo" : "Current Balance", valueTemplate: "{{remaining_balance}}" },
        ],
      });

    case "corporate_payment_settled":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Firmenzahlung verbucht - {{hotel_name}}"
          : "Corporate Payment Settlement - {{hotel_name}}",
        preheader: isDe
          ? "Eine Firmenzahlung wurde im {{hotel_name}} verbucht."
          : "A corporate account payment settlement has been recorded at {{hotel_name}}.",
        heading: isDe ? "Firmenzahlung ausgeglichen" : "Corporate Account Payment Settled",
        greeting: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
        intro: isDe
          ? "Eine Zahlung für das Firmenkonto {{corporate_name}} wurde im {{hotel_name}} verbucht."
          : "A corporate account payment settlement has been recorded at {{hotel_name}}.",
        rows: [
          { id: "row_corp", label: isDe ? "Firmenkonto" : "Corporate Account", valueTemplate: "{{corporate_name}}" },
          { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Amount Settled", valueTemplate: "{{amount_paid}}" },
          { id: "row_method", label: isDe ? "Zahlungsart" : "Payment Method", valueTemplate: "{{payment_method}}" },
          { id: "row_txref", label: isDe ? "Referenz" : "Invoice / Reference", valueTemplate: "{{transaction_reference}}" },
          { id: "row_bal", label: isDe ? "Restbetrag" : "Current Balance", valueTemplate: "{{remaining_balance}}" },
        ],
      });

    case "corporate_low_balance_alert":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Finanz-Hinweis] Firmenkonto-Kreditlimit - {{hotel_name}}"
          : "[Finance Alert] Corporate Credit Threshold Warning - {{hotel_name}}",
        preheader: isDe
          ? "Das Firmenkonto {{corporate_name}} hat den konfigurierten Schwellenwert erreicht."
          : "Corporate account {{corporate_name}} has crossed its configured credit monitoring threshold.",
        heading: isDe ? "Firmenkonto-Kreditwarnung" : "Corporate Available Credit Alert",
        intro: isDe
          ? "Das Firmenkonto {{corporate_name}} im {{hotel_name}} hat den konfigurierten Überwachungsschwellenwert erreicht."
          : "A corporate account at {{hotel_name}} has crossed its configured credit monitoring threshold.",
        rows: [
          { id: "row_corp", label: isDe ? "Firmenkonto" : "Corporate Account", valueTemplate: "{{corporate_name}}" },
          { id: "row_bal", label: isDe ? "Aktueller Saldo" : "Current Balance", valueTemplate: "{{remaining_balance}}" },
        ],
      });

    // ── Staff & Hotel Operations ──
    case "no_show":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Betrieb] No-Show erfasst - {{hotel_name}} ({{booking_reference}})"
          : "[Operations] Reservation No-Show - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Eine Reservierung im {{hotel_name}} wurde als No-Show markiert."
          : "A reservation at {{hotel_name}} has been marked as a no-show.",
        heading: isDe ? "Reservierung als No-Show markiert" : "Reservation Marked as No-Show",
        intro: isDe
          ? "Eine Reservierung im {{hotel_name}} wurde als No-Show markiert und der Zimmerbestand wurde aktualisiert."
          : "A reservation at {{hotel_name}} has been marked as a no-show and room inventory has been updated.",
        rows: [
          { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}" },
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})" },
          { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})" },
          { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}" },
        ],
      });

    case "staff_account_activation":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[AKTION ERFORDERLICH] Aktivieren Sie Ihr Mitarbeiterkonto - {{hotel_name}}"
          : "[ACTION REQUIRED] Activate Your Staff Account - {{hotel_name}}",
        preheader: isDe
          ? "Aktivieren Sie Ihr Mitarbeiterkonto für {{hotel_name}}."
          : "Complete your staff account activation for {{hotel_name}}.",
        heading: isDe ? "Kontoaktivierung" : "Staff Account Activation",
        greeting: isDe ? "Hallo {{staff_name}}," : "Hello {{staff_name}},",
        intro: isDe
          ? "Ihr Mitarbeiterkonto für {{hotel_name}} wurde erstellt. Bitte klicken Sie auf die Schaltfläche unten, um Ihr Passwort festzulegen und Ihr Konto zu aktivieren."
          : "Your staff account for {{hotel_name}} has been created. Please use the secure button below to set your password and activate your account.",
        rows: [
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
          { id: "row_staff", label: isDe ? "Mitarbeiter" : "Staff Member", valueTemplate: "{{staff_name}}" },
        ],
        actionButton: {
          label: isDe ? "Konto aktivieren" : "Activate Staff Account",
          url: "{{action_link}}",
        },
        note: isDe
          ? "Aus Sicherheitsgründen ist dieser Aktivierungslink zeitlich begrenzt."
          : "For security, this activation link expires automatically. If you did not expect this email, contact your Hotel Administrator.",
      });

    case "staff_password_reset":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[AKTION ERFORDERLICH] Passwort zurücksetzen - {{hotel_name}}"
          : "[ACTION REQUIRED] Password Reset Request - {{hotel_name}}",
        preheader: isDe
          ? "Verwenden Sie diesen sicheren Link, um Ihr Passwort für {{hotel_name}} zurückzusetzen."
          : "Use this secure link to reset your password for {{hotel_name}}.",
        heading: isDe ? "Passwort zurücksetzen" : "Password Reset Request",
        greeting: isDe ? "Hallo {{staff_name}}," : "Hello {{staff_name}},",
        intro: isDe
          ? "Ein Administrator hat eine Passwortzurücksetzung für Ihr Konto bei {{hotel_name}} angefordert. Klicken Sie unten, um ein neues Passwort festzulegen."
          : "An administrator has initiated a password reset for your account at {{hotel_name}}. Click the secure button below to set your new password.",
        rows: [
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
          { id: "row_staff", label: isDe ? "Konto" : "Account", valueTemplate: "{{staff_name}}" },
        ],
        actionButton: {
          label: isDe ? "Neues Passwort festlegen" : "Reset Password",
          url: "{{action_link}}",
        },
        note: isDe
          ? "Falls Sie diese Anfrage nicht erwartet haben, wenden Sie sich bitte umgehend an Ihren Hotel-Administrator."
          : "If you did not expect this password reset request, please notify your Hotel Administrator immediately.",
      });

    case "staff_account_status_changed":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "Statusänderung Ihres Mitarbeiterkontos - {{hotel_name}}"
          : "Staff Account Status Update - {{hotel_name}}",
        preheader: isDe
          ? "Ihr Mitarbeiterkonto-Status im {{hotel_name}} wurde aktualisiert."
          : "Your staff account status at {{hotel_name}} has been updated.",
        heading: isDe ? "Kontostatus aktualisiert" : "Staff Account Status Updated",
        greeting: isDe ? "Hallo {{staff_name}}," : "Hello {{staff_name}},",
        intro: isDe
          ? "Der Status Ihres Mitarbeiterkontos bei {{hotel_name}} wurde aktualisiert."
          : "A staff account status change has been recorded for your account at {{hotel_name}}.",
        rows: [
          { id: "row_hotel", label: "Hotel", valueTemplate: "{{hotel_name}}" },
          { id: "row_staff", label: isDe ? "Mitarbeiter" : "Staff Member", valueTemplate: "{{staff_name}}" },
          { id: "row_status", label: isDe ? "Neuer Status" : "New Status", valueTemplate: "{{staff_status}}" },
        ],
      });

    case "fnb_order_voided":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[F&B-Hinweis] Bestellung storniert - {{hotel_name}}"
          : "[F&B Alert] Order Voided - {{hotel_name}}",
        preheader: isDe
          ? "Eine F&B-Bestellung im {{hotel_name}} wurde storniert."
          : "An F&B order at {{hotel_name}} was voided.",
        heading: isDe ? "F&B-Bestellung storniert" : "F&B Order Voided",
        intro: isDe
          ? "Eine F&B-Bestellung im {{hotel_name}} wurde storniert und die zugehörigen Buchungen wurden korrigiert."
          : "An F&B order at {{hotel_name}} was voided and associated financials were reversed.",
        rows: [
          { id: "row_bill", label: isDe ? "Belegnummer" : "Order / Bill #", valueTemplate: "{{bill_number}}" },
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_amt", label: isDe ? "Stornierter Betrag" : "Voided Amount", valueTemplate: "{{total_amount}}" },
          { id: "row_reason", label: isDe ? "Grund" : "Void Reason", valueTemplate: "{{reason}}" },
        ],
      });

    case "housekeeping_room_ready":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Housekeeping] Zimmer bezugsfertig - {{hotel_name}}"
          : "[Housekeeping] Room Ready for Arrival - {{hotel_name}}",
        preheader: isDe
          ? "{{room_name}} im {{hotel_name}} ist gereinigt und bezugsfertig."
          : "{{room_name}} at {{hotel_name}} passed inspection and is ready.",
        heading: isDe ? "Zimmer geprüft & bezugsfertig" : "Room Inspected & Ready",
        intro: isDe
          ? "Die Housekeeping-Inspektion wurde bestanden und das Zimmer ist nun bezugsfertig."
          : "Housekeeping inspection passed and the room is now marked clean and ready.",
        rows: [
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_notes", label: isDe ? "Anmerkungen" : "Notes", valueTemplate: "{{reason}}" },
        ],
      });

    case "housekeeping_inspection_failed":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Housekeeping-Alarm] Inspektion nicht bestanden - {{hotel_name}}"
          : "[Housekeeping Alert] Inspection Failed - {{hotel_name}}",
        preheader: isDe
          ? "{{room_name}} im {{hotel_name}} erfordert eine Nachreinigung."
          : "{{room_name}} failed housekeeping inspection at {{hotel_name}}.",
        heading: isDe ? "Zimmerinspektion nicht bestanden" : "Room Inspection Failed",
        intro: isDe
          ? "Ein Zimmer im {{hotel_name}} hat die Housekeeping-Inspektion nicht bestanden und erfordert eine Nachreinigung."
          : "A room at {{hotel_name}} failed housekeeping inspection and requires corrective cleaning.",
        rows: [
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_notes", label: isDe ? "Befund" : "Remarks", valueTemplate: "{{reason}}" },
        ],
      });

    case "housekeeping_guest_request":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Housekeeping] Neue Gästeanfrage - {{hotel_name}}"
          : "[Housekeeping] Guest Request Logged - {{hotel_name}}",
        preheader: isDe
          ? "Eine neue Housekeeping-Gästeanfrage wurde für {{room_name}} erfasst."
          : "A new guest housekeeping request has been logged at {{hotel_name}}.",
        heading: isDe ? "Neue Housekeeping-Gästeanfrage" : "New Housekeeping Guest Request",
        intro: isDe
          ? "Eine neue Gästeanfrage wurde im {{hotel_name}} protokolliert und wartet auf Bearbeitung."
          : "A new guest housekeeping request has been logged and awaits fulfilment.",
        rows: [
          { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}" },
          { id: "row_issue", label: isDe ? "Anfrage" : "Requested Item", valueTemplate: "{{issue_summary}}" },
          { id: "row_prio", label: isDe ? "Priorität" : "Priority", valueTemplate: "{{priority}}" },
          { id: "row_notes", label: isDe ? "Hinweise" : "Notes", valueTemplate: "{{reason}}" },
        ],
      });

    case "maintenance_issue_reported":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Wartung] Neues Problem gemeldet - {{hotel_name}}"
          : "[Maintenance Alert] New Issue Reported - {{hotel_name}}",
        preheader: isDe
          ? "Ein technisches Problem wurde im {{hotel_name}} gemeldet."
          : "A new maintenance issue has been reported at {{hotel_name}}.",
        heading: isDe ? "Neues Wartungsticket gemeldet" : "New Maintenance Ticket Reported",
        intro: isDe
          ? "Ein technisches / Wartungsproblem wurde im {{hotel_name}} gemeldet."
          : "A technical / maintenance issue has been reported at {{hotel_name}}.",
        rows: [
          { id: "row_room", label: isDe ? "Zimmer / Ort" : "Room / Location", valueTemplate: "{{room_name}}" },
          { id: "row_issue", label: isDe ? "Problem" : "Issue", valueTemplate: "{{issue_summary}}" },
          { id: "row_prio", label: isDe ? "Priorität" : "Priority", valueTemplate: "{{priority}}" },
          { id: "row_notes", label: isDe ? "Hinweise" : "Notes", valueTemplate: "{{reason}}" },
        ],
      });

    case "maintenance_issue_resolved":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Wartung] Ticket abgeschlossen - {{hotel_name}}"
          : "[Maintenance] Issue Completed - {{hotel_name}}",
        preheader: isDe
          ? "Ein Wartungsticket im {{hotel_name}} wurde abgeschlossen."
          : "A maintenance ticket at {{hotel_name}} has been marked completed.",
        heading: isDe ? "Wartungsticket abgeschlossen" : "Maintenance Ticket Completed",
        intro: isDe
          ? "Eine Wartungsanfrage im {{hotel_name}} wurde als erledigt markiert."
          : "A maintenance request at {{hotel_name}} has been marked as completed.",
        rows: [
          { id: "row_room", label: isDe ? "Zimmer / Ort" : "Room / Location", valueTemplate: "{{room_name}}" },
          { id: "row_issue", label: isDe ? "Problem" : "Issue", valueTemplate: "{{issue_summary}}" },
          { id: "row_notes", label: isDe ? "Hinweise" : "Notes", valueTemplate: "{{reason}}" },
        ],
      });

    case "guest_blacklisted":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Compliance-Hinweis] Gästestatus eingeschränkt - {{hotel_name}}"
          : "[Compliance Alert] Guest Status Restricted - {{hotel_name}}",
        preheader: isDe
          ? "Ein Gästeprofil im {{hotel_name}} wurde eingeschränkt (DNR)."
          : "A guest profile at {{hotel_name}} has been flagged / restricted.",
        heading: isDe ? "Gästekonto eingeschränkt" : "Guest Account Restricted",
        intro: isDe
          ? "Ein Gästeprofil im {{hotel_name}} wurde als eingeschränkt (DNR) markiert. Bitte prüfen Sie die Details unten."
          : "A guest profile at {{hotel_name}} has been flagged / restricted. Review the details below.",
        rows: [
          { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}" },
          { id: "row_reason", label: isDe ? "Hinweise" : "Reason / Notes", valueTemplate: "{{reason}}" },
        ],
      });

    case "daily_revenue_deficit_alert":
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[Finanz-Hinweis] Tagesumsatz unter Zielwert - {{hotel_name}}"
          : "[Finance Alert] Daily Revenue Below Target - {{hotel_name}}",
        preheader: isDe
          ? "Der Tagesumsatz im {{hotel_name}} liegt unter dem definierten Zielwert."
          : "Daily collected revenue at {{hotel_name}} is below the configured daily target.",
        heading: isDe ? "Hinweis zum Tagesumsatz" : "Daily Revenue Deficit Alert",
        intro: isDe
          ? "Der bisherige Tagesumsatz im {{hotel_name}} liegt unter dem konfigurierten Zielschwellenwert."
          : "Daily collected revenue at {{hotel_name}} is currently below the configured daily target threshold.",
        rows: [
          { id: "row_summary", label: isDe ? "Zusammenfassung" : "Summary", valueTemplate: "{{issue_summary}}" },
          { id: "row_amt", label: isDe ? "Betrag" : "Amount", valueTemplate: "{{total_amount}}" },
          { id: "row_notes", label: isDe ? "Details" : "Details", valueTemplate: "{{reason}}" },
        ],
      });

    case "operational_alert":
    default:
      return makeSimpleVariant({
        branding,
        language,
        subject: isDe
          ? "[System-Hinweis] {{hotel_name}}"
          : "[System Notification] {{hotel_name}}",
        preheader: isDe
          ? "Ein wichtiges Betriebsereignis wurde für {{hotel_name}} erfasst."
          : "An important operational event was recorded for {{hotel_name}}.",
        heading: isDe ? "Systembenachrichtigung" : "Operational Notification",
        intro: isDe
          ? "Ein wichtiges Betriebsereignis wurde für {{hotel_name}} protokolliert."
          : "An important operational event has been recorded for {{hotel_name}}.",
        rows: [
          { id: "row_summary", label: isDe ? "Zusammenfassung" : "Summary", valueTemplate: "{{issue_summary}}" },
          { id: "row_amt", label: isDe ? "Betrag" : "Amount", valueTemplate: "{{total_amount}}" },
          { id: "row_notes", label: isDe ? "Details" : "Details", valueTemplate: "{{reason}}" },
        ],
      });
  }
}

export interface OptionalSectionPreset {
  id: string;
  label: string;
  description: string;
  createBlocks: () => EmailBlock[];
}

export const OPTIONAL_SECTION_PRESETS: OptionalSectionPreset[] = [
  {
    id: "loyalty_points",
    label: "Loyalty Points Summary",
    description: "Automatically hidden when no loyalty points exist for the guest.",
    createBlocks: () => [
      {
        id: `blk_loyalty_${Date.now()}`,
        type: "two_column_text",
        condition: "has_loyalty",
        leftTitle: "Loyalty Tier & Balance",
        leftText: "Tier: {{loyalty_tier}}\nCurrent Balance: {{loyalty_points_balance}} pts",
        rightTitle: "Points Earned This Stay",
        rightText: "+{{loyalty_points_earned}} points credited to your account.",
      },
    ],
  },
  {
    id: "wifi_details",
    label: "Wi-Fi Details",
    description: "Guest network access information.",
    createBlocks: () => [
      {
        id: `blk_wifi_${Date.now()}`,
        type: "two_column_text",
        leftTitle: "Complimentary Wi-Fi",
        leftText: "Connect to our hotel guest network upon arrival for high-speed internet access.",
        rightTitle: "Access Details",
        rightText: "Network credentials are provided at reception and inside your room welcome card.",
      },
    ],
  },
  {
    id: "breakfast_times",
    label: "Breakfast Times",
    description: "Dining room hours and location.",
    createBlocks: () => [
      {
        id: `blk_breakfast_${Date.now()}`,
        type: "paragraph",
        text: "Breakfast is served daily in our main restaurant from 07:00 to 10:30.",
        align: "left",
        tone: "default",
      },
    ],
  },
  {
    id: "checkout_instructions",
    label: "Check-Out Instructions",
    description: "Departure time and express check-out guidance.",
    createBlocks: () => [
      {
        id: `blk_checkout_info_${Date.now()}`,
        type: "paragraph",
        text: "Standard check-out time is {{check_out_time}} on {{check_out_date}}. Please return room keys to the front desk or request late check-out in advance.",
        align: "left",
        tone: "default",
      },
    ],
  },
  {
    id: "directions_parking",
    label: "Directions & Parking",
    description: "Arrival address and parking details.",
    createBlocks: () => [
      {
        id: `blk_directions_${Date.now()}`,
        type: "paragraph",
        text: "Directions & Parking: {{hotel_address}}. On-site parking is available; contact {{hotel_phone}} for arrival assistance.",
        align: "left",
        tone: "default",
      },
    ],
  },
  {
    id: "upsell_offer",
    label: "Stay Upgrade / Service",
    description: "Booking-related room upgrade or airport transfer link (requires configured hotel website).",
    createBlocks: () => [
      {
        id: `blk_upsell_${Date.now()}`,
        type: "button",
        displayStyle: "solid",
        label: "Explore Room Upgrades & Airport Transfer",
        url: "{{hotel_website}}",
        align: "left",
      },
    ],
  },
  {
    id: "review_link",
    label: "Guest Review Button",
    description: "Invite guests to share stay feedback.",
    createBlocks: () => [
      {
        id: `blk_review_${Date.now()}`,
        type: "button",
        displayStyle: "outline",
        label: "Share Your Stay Review",
        url: "{{review_link}}",
        align: "left",
      },
    ],
  },
];
