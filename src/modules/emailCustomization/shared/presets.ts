import {
  FOOTER_SECTION_BLOCK_TYPES,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailIconName,
  type EmailIconTone,
  type EmailTemplateBranding,
  type EmailTemplateVariant,
  type SupportedEmailLanguage,
} from "./types.ts";

const FOOTER_SECTION_TYPE_SET = new Set<string>(FOOTER_SECTION_BLOCK_TYPES);

/**
 * Builds the 3 standalone, fully editable default footer blocks (Contact Us, Confirmation Authenticity,
 * and Copyright / legal line) using allow-listed merge variables.
 * Note: "Powered by" is intentionally omitted (OFF by default).
 */
export function buildDefaultFooterBlocks(
  language: SupportedEmailLanguage = "en",
  options: {
    prefix?: string;
    logoUrl?: string;
    logoImageId?: string;
  } = {}
): EmailBlock[] {
  const isDe = language === "de";
  const p = options.prefix || "ftr";
  const logoUrl = options.logoUrl?.trim() || "";

  return [
    {
      id: `${p}_contact`,
      type: "footer_contact",
      heading: isDe ? "Kontakt" : "Contact Us",
      text: isDe
        ? "Bei Fragen zu Ihrer Reservierung erreichen Sie {{hotel_name}} telefonisch unter {{hotel_phone}} oder per E-Mail an {{hotel_email}}."
        : "For questions regarding your reservation, reach {{hotel_name}} at {{hotel_phone}} or {{hotel_email}}.",
      style: {
        backgroundColor: "#fafafa",
        textColor: "#52525b",
        borderColor: "#e4e4e7",
        align: "left",
        paddingY: 16,
        paddingX: 28,
        fontSizePx: 12,
      },
    },
    {
      id: `${p}_authenticity`,
      type: "footer_authenticity",
      heading: isDe ? "Echtheit dieser Bestätigung" : "Confirmation Authenticity",
      text: isDe
        ? "Diese transaktionale Nachricht wurde automatisch für Ihre Buchung {{booking_reference}} erstellt. Maßgeblich sind die im Reservierungssystem hinterlegten Daten."
        : "This transactional confirmation reflects our official reservation record for {{booking_reference}} at {{hotel_name}}.",
      style: {
        backgroundColor: "#fafafa",
        textColor: "#52525b",
        align: "left",
        paddingY: 10,
        paddingX: 28,
        fontSizePx: 12,
      },
    },
    {
      id: `${p}_copyright`,
      type: "footer_copyright",
      text: "© {{hotel_name}} · {{hotel_address}}",
      showFooterLogo: Boolean(logoUrl),
      footerLogoUrl: logoUrl || undefined,
      footerLogoImageId: options.logoImageId,
      footerLogoAlt: "{{hotel_name}}",
      footerLogoWidthPx: 110,
      style: {
        backgroundColor: "#fafafa",
        textColor: "#52525b",
        align: "left",
        paddingY: 14,
        paddingX: 28,
        fontSizePx: 11,
      },
    },
  ];
}

/**
 * Replaces ONLY footer blocks in a template's block list while leaving all header and body
 * blocks intact. Used by "Reset footer to default" and "Apply default footer to all events".
 */
export function replaceFooterBlocksInList(
  blocks: EmailBlock[],
  replacementFooterBlocks: EmailBlock[],
  options: { replaceNav?: boolean; replaceSocial?: boolean } = {}
): EmailBlock[] {
  const removeTypes = new Set<string>(FOOTER_SECTION_TYPE_SET);
  if (options.replaceNav) removeTypes.add("footer_nav");
  if (options.replaceSocial) removeTypes.add("social_links");

  const kept = (blocks || []).filter((b) => b && !removeTypes.has(b.type));
  const clonedFooter = (replacementFooterBlocks || []).map((b, idx) => ({
    ...JSON.parse(JSON.stringify(b)),
    id: `${b.type}_${Date.now().toString(36)}_${idx}_${Math.random().toString(36).slice(2, 5)}`,
  })) as EmailBlock[];

  return [...kept, ...clonedFooter];
}

export type StarterLayoutPresetId = "modern_resort" | "business_hotel" | "minimal" | "boutique";

export type PlaceholderImageName =
  | "resort_hero"
  | "coastal_card"
  | "spa_card"
  | "dining_card"
  | "business_banner"
  | "suite_card";

export const EMAIL_PLACEHOLDER_IMAGES: readonly PlaceholderImageName[] = [
  "resort_hero",
  "coastal_card",
  "spa_card",
  "dining_card",
  "business_banner",
  "suite_card",
] as const;

export interface StarterLayoutPresetMeta {
  id: StarterLayoutPresetId;
  name: string;
  nameDe: string;
  tagline: string;
  taglineDe: string;
  accentColor: string;
  secondaryColor: string;
  surfaceTint: string;
}

