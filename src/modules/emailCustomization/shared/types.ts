/**
 * Shared types, event registry metadata, allow-listed merge variables,
 * and typed block schemas for the Multi-Tenant Email Customization Module.
 */

export type CustomizableEmailEventType =
  | "booking_confirmation"
  | "booking_cancellation"
  | "checked_in"
  | "checked_out"
  | "booking_modified"
  | "pre_arrival_reminder"
  | "payment_receipt"
  | "no_show"
  | "post_stay_feedback_request";

export type SystemFixedEmailEventType = "tracking_code_request_alert";

export type HotelEmailEventType =
  | CustomizableEmailEventType
  | SystemFixedEmailEventType;

export type SupportedEmailLanguage = "en" | "de";

export const SUPPORTED_EMAIL_LANGUAGES: { code: SupportedEmailLanguage; label: string }[] = [
  { code: "en", label: "English" },
  { code: "de", label: "Deutsch" },
];

export const CUSTOMIZABLE_EMAIL_EVENTS: CustomizableEmailEventType[] = [
  "booking_confirmation",
  "booking_cancellation",
  "checked_in",
  "checked_out",
  "booking_modified",
  "pre_arrival_reminder",
  "payment_receipt",
  "no_show",
  "post_stay_feedback_request",
];

export const SYSTEM_FIXED_EMAIL_EVENTS: SystemFixedEmailEventType[] = [
  "tracking_code_request_alert",
];

/**
 * Strict merge-tag allow-list. Unknown variables are rejected at save time and never rendered raw.
 */
export const ALLOWED_TEMPLATE_VARIABLES = [
  "guest_name",
  "guest_first_name",
  "hotel_name",
  "hotel_phone",
  "hotel_address",
  "hotel_email",
  "hotel_website",
  "room_name",
  "room_type",
  "check_in_date",
  "check_in_time",
  "check_out_date",
  "check_out_time",
  "nights",
  "booking_reference",
  "total_amount",
  "deposit_amount",
  "balance_due",
  "loyalty_points_earned",
  "loyalty_points_balance",
  "loyalty_tier",
  "booking_link",
  "portal_link",
  "app_url",
] as const;

export type AllowedTemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

export const ALLOWED_URL_VARIABLES = new Set<string>([
  "{{portal_link}}",
  "{{hotel_website}}",
  "{{booking_link}}",
  "{{app_url}}",
]);

export const VARIABLE_DESCRIPTIONS: Record<
  AllowedTemplateVariable,
  { label: string; group: "Guest" | "Hotel" | "Stay" | "Billing" | "Loyalty" | "Links"; sample: string }
> = {
  guest_name: { label: "Guest Full Name", group: "Guest", sample: "Alex Morgan" },
  guest_first_name: { label: "Guest First Name", group: "Guest", sample: "Alex" },
  hotel_name: { label: "Hotel Name", group: "Hotel", sample: "Harborview Suites" },
  hotel_phone: { label: "Hotel Phone", group: "Hotel", sample: "+49 30 555 0199" },
  hotel_address: { label: "Hotel Address", group: "Hotel", sample: "Friedrichstrasse 101, 10117 Berlin" },
  hotel_email: { label: "Hotel Email", group: "Hotel", sample: "reservations@harborview.example" },
  hotel_website: { label: "Hotel Website", group: "Links", sample: "https://harborview.example" },
  room_name: { label: "Room Name / Number", group: "Stay", sample: "Room 204" },
  room_type: { label: "Room Type", group: "Stay", sample: "Deluxe King Suite" },
  check_in_date: { label: "Check-In Date", group: "Stay", sample: "2026-11-24" },
  check_in_time: { label: "Check-In Time", group: "Stay", sample: "14:00" },
  check_out_date: { label: "Check-Out Date", group: "Stay", sample: "2026-11-27" },
  check_out_time: { label: "Check-Out Time", group: "Stay", sample: "12:00" },
  nights: { label: "Nights", group: "Stay", sample: "3" },
  booking_reference: { label: "Booking Reference", group: "Stay", sample: "RES8A4F2" },
  total_amount: { label: "Total Amount", group: "Billing", sample: "NGN 270,000.00" },
  deposit_amount: { label: "Deposit / Paid Amount", group: "Billing", sample: "NGN 90,000.00" },
  balance_due: { label: "Balance Due", group: "Billing", sample: "NGN 180,000.00" },
  loyalty_points_earned: { label: "Loyalty Points Earned", group: "Loyalty", sample: "450" },
  loyalty_points_balance: { label: "Loyalty Points Balance", group: "Loyalty", sample: "2,150" },
  loyalty_tier: { label: "Loyalty Tier", group: "Loyalty", sample: "Gold" },
  booking_link: { label: "Booking Page URL", group: "Links", sample: "https://harborview.example/book" },
  portal_link: { label: "Hotel Portal URL", group: "Links", sample: "https://tidehotels.de" },
  app_url: { label: "Platform App URL", group: "Links", sample: "https://tidehotels.de" },
};

