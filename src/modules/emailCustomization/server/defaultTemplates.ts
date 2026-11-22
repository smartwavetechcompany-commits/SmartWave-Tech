import {
  buildDefaultTemplateVariant,
  createDefaultBranding,
  EMAIL_EVENT_CATALOG,
  OPTIONAL_SECTION_PRESETS,
} from "../shared/defaultTemplates.ts";
import type {
  CustomizableEmailEventType,
  EmailRenderContext,
  EmailTemplateBranding,
  EmailTemplateVariant,
  SupportedEmailLanguage,
} from "../shared/types.ts";
import { sanitizeHexColor, validateEmailUrl } from "../shared/validation.ts";

export {
  buildDefaultTemplateVariant,
  createDefaultBranding,
  EMAIL_EVENT_CATALOG,
  OPTIONAL_SECTION_PRESETS,
};

/**
 * Builds the default block template hydrated with the specific hotel's existing branding
 * (`hotel.branding.primaryColor`, `secondaryColor`, `logoUrl` if https) so untouched hotels
 * render the exact branded email they receive today.
 */
export function buildDefaultTemplateForHotel(
  eventType: CustomizableEmailEventType,
  hotelDoc: Record<string, any> | null | undefined,
  language: SupportedEmailLanguage = "en"
): EmailTemplateVariant {
  const branding = (hotelDoc?.branding && typeof hotelDoc.branding === "object"
    ? hotelDoc.branding
    : {}) as Record<string, any>;

  const primaryColor = sanitizeHexColor(branding.primaryColor, "#059669");
  const secondaryColor = sanitizeHexColor(branding.secondaryColor, "#18181b");
  const logoCheck = validateEmailUrl(branding.logoUrl, { allowEmpty: true });
  const logoUrl = logoCheck.valid && logoCheck.normalized ? logoCheck.normalized : "";

  const overrides: Partial<EmailTemplateBranding> = {
    accentBarColor: primaryColor,
    primaryColor,
    secondaryColor,
    buttonColor: primaryColor,
    logoUrl,
  };

  return buildDefaultTemplateVariant(eventType, language, overrides);
}

/**
 * Generates realistic, hotel-branded sample reservation data for live preview and admin test-sends.
 */
export function buildSamplePreviewContext(
  hotelId: string,
  hotelDoc: Record<string, any> | null | undefined,
  appUrl: string,
  options?: { includeLoyaltySample?: boolean }
): EmailRenderContext {
  const branding = (hotelDoc?.branding && typeof hotelDoc.branding === "object"
    ? hotelDoc.branding
    : {}) as Record<string, any>;
  const hotelName =
    (typeof branding.organizationName === "string" && branding.organizationName.trim()) ||
    (typeof hotelDoc?.name === "string" && hotelDoc.name.trim()) ||
    "Sample Hotel";

  const logoCheck = validateEmailUrl(branding.logoUrl, { allowEmpty: true });

  const cleanAppUrl = appUrl.replace(/\/+$/, "");
  const configuredWebsite =
    (typeof branding.website === "string" && branding.website.trim()) ||
    (typeof hotelDoc?.website === "string" && hotelDoc.website.trim()) ||
    "";

  return {
    hotelId,
    hotelName,
    hotelAddress:
      (typeof branding.address === "string" && branding.address.trim()) ||
      (typeof hotelDoc?.address === "string" && hotelDoc.address.trim()) ||
      "123 Hospitality Avenue, City Center",
    hotelPhone:
      (typeof branding.phone === "string" && branding.phone.trim()) ||
      (typeof hotelDoc?.phone === "string" && hotelDoc.phone.trim()) ||
      "+49 30 555 0199",
    hotelEmail:
      (typeof branding.email === "string" && branding.email.trim()) ||
      (typeof hotelDoc?.email === "string" && hotelDoc.email.trim()) ||
      "reservations@hotel.example",
    hotelWebsite:
      configuredWebsite && configuredWebsite.replace(/\/+$/, "").toLowerCase() !== cleanAppUrl.toLowerCase()
        ? configuredWebsite
        : undefined,
    hotelLogoUrl: logoCheck.valid && logoCheck.normalized ? logoCheck.normalized : undefined,
    hotelPrimaryColor: sanitizeHexColor(branding.primaryColor, "#059669"),
    hotelSecondaryColor: sanitizeHexColor(branding.secondaryColor, "#18181b"),
    hotelFooterNotes:
      typeof branding.footerNotes === "string" ? branding.footerNotes.trim() : undefined,
    currencyCode:
      typeof hotelDoc?.defaultCurrency === "string" && hotelDoc.defaultCurrency.trim()
        ? hotelDoc.defaultCurrency.trim()
        : "NGN",
    appUrl: cleanAppUrl,
    guestName: "Alex Morgan",
    guestEmail: "alex.morgan@example.com",
    roomName: "Room 204",
    roomNumber: "204",
    roomType: "Deluxe King Suite",
    checkInDate: "2026-11-24",
    checkInTime: "14:00",
    checkOutDate: "2026-11-27",
    checkOutTime: "12:00",
    nights: 3,
    bookingReference: "RES8A4F2",
    totalAmount: 100000,
    originalAmount: 100000,
    discountAmount: 20000,
    amountPaid: 80000,
    depositAmount: 50000,
    depositBalance: 125000,
    refundAmount: 25000,
    balanceDue: 0,
    paymentStatus: "Fully Settled",
    paymentMethod: "TRANSFER",
    transactionReference: "TXN-89421",
    transactionDate: "2026-11-22",
    reason: "Front desk confirmation",
    staffName: "Jordan Taylor",
    staffStatus: "ACTIVE",
    corporateName: "Meridian Travel Group",
    outletName: "Main Restaurant",
    billNumber: "FNB-1042",
    issueSummary: "Room inspection completed",
    priority: "NORMAL",
    actionLink: `${cleanAppUrl}/auth-action?sample=1`,
    ...(options?.includeLoyaltySample
      ? {
          loyaltyPointsFormatted: "+450 pts",
          loyaltyPointsEarned: 450,
          loyaltyPointsBalance: 2150,
          loyaltyTier: "Gold",
          previousTier: "Silver",
          redemptionValueFormatted: "NGN 5,000.00",
          expiryDate: "2027-01-31",
        }
      : {
          loyaltyPointsFormatted: "+450 pts",
          loyaltyPointsEarned: 450,
          loyaltyPointsBalance: 2150,
          loyaltyTier: "Gold",
          previousTier: "Silver",
          redemptionValueFormatted: "NGN 5,000.00",
          expiryDate: "2027-01-31",
        }),
  };
}