export const STARTER_LAYOUT_PRESETS: readonly StarterLayoutPresetMeta[] = [
  {
    id: "modern_resort",
    name: "Modern Resort",
    nameDe: "Modernes Resort",
    tagline: "Full hospitality layout with header strip, stay dates, alternating feature cards, benefits, and icon grid.",
    taglineDe: "Vollständiges Resort-Layout mit Header, Aufenthaltsdaten, Angebotskarten, Vorteilen und Icon-Übersicht.",
    accentColor: "#991b1b",
    secondaryColor: "#18181b",
    surfaceTint: "#f8fafc",
  },
  {
    id: "business_hotel",
    name: "Business Hotel",
    nameDe: "Business-Hotel",
    tagline: "Crisp executive confirmation with dark portal strip, clear booking code, check-in details, and quick links.",
    taglineDe: "Klares Business-Layout mit Portal-Leiste, Buchungscode, Check-in-Zeiten und Schnellzugriffen.",
    accentColor: "#1e3a5f",
    secondaryColor: "#0f172a",
    surfaceTint: "#f1f5f9",
  },
  {
    id: "minimal",
    name: "Minimal",
    nameDe: "Minimalistisch",
    tagline: "Clean, quiet typography with confirmation number, stay timeline, and structured reservation details.",
    taglineDe: "Ruhige Typografie mit Bestätigungsnummer, Aufenthaltszeitraum und klaren Reservierungsdetails.",
    accentColor: "#059669",
    secondaryColor: "#18181b",
    surfaceTint: "#fafafa",
  },
  {
    id: "boutique",
    name: "Boutique",
    nameDe: "Boutique-Hotel",
    tagline: "Warm editorial serif layout featuring curated dining & wellness cards and a refined guest checklist.",
    taglineDe: "Warmes Editorial-Design mit Serifenschrift, Kulinarik- & Wellness-Karten und Gästetipps.",
    accentColor: "#881337",
    secondaryColor: "#292524",
    surfaceTint: "#faf8f5",
  },
] as const;

export function normalizeAssetBaseUrl(appUrl?: string): string {
  const cleaned = String(appUrl || "").trim().replace(/\/+$/, "");
  if (cleaned.startsWith("https://")) return cleaned;
  return "https://tidehotels.de";
}

export function buildEmailIconUrl(
  appUrl: string,
  tone: EmailIconTone,
  icon: EmailIconName
): string {
  return `${normalizeAssetBaseUrl(appUrl)}/uploads/email-assets/icons/${tone}/${icon}.png`;
}

export function buildPlaceholderImageUrl(
  appUrl: string,
  name: PlaceholderImageName
): string {
  return `${normalizeAssetBaseUrl(appUrl)}/uploads/email-assets/placeholders/${name}.png`;
}

export function buildSampleGifUrl(appUrl: string): string {
  return `${normalizeAssetBaseUrl(appUrl)}/uploads/email-assets/samples/welcome.gif`;
}

interface EventCopy {
  subject: string;
  preheader: string;
  headline: string;
  body: string;
  ctaLabel: string;
}

