import {
  ALLOWED_TEMPLATE_VARIABLES,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailTemplateBranding,
  type EmailTemplateVariant,
  type EventCatalogEntry,
  type SupportedEmailLanguage,
} from "./types.ts";

export const EMAIL_EVENT_CATALOG: Record<CustomizableEmailEventType, EventCatalogEntry> = {
  booking_confirmation: {
    eventType: "booking_confirmation",
    name: "Booking Confirmation",
    description: "Sent immediately when a new reservation is created and confirmed.",
    audience: "guest",
    markerKey: "confirmation",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  booking_cancellation: {
    eventType: "booking_cancellation",
    name: "Booking Cancellation",
    description: "Sent when a reservation transitions to cancelled status.",
    audience: "guest",
    markerKey: "cancelled",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  checked_in: {
    eventType: "checked_in",
    name: "Check-In Confirmation",
    description: "Sent immediately when a guest checks in (including walk-ins checked in directly).",
    audience: "guest",
    markerKey: "checkedIn",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  checked_out: {
    eventType: "checked_out",
    name: "Check-Out Summary",
    description: "Sent immediately after guest check-out with stay and billing summary.",
    audience: "guest",
    markerKey: "checkedOut",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  booking_modified: {
    eventType: "booking_modified",
    name: "Booking Modified",
    description: "Sent when reservation dates or assigned room are updated.",
    audience: "guest",
    markerKey: "modified",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  pre_arrival_reminder: {
    eventType: "pre_arrival_reminder",
    name: "Pre-Arrival Reminder",
    description: "Sent before check-in date via the scheduled reminder job (configurable days ahead).",
    audience: "guest",
    requiresScheduler: true,
    markerKey: "preArrivalReminder",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  payment_receipt: {
    eventType: "payment_receipt",
    name: "Payment / Deposit Receipt",
    description: "Sent when a reservation payment or guest account deposit is recorded.",
    audience: "guest",
    markerKey: "paymentReceipt",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  no_show: {
    eventType: "no_show",
    name: "No-Show Notice",
    description: "Sent when a reservation transitions to no-show status.",
    audience: "hotel_staff",
    markerKey: "noShow",
    allowedVariables: [...ALLOWED_TEMPLATE_VARIABLES],
  },
  post_stay_feedback_request: {
    eventType: "post_stay_feedback_request",
    name: "Post-Stay Feedback Request",
    description: "Sent after guest check-out via the scheduled feedback job (configurable days after).",
    audience: "guest",
    requiresScheduler: true,
    markerKey: "postStayFeedback",
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
      { id: "cf_website", key: "website", label: lang === "de" ? "Webseite" : "Website", valueTemplate: "{{hotel_website}}", visible: false },
    ],
    legalImprintText: "",
    footerNote: "",
  };
}

function defaultPortalLinkBlock(lang: SupportedEmailLanguage): EmailBlock {
  return {
    id: "blk_portal",
    type: "button",
    displayStyle: "text_link",
    prefixText: lang === "de" ? "Hotelportal" : "Hotel Portal",
    label: "{{portal_link}}",
    url: "{{portal_link}}",
    align: "left",
  };
}

/**
 * Rebuilds TODAY's exact default emails as typed JSON blocks so untouched hotels
 * receive visually and textually identical emails.
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
      return {
        subject: isDe
          ? "Buchungsbestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Booking Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde bestätigt."
          : "Your reservation at {{hotel_name}} has been confirmed.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Buchungsbestätigung" : "Booking Confirmation",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Ihre Reservierung im {{hotel_name}} wurde bestätigt. Bitte überprüfen Sie unten Ihre Aufenthaltsdaten."
              : "Your reservation at {{hotel_name}} has been confirmed. Please review your stay details below.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
              { id: "row_total", label: isDe ? "Gesamtbetrag" : "Total Amount", valueTemplate: "{{total_amount}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "checked_in":
      return {
        subject: isDe
          ? "Check-In-Bestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Check-In Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Willkommen im {{hotel_name}}. Ihr Check-in ist abgeschlossen."
          : "You have been checked in at {{hotel_name}}.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Willkommen & Check-In-Bestätigung" : "Welcome & Check-In Confirmation",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Sie wurden im {{hotel_name}} eingecheckt. Unten finden Sie Ihre Aufenthaltsübersicht."
              : "You have been checked in at {{hotel_name}}. Below is your stay summary for reference.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "checked_out":
      return {
        subject: isDe
          ? "Vielen Dank & Check-Out-Übersicht - {{hotel_name}} ({{booking_reference}})"
          : "Thank You & Check-Out Summary - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihr Check-out im {{hotel_name}} ist abgeschlossen."
          : "Your check-out at {{hotel_name}} is complete.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Vielen Dank für Ihren Aufenthalt" : "Thank You for Staying With Us",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Ihr Check-out im {{hotel_name}} ist abgeschlossen. Unten finden Sie eine Zusammenfassung Ihres Aufenthalts."
              : "Your check-out at {{hotel_name}} is complete. Below is a summary of your stay.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
              { id: "row_total", label: isDe ? "Gesamtbetrag" : "Total Amount", valueTemplate: "{{total_amount}}", visible: true },
              { id: "row_paid", label: isDe ? "Bezahlter Betrag" : "Total Paid", valueTemplate: "{{deposit_amount}}", visible: true },
            ],
          },
          {
            id: "blk_note",
            type: "paragraph",
            text: isDe
              ? "Vielen Dank, dass Sie bei uns waren. Wir freuen uns darauf, Sie bald wieder begrüßen zu dürfen."
              : "Thank you for choosing us. We look forward to welcoming you again.",
            align: "left",
            tone: "muted",
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "booking_cancellation":
      return {
        subject: isDe
          ? "Stornierungsbestätigung - {{hotel_name}} ({{booking_reference}})"
          : "Booking Cancellation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde storniert."
          : "Your reservation at {{hotel_name}} has been cancelled.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Stornierungsbestätigung" : "Booking Cancellation Notice",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Ihre Reservierung im {{hotel_name}} wurde storniert. Die stornierten Buchungsdetails sind unten aufgeführt."
              : "Your reservation at {{hotel_name}} has been cancelled. Cancelled booking details are listed below.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
            ],
          },
          {
            id: "blk_note",
            type: "paragraph",
            text: isDe
              ? "Falls diese Stornierung unerwartet war, kontaktieren Sie das Hotel bitte direkt."
              : "If this cancellation was unexpected, please contact the hotel directly.",
            align: "left",
            tone: "muted",
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "no_show":
      return {
        subject: isDe
          ? "[Betrieb] No-Show erfasst - {{hotel_name}} ({{booking_reference}})"
          : "[Operations] Reservation No-Show - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Eine Reservierung im {{hotel_name}} wurde als No-Show markiert."
          : "A reservation at {{hotel_name}} has been marked as a no-show.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Reservierung als No-Show markiert" : "Reservation Marked as No-Show",
            align: "left",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Eine Reservierung im {{hotel_name}} wurde als No-Show markiert und der Zimmerbestand wurde aktualisiert."
              : "A reservation at {{hotel_name}} has been marked as a no-show and room inventory has been updated.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "booking_modified":
      return {
        subject: isDe
          ? "Aktualisierte Buchungsdetails - {{hotel_name}} ({{booking_reference}})"
          : "Booking Update Confirmation - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihre Reservierung im {{hotel_name}} wurde aktualisiert."
          : "Your reservation details at {{hotel_name}} have been updated.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Reservierung aktualisiert" : "Reservation Updated",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Ihre Reservierung im {{hotel_name}} wurde geändert. Unten finden Sie Ihre aktuellen Aufenthaltsdaten."
              : "Your reservation at {{hotel_name}} has been modified. Please review your updated stay details below.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_nights", label: isDe ? "Nächte" : "Nights", valueTemplate: "{{nights}}", visible: true },
              { id: "row_total", label: isDe ? "Gesamtbetrag" : "Total Amount", valueTemplate: "{{total_amount}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "pre_arrival_reminder":
      return {
        subject: isDe
          ? "Wir freuen uns auf Ihre Anreise - {{hotel_name}} ({{booking_reference}})"
          : "Pre-Arrival Reminder - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Ihr Aufenthalt im {{hotel_name}} beginnt am {{check_in_date}}."
          : "Your upcoming stay at {{hotel_name}} starts on {{check_in_date}}.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Wir freuen uns auf Sie" : "We Look Forward to Welcoming You",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Ihr Aufenthalt im {{hotel_name}} steht kurz bevor. Hier sind die wichtigsten Details für eine reibungslose Anreise."
              : "Your upcoming stay at {{hotel_name}} is just around the corner. Here are your reservation details ahead of arrival.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}} ({{check_in_time}})", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}} ({{check_out_time}})", visible: true },
              { id: "row_balance", label: isDe ? "Offener Betrag" : "Balance Due", valueTemplate: "{{balance_due}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "payment_receipt":
      return {
        subject: isDe
          ? "Zahlungsbeleg - {{hotel_name}} ({{booking_reference}})"
          : "Payment Receipt - {{hotel_name}} ({{booking_reference}})",
        preheader: isDe
          ? "Vielen Dank für Ihre Zahlung im {{hotel_name}}."
          : "Thank you for your payment at {{hotel_name}}.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Zahlungsbestätigung" : "Payment Received",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_name}}," : "Hello {{guest_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Eine Zahlung für Ihren Aufenthalt im {{hotel_name}} wurde verbucht. Unten finden Sie Ihre Belegübersicht."
              : "A payment has been recorded at {{hotel_name}}. Your receipt summary is provided below.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_guest", label: isDe ? "Gastname" : "Guest Name", valueTemplate: "{{guest_name}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_deposit", label: isDe ? "Eingegangener Betrag" : "Amount Paid", valueTemplate: "{{deposit_amount}}", visible: true },
              { id: "row_balance", label: isDe ? "Restbetrag" : "Balance Due", valueTemplate: "{{balance_due}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };

    case "post_stay_feedback_request":
      return {
        subject: isDe
          ? "Wie war Ihr Aufenthalt im {{hotel_name}}?"
          : "How Was Your Stay at {{hotel_name}}?",
        preheader: isDe
          ? "Vielen Dank für Ihren Besuch im {{hotel_name}}. Wir freuen uns über Ihr Feedback."
          : "Thank you for staying with {{hotel_name}}. Share your feedback with us.",
        branding,
        blocks: [
          {
            id: "blk_heading",
            type: "heading",
            level: 2,
            text: isDe ? "Vielen Dank für Ihren Besuch" : "Thank You for Visiting {{hotel_name}}",
            align: "left",
          },
          {
            id: "blk_greeting",
            type: "paragraph",
            text: isDe ? "Hallo {{guest_first_name}}," : "Hello {{guest_first_name}},",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_intro",
            type: "paragraph",
            text: isDe
              ? "Wir hoffen, Sie hatten einen angenehmen Aufenthalt im {{hotel_name}}. Ihre Rückmeldung hilft uns, unseren Service weiter zu verbessern."
              : "We hope you enjoyed your recent stay at {{hotel_name}}. We would appreciate a brief moment to hear about your experience.",
            align: "left",
            tone: "default",
          },
          {
            id: "blk_table",
            type: "booking_details_table",
            rows: [
              { id: "row_ref", label: isDe ? "Buchungsreferenz" : "Booking Reference", valueTemplate: "{{booking_reference}}", visible: true },
              { id: "row_room", label: isDe ? "Zimmer" : "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "row_checkin", label: isDe ? "Anreise" : "Check-In", valueTemplate: "{{check_in_date}}", visible: true },
              { id: "row_checkout", label: isDe ? "Abreise" : "Check-Out", valueTemplate: "{{check_out_date}}", visible: true },
            ],
          },
          defaultPortalLinkBlock(language),
          defaultContactFooter(language),
        ],
      };
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
    description: "Booking-related room upgrade or airport transfer link.",
    createBlocks: () => [
      {
        id: `blk_upsell_${Date.now()}`,
        type: "button",
        displayStyle: "solid",
        label: "Explore Room Upgrades & Airport Transfer",
        url: "{{portal_link}}",
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
        url: "{{portal_link}}",
        align: "left",
      },
    ],
  },
];
