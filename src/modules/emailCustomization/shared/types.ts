/**
 * Shared types, event registry metadata, allow-listed merge variables,
 * and typed block schemas for the Multi-Tenant Email Customization Module.
 */

export type EmailTemplateCategory =
  | "guest_stays"
  | "payments_billing"
  | "loyalty_rewards"
  | "corporate"
  | "staff_operations";

export type CustomizableEmailEventType =
  // Guest Stays & Reservations (existing IDs strictly preserved)
  | "booking_confirmation"
  | "booking_cancellation"
  | "checked_in"
  | "checked_out"
  | "booking_modified"
  | "pre_arrival_reminder"
  | "post_stay_feedback_request"
  | "guest_profile_created"
  | "fnb_order_posted"
  | "room_transferred"
  | "stay_extended"
  // Payments, Deposits, Discounts & Refunds
  | "payment_receipt"
  | "deposit_received"
  | "refund_processed"
  | "invoice_issued"
  | "receipt_sent"
  | "discount_settlement_confirmation"
  | "folio_charge_posted"
  | "folio_charge_voided"
  | "folio_discount_applied"
  | "folio_balance_transferred"
  // Guest Loyalty & Rewards
  | "loyalty_account_activated"
  | "loyalty_points_awarded"
  | "loyalty_points_deducted"
  | "loyalty_points_redeemed"
  | "loyalty_tier_upgraded"
  | "loyalty_points_expiring"
  | "loyalty_points_expired"
  // Corporate & City Ledger
  | "corporate_account_created"
  | "corporate_city_ledger_transfer"
  | "corporate_payment_settled"
  | "corporate_low_balance_alert"
  // Staff & Hotel Operations
  | "no_show"
  | "staff_account_activation"
  | "staff_password_reset"
  | "staff_account_status_changed"
  | "fnb_order_voided"
  | "housekeeping_room_ready"
  | "housekeeping_inspection_failed"
  | "housekeeping_guest_request"
  | "maintenance_issue_reported"
  | "maintenance_issue_resolved"
  | "guest_blacklisted"
  | "daily_revenue_deficit_alert"
  | "operational_alert";

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
  // Guest Stays & Reservations
  "booking_confirmation",
  "booking_modified",
  "booking_cancellation",
  "checked_in",
  "checked_out",
  "pre_arrival_reminder",
  "post_stay_feedback_request",
  "guest_profile_created",
  "fnb_order_posted",
  "room_transferred",
  "stay_extended",
  // Payments, Deposits, Discounts & Refunds
  "payment_receipt",
  "deposit_received",
  "refund_processed",
  "invoice_issued",
  "receipt_sent",
  "discount_settlement_confirmation",
  "folio_charge_posted",
  "folio_charge_voided",
  "folio_discount_applied",
  "folio_balance_transferred",
  // Guest Loyalty & Rewards
  "loyalty_account_activated",
  "loyalty_points_awarded",
  "loyalty_points_deducted",
  "loyalty_points_redeemed",
  "loyalty_tier_upgraded",
  "loyalty_points_expiring",
  "loyalty_points_expired",
  // Corporate & City Ledger
  "corporate_account_created",
  "corporate_city_ledger_transfer",
  "corporate_payment_settled",
  "corporate_low_balance_alert",
  // Staff & Hotel Operations
  "no_show",
  "staff_account_activation",
  "staff_password_reset",
  "staff_account_status_changed",
  "fnb_order_voided",
  "housekeeping_room_ready",
  "housekeeping_inspection_failed",
  "housekeeping_guest_request",
  "maintenance_issue_reported",
  "maintenance_issue_resolved",
  "guest_blacklisted",
  "daily_revenue_deficit_alert",
  "operational_alert",
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
  "legal_imprint",
  "room_name",
  "room_number",
  "room_type",
  "previous_room",
  "check_in_date",
  "check_in_time",
  "check_out_date",
  "check_out_time",
  "previous_check_out",
  "nights",
  "extra_nights",
  "booking_reference",
  "reservation_number",
  "charge_amount",
  "item_description",
  "charge_category",
  "rate_adjustment",
  "transfer_target",
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
  "loyalty_points",
  "loyalty_points_earned",
  "loyalty_points_balance",
  "points_balance",
  "loyalty_tier",
  "previous_tier",
  "loyalty_tier_benefits",
  "loyalty_all_tiers_benefits",
  "redemption_value",
  "expiry_date",
  "reason",
  "staff_name",
  "staff_status",
  "corporate_name",
  "outlet_name",
  "bill_number",
  "issue_summary",
  "priority",
  "action_link",
  "booking_link",
  "portal_link",
  "app_url",
  "review_link",
  "directions_link",
  "wifi_guide_link",
  "social_instagram",
  "social_facebook",
  "social_x",
  "social_linkedin",
] as const;