export const WEB_SAFE_FONTS = [
  { id: "arial", label: "Arial / Helvetica", css: "Arial, Helvetica, sans-serif" },
  { id: "georgia", label: "Georgia (Serif)", css: "Georgia, 'Times New Roman', serif" },
  { id: "verdana", label: "Verdana", css: "Verdana, Geneva, sans-serif" },
  { id: "tahoma", label: "Tahoma", css: "Tahoma, Geneva, sans-serif" },
  { id: "trebuchet", label: "Trebuchet MS", css: "'Trebuchet MS', Helvetica, sans-serif" },
  { id: "times", label: "Times New Roman", css: "'Times New Roman', Times, serif" },
] as const;

export type WebSafeFontId = (typeof WEB_SAFE_FONTS)[number]["id"];

export type BlockCondition = "always" | "has_loyalty" | "has_balance_due" | "has_deposit";

export type EmailBlockType =
  | "heading"
  | "paragraph"
  | "image"
  | "button"
  | "divider"
  | "spacer"
  | "booking_details_table"
  | "two_column_text"
  | "social_links"
  | "footer";

export interface EmailBlockBase {
  id: string;
  type: EmailBlockType;
  condition?: BlockCondition;
}

export interface HeadingBlock extends EmailBlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  align?: "left" | "center" | "right";
  color?: string;
}

export interface ParagraphBlock extends EmailBlockBase {
  type: "paragraph";
  text: string;
  align?: "left" | "center" | "right";
  tone?: "default" | "muted" | "accent";
}

export interface ImageBlock extends EmailBlockBase {
  type: "image";
  imageId?: string;
  src: string;
  alt: string;
  widthPx: number;
  align?: "left" | "center" | "right";
  fallbackBg?: string;
  linkUrl?: string;
}

export interface ButtonBlock extends EmailBlockBase {
  type: "button";
  label: string;
  url: string;
  displayStyle: "solid" | "outline" | "text_link";
  prefixText?: string;
  align?: "left" | "center" | "right";
  bgColor?: string;
  textColor?: string;
}

export interface DividerBlock extends EmailBlockBase {
  type: "divider";
  color?: string;
  thicknessPx?: number;
}

export interface SpacerBlock extends EmailBlockBase {
  type: "spacer";
  heightPx: number;
}

export interface BookingDetailsRowConfig {
  id: string;
  label: string;
  valueTemplate: string;
  visible: boolean;
}

export interface BookingDetailsTableBlock extends EmailBlockBase {
  type: "booking_details_table";
  title?: string;
  rows: BookingDetailsRowConfig[];
}

export interface TwoColumnTextBlock extends EmailBlockBase {
  type: "two_column_text";
  leftTitle?: string;
  leftText: string;
  rightTitle?: string;
  rightText: string;
}

export interface SocialLinkItem {
  id: string;
  label: string;
  url: string;
}

export interface SocialLinksBlock extends EmailBlockBase {
  type: "social_links";
  title?: string;
  links: SocialLinkItem[];
  align?: "left" | "center" | "right";
}

export type ContactFieldKey = "address" | "phone" | "email" | "website" | "custom";

export interface FooterContactField {
  id: string;
  key: ContactFieldKey;
  label: string;
  valueTemplate: string;
  visible: boolean;
}

export interface FooterBlock extends EmailBlockBase {
  type: "footer";
  showContactBlock: boolean;
  contactTitle: string;
  fields: FooterContactField[];
  legalImprintText?: string;
  footerNote?: string;
}

export type EmailBlock =
  | HeadingBlock
  | ParagraphBlock
  | ImageBlock
  | ButtonBlock
  | DividerBlock
  | SpacerBlock
  | BookingDetailsTableBlock
  | TwoColumnTextBlock
  | SocialLinksBlock
  | FooterBlock;

export interface EmailTemplateBranding {
  accentBarEnabled: boolean;
  accentBarColor: string;
  accentBarThicknessPx: number;
  showEyebrow: boolean;
  eyebrowText: string;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontFamily: WebSafeFontId;
  showLogo: boolean;
  logoUrl?: string;
  logoImageId?: string;
  logoAlt?: string;
  logoWidthPx?: number;
}

export interface EmailTemplateVariant {
  subject: string;
  preheader: string;
  branding: EmailTemplateBranding;
  portalUrlOverride?: string;
  blocks: EmailBlock[];
}

