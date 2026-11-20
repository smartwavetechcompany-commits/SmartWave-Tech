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
import { measureEmailHtmlBytes } from "../src/modules/emailCustomization/shared/validation.ts";
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
    legalImprint: "Harborview Suites GmbH · HRB 123456 Berlin",
  };

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