export type AllowedTemplateVariable = (typeof ALLOWED_TEMPLATE_VARIABLES)[number];

export const ALLOWED_URL_VARIABLES = new Set<string>([
  "{{portal_link}}",
  "{{hotel_website}}",
  "{{booking_link}}",
  "{{action_link}}",
  "{{app_url}}",
  "{{review_link}}",
  "{{directions_link}}",
  "{{wifi_guide_link}}",
  "{{social_instagram}}",
  "{{social_facebook}}",
  "{{social_x}}",
  "{{social_linkedin}}",
]);

export const ALLOWED_CONTACT_URL_VARIABLES = new Set<string>([
  "mailto:{{hotel_email}}",
  "tel:{{hotel_phone}}",
]);

export const VARIABLE_DESCRIPTIONS: Record<
  AllowedTemplateVariable,
  {
    label: string;
    group: "Guest" | "Hotel" | "Stay" | "Billing" | "Loyalty" | "Operations" | "Links";
    sample: string;
  }
> = {
  guest_name: { label: "Guest Full Name", group: "Guest", sample: "Alex Morgan" },
  guest_first_name: { label: "Guest First Name", group: "Guest", sample: "Alex" },
  hotel_name: { label: "Hotel Name", group: "Hotel", sample: "Harborview Suites" },
  hotel_phone: { label: "Hotel Phone", group: "Hotel", sample: "+49 30 555 0199" },
  hotel_address: { label: "Hotel Address", group: "Hotel", sample: "Friedrichstrasse 101, 10117 Berlin" },
  hotel_email: { label: "Hotel Email", group: "Hotel", sample: "reservations@harborview.example" },
  hotel_website: { label: "Hotel Website", group: "Links", sample: "https://harborview.example" },
  legal_imprint: { label: "Legal / Imprint Text", group: "Hotel", sample: "Harborview Suites GmbH · VAT DE123456789" },
  room_name: { label: "Room Name / Number", group: "Stay", sample: "Room 204" },
  room_number: { label: "Room Number", group: "Stay", sample: "204" },
  room_type: { label: "Room Type", group: "Stay", sample: "Deluxe King Suite" },
  previous_room: { label: "Previous Room (Room Transfer)", group: "Stay", sample: "Room 108 (Standard Queen)" },
  check_in_date: { label: "Check-In Date", group: "Stay", sample: "2026-11-24" },
  check_in_time: { label: "Check-In Time", group: "Stay", sample: "14:00" },
  check_out_date: { label: "Check-Out Date", group: "Stay", sample: "2026-11-27" },
  check_out_time: { label: "Check-Out Time", group: "Stay", sample: "12:00" },
  previous_check_out: { label: "Previous Check-Out Date", group: "Stay", sample: "2026-11-25" },
  nights: { label: "Nights", group: "Stay", sample: "3" },
  extra_nights: { label: "Additional Nights Added", group: "Stay", sample: "2" },
  booking_reference: { label: "Booking Reference", group: "Stay", sample: "RES8A4F2" },
  reservation_number: { label: "Reservation Number", group: "Stay", sample: "RES8A4F2" },
  charge_amount: { label: "Posted / Transaction Amount", group: "Billing", sample: "NGN 20,000.00" },
  item_description: { label: "Item / Charge Description", group: "Billing", sample: "Main Restaurant — Grilled Fish & Juice" },
  charge_category: { label: "Charge Category", group: "Billing", sample: "F & B" },
  rate_adjustment: { label: "Room Rate Adjustment", group: "Billing", sample: "+NGN 25,000.00" },
  transfer_target: { label: "Transfer Destination", group: "Billing", sample: "Meridian Travel Group City Ledger" },
  total_amount: { label: "Total Amount", group: "Billing", sample: "NGN 100,000.00" },
  original_amount: { label: "Original Amount (Before Discount)", group: "Billing", sample: "NGN 100,000.00" },
  discount_amount: { label: "Discount Granted", group: "Billing", sample: "NGN 20,000.00" },
  amount_paid: { label: "Amount Paid / Settled", group: "Billing", sample: "NGN 80,000.00" },
  deposit_amount: { label: "Deposit / Payment Amount", group: "Billing", sample: "NGN 50,000.00" },
  deposit_balance: { label: "Updated Deposit Balance", group: "Billing", sample: "NGN 125,000.00" },
  refund_amount: { label: "Refund Amount", group: "Billing", sample: "NGN 25,000.00" },
  balance_due: { label: "Remaining Balance Due", group: "Billing", sample: "NGN 0.00" },
  remaining_balance: { label: "Actual Remaining Balance", group: "Billing", sample: "NGN 0.00" },
  payment_status: { label: "Payment Status", group: "Billing", sample: "Fully Settled" },
  payment_method: { label: "Payment Method", group: "Billing", sample: "TRANSFER" },
  transaction_reference: { label: "Transaction / Deposit Reference", group: "Billing", sample: "TXN-89421" },
  transaction_date: { label: "Transaction / Deposit Date", group: "Billing", sample: "2026-11-22" },
  loyalty_points: { label: "Loyalty Points (Transaction)", group: "Loyalty", sample: "+450 pts" },
  loyalty_points_earned: { label: "Loyalty Points Earned", group: "Loyalty", sample: "450" },
  loyalty_points_balance: { label: "Loyalty Points Balance", group: "Loyalty", sample: "2,150" },
  points_balance: { label: "Available Points Balance", group: "Loyalty", sample: "2,150 pts" },
  loyalty_tier: { label: "Loyalty Membership Level", group: "Loyalty", sample: "Gold" },
  previous_tier: { label: "Previous Loyalty Tier", group: "Loyalty", sample: "Silver" },
  loyalty_tier_benefits: {
    label: "Current Tier Benefits",
    group: "Loyalty",
    sample: "Late check-out subject to availability • Room upgrade priority • Welcome amenity",
  },
  loyalty_all_tiers_benefits: {
    label: "All Membership Tiers & Benefits",
    group: "Loyalty",
    sample: "Standard (0+ pts), Silver (500+ pts), Gold (2,000+ pts), Platinum (5,000+ pts) full benefits",
  },
  redemption_value: { label: "Points Redemption Value", group: "Loyalty", sample: "NGN 5,000.00" },
  expiry_date: { label: "Points Expiry Date", group: "Loyalty", sample: "2027-01-31" },
  reason: { label: "Reason / Notes", group: "Operations", sample: "Front desk adjustment" },
  staff_name: { label: "Staff Member Name", group: "Operations", sample: "Jordan Taylor" },
  staff_status: { label: "Account Status", group: "Operations", sample: "ACTIVE" },
  corporate_name: { label: "Corporate Account Name", group: "Operations", sample: "Meridian Travel Group" },
  outlet_name: { label: "Restaurant / F&B Outlet", group: "Operations", sample: "Main Restaurant" },
  bill_number: { label: "Order / Bill Number", group: "Operations", sample: "FNB-1042" },
  issue_summary: { label: "Maintenance / Alert Summary", group: "Operations", sample: "AC thermostat check in Room 204" },
  priority: { label: "Priority Level", group: "Operations", sample: "HIGH" },
  action_link: { label: "Secure Action Link (Auth/Reset)", group: "Links", sample: "https://your-hotel.example/auth-action" },
  booking_link: { label: "Booking Page URL", group: "Links", sample: "https://harborview.example/book" },
  portal_link: { label: "Hotel Portal URL (Configured)", group: "Links", sample: "https://harborview.example/portal" },
  app_url: { label: "PMS Staff App URL", group: "Links", sample: "https://harborview.example" },
  review_link: { label: "Guest Review Page URL", group: "Links", sample: "https://harborview.example/review" },
  directions_link: { label: "Directions / Map URL", group: "Links", sample: "https://harborview.example/directions" },
  wifi_guide_link: { label: "Wi-Fi & Guest Guide URL", group: "Links", sample: "https://harborview.example/wifi" },
  social_instagram: { label: "Instagram URL", group: "Links", sample: "https://instagram.com/harborviewsuites" },
  social_facebook: { label: "Facebook URL", group: "Links", sample: "https://facebook.com/harborviewsuites" },
  social_x: { label: "X (Twitter) URL", group: "Links", sample: "https://x.com/harborviewsuites" },
  social_linkedin: { label: "LinkedIn URL", group: "Links", sample: "https://linkedin.com/company/harborviewsuites" },
};