export interface EmailTemplateVersionSnapshot {
  version: number;
  savedAt: string;
  savedBy: string;
  note?: string;
  variants: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>>;
}

export interface EmailTemplateDocument {
  eventType: CustomizableEmailEventType;
  enabled: boolean;
  isCustomized: boolean;
  defaultLanguage: SupportedEmailLanguage;
  publishedVersion: number;
  draft: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>>;
  published: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>>;
  versions: EmailTemplateVersionSnapshot[];
  updatedBy?: string;
  updatedAt?: string;
}

export type DateFormatPreset =
  | "iso" // 2026-11-19
  | "dd_mmm_yyyy" // 19 Nov 2026
  | "dd_dot_mm_dot_yyyy" // 19.11.2026
  | "mm_slash_dd_slash_yyyy" // 11/19/2026
  | "dd_slash_mm_slash_yyyy"; // 19/11/2026

export interface CurrencyDisplaySettings {
  mode: "code" | "symbol";
  decimals: 0 | 2;
  thousandsSeparator: "," | "." | " ";
}

export interface HotelEmailSettings {
  portalUrl?: string;
  bookingUrl?: string;
  senderDisplayName?: string;
  replyToEmail?: string;
  defaultLanguage: SupportedEmailLanguage;
  timeZone: string;
  dateFormat: DateFormatPreset;
  timeFormat: "12h" | "24h";
  currencyDisplay: CurrencyDisplaySettings;
  preArrivalDaysBefore: number;
  postStayDaysAfter: number;
  contactOverrides?: {
    address?: string;
    phone?: string;
    email?: string;
    website?: string;
  };
  legalImprint?: string;
  updatedBy?: string;
  updatedAt?: string;
}

export interface EmailImageAsset {
  id: string;
  hotelId: string;
  label: string;
  url: string;
  storagePath: string;
  storageProvider?: "local" | "cloudinary";
  mimeType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
}

export interface EventCatalogEntry {
  eventType: CustomizableEmailEventType;
  name: string;
  description: string;
  audience: "guest" | "hotel_staff";
  requiresScheduler?: boolean;
  markerKey: string;
  allowedVariables: AllowedTemplateVariable[];
}

export interface EmailRenderContext {
  hotelId: string;
  hotelName: string;
  hotelPhone?: string;
  hotelAddress?: string;
  hotelEmail?: string;
  hotelWebsite?: string;
  hotelLogoUrl?: string;
  hotelPrimaryColor?: string;
  hotelSecondaryColor?: string;
  hotelFooterNotes?: string;
  currencyCode: string;
  appUrl: string;
  guestName?: string;
  guestEmail?: string;
  guestLanguage?: string;
  roomName?: string;
  roomType?: string;
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  nights?: number;
  bookingReference?: string;
  totalAmount?: number;
  depositAmount?: number;
  balanceDue?: number;
  /** Optional real loyalty fields when present on guest/reservation; never invented */
  loyaltyPointsEarned?: number | null;
  loyaltyPointsBalance?: number | null;
  loyaltyTier?: string | null;
}

export interface RenderedEmailOutput {
  subject: string;
  preheader: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
  usedDefaultLayout: boolean;
}

export const DEFAULT_HOTEL_EMAIL_SETTINGS: HotelEmailSettings = {
  portalUrl: "",
  bookingUrl: "",
  senderDisplayName: "",
  replyToEmail: "",
  defaultLanguage: "en",
  timeZone: "UTC",
  dateFormat: "iso",
  timeFormat: "24h",
  currencyDisplay: {
    mode: "code",
    decimals: 2,
    thousandsSeparator: ",",
  },
  preArrivalDaysBefore: 1,
  postStayDaysAfter: 1,
  contactOverrides: {},
  legalImprint: "",
};

export const IMAGE_LIMITS = {
  maxFileSizeBytes: 2 * 1024 * 1024, // 2 MB
  maxWidthPx: 2000,
  maxImagesPerHotel: 30,
  maxTotalBytesPerHotel: 20 * 1024 * 1024, // 20 MB total per hotel
} as const;

export const EMAIL_MODULE_BASE_CONFIG = {
  moduleId: "email_templates",
  featureFlagEnvVar: "EMAIL_CUSTOMIZATION_ENABLED",
  defaultLanguage: "en" as SupportedEmailLanguage,
  supportedLanguages: SUPPORTED_EMAIL_LANGUAGES,
  defaultCurrency: "NGN",
  maxVersionHistory: 10,
  defaultSettings: DEFAULT_HOTEL_EMAIL_SETTINGS,
  imageLimits: IMAGE_LIMITS,
} as const;