function getEventCopy(
  eventType: CustomizableEmailEventType,
  language: SupportedEmailLanguage
): EventCopy {
  const isDe = language === "de";
  switch (eventType) {
    case "booking_confirmation":
      return isDe
        ? {
            subject: "Buchungsbestätigung – {{hotel_name}} ({{booking_reference}})",
            preheader: "Ihre Reservierung im {{hotel_name}} ist bestätigt.",
            headline: "Wir freuen uns auf Sie, {{guest_first_name}}",
            body: "Ihre Reservierung im {{hotel_name}} ist bestätigt. Unten finden Sie alle wichtigen Details für eine entspannte Anreise.",
            ctaLabel: "Buchung ansehen",
          }
        : {
            subject: "Booking Confirmation – {{hotel_name}} ({{booking_reference}})",
            preheader: "Your upcoming stay at {{hotel_name}} is confirmed.",
            headline: "We Look Forward to Welcoming You, {{guest_first_name}}",
            body: "Your reservation at {{hotel_name}} is confirmed. Review your stay schedule and property highlights below before arrival.",
            ctaLabel: "Manage Stay",
          };
    case "booking_cancellation":
      return isDe
        ? {
            subject: "Stornierungsbestätigung – {{hotel_name}} ({{booking_reference}})",
            preheader: "Ihre Reservierung {{booking_reference}} wurde storniert.",
            headline: "Ihre Reservierung wurde storniert",
            body: "Wir bestätigen die Stornierung Ihrer Buchung im {{hotel_name}}. Bei Fragen oder einer neuen Buchung sind wir jederzeit für Sie da.",
            ctaLabel: "Neu buchen",
          }
        : {
            subject: "Cancellation Confirmation – {{hotel_name}} ({{booking_reference}})",
            preheader: "Your reservation {{booking_reference}} has been cancelled.",
            headline: "Your Reservation Has Been Cancelled",
            body: "This confirms that your stay at {{hotel_name}} has been cancelled. Whenever your travel plans change, we would love to host you.",
            ctaLabel: "Plan a New Stay",
          };
    case "checked_in":
      return isDe
        ? {
            subject: "Willkommen im {{hotel_name}} – Check-in bestätigt",
            preheader: "Sie sind eingecheckt in {{room_name}}.",
            headline: "Herzlich willkommen, {{guest_first_name}}",
            body: "Ihr Check-in im {{hotel_name}} ist abgeschlossen. Entdecken Sie unsere Services und genießen Sie Ihren Aufenthalt in {{room_name}}.",
            ctaLabel: "Gästeportal öffnen",
          }
        : {
            subject: "Welcome to {{hotel_name}} – Check-In Confirmed",
            preheader: "You are checked into {{room_name}}.",
            headline: "Welcome to {{hotel_name}}, {{guest_first_name}}",
            body: "Your check-in is complete and {{room_name}} is ready for you. Explore property amenities and reach our front desk anytime.",
            ctaLabel: "Open Guest Portal",
          };
    case "checked_out":
      return isDe
        ? {
            subject: "Vielen Dank für Ihren Aufenthalt – {{hotel_name}}",
            preheader: "Ihre Check-out-Übersicht für {{booking_reference}}.",
            headline: "Vielen Dank für Ihren Besuch, {{guest_first_name}}",
            body: "Ihr Check-out im {{hotel_name}} wurde abgeschlossen. Wir wünschen Ihnen eine angenehme Weiterreise und freuen uns auf ein Wiedersehen.",
            ctaLabel: "Nächsten Aufenthalt planen",
          }
        : {
            subject: "Thank You for Staying With Us – {{hotel_name}}",
            preheader: "Your check-out summary for {{booking_reference}}.",
            headline: "Thank You for Staying With Us, {{guest_first_name}}",
            body: "Your check-out at {{hotel_name}} is complete. We wish you safe travels and look forward to welcoming you back soon.",
            ctaLabel: "Plan Your Next Stay",
          };
    case "booking_modified":
      return isDe
        ? {
            subject: "Buchung aktualisiert – {{hotel_name}} ({{booking_reference}})",
            preheader: "Ihre geänderten Aufenthaltsdaten im Überblick.",
            headline: "Ihre Reservierung wurde aktualisiert",
            body: "Die Änderungen an Ihrer Buchung im {{hotel_name}} wurden gespeichert. Nachfolgend finden Sie den aktuellen Stand.",
            ctaLabel: "Details prüfen",
          }
        : {
            subject: "Reservation Updated – {{hotel_name}} ({{booking_reference}})",
            preheader: "Review your updated stay schedule at {{hotel_name}}.",
            headline: "Your Reservation Has Been Updated",
            body: "We have updated your upcoming reservation at {{hotel_name}}. Please review your revised stay dates and summary below.",
            ctaLabel: "Review Stay Details",
          };
    case "pre_arrival_reminder":
      return isDe
        ? {
            subject: "Bald geht es los – Ihr Aufenthalt im {{hotel_name}}",
            preheader: "Anreiseinformationen für {{check_in_date}}.",
            headline: "Wir bereiten alles für Sie vor, {{guest_first_name}}",
            body: "Ihr Aufenthalt im {{hotel_name}} steht kurz bevor. Hier finden Sie Check-in-Zeiten, Adresse und hilfreiche Tipps für Ihre Anreise.",
            ctaLabel: "Anreise planen",
          }
        : {
            subject: "Your Upcoming Stay at {{hotel_name}} Starts Soon",
            preheader: "Arrival details for {{check_in_date}} at {{hotel_name}}.",
            headline: "Getting Ready for Your Arrival, {{guest_first_name}}",
            body: "Your stay at {{hotel_name}} is right around the corner. Review your check-in schedule and property highlights below.",
            ctaLabel: "View Arrival Guide",
          };
    case "payment_receipt":
      return isDe
        ? {
            subject: "Zahlungsbestätigung – {{hotel_name}} ({{booking_reference}})",
            preheader: "Eingegangene Zahlung: {{deposit_amount}}.",
            headline: "Zahlungsbeleg für Ihre Reservierung",
            body: "Vielen Dank für Ihre Zahlung an das {{hotel_name}}. Nachfolgend finden Sie Ihre aktuelle Zahlungs- und Buchungsübersicht.",
            ctaLabel: "Buchung öffnen",
          }
        : {
            subject: "Payment Receipt – {{hotel_name}} ({{booking_reference}})",
            preheader: "Payment received: {{deposit_amount}} for {{booking_reference}}.",
            headline: "Payment Confirmation",
            body: "Thank you for your payment to {{hotel_name}}. Below is your updated payment and reservation summary.",
            ctaLabel: "View Reservation",
          };
    case "no_show":
      return isDe
        ? {
            subject: "[Betrieb] No-Show Meldung – {{hotel_name}} ({{booking_reference}})",
            preheader: "Reservierung {{booking_reference}} als No-Show markiert.",
            headline: "No-Show Benachrichtigung",
            body: "Die Reservierung {{booking_reference}} für {{guest_name}} wurde im PMS als No-Show verbucht.",
            ctaLabel: "Im PMS öffnen",
          }
        : {
            subject: "[Operations] Reservation No-Show – {{hotel_name}} ({{booking_reference}})",
            preheader: "Reservation {{booking_reference}} marked as No-Show.",
            headline: "Reservation No-Show Alert",
            body: "Reservation {{booking_reference}} for {{guest_name}} has been marked as a No-Show in {{hotel_name}}.",
            ctaLabel: "Open Hotel Portal",
          };
    case "post_stay_feedback_request":
      return isDe
        ? {
            subject: "Wie war Ihr Aufenthalt im {{hotel_name}}?",
            preheader: "Teilen Sie Ihre Eindrücke mit unserem Team.",
            headline: "Wie hat Ihnen Ihr Aufenthalt gefallen?",
            body: "Vielen Dank, dass Sie Gast im {{hotel_name}} waren. Ihr kurzes Feedback hilft uns, jeden zukünftigen Aufenthalt noch angenehmer zu gestalten.",
            ctaLabel: "Feedback senden",
          }
        : {
            subject: "How Was Your Stay at {{hotel_name}}?",
            preheader: "Share a quick note about your stay with our team.",
            headline: "How Was Your Stay With Us?",
            body: "Thank you for visiting {{hotel_name}}. We would appreciate a quick moment of your feedback to keep improving our guest experience.",
            ctaLabel: "Share Feedback",
          };
  }
}

/**
 * Builds a complete v2 starter layout variant for the given preset, event, and language.
 * Applies ONLY to the draft inside the editor until the admin explicitly publishes.
 * Uses strictly hotel merge variables, neutral hospitality copy, and module-hosted assets.
 */