export interface InlineTextLink {
  id: string;
  label: string;
  url: string;
  color?: string;
  underline?: boolean;
  openInNewTab?: boolean;
  hidden?: boolean;
}

export interface LocalizedLinkValue {
  defaultUrl?: string;
  byLanguage?: Partial<Record<SupportedEmailLanguage, string>>;
}

export interface HotelDefaultLinks {
  website?: LocalizedLinkValue;
  booking?: LocalizedLinkValue;
  portal?: LocalizedLinkValue;
  review?: LocalizedLinkValue;
  directions?: LocalizedLinkValue;
  wifiGuide?: LocalizedLinkValue;
  socialInstagram?: LocalizedLinkValue;
  socialFacebook?: LocalizedLinkValue;
  socialX?: LocalizedLinkValue;
  socialLinkedin?: LocalizedLinkValue;
}

export interface TemplateLinkOverviewItem {
  id: string;
  blockId: string;
  blockIndex: number;
  blockLabel: string;
  location: string;
  text: string;
  rawUrl: string;
  resolvedUrl: string;
  hidden: boolean;
  status: "valid" | "empty_variable" | "invalid";
  error?: string;
}

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

export const EMAIL_ICON_NAMES = [
  "location_pin",
  "phone",
  "calendar",
  "key",
  "map",
  "dining",
  "activities",
  "spa",
  "wifi",
  "parking",
  "chat",
  "check",
  "arrow",
  "star",
  "gift",
] as const;

