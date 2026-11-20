import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import {
  sendEmail,
  validateEmailConfig,
  getAppUrl,
} from "../src/services/emailService.ts";
import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  type CustomizableEmailEventType,
} from "../src/modules/emailCustomization/shared/types.ts";
import {
  buildDefaultTemplateForHotel,
  buildSamplePreviewContext,
  EMAIL_EVENT_CATALOG,
} from "../src/modules/emailCustomization/server/defaultTemplates.ts";
import {
  buildSampleGifUrl,
  buildStarterPresetVariant,
  STARTER_LAYOUT_PRESETS,
} from "../src/modules/emailCustomization/shared/presets.ts";
import {
  measureEmailHtmlBytes,
  validateTemplateVariant,
} from "../src/modules/emailCustomization/shared/validation.ts";
import { renderHotelEmailServerSide } from "../src/modules/emailCustomization/server/renderer.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });
dotenv.config();

async function main() {
  const testRecipient = (process.env.TEST_EMAIL_TO || "").trim();
  if (!testRecipient) {
    console.error("FAILURE: TEST_EMAIL_TO environment variable is required.");
    process.exit(1);
  }

  const configCheck = validateEmailConfig();
  if (!configCheck.ok) {
    console.error(`FAILURE: ${configCheck.error}`);
    process.exit(1);
  }

  const appUrl = getAppUrl();
  const filterEvent = (process.env.TEST_EMAIL_EVENT || "").trim().toLowerCase();
  const lang = (process.env.TEST_EMAIL_LANG || "en").trim().toLowerCase() === "de" ? "de" : "en";
  const presetsMode = String(process.env.TEST_EMAIL_PRESETS || "").trim().toLowerCase() === "true";
  const editedFooterMode =
    process.argv.includes("--edited-footer") ||
    String(process.env.TEST_EMAIL_EDITED_FOOTER || "").trim().toLowerCase() === "true";
  const editedLinksMode =
    process.argv.includes("--edited-links") ||
    String(process.env.TEST_EMAIL_EDITED_LINKS || "").trim().toLowerCase() === "true";

  const sampleHotel = {
    id: "sample-hotel-custom",
    name: "Harborview Suites",
    defaultCurrency: "EUR",
    branding: {
      organizationName: "Harborview Suites",
      primaryColor: "#0f766e",
      secondaryColor: "#134e4a",
      address: "Friedrichstrasse 101, 10117 Berlin",
      phone: "+49 30 555 0199",
      email: "frontdesk@harborview.example",
      website: appUrl,
      footerNotes: "Thank you for choosing Harborview Suites.",
    },
  };

  const sampleSettings = {
    ...DEFAULT_HOTEL_EMAIL_SETTINGS,
    portalUrl: appUrl,
    senderDisplayName: "Harborview Suites",
    replyToEmail: "frontdesk@harborview.example",
    defaultLanguage: lang as "en" | "de",
    dateFormat: lang === "de" ? ("dd_dot_mm_dot_yyyy" as const) : ("dd_mmm_yyyy" as const),
    timeFormat: "24h" as const,
    currencyDisplay: {
      mode: "symbol" as const,
      decimals: 2 as const,
      thousandsSeparator: lang === "de" ? ("." as const) : ("," as const),
    },
    legalImprint: "Harborview Suites GmbH · HRB 123456 Berlin · VAT ID DE987654321",
  };

  if (editedLinksMode) {
    const targetEvent: CustomizableEmailEventType =
      filterEvent && (CUSTOMIZABLE_EMAIL_EVENTS as readonly string[]).includes(filterEvent)
        ? (filterEvent as CustomizableEmailEventType)
        : "booking_confirmation";

    const ctx = buildSamplePreviewContext(sampleHotel.id, sampleHotel, appUrl, {
      includeLoyaltySample: true,
    });
    const linksSettings = {
      ...sampleSettings,
      defaultLinks: {
        website: {
          defaultUrl: "https://tidehotels.de",
          byLanguage: { en: "https://tidehotels.de", de: "https://tidehotels.de" },
        },
        booking: { defaultUrl: "https://tidehotels.de/book" },
        portal: { defaultUrl: appUrl },
        review: { defaultUrl: "https://tidehotels.de/reviews" },
        directions: { defaultUrl: "https://maps.google.com/?q=Friedrichstrasse+101+Berlin" },
        wifiGuide: { defaultUrl: "https://tidehotels.de/guest-guide" },
        socialInstagram: { defaultUrl: "https://instagram.com/harborviewsuites" },
        socialFacebook: { defaultUrl: "https://facebook.com/harborviewsuites" },
      },
    };

    const variant = buildStarterPresetVariant("modern_resort", targetEvent, lang, appUrl, {
      primaryColor: "#0f766e",
      secondaryColor: "#134e4a",
    });
    variant.schemaVersion = 4;
    variant.subject = `[Edited Links Preview] ${variant.subject}`;
    variant.branding = {
      ...variant.branding,
      logoLinkUrl: "{{hotel_website}}",
      logoLinkOpenInNewTab: true,
    };

    variant.blocks = variant.blocks.map((b) => {
      if (b.type === "brand_header") {
        return {
          ...b,
          logoLinkUrl: "{{hotel_website}}",
          logoLinkOpenInNewTab: true,
          addressLinkUrl: "{{directions_link}}",
          phoneAsLink: true,
          showEmail: true,
          emailAsLink: true,
        };
      }
      if (b.type === "hero_text") {
        return {
          ...b,
          body: "Dear {{guest_name}}, we look forward to welcoming you. View our [[link:hero_guide]] or [[link:hero_directions]] before arrival.",
          inlineLinks: [
            {
              id: "hero_guide",
              label: "Wi-Fi & Arrival Guide",
              url: "{{wifi_guide_link}}",
              openInNewTab: true,
              underline: true,
              color: "#0f766e",
            },
            {
              id: "hero_directions",
              label: "get hotel directions",
              url: "{{directions_link}}",
              openInNewTab: true,
              underline: true,
              color: "#0f766e",
            },
          ],
          buttonLabel: "Manage My Stay Online",
          buttonUrl: "{{portal_link}}",
          buttonOpenInNewTab: true,
          buttonBorderColor: "#0f766e",
        };
      }
      if (b.type === "footer_nav") {
        return {
          ...b,
          links: [
            { id: "ln1", label: "Hotel Website", url: "{{hotel_website}}", openInNewTab: true, underline: true, color: "#0f766e" },
            { id: "ln2", label: "Directions", url: "{{directions_link}}", openInNewTab: true },
            { id: "ln3", label: "Guest Reviews", url: "{{review_link}}", openInNewTab: true },
            { id: "ln4", label: "Call Front Desk", url: "tel:{{hotel_phone}}" },
            { id: "ln5", label: "Email Concierge", url: "mailto:{{hotel_email}}" },
          ],
        };
      }
      if (b.type === "footer_contact") {
        return {
          ...b,
          heading: "Concierge & Direct Contact",
          text: "Questions about your stay? Call [[link:fc_phone]] or email [[link:fc_email]] anytime.",
          inlineLinks: [
            { id: "fc_phone", label: "{{hotel_phone}}", url: "tel:{{hotel_phone}}", underline: true, color: "#0f766e" },
            { id: "fc_email", label: "{{hotel_email}}", url: "mailto:{{hotel_email}}", underline: true, color: "#0f766e" },
          ],
        };
      }
      return b;
    });

    // Add a social links bar right before footer_contact
    const contactIdx = variant.blocks.findIndex((b) => b.type === "footer_contact");
    const socialBlock = {
      id: "edited_links_social",
      type: "social_links" as const,
      links: [
        { platform: "instagram" as const, label: "Instagram", url: "{{social_instagram}}", openInNewTab: true },
        { platform: "facebook" as const, label: "Facebook", url: "{{social_facebook}}", openInNewTab: true },
        { platform: "website" as const, label: "Official Website", url: "{{hotel_website}}", openInNewTab: true },
      ],
    };
    if (contactIdx >= 0) {
      variant.blocks.splice(contactIdx, 0, socialBlock);
    } else {
      variant.blocks.push(socialBlock);
    }

    const validationIssues = validateTemplateVariant(variant);
    if (validationIssues.length > 0) {
      console.error("FAILURE: Edited links template validation failed:", validationIssues);
      process.exit(1);
    }

    const rendered = renderHotelEmailServerSide({
      variant,
      context: ctx,
      settings: linksSettings,
      language: lang,
      usedDefaultLayout: false,
    });
    const size = measureEmailHtmlBytes(rendered.html);

    const result = await sendEmail({
      to: testRecipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      tags: [
        { name: "hotelId", value: sampleHotel.id },
        { name: "event", value: targetEvent },
        { name: "testRun", value: "edited_links_v4" },
      ],
    });

    if (result.success) {
      console.log(
        `SUCCESS | mode=edited-links | event=${targetEvent} | htmlKB=${size.kb} | messageId=${result.messageId}`
      );
      process.exit(0);
    } else {
      console.error(
        `FAILURE | mode=edited-links | error=${result.error || "Unknown error"}`
      );
      process.exit(1);
    }
  }

  if (editedFooterMode) {
    const targetEvent: CustomizableEmailEventType =
      filterEvent && (CUSTOMIZABLE_EMAIL_EVENTS as readonly string[]).includes(filterEvent)
        ? (filterEvent as CustomizableEmailEventType)
        : "booking_confirmation";

    const ctx = buildSamplePreviewContext(sampleHotel.id, sampleHotel, appUrl, {
      includeLoyaltySample: true,
    });
    const variant = buildStarterPresetVariant("modern_resort", targetEvent, lang, appUrl, {
      primaryColor: "#0f766e",
      secondaryColor: "#134e4a",
    });

    variant.subject = `[Edited Footer Preview] ${variant.subject}`;
    variant.blocks = variant.blocks.map((b) => {
      if (b.type === "footer_contact") {
        return {
          ...b,
          heading: "Guest Relations & Concierge",
          text: "Need an airport transfer or late check-in? Contact {{hotel_name}} anytime at {{hotel_phone}} or {{hotel_email}}.",
          style: {
            align: "left",
            fontFamily: "georgia",
            fontSizePx: 13,
            accentColor: "#0f766e",
            textColor: "#3f3f46",
            paddingY: 12,
          },
        };
      }
      if (b.type === "footer_authenticity") {
        return {
          ...b,
          heading: "Reservation Verification",
          text: "Verified booking record {{booking_reference}} issued directly by {{hotel_name}}.",
          style: { align: "left", fontSizePx: 12, accentColor: "#18181b", textColor: "#52525b", paddingY: 8 },
        };
      }
      if (b.type === "footer_copyright") {
        return {
          ...b,
          text: "© 2026 {{hotel_name}} Hospitality · {{hotel_address}}",
          style: { align: "left", fontSizePx: 11, textColor: "#71717a", paddingY: 10 },
        };
      }
      return b;
    });

    // Add an extra custom Legal / Impressum block using {{legal_imprint}}
    const copyrightIdx = variant.blocks.findIndex((b) => b.type === "footer_copyright");
    const extraLegalBlock = {
      id: "edited_footer_impressum",
      type: "footer_legal" as const,
      heading: "Legal Notice & Cancellation Policy",
      text: "{{legal_imprint}} · Free cancellation up to 48 hours prior to {{check_in_date}}.",
      style: { align: "left" as const, fontSizePx: 12, accentColor: "#18181b", textColor: "#52525b", paddingY: 8 },
    };
    if (copyrightIdx >= 0) {
      variant.blocks.splice(copyrightIdx, 0, extraLegalBlock);
    } else {
      variant.blocks.push(extraLegalBlock);
    }

    const validationIssues = validateTemplateVariant(variant);
    if (validationIssues.length > 0) {
      console.error("FAILURE: Edited footer template validation failed:", validationIssues);
      process.exit(1);
    }

    const rendered = renderHotelEmailServerSide({
      variant,
      context: ctx,
      settings: sampleSettings,
      language: lang,
      usedDefaultLayout: false,
    });
    const size = measureEmailHtmlBytes(rendered.html);

    const result = await sendEmail({
      to: testRecipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      tags: [
        { name: "hotelId", value: sampleHotel.id },
        { name: "event", value: targetEvent },
        { name: "testRun", value: "edited_footer_v3" },
      ],
    });

    if (result.success) {
      console.log(
        `SUCCESS | mode=edited-footer | event=${targetEvent} | htmlKB=${size.kb} | messageId=${result.messageId}`
      );
      process.exit(0);
    } else {
      console.error(
        `FAILURE | mode=edited-footer | error=${result.error || "Unknown error"}`
      );
      process.exit(1);
    }
  }

  if (presetsMode) {
    const targetEvent: CustomizableEmailEventType =
      filterEvent && (CUSTOMIZABLE_EMAIL_EVENTS as readonly string[]).includes(filterEvent)
        ? (filterEvent as CustomizableEmailEventType)
        : "booking_confirmation";

    const ctxLoyaltyOn = buildSamplePreviewContext(sampleHotel.id, sampleHotel, appUrl, {
      includeLoyaltySample: true,
    });
    const ctxLoyaltyOff = buildSamplePreviewContext(sampleHotel.id, sampleHotel, appUrl, {
      includeLoyaltySample: false,
    });
    const sampleGifUrl = buildSampleGifUrl(appUrl);

    let hasFailure = false;
    for (const preset of STARTER_LAYOUT_PRESETS) {
      for (const loyaltyOn of [true, false]) {
        const variant = buildStarterPresetVariant(preset.id, targetEvent, lang, appUrl, {
          primaryColor: preset.accentColor,
          secondaryColor: preset.secondaryColor,
        });
        variant.subject = `[Preset: ${preset.name} | Loyalty ${loyaltyOn ? "ON" : "OFF"}] ${variant.subject}`;

        // Inject a lightweight sample animated GIF block right after the confirmation/hero area
        const insertAt = Math.min(4, variant.blocks.length);
        variant.blocks.splice(insertAt, 0, {
          id: `sample_gif_${preset.id}`,
          type: "image",
          src: sampleGifUrl,
          alt: "Animated welcome visual from Harborview Suites",
          widthPx: 540,
          align: "center",
        });

        const rendered = renderHotelEmailServerSide({
          variant,
          context: loyaltyOn ? ctxLoyaltyOn : ctxLoyaltyOff,
          settings: sampleSettings,
          language: lang,
          usedDefaultLayout: false,
        });
        const size = measureEmailHtmlBytes(rendered.html);

        const result = await sendEmail({
          to: testRecipient,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          fromName: rendered.fromName,
          replyTo: rendered.replyTo,
          tags: [
            { name: "hotelId", value: sampleHotel.id },
            { name: "event", value: targetEvent },
            { name: "preset", value: preset.id },
            { name: "loyalty", value: loyaltyOn ? "on" : "off" },
          ],
        });

        if (result.success) {
          console.log(
            `SUCCESS | preset=${preset.id} | loyalty=${loyaltyOn ? "ON" : "OFF"} | htmlKB=${size.kb} | messageId=${result.messageId}`
          );
        } else {
          hasFailure = true;
          console.error(
            `FAILURE | preset=${preset.id} | loyalty=${loyaltyOn ? "ON" : "OFF"} | error=${result.error || "Unknown error"}`
          );
        }
      }
    }

    process.exit(hasFailure ? 1 : 0);
  }

  const eventsToSend: CustomizableEmailEventType[] = filterEvent
    ? CUSTOMIZABLE_EMAIL_EVENTS.filter((e) => e === filterEvent)
    : [...CUSTOMIZABLE_EMAIL_EVENTS];

  if (eventsToSend.length === 0) {
    console.error(
      `FAILURE: Unknown TEST_EMAIL_EVENT '${filterEvent}'. Supported: ${CUSTOMIZABLE_EMAIL_EVENTS.join(", ")}.`
    );
    process.exit(1);
  }

  const sampleCtx = buildSamplePreviewContext(sampleHotel.id, sampleHotel, appUrl, {
    includeLoyaltySample: true,
  });

  let hasFailure = false;
  for (const eventType of eventsToSend) {
    const variant = buildDefaultTemplateForHotel(eventType, sampleHotel, lang);
    // Apply a light customization marker so test output proves customized rendering works end-to-end
    variant.subject = `[Custom Preview] ${variant.subject}`;
    variant.branding.accentBarColor = "#0f766e";

    const rendered = renderHotelEmailServerSide({
      variant,
      context: sampleCtx,
      settings: sampleSettings,
      language: lang,
      usedDefaultLayout: false,
    });

    const result = await sendEmail({
      to: testRecipient,
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
      fromName: rendered.fromName,
      replyTo: rendered.replyTo,
      tags: [
        { name: "hotelId", value: sampleHotel.id },
        { name: "event", value: eventType },
        { name: "testRun", value: "cli_customization" },
      ],
    });

    if (result.success) {
      console.log(
        `SUCCESS | event=${eventType} (${EMAIL_EVENT_CATALOG[eventType].name}) | messageId=${result.messageId}`
      );
    } else {
      hasFailure = true;
      console.error(`FAILURE | event=${eventType} | error=${result.error || "Unknown error"}`);
    }
  }

  process.exit(hasFailure ? 1 : 0);
}

main().catch((err: any) => {
  console.error(`FAILURE | error=${err?.message || "Unexpected error"}`);
  process.exit(1);
});