export function buildStarterPresetVariant(
  presetId: StarterLayoutPresetId,
  eventType: CustomizableEmailEventType,
  language: SupportedEmailLanguage,
  appUrl: string,
  brandingOverrides?: Partial<EmailTemplateBranding>
): EmailTemplateVariant {
  const isDe = language === "de";
  const copy = getEventCopy(eventType, language);
  const meta =
    STARTER_LAYOUT_PRESETS.find((p) => p.id === presetId) || STARTER_LAYOUT_PRESETS[0];

  const primaryColor = brandingOverrides?.primaryColor || meta.accentColor;
  const secondaryColor = brandingOverrides?.secondaryColor || meta.secondaryColor;
  const logoUrl = brandingOverrides?.logoUrl || "";
  const logoImageId = brandingOverrides?.logoImageId;

  const baseBranding: EmailTemplateBranding = {
    accentBarEnabled: false,
    accentBarColor: primaryColor,
    accentBarThicknessPx: 4,
    showEyebrow: false,
    eyebrowText: "{{hotel_name}}",
    primaryColor,
    secondaryColor,
    buttonColor: primaryColor,
    buttonTextColor: "#ffffff",
    fontFamily: presetId === "boutique" ? "georgia" : "arial",
    showLogo: Boolean(logoUrl),
    logoUrl,
    logoImageId,
    logoAlt: "{{hotel_name}}",
    logoWidthPx: 140,
  };

  const coastalImg = buildPlaceholderImageUrl(appUrl, "coastal_card");
  const spaImg = buildPlaceholderImageUrl(appUrl, "spa_card");
  const diningImg = buildPlaceholderImageUrl(appUrl, "dining_card");
  const suiteImg = buildPlaceholderImageUrl(appUrl, "suite_card");
  const businessImg = buildPlaceholderImageUrl(appUrl, "business_banner");

  const commonFooterNav: EmailBlock = {
    id: `${presetId}_fnav`,
    type: "footer_nav",
    links: isDe
      ? [
          { id: "fn1", label: "Hotel-Website", url: "{{hotel_website}}" },
          { id: "fn2", label: "Buchungsportal", url: "{{portal_link}}" },
          { id: "fn3", label: "Reservierung", url: "{{booking_link}}" },
        ]
      : [
          { id: "fn1", label: "Hotel Website", url: "{{hotel_website}}" },
          { id: "fn2", label: "Guest Portal", url: "{{portal_link}}" },
          { id: "fn3", label: "Book Direct", url: "{{booking_link}}" },
        ],
    secondaryText: isDe
      ? "Verwalten Sie Ihren Aufenthalt jederzeit über unser Gästeportal"
      : "Manage your upcoming stay anytime through our Guest Portal",
    secondaryLinkUrl: "{{portal_link}}",
    showViewNote: false,
    style: { backgroundColor: "#ffffff", paddingY: 20, paddingX: 24, borderColor: "#e4e4e7" },
  };

  const commonFooterBlocks = buildDefaultFooterBlocks(language, {
    prefix: `${presetId}_ftr`,
    logoUrl,
    logoImageId,
  });

  if (presetId === "modern_resort") {
    const blocks: EmailBlock[] = [
      {
        id: "mr_header",
        type: "brand_header",
        logoUrl: logoUrl || undefined,
        logoImageId,
        logoAlt: "{{hotel_name}}",
        logoWidthPx: 130,
        showHotelName: true,
        showAddress: true,
        showPhone: true,
        iconTone: "dark",
        style: { backgroundColor: "#ffffff", paddingY: 18, paddingX: 28, borderColor: "#e4e4e7" },
      },
      {
        id: "mr_promo",
        type: "promo_banner",
        imageUrl: businessImg,
        imageAlt: isDe ? "Gästeportal Banner" : "Guest portal banner",
        text: isDe
          ? "Check-in Zeiten, Zimmerinfos und direkte Anfragen an die Rezeption jederzeit griffbereit."
          : "Keep check-in times, room details, and concierge requests at your fingertips.",
        buttonLabel: isDe ? "Portal öffnen" : "Open Portal",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "pill",
        buttonBgColor: "#ffffff",
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#18181b", textColor: "#ffffff", paddingY: 14, paddingX: 24 },
      },
      {
        id: "mr_loyalty_strip",
        type: "membership_strip",
        condition: "has_loyalty",
        tierTemplate: "{{loyalty_tier}}",
        pointsTemplate: isDe ? "{{loyalty_points_balance}} Punkte" : "{{loyalty_points_balance}} Points",
        linkUrl: "{{portal_link}}",
        showArrow: true,
        iconTone: "dark",
        style: { backgroundColor: "#f8fafc", textColor: "#18181b", paddingY: 12, paddingX: 24, borderColor: "#e4e4e7" },
      },
      {
        id: "mr_hero",
        type: "hero_text",
        headline: copy.headline,
        body: copy.body,
        style: { backgroundColor: "#ffffff", textColor: "#18181b", align: "center", paddingY: 24, paddingX: 32 },
      },
      {
        id: "mr_conf",
        type: "confirmation_number",
        label: isDe ? "BESTÄTIGUNGSNUMMER" : "CONFIRMATION NUMBER",
        valueTemplate: "{{booking_reference}}",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 12, paddingX: 28 },
      },
      {
        id: "mr_dates",
        type: "stay_dates",
        checkInLabel: isDe ? "CHECK-IN" : "CHECK-IN",
        checkInDateTemplate: "{{check_in_date}}",
        checkInTimeTemplate: "{{check_in_time}}",
        checkOutLabel: isDe ? "CHECK-OUT" : "CHECK-OUT",
        checkOutDateTemplate: "{{check_out_date}}",
        checkOutTimeTemplate: "{{check_out_time}}",
        buttonLabel: copy.ctaLabel,
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "square",
        buttonBgColor: "#18181b",
        buttonTextColor: "#18181b",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 16, paddingX: 28 },
      },
      {
        id: "mr_div1",
        type: "icon_divider",
        icon: "map",
        iconTone: "muted",
        lineColor: "#d4d4d8",
        style: { backgroundColor: "#ffffff", paddingY: 12, paddingX: 28 },
      },
      {
        id: "mr_elevate",
        type: "hero_text",
        headline: isDe ? "Ihren Aufenthalt veredeln" : "Elevate Your Stay",
        body: isDe
          ? "Entdecken Sie unsere kuratierten Angebote im {{hotel_name}}."
          : "Discover curated experiences waiting for you at {{hotel_name}}.",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", align: "center", paddingY: 10, paddingX: 28 },
      },
      {
        id: "mr_card1",
        type: "feature_card",
        imagePosition: "left",
        imageUrl: coastalImg,
        imageAlt: isDe ? "Regionale Erlebnisse" : "Local experiences and coastal scenery",
        title: isDe ? "Besondere Erlebnisse" : "Inspiring Local Experiences",
        body: isDe
          ? "Planen Sie Ausflüge, Führungen und Aktivitäten rund um {{hotel_name}} schon vor Ihrer Anreise."
          : "Plan excursions, guided tours, and local activities around {{hotel_name}} ahead of your arrival.",
        buttonLabel: isDe ? "Aktivitäten entdecken" : "Explore Activities",
        buttonUrl: "{{hotel_website}}",
        buttonStyle: "filled",
        buttonCorner: "rounded",
        buttonBgColor: primaryColor,
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#ffffff", borderColor: "#e4e4e7", borderRadius: 12, paddingY: 10, paddingX: 24 },
      },
      {
        id: "mr_card2",
        type: "feature_card",
        imagePosition: "right",
        imageUrl: spaImg,
        imageAlt: isDe ? "Wellness und Entspannung" : "Spa and wellness lounge",
        title: isDe ? "Zeit für Entspannung" : "Unwind at Our Spa & Wellness",
        body: isDe
          ? "Reservieren Sie Ihre persönliche Wellness-Anwendung oder Sauna-Zeit bequem vorab."
          : "Reserve a restorative spa treatment or quiet wellness session as part of your upcoming stay.",
        buttonLabel: isDe ? "Termin anfragen" : "Request Appointment",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "filled",
        buttonCorner: "rounded",
        buttonBgColor: primaryColor,
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#ffffff", borderColor: "#e4e4e7", borderRadius: 12, paddingY: 10, paddingX: 24 },
      },
      {
        id: "mr_benefits",
        type: "benefits_list",
        condition: "has_loyalty",
        badgeText: "{{hotel_name}} · {{loyalty_tier}}",
        heading: isDe
          ? "Ihre {{loyalty_tier}}-Vorteile während dieses Aufenthalts"
          : "Enjoy Your {{loyalty_tier}} Member Benefits",
        listStyle: "bullet",
        itemIcon: "check",
        iconTone: "emerald",
        items: isDe
          ? [
              { id: "bf1", text: "Bonuspunkte auf berechtigte Ausgaben im Hotel" },
              { id: "bf2", text: "Persönlicher Willkommensgruß bei Anreise" },
              { id: "bf3", text: "Bevorzugtes Zimmer-Upgrade nach Verfügbarkeit" },
              { id: "bf4", text: "Flexibler Late Check-out nach Absprache" },
            ]
          : [
              { id: "bf1", text: "Bonus loyalty points earned on eligible stay charges" },
              { id: "bf2", text: "Complimentary welcome amenity upon arrival" },
              { id: "bf3", text: "Priority room upgrade subject to availability" },
              { id: "bf4", text: "Flexible late check-out on request" },
            ],
        footnote: isDe
          ? "*Vorteile gelten nach Verfügbarkeit im {{hotel_name}}."
          : "*Select member benefits are subject to availability at {{hotel_name}}.",
        buttonLabel: isDe ? "Alle Vorteile ansehen" : "See All Benefits",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "outlined",
        buttonCorner: "square",
        buttonBgColor: "#18181b",
        buttonTextColor: "#18181b",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 22, paddingX: 28 },
      },
      {
        id: "mr_grid",
        type: "icon_link_grid",
        heading: isDe ? "Das Haus entdecken" : "Explore Your Stay",
        subheading: isDe
          ? "Alles Wichtige rund um Kulinarik, Freizeit und Service."
          : "Everything you need for dining, activities, and property amenities.",
        iconTone: "dark",
        showArrows: true,
        items: isDe
          ? [
              { id: "ig1", icon: "dining", label: "Restaurant & Bar", url: "{{hotel_website}}" },
              { id: "ig2", icon: "activities", label: "Aktivitäten", url: "{{hotel_website}}" },
              { id: "ig3", icon: "spa", label: "Wellness", url: "{{portal_link}}" },
            ]
          : [
              { id: "ig1", icon: "dining", label: "Hotel Dining", url: "{{hotel_website}}" },
              { id: "ig2", icon: "activities", label: "Activities", url: "{{hotel_website}}" },
              { id: "ig3", icon: "spa", label: "Spa & Pool", url: "{{portal_link}}" },
            ],
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 20, paddingX: 28 },
      },
      {
        id: "mr_imglist",
        type: "image_with_list",
        imagePosition: "left",
        imageUrl: suiteImg,
        imageAlt: isDe ? "Digitaler Gästeservice" : "Suite interior and guest services",
        heading: isDe ? "Alles bereit für Ihren Aufenthalt" : "Everything Ready Before You Arrive",
        iconTone: "dark",
        items: isDe
          ? [
              { id: "il1", icon: "calendar", text: "Aufenthaltsdaten jederzeit einsehen" },
              { id: "il2", icon: "key", text: "Schneller Check-in ab {{check_in_time}}" },
              { id: "il3", icon: "chat", text: "Direkter Kontakt zur Rezeption" },
            ]
          : [
              { id: "il1", icon: "calendar", text: "Review your itinerary anytime" },
              { id: "il2", icon: "key", text: "Smooth arrival from {{check_in_time}}" },
              { id: "il3", icon: "chat", text: "Message our front desk team directly" },
            ],
        buttonLabel: isDe ? "Jetzt öffnen" : "Open Portal",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "dark",
        buttonCorner: "square",
        buttonBgColor: "#18181b",
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", borderRadius: 12, paddingY: 22, paddingX: 28 },
      },
      commonFooterNav,
      ...commonFooterBlocks,
    ];

    return {
      schemaVersion: 3,
      subject: copy.subject,
      preheader: copy.preheader,
      branding: baseBranding,
      blocks,
    };
  }

  if (presetId === "business_hotel") {
    const blocks: EmailBlock[] = [
      {
        id: "bh_header",
        type: "brand_header",
        logoUrl: logoUrl || undefined,
        logoImageId,
        logoAlt: "{{hotel_name}}",
        logoWidthPx: 130,
        showHotelName: true,
        showAddress: true,
        showPhone: true,
        iconTone: "navy",
        style: { backgroundColor: "#ffffff", paddingY: 18, paddingX: 28, borderColor: "#e2e8f0" },
      },
      {
        id: "bh_promo",
        type: "promo_banner",
        imageUrl: businessImg,
        imageAlt: isDe ? "Business Service" : "Executive guest services",
        text: isDe
          ? "Express Check-in, Highspeed-WLAN und digitale Rechnungen für Geschäftsreisende."
          : "Express check-in, high-speed Wi-Fi, and seamless billing for your business trip.",
        buttonLabel: isDe ? "Buchung verwalten" : "Manage Trip",
        buttonUrl: "{{portal_link}}",
        buttonStyle: "filled",
        buttonCorner: "rounded",
        buttonBgColor: primaryColor,
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#0f172a", textColor: "#ffffff", paddingY: 14, paddingX: 24 },
      },
      {
        id: "bh_loyalty",
        type: "membership_strip",
        condition: "has_loyalty",
        tierTemplate: "{{loyalty_tier}}",
        pointsTemplate: isDe ? "{{loyalty_points_balance}} Punkte" : "{{loyalty_points_balance}} Points",
        linkUrl: "{{portal_link}}",
        showArrow: true,
        iconTone: "navy",
        style: { backgroundColor: "#f1f5f9", textColor: "#0f172a", paddingY: 12, paddingX: 24, borderColor: "#e2e8f0" },
      },
      {
        id: "bh_hero",
        type: "hero_text",
        headline: copy.headline,
        body: copy.body,
        style: { backgroundColor: "#ffffff", textColor: "#0f172a", align: "left", paddingY: 22, paddingX: 28 },
      },
      {
        id: "bh_conf",
        type: "confirmation_number",
        label: isDe ? "RESERVIERUNGSNUMMER" : "CONFIRMATION NUMBER",
        valueTemplate: "{{booking_reference}}",
        style: { backgroundColor: "#f8fafc", textColor: "#0f172a", paddingY: 16, paddingX: 28, borderRadius: 8 },
      },
      {
        id: "bh_dates",
        type: "stay_dates",
        checkInLabel: isDe ? "ANREISE" : "CHECK-IN",
        checkInDateTemplate: "{{check_in_date}}",
        checkInTimeTemplate: "{{check_in_time}}",
        checkOutLabel: isDe ? "ABREISE" : "CHECK-OUT",
        checkOutDateTemplate: "{{check_out_date}}",
        checkOutTimeTemplate: "{{check_out_time}}",
        buttonLabel: copy.ctaLabel,
        buttonUrl: "{{portal_link}}",
        buttonStyle: "filled",
        buttonCorner: "rounded",
        buttonBgColor: primaryColor,
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#ffffff", textColor: "#0f172a", paddingY: 18, paddingX: 28 },
      },
      {
        id: "bh_summary",
        type: "booking_details_table",
        title: isDe ? "Reservierungs- & Rechnungsübersicht" : "Reservation & Billing Summary",
        rows: isDe
          ? [
              { id: "r1", label: "Gast", valueTemplate: "{{guest_name}}", visible: true },
              { id: "r2", label: "Zimmer", valueTemplate: "{{room_name}} ({{room_type}})", visible: true },
              { id: "r3", label: "Nächte", valueTemplate: "{{nights}}", visible: true },
              { id: "r4", label: "Gesamtbetrag", valueTemplate: "{{total_amount}}", visible: true },
              { id: "r5", label: "Offener Betrag", valueTemplate: "{{balance_due}}", visible: true },
            ]
          : [
              { id: "r1", label: "Guest", valueTemplate: "{{guest_name}}", visible: true },
              { id: "r2", label: "Room", valueTemplate: "{{room_name}} ({{room_type}})", visible: true },
              { id: "r3", label: "Nights", valueTemplate: "{{nights}}", visible: true },
              { id: "r4", label: "Total Amount", valueTemplate: "{{total_amount}}", visible: true },
              { id: "r5", label: "Balance Due", valueTemplate: "{{balance_due}}", visible: true },
            ],
      },
      {
        id: "bh_grid",
        type: "icon_link_grid",
        heading: isDe ? "Business-Services vor Ort" : "On-Site Business Essentials",
        iconTone: "navy",
        showArrows: true,
        items: isDe
          ? [
              { id: "bg1", icon: "wifi", label: "Highspeed-WLAN", url: "{{hotel_website}}" },
              { id: "bg2", icon: "parking", label: "Parkmöglichkeiten", url: "{{hotel_website}}" },
              { id: "bg3", icon: "dining", label: "Frühstück & Lounge", url: "{{hotel_website}}" },
              { id: "bg4", icon: "chat", label: "24/7 Rezeption", url: "{{portal_link}}" },
            ]
          : [
              { id: "bg1", icon: "wifi", label: "High-Speed Wi-Fi", url: "{{hotel_website}}" },
              { id: "bg2", icon: "parking", label: "Parking Info", url: "{{hotel_website}}" },
              { id: "bg3", icon: "dining", label: "Dining & Lounge", url: "{{hotel_website}}" },
              { id: "bg4", icon: "chat", label: "Front Desk", url: "{{portal_link}}" },
            ],
        style: { backgroundColor: "#ffffff", textColor: "#0f172a", paddingY: 18, paddingX: 28 },
      },
      commonFooterNav,
      ...commonFooterBlocks,
    ];

    return {
      schemaVersion: 3,
      subject: copy.subject,
      preheader: copy.preheader,
      branding: baseBranding,
      blocks,
    };
  }

  if (presetId === "minimal") {
    const blocks: EmailBlock[] = [
      {
        id: "mn_header",
        type: "brand_header",
        logoUrl: logoUrl || undefined,
        logoImageId,
        logoAlt: "{{hotel_name}}",
        logoWidthPx: 120,
        showHotelName: true,
        showAddress: true,
        showPhone: true,
        iconTone: "muted",
        style: { backgroundColor: "#ffffff", paddingY: 20, paddingX: 28, borderColor: "#e4e4e7" },
      },
      {
        id: "mn_loyalty",
        type: "membership_strip",
        condition: "has_loyalty",
        tierTemplate: "{{loyalty_tier}}",
        pointsTemplate: isDe ? "{{loyalty_points_balance}} Punkte" : "{{loyalty_points_balance}} Points",
        showArrow: false,
        iconTone: "emerald",
        style: { backgroundColor: "#fafafa", textColor: "#18181b", paddingY: 10, paddingX: 24, borderColor: "#e4e4e7" },
      },
      {
        id: "mn_hero",
        type: "hero_text",
        headline: copy.headline,
        body: copy.body,
        style: { backgroundColor: "#ffffff", textColor: "#18181b", align: "center", paddingY: 24, paddingX: 32 },
      },
      {
        id: "mn_conf",
        type: "confirmation_number",
        label: isDe ? "BUCHUNGSREFERENZ" : "CONFIRMATION NUMBER",
        valueTemplate: "{{booking_reference}}",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 10, paddingX: 28 },
      },
      {
        id: "mn_dates",
        type: "stay_dates",
        checkInLabel: isDe ? "CHECK-IN" : "CHECK-IN",
        checkInDateTemplate: "{{check_in_date}}",
        checkInTimeTemplate: "{{check_in_time}}",
        checkOutLabel: isDe ? "CHECK-OUT" : "CHECK-OUT",
        checkOutDateTemplate: "{{check_out_date}}",
        checkOutTimeTemplate: "{{check_out_time}}",
        buttonLabel: copy.ctaLabel,
        buttonUrl: "{{portal_link}}",
        buttonStyle: "dark",
        buttonCorner: "rounded",
        buttonBgColor: "#18181b",
        buttonTextColor: "#ffffff",
        style: { backgroundColor: "#ffffff", textColor: "#18181b", paddingY: 18, paddingX: 28 },
      },
      {
        id: "mn_div",
        type: "icon_divider",
        icon: "calendar",
        iconTone: "muted",
        lineColor: "#e4e4e7",
        style: { backgroundColor: "#ffffff", paddingY: 10, paddingX: 28 },
      },
      {
        id: "mn_table",
        type: "booking_details_table",
        title: isDe ? "Ihre Reservierungsdetails" : "Reservation Summary",
        rows: isDe
          ? [
              { id: "mr1", label: "Gast", valueTemplate: "{{guest_name}}", visible: true },
              { id: "mr2", label: "Zimmer", valueTemplate: "{{room_name}}", visible: true },
              { id: "mr3", label: "Kategorie", valueTemplate: "{{room_type}}", visible: true },
              { id: "mr4", label: "Gesamtbetrag", valueTemplate: "{{total_amount}}", visible: true },
            ]
          : [
              { id: "mr1", label: "Guest", valueTemplate: "{{guest_name}}", visible: true },
              { id: "mr2", label: "Room", valueTemplate: "{{room_name}}", visible: true },
              { id: "mr3", label: "Room Type", valueTemplate: "{{room_type}}", visible: true },
              { id: "mr4", label: "Total Amount", valueTemplate: "{{total_amount}}", visible: true },
            ],
      },
      commonFooterNav,
      ...commonFooterBlocks,
    ];

    return {
      schemaVersion: 3,
      subject: copy.subject,
      preheader: copy.preheader,
      branding: baseBranding,
      blocks,
    };
  }

  // "boutique"
  const blocks: EmailBlock[] = [
    {
      id: "bt_header",
      type: "brand_header",
      logoUrl: logoUrl || undefined,
      logoImageId,
      logoAlt: "{{hotel_name}}",
      logoWidthPx: 135,
      showHotelName: true,
      showAddress: true,
      showPhone: true,
      iconTone: "burgundy",
      style: { backgroundColor: "#faf8f5", paddingY: 20, paddingX: 28, borderColor: "#e7e5e4" },
    },
    {
      id: "bt_loyalty",
      type: "membership_strip",
      condition: "has_loyalty",
      tierTemplate: "{{loyalty_tier}}",
      pointsTemplate: isDe ? "{{loyalty_points_balance}} Punkte" : "{{loyalty_points_balance}} Points",
      linkUrl: "{{portal_link}}",
      showArrow: true,
      iconTone: "burgundy",
      style: { backgroundColor: "#f5f0ea", textColor: "#292524", paddingY: 12, paddingX: 24, borderColor: "#e7e5e4" },
    },
    {
      id: "bt_hero",
      type: "hero_text",
      headline: copy.headline,
      body: copy.body,
      style: { backgroundColor: "#ffffff", textColor: "#292524", align: "center", paddingY: 26, paddingX: 32 },
    },
    {
      id: "bt_conf",
      type: "confirmation_number",
      label: isDe ? "RESERVIERUNGSNUMMER" : "CONFIRMATION NUMBER",
      valueTemplate: "{{booking_reference}}",
      style: { backgroundColor: "#ffffff", textColor: "#292524", paddingY: 10, paddingX: 28 },
    },
    {
      id: "bt_dates",
      type: "stay_dates",
      checkInLabel: isDe ? "CHECK-IN" : "CHECK-IN",
      checkInDateTemplate: "{{check_in_date}}",
      checkInTimeTemplate: "{{check_in_time}}",
      checkOutLabel: isDe ? "CHECK-OUT" : "CHECK-OUT",
      checkOutDateTemplate: "{{check_out_date}}",
      checkOutTimeTemplate: "{{check_out_time}}",
      buttonLabel: copy.ctaLabel,
      buttonUrl: "{{portal_link}}",
      buttonStyle: "outlined",
      buttonCorner: "square",
      buttonBgColor: primaryColor,
      buttonTextColor: primaryColor,
      style: { backgroundColor: "#ffffff", textColor: "#292524", paddingY: 16, paddingX: 28 },
    },
    {
      id: "bt_div",
      type: "icon_divider",
      icon: "star",
      iconTone: "amber",
      lineColor: "#e7e5e4",
      style: { backgroundColor: "#ffffff", paddingY: 12, paddingX: 28 },
    },
    {
      id: "bt_card1",
      type: "feature_card",
      imagePosition: "left",
      imageUrl: diningImg,
      imageAlt: isDe ? "Kulinarik im Hotel" : "Boutique restaurant dining",
      title: isDe ? "Saisonale Küche & Weinbar" : "Seasonal Kitchen & Wine Bar",
      body: isDe
        ? "Genießen Sie regionale Zutaten und hausgemachte Klassiker in gemütlicher Atmosphäre."
        : "Enjoy locally sourced dishes and curated evening pairings crafted fresh by our kitchen.",
      buttonLabel: isDe ? "Tisch reservieren" : "Reserve a Table",
      buttonUrl: "{{hotel_website}}",
      buttonStyle: "filled",
      buttonCorner: "square",
      buttonBgColor: primaryColor,
      buttonTextColor: "#ffffff",
      style: { backgroundColor: "#ffffff", borderColor: "#e7e5e4", borderRadius: 8, paddingY: 10, paddingX: 24 },
    },
    {
      id: "bt_card2",
      type: "feature_card",
      imagePosition: "right",
      imageUrl: suiteImg,
      imageAlt: isDe ? "Individuelle Zimmerausstattung" : "Boutique suite design",
      title: isDe ? "Persönlicher Concierge-Service" : "Personal Concierge Touches",
      body: isDe
        ? "Ob Flughafentransfer, Kissenwahl oder Geheimtipps im Viertel – schreiben Sie uns vorab."
        : "From airport transfers to neighborhood favorites, let our team personalize your stay before arrival.",
      buttonLabel: isDe ? "Wünsche mitteilen" : "Message Concierge",
      buttonUrl: "{{portal_link}}",
      buttonStyle: "outlined",
      buttonCorner: "square",
      buttonBgColor: primaryColor,
      buttonTextColor: primaryColor,
      style: { backgroundColor: "#ffffff", borderColor: "#e7e5e4", borderRadius: 8, paddingY: 10, paddingX: 24 },
    },
    {
      id: "bt_benefits",
      type: "benefits_list",
      condition: "has_loyalty",
      badgeText: "{{loyalty_tier}}",
      heading: isDe
        ? "Ihre persönlichen {{loyalty_tier}}-Aufmerksamkeiten"
        : "Your Personal {{loyalty_tier}} Privileges",
      listStyle: "icon",
      itemIcon: "gift",
      iconTone: "burgundy",
      items: isDe
        ? [
            { id: "bb1", text: "Begrüßungsgetränk an unserer Bar" },
            { id: "bb2", text: "Zimmer-Upgrade nach Verfügbarkeit" },
            { id: "bb3", text: "Aktueller Punktestand: {{loyalty_points_balance}}" },
          ]
        : [
            { id: "bb1", text: "Complimentary welcome drink at our lounge bar" },
            { id: "bb2", text: "Room upgrade subject to availability" },
            { id: "bb3", text: "Current points balance: {{loyalty_points_balance}}" },
          ],
      style: { backgroundColor: "#faf8f5", textColor: "#292524", paddingY: 20, paddingX: 28, borderRadius: 8 },
    },
    commonFooterNav,
    ...commonFooterBlocks,
  ];

  return {
    schemaVersion: 3,
    subject: copy.subject,
    preheader: copy.preheader,
    branding: baseBranding,
    blocks,
  };
}