export type EmailIconName = (typeof EMAIL_ICON_NAMES)[number];

export const EMAIL_ICON_LABELS: Record<EmailIconName, string> = {
  location_pin: "Location Pin",
  phone: "Phone",
  calendar: "Calendar",
  key: "Room Key",
  map: "Map",
  dining: "Dining",
  activities: "Activities",
  spa: "Spa & Wellness",
  wifi: "Wi-Fi",
  parking: "Parking",
  chat: "Concierge Chat",
  check: "Checkmark",
  arrow: "Arrow",
  star: "Star",
  gift: "Gift / Welcome",
};

export const EMAIL_ICON_TONES = [
  "dark",
  "light",
  "muted",
  "emerald",
  "navy",
  "burgundy",
  "amber",
] as const;

export type EmailIconTone = (typeof EMAIL_ICON_TONES)[number];

export const EMAIL_ICON_TONE_HEX: Record<EmailIconTone, { label: string; hex: string }> = {
  dark: { label: "Charcoal", hex: "#18181b" },
  light: { label: "White", hex: "#ffffff" },
  muted: { label: "Slate", hex: "#71717a" },
  emerald: { label: "Emerald", hex: "#059669" },
  navy: { label: "Navy", hex: "#1e3a5f" },
  burgundy: { label: "Burgundy", hex: "#881337" },
  amber: { label: "Warm Gold", hex: "#b45309" },
};

export type ModernButtonStyle = "filled" | "outlined" | "dark";
export type ButtonCornerStyle = "square" | "rounded" | "pill";

export type EmailHorizontalAlign = "left" | "center" | "right";
export type EmailTextAlign = "left" | "center" | "right" | "justify";
export type EmailVerticalAlign = "top" | "middle" | "bottom";

export interface BlockStyleConfig {
  backgroundColor?: string;
  textColor?: string;
  borderColor?: string;
  accentColor?: string;
  align?: EmailHorizontalAlign;
  verticalAlign?: EmailVerticalAlign;
  paddingY?: number; // 0..40 px
  paddingX?: number; // 0..40 px
  borderRadius?: number; // 0..16 px
  fontFamily?: WebSafeFontId;
  fontSizePx?: number; // 10..24 px
}

export type LegacyEmailBlockType =
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

export type ModernEmailBlockType =
  | "brand_header"
  | "promo_banner"
  | "membership_strip"
  | "icon_divider"
  | "hero_text"
  | "confirmation_number"
  | "stay_dates"
  | "feature_card"
  | "benefits_list"
  | "icon_link_grid"
  | "image_with_list"
  | "footer_nav"
  | "legal_section"
  | "footer_contact"
  | "footer_authenticity"
  | "footer_copyright"
  | "footer_legal"
  | "footer_powered_by";

export type EmailBlockType = LegacyEmailBlockType | ModernEmailBlockType;

export const MODERN_EMAIL_BLOCK_TYPES: readonly ModernEmailBlockType[] = [
  "brand_header",
  "promo_banner",
  "membership_strip",
  "icon_divider",
  "hero_text",
  "confirmation_number",
  "stay_dates",
  "feature_card",
  "benefits_list",
  "icon_link_grid",
  "image_with_list",
  "footer_nav",
  "legal_section",
  "footer_contact",
  "footer_authenticity",
  "footer_copyright",
  "footer_legal",
  "footer_powered_by",
] as const;

export const STANDALONE_FOOTER_BLOCK_TYPES: readonly EmailBlockType[] = [
  "footer_contact",
  "footer_authenticity",
  "footer_copyright",
  "footer_legal",
  "footer_powered_by",
] as const;

export const FOOTER_SECTION_BLOCK_TYPES: readonly EmailBlockType[] = [
  "footer",
  "legal_section",
  "footer_contact",
  "footer_authenticity",
  "footer_copyright",
  "footer_legal",
  "footer_powered_by",
] as const;

export const ALLOWED_DEFAULT_FOOTER_BLOCK_TYPES: readonly EmailBlockType[] = [
  "footer_nav",
  "social_links",
  "footer_contact",
  "footer_authenticity",
  "footer_copyright",
  "footer_legal",
  "footer_powered_by",
  "divider",
  "spacer",
] as const;

export interface EmailBlockBase {
  id: string;
  type: EmailBlockType;
  condition?: BlockCondition;
  /** When true, this block is omitted completely from rendered HTML and plain text */
  hidden?: boolean;
}

export interface HeadingBlock extends EmailBlockBase {
  type: "heading";
  level: 1 | 2 | 3;
  text: string;
  align?: EmailHorizontalAlign;
  verticalAlign?: EmailVerticalAlign;
  color?: string;
}

export interface ParagraphBlock extends EmailBlockBase {
  type: "paragraph";
  text: string;
  align?: EmailTextAlign;
  verticalAlign?: EmailVerticalAlign;
  tone?: "default" | "muted" | "accent";
  inlineLinks?: InlineTextLink[];
}

export interface ImageBlock extends EmailBlockBase {
  type: "image";
  imageId?: string;
  src: string;
  alt: string;
  widthPx: number;
  align?: EmailHorizontalAlign;
  verticalAlign?: EmailVerticalAlign;
  fallbackBg?: string;
  linkUrl?: string;
  linkOpenInNewTab?: boolean;
  linkHidden?: boolean;
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
  borderColor?: string;
  borderRadiusPx?: number;
  underline?: boolean;
  openInNewTab?: boolean;
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
  inlineLinks?: InlineTextLink[];
}

export interface SocialLinkItem {
  id: string;
  label: string;
  url: string;
  hidden?: boolean;
  color?: string;
  underline?: boolean;
  openInNewTab?: boolean;
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
  linkEnabled?: boolean;
  linkColor?: string;
  underline?: boolean;
}

export interface FooterBlock extends EmailBlockBase {
  type: "footer";
  showContactBlock: boolean;
  contactTitle: string;
  fields: FooterContactField[];
  legalImprintText?: string;
  footerNote?: string;
}

// --- 13 New Modern Additive Block Types ---

export interface BrandHeaderBlock extends EmailBlockBase {
  type: "brand_header";
  logoUrl?: string;
  logoImageId?: string;
  logoAlt?: string;
  logoWidthPx?: number;
  logoLinkUrl?: string;
  logoLinkOpenInNewTab?: boolean;
  logoAlign?: EmailHorizontalAlign;
  logoVerticalAlign?: EmailVerticalAlign;
  contactAlign?: EmailHorizontalAlign;
  contactVerticalAlign?: EmailVerticalAlign;
  showHotelName: boolean;
  showAddress: boolean;
  showPhone: boolean;
  phoneOverride?: string;
  phoneLinkEnabled?: boolean;
  showEmail?: boolean;
  emailOverride?: string;
  emailLinkEnabled?: boolean;
  iconTone?: EmailIconTone;
  style?: BlockStyleConfig;
}

export interface PromoBannerBlock extends EmailBlockBase {
  type: "promo_banner";
  imageUrl?: string;
  imageId?: string;
  imageAlt?: string;
  imageLinkUrl?: string;
  imageAlign?: EmailHorizontalAlign;
  imageVerticalAlign?: EmailVerticalAlign;
  textAlign?: EmailHorizontalAlign;
  textVerticalAlign?: EmailVerticalAlign;
  text: string;
  buttonLabel: string;
  buttonUrl: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface MembershipStripBlock extends EmailBlockBase {
  type: "membership_strip";
  tierTemplate: string;
  pointsTemplate: string;
  linkUrl?: string;
  linkOpenInNewTab?: boolean;
  linkHidden?: boolean;
  showArrow?: boolean;
  iconTone?: EmailIconTone;
  style?: BlockStyleConfig;
}

export interface IconDividerBlock extends EmailBlockBase {
  type: "icon_divider";
  icon: EmailIconName;
  iconTone?: EmailIconTone;
  lineColor?: string;
  style?: BlockStyleConfig;
}

export interface HeroTextBlock extends EmailBlockBase {
  type: "hero_text";
  headline: string;
  body: string;
  inlineLinks?: InlineTextLink[];
  buttonLabel?: string;
  buttonUrl?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface ConfirmationNumberBlock extends EmailBlockBase {
  type: "confirmation_number";
  label: string;
  valueTemplate: string;
  style?: BlockStyleConfig;
}

export interface StayDatesBlock extends EmailBlockBase {
  type: "stay_dates";
  checkInLabel: string;
  checkInDateTemplate: string;
  checkInTimeTemplate: string;
  checkOutLabel: string;
  checkOutDateTemplate: string;
  checkOutTimeTemplate: string;
  buttonLabel?: string;
  buttonUrl?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface FeatureCardBlock extends EmailBlockBase {
  type: "feature_card";
  imagePosition: "left" | "right";
  imageUrl: string;
  imageId?: string;
  imageAlt: string;
  imageLinkUrl?: string;
  imageAlign?: EmailHorizontalAlign;
  imageVerticalAlign?: EmailVerticalAlign;
  textAlign?: EmailHorizontalAlign;
  textVerticalAlign?: EmailVerticalAlign;
  title: string;
  body: string;
  inlineLinks?: InlineTextLink[];
  buttonLabel?: string;
  buttonUrl?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface BenefitsListItem {
  id: string;
  text: string;
}

export interface BenefitsListBlock extends EmailBlockBase {
  type: "benefits_list";
  badgeText?: string;
  badgeImageUrl?: string;
  badgeImageId?: string;
  badgeImageAlt?: string;
  badgeImageLinkUrl?: string;
  heading: string;
  listStyle: "bullet" | "icon";
  itemIcon?: EmailIconName;
  iconTone?: EmailIconTone;
  items: BenefitsListItem[];
  footnote?: string;
  inlineLinks?: InlineTextLink[];
  buttonLabel?: string;
  buttonUrl?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface IconLinkGridItem {
  id: string;
  icon: EmailIconName;
  label: string;
  url: string;
  hidden?: boolean;
  openInNewTab?: boolean;
}

export interface IconLinkGridBlock extends EmailBlockBase {
  type: "icon_link_grid";
  heading?: string;
  subheading?: string;
  iconTone?: EmailIconTone;
  showArrows?: boolean;
  items: IconLinkGridItem[];
  style?: BlockStyleConfig;
}

export interface ImageWithListItem {
  id: string;
  icon: EmailIconName;
  text: string;
}

export interface ImageWithListBlock extends EmailBlockBase {
  type: "image_with_list";
  imagePosition?: "left" | "right";
  imageUrl: string;
  imageId?: string;
  imageAlt: string;
  imageLinkUrl?: string;
  imageAlign?: EmailHorizontalAlign;
  imageVerticalAlign?: EmailVerticalAlign;
  textAlign?: EmailHorizontalAlign;
  textVerticalAlign?: EmailVerticalAlign;
  heading: string;
  iconTone?: EmailIconTone;
  items: ImageWithListItem[];
  inlineLinks?: InlineTextLink[];
  buttonLabel?: string;
  buttonUrl?: string;
  buttonStyle?: ModernButtonStyle;
  buttonCorner?: ButtonCornerStyle;
  buttonBgColor?: string;
  buttonTextColor?: string;
  buttonBorderColor?: string;
  buttonOpenInNewTab?: boolean;
  buttonHidden?: boolean;
  style?: BlockStyleConfig;
}

export interface FooterNavLinkItem {
  id: string;
  label: string;
  url: string;
  hidden?: boolean;
  color?: string;
  underline?: boolean;
  openInNewTab?: boolean;
}

export interface FooterNavBlock extends EmailBlockBase {
  type: "footer_nav";
  links: FooterNavLinkItem[];
  secondaryText?: string;
  secondaryLinkUrl?: string;
  secondaryLinkHidden?: boolean;
  secondaryLinkOpenInNewTab?: boolean;
  showViewNote?: boolean;
  style?: BlockStyleConfig;
}

export interface LegalSectionItem {
  id: string;
  heading: string;
  body: string;
}

export interface LegalSectionBlock extends EmailBlockBase {
  type: "legal_section";
  sections: LegalSectionItem[];
  inlineLinks?: InlineTextLink[];
  copyrightText?: string;
  showFooterLogo?: boolean;
  footerLogoUrl?: string;
  footerLogoImageId?: string;
  footerLogoAlt?: string;
  footerLogoWidthPx?: number;
  footerLogoLinkUrl?: string;
  style?: BlockStyleConfig;
}

// --- 5 Standalone Editable Footer Blocks (Schema v3 Additive) ---

export interface FooterContactBlock extends EmailBlockBase {
  type: "footer_contact";
  heading: string;
  text: string;
  inlineLinks?: InlineTextLink[];
  emailOverride?: string;
  phoneOverride?: string;
  emailLinkEnabled?: boolean;
  phoneLinkEnabled?: boolean;
  linkColor?: string;
  underline?: boolean;
  style?: BlockStyleConfig;
}

export interface FooterAuthenticityBlock extends EmailBlockBase {
  type: "footer_authenticity";
  heading: string;
  text: string;
  inlineLinks?: InlineTextLink[];
  style?: BlockStyleConfig;
}

export interface FooterCopyrightBlock extends EmailBlockBase {
  type: "footer_copyright";
  text: string;
  inlineLinks?: InlineTextLink[];
  showFooterLogo?: boolean;
  footerLogoUrl?: string;
  footerLogoImageId?: string;
  footerLogoAlt?: string;
  footerLogoWidthPx?: number;
  footerLogoLinkUrl?: string;
  footerLogoLinkOpenInNewTab?: boolean;
  style?: BlockStyleConfig;
}

export interface FooterLegalBlock extends EmailBlockBase {
  type: "footer_legal";
  heading: string;
  text: string;
  inlineLinks?: InlineTextLink[];
  style?: BlockStyleConfig;
}

export interface FooterPoweredByBlock extends EmailBlockBase {
  type: "footer_powered_by";
  text: string;
  linkLabel?: string;
  linkUrl?: string;
  linkColor?: string;
  underline?: boolean;
  openInNewTab?: boolean;
  linkHidden?: boolean;
  style?: BlockStyleConfig;
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
  | FooterBlock
  | BrandHeaderBlock
  | PromoBannerBlock
  | MembershipStripBlock
  | IconDividerBlock
  | HeroTextBlock
  | ConfirmationNumberBlock
  | StayDatesBlock
  | FeatureCardBlock
  | BenefitsListBlock
  | IconLinkGridBlock
  | ImageWithListBlock
  | FooterNavBlock
  | LegalSectionBlock
  | FooterContactBlock
  | FooterAuthenticityBlock
  | FooterCopyrightBlock
  | FooterLegalBlock
  | FooterPoweredByBlock;

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
  logoAlign?: EmailHorizontalAlign;
  logoLinkUrl?: string;
  logoLinkOpenInNewTab?: boolean;
}

export interface EmailTemplateVariant {
  /** Schema version: undefined/1 = legacy classic default (byte-for-byte preserved), 2 = legacy modern layout, 3 = pure block-driven footer layout, 4 = fully editable links */
  schemaVersion?: 1 | 2 | 3 | 4;
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
  /** Optional reusable per-hotel footer blocks (per language), copied into drafts only when applied */
  defaultFooterBlocks?: Partial<Record<SupportedEmailLanguage, EmailBlock[]>>;
  /** Optional hotel-level default links (single URL + optional EN/DE per-language overrides) */
  defaultLinks?: HotelDefaultLinks;
  /** Optional reusable default footer navigation links (per language), copied into drafts only when applied */
  defaultFooterNavLinks?: Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>>;
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
  mimeType: "image/png" | "image/jpeg" | "image/webp" | "image/gif";
  width: number;
  height: number;
  sizeBytes: number;
  isAnimated?: boolean;
  frameCount?: number;
  durationMs?: number;
  createdBy: string;
  createdAt: string;
}

export interface EventCatalogEntry {
  eventType: CustomizableEmailEventType;
  name: string;
  description: string;
  category: EmailTemplateCategory;
  audience: "guest" | "hotel_staff" | "corporate";
  canDisable?: boolean;
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
  roomNumber?: string;
  roomType?: string;
  previousRoom?: string;
  checkInDate?: string;
  checkInTime?: string;
  checkOutDate?: string;
  checkOutTime?: string;
  previousCheckOut?: string;
  nights?: number;
  extraNights?: number;
  bookingReference?: string;
  chargeAmount?: number;
  itemDescription?: string;
  chargeCategory?: string;
  rateAdjustment?: string;
  transferTarget?: string;
  totalAmount?: number;
  originalAmount?: number;
  discountAmount?: number;
  amountPaid?: number;
  depositAmount?: number;
  depositBalance?: number;
  refundAmount?: number;
  balanceDue?: number;
  paymentStatus?: string;
  paymentMethod?: string;
  transactionReference?: string;
  transactionDate?: string;
  /** Optional real loyalty fields when present on guest/reservation; never invented */
  loyaltyPointsFormatted?: string | null;
  loyaltyPointsEarned?: number | null;
  loyaltyPointsBalance?: number | null;
  loyaltyTier?: string | null;
  previousTier?: string | null;
  loyaltyTierBenefits?: string[] | null;
  loyaltyAllTiers?: Array<{
    id?: string;
    name: string;
    minPoints: number;
    color?: string;
    benefits: string[];
    isCurrent?: boolean;
  }> | null;
  redemptionValueFormatted?: string | null;
  expiryDate?: string | null;
  /** Optional operational / corporate / auth fields */
  reason?: string;
  staffName?: string;
  staffStatus?: string;
  corporateName?: string;
  outletName?: string;
  billNumber?: string;
  issueSummary?: string;
  priority?: string;
  /** Strictly for legitimate security links (staff activation / password reset) */
  actionLink?: string;
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
  maxGifWidthPx: 640,
  maxGifFrames: 100,
  maxGifDurationMs: 15_000, // 15 seconds
  maxImagesPerHotel: 30,
  maxTotalBytesPerHotel: 20 * 1024 * 1024, // 20 MB total per hotel
  htmlWarnBytes: 80 * 1024, // 80 KB soft warning
  htmlMaxBytes: 90 * 1024, // 90 KB Gmail clipping threshold alert
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

