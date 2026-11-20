import assert from "assert";
import sharp from "sharp";
import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  EMAIL_ICON_NAMES,
  EMAIL_ICON_TONES,
  type CustomizableEmailEventType,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type HotelEmailSettings,
} from "../modules/emailCustomization/shared/types.ts";
import {
  buildDefaultTemplateVariant,
  OPTIONAL_SECTION_PRESETS,
} from "../modules/emailCustomization/shared/defaultTemplates.ts";
import {
  EMAIL_PLACEHOLDER_IMAGES,
  STARTER_LAYOUT_PRESETS,
  buildStarterPresetVariant,
} from "../modules/emailCustomization/shared/presets.ts";
import { isModernV2Variant } from "../modules/emailCustomization/shared/renderer.ts";
import {
  formatEmailCurrency,
  formatEmailDate,
  formatEmailTime,
  measureEmailHtmlBytes,
  validateEmailUrl,
  validateHotelEmailSettings,
  validateTemplateVariant,
  validateTemplateVariables,
} from "../modules/emailCustomization/shared/validation.ts";
import {
  createEmailAssetsMiddleware,
  resolveSafeBundledIconPath,
} from "../modules/emailCustomization/server/assetService.ts";
import {
  buildDefaultTemplateForHotel,
  buildSamplePreviewContext,
} from "../modules/emailCustomization/server/defaultTemplates.ts";
import {
  extractReferencedImages,
  renderHotelEmailServerSide,
} from "../modules/emailCustomization/server/renderer.ts";
import {
  callerHasEmailModuleAccess,
  callerIsStrictHotelAdmin,
  isEmailCustomizationEnabled,
} from "../modules/emailCustomization/server/templateRegistry.ts";
import { hasPermission, isPMSModuleAssigned } from "../utils/permissions.ts";
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import express from "express";
import {
  buildCloudinarySignature,
  createLocalEmailImageMiddleware,
  deleteHotelImage,
  detectAllowedImageMagicBytes,
  resolveImageStorageProvider,
  resolveSafeLocalEmailImagePath,
  sanitizeImageLabel,
  uploadHotelImage,
  validateAndProcessImageBuffer,
} from "../modules/emailCustomization/server/imageService.ts";
import { sendHotelEmail } from "../modules/emailCustomization/server/dispatcher.ts";
import {
  renderMultiTenantEmail,
  resolveHotelBrandContext,
} from "../services/multiTenantEmailService.ts";
import type { SendEmailParams } from "../services/emailService.ts";

let passed = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed += 1;
    console.log(`  [PASS] ${name}`);
  } catch (err: any) {
    console.error(`  [FAIL] ${name}:`, err?.message || err);
    process.exitCode = 1;
  }
}

const SAMPLE_HOTEL = {
  id: "hotel_alpha",
  name: "Harborview Suites",
  defaultCurrency: "NGN",
  branding: {
    organizationName: "Harborview Suites",
    primaryColor: "#059669",
    secondaryColor: "#18181b",
    address: "100 Marina Blvd, Coastal City",
    phone: "+49 30 555 0199",
    email: "reservations@harborview.example",
    website: "https://harborview.example",
  },
};

const BASE_CONTEXT: EmailRenderContext = {
  hotelId: "hotel_alpha",
  hotelName: "Harborview Suites",
  hotelAddress: "100 Marina Blvd, Coastal City",
  hotelPhone: "+49 30 555 0199",
  hotelEmail: "reservations@harborview.example",
  hotelWebsite: "https://harborview.example",
  hotelPrimaryColor: "#059669",
  hotelSecondaryColor: "#18181b",
  currencyCode: "NGN",
  appUrl: "https://tidehotels.de/",
  guestName: "Alex Morgan",
  guestEmail: "alex.morgan@example.com",
  roomName: "Room 204",
  roomType: "Deluxe King Suite",
  checkInDate: "2026-11-24",
  checkInTime: "14:00",
  checkOutDate: "2026-11-27",
  checkOutTime: "12:00",
  nights: 3,
  bookingReference: "RES8A4F2",
  totalAmount: 270000,
  depositAmount: 90000,
  balanceDue: 180000,
  loyaltyPointsEarned: null,
  loyaltyPointsBalance: null,
  loyaltyTier: null,
};

async function run() {
  console.log("Running Multi-Tenant Email Customization Module Test Suite...\n");

  // 1. Default fallback snapshot parity matching current emails
  await test("1. Default fallback snapshot parity for confirmation, cancellation, check-in, check-out, no-show", () => {
    const brand = resolveHotelBrandContext("hotel_alpha", SAMPLE_HOTEL, "https://tidehotels.de");
    const pairs: Array<{
      customEvent: CustomizableEmailEventType;
      legacyEvent:
        | "reservation.confirmed"
        | "reservation.cancelled"
        | "reservation.checked_in"
        | "reservation.checked_out"
        | "reservation.no_show";
      expectedSubjectPrefix: string;
    }> = [
      {
        customEvent: "booking_confirmation",
        legacyEvent: "reservation.confirmed",
        expectedSubjectPrefix: "Booking Confirmation - Harborview Suites (RES8A4F2)",
      },
      {
        customEvent: "booking_cancellation",
        legacyEvent: "reservation.cancelled",
        expectedSubjectPrefix: "Booking Cancellation - Harborview Suites (RES8A4F2)",
      },
      {
        customEvent: "checked_in",
        legacyEvent: "reservation.checked_in",
        expectedSubjectPrefix: "Check-In Confirmation - Harborview Suites (RES8A4F2)",
      },
      {
        customEvent: "checked_out",
        legacyEvent: "reservation.checked_out",
        expectedSubjectPrefix: "Thank You & Check-Out Summary - Harborview Suites (RES8A4F2)",
      },
      {
        customEvent: "no_show",
        legacyEvent: "reservation.no_show",
        expectedSubjectPrefix: "[Operations] Reservation No-Show - Harborview Suites (RES8A4F2)",
      },
    ];

    for (const pair of pairs) {
      const legacy = renderMultiTenantEmail(pair.legacyEvent, brand, {
        recipientName: pair.customEvent === "no_show" ? undefined : "Alex Morgan",
        subjectOverride: pair.expectedSubjectPrefix,
        rows: [
          { label: "Booking Reference", value: "RES8A4F2" },
          { label: "Guest Name", value: "Alex Morgan" },
          { label: "Room", value: "Room 204" },
          { label: "Check-In", value: "2026-11-24" },
          { label: "Check-Out", value: "2026-11-27" },
        ],
        ctaLabel: "Hotel Portal",
        ctaUrl: "https://tidehotels.de",
      });

      const defaultVariant = buildDefaultTemplateForHotel(pair.customEvent, SAMPLE_HOTEL, "en");
      const modular = renderHotelEmailServerSide({
        variant: defaultVariant,
        context: BASE_CONTEXT,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: "en",
        usedDefaultLayout: true,
      });

      assert.strictEqual(modular.subject, legacy.subject, `Subject parity failed for ${pair.customEvent}`);
      assert.ok(modular.html.includes("Harborview Suites"), `Hotel name missing for ${pair.customEvent}`);
      assert.ok(modular.html.includes("RES8A4F2"), `Booking ref missing for ${pair.customEvent}`);
      assert.ok(modular.html.includes("Room 204"), `Room missing for ${pair.customEvent}`);
      assert.ok(modular.html.includes("2026-11-24"), `Check-in missing for ${pair.customEvent}`);
      assert.ok(modular.html.includes("2026-11-27"), `Check-out missing for ${pair.customEvent}`);
      assert.ok(modular.html.includes("https://tidehotels.de"), `APP_URL missing for ${pair.customEvent}`);
      assert.ok(!modular.html.includes("undefined"), `Found literal undefined in ${pair.customEvent}`);
      assert.ok(modular.text.includes("RES8A4F2"), `Plain text missing ref for ${pair.customEvent}`);
    }
  });

  // 2. Custom template used when saved; disabled event sends nothing; feature flag false falls back to defaults
  await test("2. Custom template used when enabled, disabled event skipped, feature flag off falls back to defaults", async () => {
    const sentPayloads: SendEmailParams[] = [];
    const customVariant = buildDefaultTemplateVariant("booking_confirmation", "en");
    customVariant.subject = "CUSTOM VIP WELCOME - {{hotel_name}} ({{booking_reference}})";

    // 2a. Custom enabled
    const r1 = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES8A4F2_0001",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES8A4F2_0001",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex@example.com",
          roomNumber: "204",
          checkIn: "2026-11-24",
          checkOut: "2026-11-27",
          totalAmount: 270000,
          status: "confirmed",
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: true,
          language: "en",
          variant: customVariant,
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: false,
          publishedVersion: 2,
        }),
        sendEmailFn: async (p) => {
          sentPayloads.push(p);
          return { success: true, messageId: "msg_custom_1", deliveryState: "accepted_by_provider", provider: "resend", statusCode: 200 };
        },
        persistMarkerFn: async () => true,
      },
    });
    assert.strictEqual(r1.sent, true);
    assert.strictEqual(sentPayloads.length, 1);
    assert.strictEqual(sentPayloads[0].subject, "CUSTOM VIP WELCOME - Harborview Suites (RES8A4F2)");

    // 2b. Disabled event sends nothing
    const r2 = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES8A4F2_0002",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES8A4F2_0002",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex@example.com",
          status: "confirmed",
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: false,
          language: "en",
          variant: customVariant,
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async () => {
          throw new Error("Should never be called when event is disabled");
        },
      },
    });
    assert.strictEqual(r2.skipped, true);
    assert.strictEqual(r2.reason, "event_disabled");

    // 2c. Feature flag kill-switch check
    const prevFlag = process.env.EMAIL_CUSTOMIZATION_ENABLED;
    process.env.EMAIL_CUSTOMIZATION_ENABLED = "false";
    assert.strictEqual(isEmailCustomizationEnabled(SAMPLE_HOTEL), false);
    process.env.EMAIL_CUSTOMIZATION_ENABLED = "true";
    assert.strictEqual(isEmailCustomizationEnabled({ ...SAMPLE_HOTEL, emailCustomizationEnabled: false }), false);
    assert.strictEqual(isEmailCustomizationEnabled(SAMPLE_HOTEL), true);
    if (prevFlag === undefined) delete process.env.EMAIL_CUSTOMIZATION_ENABLED;
    else process.env.EMAIL_CUSTOMIZATION_ENABLED = prevFlag;
  });

  // 3. Unknown variable & template logic syntax rejected at save time
  await test("3. Unknown variable and template logic syntax rejected cleanly", () => {
    const unknown = validateTemplateVariables("Hello {{guest_name}} your secret is {{api_key}}");
    assert.strictEqual(unknown.valid, false);
    assert.ok(unknown.unknownVariables.includes("api_key"));

    const logic1 = validateTemplateVariables("{{#if guest_name}}Hi{{/if}}");
    assert.strictEqual(logic1.valid, false);

    const logic2 = validateTemplateVariables("{{{guest_name}}}");
    assert.strictEqual(logic2.valid, false);

    const logic3 = validateTemplateVariables("Total: ${process.env.RESEND_API_KEY}");
    assert.strictEqual(logic3.valid, false);

    const badVariant = buildDefaultTemplateVariant("booking_confirmation", "en");
    badVariant.subject = "Welcome {{non_existent_field}}";
    const issues = validateTemplateVariant(badVariant);
    assert.ok(issues.some((i) => i.path === "subject"));
  });

  // 4. Script/HTML injection in template AND guest name neutralized
  await test("4. Script/HTML injection in template and guest name neutralized on render", () => {
    const xssVariant = buildDefaultTemplateVariant("booking_confirmation", "en");
    xssVariant.blocks.push({
      id: "blk_xss",
      type: "paragraph",
      text: 'Welcome <script>alert("xss")</script><img src=x onerror="steal()"> <b>bold</b>',
    });

    const rendered = renderHotelEmailServerSide({
      variant: xssVariant,
      context: {
        ...BASE_CONTEXT,
        guestName: '<script>document.cookie</script>Alex "Admin" & Co',
      },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    });

    assert.ok(!rendered.html.includes("<script>"), "Unescaped <script> tag found!");
    assert.ok(!rendered.html.includes("onerror="), "Unescaped onerror handler found!");
    assert.ok(rendered.html.includes("&lt;script&gt;document.cookie&lt;/script&gt;"));
  });

  // 5. Cross-hotel admin rejected; non-admin staff rejected
  await test("5. Cross-hotel admin and non-admin staff rejected by strict admin guard", () => {
    const adminA = {
      uid: "u1",
      email: "admin@hotel-a.com",
      profile: { role: "hotelAdmin", hotelId: "hotel_a", status: "active" },
    };
    const staffA = {
      uid: "u2",
      email: "frontdesk@hotel-a.com",
      profile: { role: "receptionist", staffRole: "frontDesk", hotelId: "hotel_a", status: "active" },
    };
    const superAdmin = {
      uid: "u3",
      email: "smartwavetechcompany@gmail.com",
      profile: { role: "superAdmin", status: "active" },
    };

    assert.strictEqual(callerIsStrictHotelAdmin(adminA, "hotel_a").allowed, true);
    assert.strictEqual(callerIsStrictHotelAdmin(adminA, "hotel_b").allowed, false);
    assert.strictEqual(callerIsStrictHotelAdmin(staffA, "hotel_a").allowed, false);
    assert.strictEqual(callerIsStrictHotelAdmin(superAdmin, "hotel_b").allowed, true);
    assert.strictEqual(callerIsStrictHotelAdmin(null, "hotel_a").allowed, false);
  });

  // 6 & 7. Client-supplied recipient ignored + persistent emailsSent dedupe + failure retryability
  await test("6 & 7. Persistent emailsSent prevents duplicates and failed Resend calls do NOT lock out retries", async () => {
    const persisted: Record<string, any> = {};
    let attempts = 0;

    // First attempt fails at Resend -> should NOT persist marker
    const failRes = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES99999",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES99999",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "real.guest@example.com",
          roomNumber: "101",
          checkIn: "2026-12-01",
          checkOut: "2026-12-03",
          emailsSent: {},
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: true,
          language: "en",
          variant: buildDefaultTemplateForHotel("booking_confirmation", SAMPLE_HOTEL, "en"),
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async () => {
          attempts += 1;
          return { success: false, deliveryState: "failed", provider: "resend", statusCode: 502, error: "Temporary outage" };
        },
        persistMarkerFn: async (_h, _r, key, rec) => {
          persisted[key] = rec;
          return true;
        },
      },
    });
    assert.strictEqual(failRes.ok, false);
    assert.strictEqual(failRes.sent, false);
    assert.strictEqual(Object.keys(persisted).length, 0, "Failed send must NOT write emailsSent marker");

    // Second attempt succeeds -> writes marker
    let sentTo: string | string[] | undefined;
    const okRes = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES99999",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES99999",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "real.guest@example.com",
          roomNumber: "101",
          checkIn: "2026-12-01",
          checkOut: "2026-12-03",
          emailsSent: { ...persisted },
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: true,
          language: "en",
          variant: buildDefaultTemplateForHotel("booking_confirmation", SAMPLE_HOTEL, "en"),
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async (p) => {
          attempts += 1;
          sentTo = p.to;
          return { success: true, messageId: "msg_ok_2", deliveryState: "accepted_by_provider", provider: "resend", statusCode: 200 };
        },
        persistMarkerFn: async (_h, _r, key, rec) => {
          persisted[key] = rec;
          return true;
        },
      },
    });
    assert.strictEqual(okRes.sent, true);
    assert.deepStrictEqual(sentTo, ["real.guest@example.com"]);
    assert.ok(persisted.confirmation, "Successful send must write emailsSent.confirmation");

    // Third attempt (re-save / restart) -> deduplicated!
    const dupRes = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES99999",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES99999",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "real.guest@example.com",
          emailsSent: { ...persisted },
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        sendEmailFn: async () => {
          throw new Error("Duplicate send must not invoke Resend!");
        },
      },
    });
    assert.strictEqual(dupRes.skipped, true);
    assert.strictEqual(dupRes.deduplicated, true);
    assert.strictEqual(attempts, 2);
  });

  // 8 & 9. Missing guest email skips silently; thrown Resend exception never throws out
  await test("8 & 9. Missing guest email skips silently and thrown Resend errors never break PMS actions", async () => {
    const noEmailRes = await sendHotelEmail("hotel_alpha", "checked_in", {
      reservationId: "RES_NOEMAIL",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: { id: "RES_NOEMAIL", hotelId: "hotel_alpha", guestName: "Walk-In Guest" },
        guest: null,
        room: null,
      },
      overrides: { appUrl: "https://tidehotels.de" },
    });
    assert.strictEqual(noEmailRes.ok, true);
    assert.strictEqual(noEmailRes.skipped, true);
    assert.strictEqual(noEmailRes.reason, "no_guest_email");

    const crashRes = await sendHotelEmail("hotel_alpha", "checked_in", {
      reservationId: "RES_CRASH",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: { id: "RES_CRASH", hotelId: "hotel_alpha", guestName: "Guest", guestEmail: "g@example.com" },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: true,
          language: "en",
          variant: buildDefaultTemplateForHotel("checked_in", SAMPLE_HOTEL, "en"),
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async () => {
          throw new Error("Simulated Resend network crash");
        },
      },
    });
    assert.strictEqual(crashRes.ok, false);
    assert.strictEqual(crashRes.sent, false);
  });

  // 10. Loyalty block hides completely when absent and renders when present
  await test("10. Loyalty block hides when no loyalty data exists and renders cleanly when present", () => {
    const variant = buildDefaultTemplateVariant("checked_out", "en");
    const loyaltyPreset = OPTIONAL_SECTION_PRESETS.find((p) => p.id === "loyalty_points")!;
    variant.blocks.splice(variant.blocks.length - 1, 0, ...loyaltyPreset.createBlocks());

    const withoutLoyalty = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    });
    assert.ok(!withoutLoyalty.html.includes("Loyalty Tier"));
    assert.ok(!withoutLoyalty.html.includes("Points Earned This Stay"));
    assert.ok(!withoutLoyalty.html.includes("undefined"));

    const withLoyalty = renderHotelEmailServerSide({
      variant,
      context: {
        ...BASE_CONTEXT,
        loyaltyPointsEarned: 450,
        loyaltyPointsBalance: 2150,
        loyaltyTier: "Gold",
      },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    });
    assert.ok(withLoyalty.html.includes("Loyalty Tier"));
    assert.ok(withLoyalty.html.includes("450"));
    assert.ok(withLoyalty.html.includes("2150"));
    assert.ok(withLoyalty.html.includes("Gold"));
  });

  // 11. Custom portal URL used; no custom URL falls back to APP_URL (no trailing slash)
  await test("11. Custom hotel portal URL overrides APP_URL, and fallback strips trailing slash", () => {
    const variant = buildDefaultTemplateVariant("booking_confirmation", "en");

    const fallbackRender = renderHotelEmailServerSide({
      variant,
      context: { ...BASE_CONTEXT, appUrl: "https://tidehotels.de///" },
      settings: { ...DEFAULT_HOTEL_EMAIL_SETTINGS, portalUrl: "" },
    });
    assert.ok(fallbackRender.html.includes('href="https://tidehotels.de"'));
    assert.ok(!fallbackRender.html.includes('href="https://tidehotels.de/"'));

    const customSettings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      portalUrl: "https://portal.harborview.example",
    };
    const customRender = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings: customSettings,
    });
    assert.ok(customRender.html.includes('href="https://portal.harborview.example"'));
  });

  // 12. Malicious URLs rejected on save AND neutralized on render
  await test("12. Malicious URLs rejected on save and neutralized on render", () => {
    const badUrls = [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "http://insecure-hotel.example",
      "https://user:pass@phishing.example",
      "vbscript:msgbox(1)",
      "not-a-valid-url",
    ];

    for (const bad of badUrls) {
      assert.strictEqual(validateEmailUrl(bad).valid, false, `Should reject URL: ${bad}`);
      assert.ok(
        validateHotelEmailSettings({ portalUrl: bad }).length > 0,
        `Settings should reject URL: ${bad}`
      );
    }

    // Even if a malicious URL somehow bypassed save into blocks, render neutralizes it
    const badBtnVariant: EmailTemplateVariant = {
      ...buildDefaultTemplateVariant("booking_confirmation", "en"),
      blocks: [
        {
          id: "b1",
          type: "button",
          label: "Click Me",
          url: "javascript:alert(1)",
          displayStyle: "solid",
        },
      ],
    };
    const rendered = renderHotelEmailServerSide({
      variant: badBtnVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    });
    assert.ok(!rendered.html.toLowerCase().includes("javascript:"));
  });

  // 13. Hidden/renamed details table rows and contact fields render cleanly without "undefined"
  await test("13. Hidden/renamed details table rows and contact fields render cleanly", () => {
    const variant = buildDefaultTemplateVariant("booking_confirmation", "en");
    const tableBlock = variant.blocks.find((b) => b.type === "booking_details_table")!;
    if (tableBlock.type === "booking_details_table") {
      tableBlock.rows[0].label = "Confirmation Code";
      tableBlock.rows[2].visible = false; // Hide Room row
    }
    const footerBlock = variant.blocks.find((b) => b.type === "footer")!;
    if (footerBlock.type === "footer") {
      footerBlock.fields[0].visible = false; // Hide Address
      footerBlock.fields[1].label = "Front Desk Phone";
    }

    const rendered = renderHotelEmailServerSide({
      variant,
      context: { ...BASE_CONTEXT, hotelAddress: undefined, roomType: undefined },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    });

    assert.ok(rendered.html.includes("Confirmation Code"));
    assert.ok(!rendered.html.includes(">Room<"));
    assert.ok(rendered.html.includes("Front Desk Phone"));
    assert.ok(!rendered.html.includes("100 Marina Blvd"));
    assert.ok(!rendered.html.includes("undefined"));
  });

  // 14. Date, time, and currency format controls change displayed text only
  await test("14. Date, time, and currency display formats transform email output only", () => {
    assert.strictEqual(formatEmailDate("2026-11-24", "dd_dot_mm_dot_yyyy", "Europe/Berlin", "de"), "24.11.2026");
    assert.strictEqual(formatEmailDate("2026-11-24", "dd_mmm_yyyy", "UTC", "en"), "24 Nov 2026");
    assert.strictEqual(formatEmailTime("14:30", "12h"), "2:30 PM");
    assert.strictEqual(formatEmailTime("14:30", "24h"), "14:30");
    assert.strictEqual(
      formatEmailCurrency(270000, "EUR", { mode: "symbol", decimals: 2, thousandsSeparator: "." }),
      "€270.000,00"
    );
    assert.strictEqual(
      formatEmailCurrency(270000, "NGN", { mode: "symbol", decimals: 0, thousandsSeparator: "," }),
      "₦270,000"
    );

    const germanSettings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      defaultLanguage: "de",
      dateFormat: "dd_dot_mm_dot_yyyy",
      timeFormat: "12h",
      currencyDisplay: { mode: "symbol", decimals: 0, thousandsSeparator: "." },
    };
    const deVariant = buildDefaultTemplateVariant("booking_confirmation", "de");
    const rendered = renderHotelEmailServerSide({
      variant: deVariant,
      context: { ...BASE_CONTEXT, currencyCode: "EUR" },
      settings: germanSettings,
      language: "de",
    });
    assert.ok(rendered.html.includes("24.11.2026"));
    assert.ok(rendered.html.includes("€270.000"));
    assert.strictEqual(BASE_CONTEXT.totalAmount, 270000, "Stored numeric context must remain untouched");
  });

  // 15. Image security tests (magic bytes, resize > 2000px, EXIF strip, path traversal, reference tracking)
  await test("15. Image security: reject SVG/AVIF/PDF/MP4/WebM/renamed files, resize >2000px, strip EXIF, neutralize filenames, track refs", async () => {
    // Reject SVG, AVIF, PDF, MP4, WebM, fake renamed .png
    const svgBuf = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const avifBuf = Buffer.from("\x00\x00\x00\x1cftypavif\x00\x00\x00\x00avifmif1");
    const pdfBuf = Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj");
    const mp4Buf = Buffer.from("\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom");
    const webmBuf = Buffer.from("\x1a\x45\xdf\xa3\x01\x00\x00\x00webm");
    const fakePng = Buffer.from("<html><body>not a png</body></html>");

    for (const [label, buf] of [
      ["SVG", svgBuf],
      ["AVIF", avifBuf],
      ["PDF", pdfBuf],
      ["MP4", mp4Buf],
      ["WebM", webmBuf],
      ["Fake HTML", fakePng],
    ] as const) {
      assert.strictEqual(detectAllowedImageMagicBytes(buf), null, `${label} must fail magic-byte check`);
      const res = await validateAndProcessImageBuffer(buf);
      assert.strictEqual(res.ok, false, `${label} must be rejected by image processor`);
    }

    // Valid oversized 2600x400 JPEG WITH EXIF metadata -> must resize <= 2000px and strip EXIF!
    const oversizedJpegWithExif = await sharp({
      create: { width: 2600, height: 400, channels: 3, background: { r: 16, g: 120, b: 90 } },
    })
      .withMetadata({ exif: { IFD0: { Make: "SecretCameraGPS", Artist: "HiddenAuthor" } } })
      .jpeg({ quality: 85 })
      .toBuffer();

    const preMeta = await sharp(oversizedJpegWithExif).metadata();
    assert.ok(preMeta.exif && preMeta.exif.length > 0, "Test fixture should contain EXIF");

    const processed = await validateAndProcessImageBuffer(oversizedJpegWithExif);
    assert.strictEqual(processed.ok, true, "Valid JPEG should pass processing");
    if (processed.ok) {
      assert.ok(processed.result.width <= 2000, `Expected width <= 2000, got ${processed.result.width}`);
      assert.strictEqual(processed.result.mimeType, "image/jpeg");
      assert.ok(/^[0-9a-f]{32}\.jpg$/.test(processed.result.randomFilename), "Filename must be purely random hex");

      const postMeta = await sharp(processed.result.buffer).metadata();
      assert.ok(!postMeta.exif, "EXIF metadata must be stripped on re-encode");
    }

    // Valid PNG and WebP accepted
    const validPng = await sharp({
      create: { width: 120, height: 60, channels: 4, background: { r: 5, g: 150, b: 105, alpha: 1 } },
    })
      .png()
      .toBuffer();
    const pngRes = await validateAndProcessImageBuffer(validPng);
    assert.strictEqual(pngRes.ok, true);

    const validWebp = await sharp({
      create: { width: 120, height: 60, channels: 3, background: { r: 5, g: 150, b: 105 } },
    })
      .webp()
      .toBuffer();
    const webpRes = await validateAndProcessImageBuffer(validWebp);
    assert.strictEqual(webpRes.ok, true);

    // Path traversal label sanitization
    const cleanLabel = sanitizeImageLabel("../../etc/passwd<script>x</script>");
    assert.ok(!cleanLabel.includes(".."));
    assert.ok(!cleanLabel.includes("/"));
    assert.ok(!cleanLabel.includes("<script>"));

    // Reference tracking for published-template deletion guard
    const variantWithImg = buildDefaultTemplateVariant("booking_confirmation", "en");
    variantWithImg.branding.logoImageId = "img_logo_1";
    variantWithImg.branding.logoUrl = "https://firebasestorage.googleapis.com/v0/b/test/o/logo.png";
    variantWithImg.blocks.push({
      id: "blk_banner",
      type: "image",
      imageId: "img_banner_2",
      src: "https://firebasestorage.googleapis.com/v0/b/test/o/banner.webp",
      alt: "Property banner",
      widthPx: 540,
    });
    const refs = extractReferencedImages(variantWithImg);
    assert.ok(refs.imageIds.has("img_logo_1"));
    assert.ok(refs.imageIds.has("img_banner_2"));
    assert.ok(refs.urls.has("https://firebasestorage.googleapis.com/v0/b/test/o/banner.webp"));

    // All 9 customizable events have valid EN & DE defaults with zero validation errors
    for (const ev of CUSTOMIZABLE_EMAIL_EVENTS) {
      for (const lang of ["en", "de"] as const) {
        const v = buildDefaultTemplateVariant(ev, lang);
        const issues = validateTemplateVariant(v);
        assert.strictEqual(issues.length, 0, `Default template ${ev} (${lang}) has issues: ${JSON.stringify(issues)}`);
        const sampleCtx = buildSamplePreviewContext("hotel_alpha", SAMPLE_HOTEL, "https://tidehotels.de");
        const out = renderHotelEmailServerSide({ variant: v, context: sampleCtx, language: lang });
        assert.ok(out.subject.length > 0 && out.html.length > 100 && !out.html.includes("undefined"));
      }
    }
  });

  // 16. Tracking code request alert via dispatcher routes to platform + hotel renewal admins & skips non-pending
  await test("16. Tracking code request alert dispatches via sendHotelEmail with multi-tenant routing and skips non-pending", async () => {
    const sent: SendEmailParams[] = [];

    const pendingRes = await sendHotelEmail("SYSTEM", "tracking_code_request_alert", {
      requestId: "req_renewal_01",
      preloaded: {
        trackingRequest: {
          id: "req_renewal_01",
          status: "pending",
          type: "renewal",
          hotelId: "hotel_alpha",
          hotelName: "Harborview Suites",
          email: "owner@harborview.example",
          phone: "+49 30 555 0199",
          plan: "Enterprise",
          timestamp: "2026-11-20T09:00:00Z",
        },
        systemSettings: {
          platformName: "Tidé Cloud PMS",
          supportEmail: "platform-admin@example.com",
        },
        hotel: {
          ...SAMPLE_HOTEL,
          emailConfig: {
            trackingCodeAlertRecipients: ["gm@harborview.example"],
          },
        },
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        sendEmailFn: async (p) => {
          sent.push(p);
          return {
            success: true,
            messageId: "msg_tracking_1",
            deliveryState: "accepted_by_provider",
            provider: "resend",
            statusCode: 200,
          };
        },
      },
    });

    assert.strictEqual(pendingRes.ok, true);
    assert.strictEqual(pendingRes.sent, true);
    assert.strictEqual(sent.length, 1);
    assert.ok(Array.isArray(sent[0].to) && sent[0].to.includes("platform-admin@example.com"));
    assert.ok(Array.isArray(sent[0].to) && sent[0].to.includes("gm@harborview.example"));
    assert.strictEqual(sent[0].replyTo, "owner@harborview.example");
    assert.ok(sent[0].subject.includes("Renewal Code Request"));
    assert.ok(sent[0].html.includes("Harborview Suites"));
    assert.ok(sent[0].html.includes("req_renewal_01"));

    const approvedSkip = await sendHotelEmail("SYSTEM", "tracking_code_request_alert", {
      requestId: "req_already_done",
      preloaded: {
        trackingRequest: {
          id: "req_already_done",
          status: "approved",
          hotelName: "Harborview Suites",
          email: "owner@harborview.example",
        },
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        sendEmailFn: async () => {
          throw new Error("Non-pending tracking request must not send email");
        },
      },
    });
    assert.strictEqual(approvedSkip.ok, true);
    assert.strictEqual(approvedSkip.skipped, true);
  });

  // 17. Legacy hotel.emailConfig senderDisplayName & replyToEmail preserved when emailSettings leaves them blank
  await test("17. Legacy hotel.emailConfig senderDisplayName and replyToEmail preserved as fallback", async () => {
    const sent: SendEmailParams[] = [];
    const hotelWithLegacyConfig = {
      ...SAMPLE_HOTEL,
      emailConfig: {
        senderDisplayName: "Harborview Concierge Desk",
        replyToEmail: "concierge@harborview.example",
      },
    };

    const res = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES_LEGACY_CFG",
      preloaded: {
        hotel: hotelWithLegacyConfig,
        reservation: {
          id: "RES_LEGACY_CFG",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex@example.com",
          roomNumber: "305",
          checkIn: "2026-12-10",
          checkOut: "2026-12-12",
          status: "confirmed",
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => ({
          enabled: true,
          language: "en",
          variant: buildDefaultTemplateForHotel("booking_confirmation", hotelWithLegacyConfig, "en"),
          settings: { ...DEFAULT_HOTEL_EMAIL_SETTINGS, senderDisplayName: "", replyToEmail: "" },
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async (p) => {
          sent.push(p);
          return {
            success: true,
            messageId: "msg_legacy_cfg",
            deliveryState: "accepted_by_provider",
            provider: "resend",
            statusCode: 200,
          };
        },
        persistMarkerFn: async () => true,
      },
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, true);
    assert.strictEqual(sent[0].fromName, "Harborview Concierge Desk");
    assert.strictEqual(sent[0].replyTo, "concierge@harborview.example");
  });

  // 18. Role-Based Access Control (RBAC) for Email Templates module
  await test("18. RBAC: unassigned staff hidden & blocked; Hotel Admin/Admin full access; explicit view vs manage delegation works", () => {
    const hotelAdminProfile = { uid: "ha1", role: "hotelAdmin", hotelId: "hotel_a", status: "active" };
    const secondaryAdminProfile = { uid: "ha2", role: "staff", staffRole: "admin", hotelId: "hotel_a", status: "active" };
    const unassignedFrontDesk = { uid: "fd1", role: "staff", staffRole: "frontDesk", hotelId: "hotel_a", status: "active" };
    const unassignedManager = { uid: "mg1", role: "manager", staffRole: "hotelManager", hotelId: "hotel_a", status: "active" };
    const viewOnlyStaff = {
      uid: "vs1",
      role: "staff",
      staffRole: "frontDesk",
      hotelId: "hotel_a",
      status: "active",
      permissions: ["view_dashboard", "view_email_templates"],
    };
    const delegatedEmailAdmin = {
      uid: "ea1",
      role: "staff",
      hotelId: "hotel_a",
      status: "active",
      customRoleId: "role_email_mgr",
      permissions: [],
    };
    const customRoles = [
      { id: "role_email_mgr", status: "active", permissions: ["view_email_templates", "manage_email_templates"] },
      { id: "role_disabled", status: "disabled", permissions: ["manage_email_templates"] },
    ];

    // Frontend RBAC module visibility & permission checks
    assert.strictEqual(isPMSModuleAssigned(hotelAdminProfile, "email_templates", customRoles), true);
    assert.strictEqual(hasPermission(hotelAdminProfile, "manage_email_templates", customRoles), true);
    assert.strictEqual(isPMSModuleAssigned(secondaryAdminProfile, "email_templates", customRoles), true);
    assert.strictEqual(hasPermission(secondaryAdminProfile, "manage_email_templates", customRoles), true);

    assert.strictEqual(isPMSModuleAssigned(unassignedFrontDesk, "email_templates", customRoles), false);
    assert.strictEqual(hasPermission(unassignedFrontDesk, "view_email_templates", customRoles), false);
    assert.strictEqual(isPMSModuleAssigned(unassignedManager, "email_templates", customRoles), false);
    assert.strictEqual(hasPermission(unassignedManager, "manage_email_templates", customRoles), false);

    assert.strictEqual(isPMSModuleAssigned(viewOnlyStaff, "email_templates", customRoles), true);
    assert.strictEqual(hasPermission(viewOnlyStaff, "view_email_templates", customRoles), true);
    assert.strictEqual(hasPermission(viewOnlyStaff, "manage_email_templates", customRoles), false);

    assert.strictEqual(isPMSModuleAssigned(delegatedEmailAdmin, "email_templates", customRoles), true);
    assert.strictEqual(hasPermission(delegatedEmailAdmin, "manage_email_templates", customRoles), true);

    // Backend RBAC checks (callerHasEmailModuleAccess)
    assert.strictEqual(
      callerHasEmailModuleAccess({ uid: "ha1", email: "a@h.com", profile: hotelAdminProfile }, "hotel_a", "manage").allowed,
      true
    );
    assert.strictEqual(
      callerHasEmailModuleAccess({ uid: "ha1", email: "a@h.com", profile: hotelAdminProfile }, "hotel_b", "view").allowed,
      false
    );
    assert.strictEqual(
      callerHasEmailModuleAccess({ uid: "fd1", email: "f@h.com", profile: unassignedFrontDesk }, "hotel_a", "view").allowed,
      false
    );
    assert.strictEqual(
      callerHasEmailModuleAccess({ uid: "vs1", email: "v@h.com", profile: viewOnlyStaff }, "hotel_a", "view").allowed,
      true
    );
    assert.strictEqual(
      callerHasEmailModuleAccess({ uid: "vs1", email: "v@h.com", profile: viewOnlyStaff }, "hotel_a", "manage").allowed,
      false
    );
    assert.strictEqual(
      callerHasEmailModuleAccess(
        { uid: "ea1", email: "e@h.com", profile: delegatedEmailAdmin },
        "hotel_a",
        "manage",
        customRoles[0]
      ).allowed,
      true
    );
    assert.strictEqual(
      callerHasEmailModuleAccess(
        { uid: "ea1", email: "e@h.com", profile: delegatedEmailAdmin },
        "hotel_b",
        "manage",
        customRoles[0]
      ).allowed,
      false
    );
    assert.strictEqual(
      callerHasEmailModuleAccess(
        { uid: "ea1", email: "e@h.com", profile: { ...delegatedEmailAdmin, customRoleId: "role_disabled" } },
        "hotel_a",
        "view",
        customRoles[1]
      ).allowed,
      false
    );
  });

  // 19. Resolver failure gracefully falls back to default template and sends via Resend
  await test("19. Dispatcher falls back to default hotel template if resolver throws unexpectedly", async () => {
    const sent: SendEmailParams[] = [];
    const res = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES_FALLBACK_01",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES_FALLBACK_01",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex@example.com",
          roomNumber: "402",
          checkIn: "2026-12-15",
          checkOut: "2026-12-17",
          status: "confirmed",
        },
        guest: null,
        room: null,
      },
      overrides: {
        appUrl: "https://tidehotels.de",
        resolveTemplateFn: async () => {
          throw new Error("Simulated transient Firestore timeout");
        },
        sendEmailFn: async (p) => {
          sent.push(p);
          return {
            success: true,
            messageId: "msg_fallback_1",
            deliveryState: "accepted_by_provider",
            provider: "resend",
            statusCode: 200,
          };
        },
        persistMarkerFn: async () => true,
      },
    });

    assert.strictEqual(res.ok, true);
    assert.strictEqual(res.sent, true);
    assert.strictEqual(res.usedDefaultLayout, true);
    assert.strictEqual(sent.length, 1);
    assert.strictEqual(sent[0].subject, "Booking Confirmation - Harborview Suites (RES_FALL)");
    assert.ok(sent[0].html.includes("Harborview Suites"));
    assert.ok(sent[0].html.includes("Room 402"));
  });

  // 20. Local image storage provider: upload returns https URL, loads via read-only middleware with security headers, traversal blocked, delete removes file
  await test("20. Local image storage: https URL loads via read-only middleware, blocks traversal/listing, and deletes file from disk", async () => {
    const tmpUploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pms-email-img-test-"));
    const memoryStore = new Map<string, any>();

    try {
      const localProvider = resolveImageStorageProvider({
        env: {
          IMAGE_STORAGE_PROVIDER: "local",
          IMAGE_UPLOAD_DIR: tmpUploadDir,
          APP_URL: "https://tidehotels.de/",
        },
      });
      assert.strictEqual(localProvider.name, "local");

      const sampleWebp = await sharp({
        create: { width: 320, height: 120, channels: 3, background: { r: 14, g: 165, b: 120 } },
      })
        .webp({ quality: 80 })
        .toBuffer();

      const uploadRes = await uploadHotelImage(
        "hotel_alpha",
        {
          base64Data: `data:image/webp;base64,${sampleWebp.toString("base64")}`,
          label: "Lobby Banner",
        },
        "admin@harborview.example",
        undefined,
        {
          storageProvider: localProvider,
          listDocsFn: async () => Array.from(memoryStore.values()),
          setDocFn: async (_h, id, asset) => {
            memoryStore.set(id, asset);
            return { ok: true };
          },
        }
      );

      assert.strictEqual(uploadRes.ok, true, `Upload failed: ${uploadRes.error}`);
      assert.ok(uploadRes.image, "Uploaded image metadata should be returned");
      const img = uploadRes.image!;
      assert.ok(img.url.startsWith("https://tidehotels.de/uploads/email-images/hotel_alpha/"));
      assert.ok(img.url.endsWith(".webp"));
      assert.strictEqual(img.storageProvider, "local");
      // Metadata only in Firestore — never raw binary
      assert.strictEqual((img as any).buffer, undefined);

      const urlPath = new URL(img.url).pathname; // /uploads/email-images/hotel_alpha/<hex>.webp
      const filename = path.basename(urlPath);
      const diskPath = path.join(tmpUploadDir, "email-images", "hotel_alpha", filename);
      assert.strictEqual(fs.existsSync(diskPath), true, "Image file must exist on disk");

      // Mount read-only middleware on an ephemeral HTTP server and verify loading & security headers
      const testApp = express();
      testApp.use("/uploads/email-images", createLocalEmailImageMiddleware({ uploadDir: tmpUploadDir }));
      const server = http.createServer(testApp);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const baseHttp = `http://127.0.0.1:${port}`;

      try {
        // 1. Valid image loads with exact headers
        const getResp = await fetch(`${baseHttp}${urlPath}`);
        assert.strictEqual(getResp.status, 200);
        assert.strictEqual(getResp.headers.get("content-type"), "image/webp");
        assert.strictEqual(getResp.headers.get("x-content-type-options"), "nosniff");
        assert.ok((getResp.headers.get("cache-control") || "").includes("max-age=31536000"));
        const fetchedBytes = Buffer.from(await getResp.arrayBuffer());
        assert.ok(fetchedBytes.length > 0 && fetchedBytes.equals(await fs.promises.readFile(diskPath)));

        // 2. Directory listings blocked
        const dirRoot = await fetch(`${baseHttp}/uploads/email-images/`);
        assert.strictEqual(dirRoot.status, 404);
        const dirHotel = await fetch(`${baseHttp}/uploads/email-images/hotel_alpha/`);
        assert.strictEqual(dirHotel.status, 404);

        // 3. Path traversal & encoded traversal neutralized (use raw http.get so %2e%2e reaches Express un-normalized)
        const travStatus = await new Promise<number>((resolve, reject) => {
          const req = http.get(
            {
              hostname: "127.0.0.1",
              port,
              path: "/uploads/email-images/hotel_alpha/%2e%2e/%2e%2e/etc/passwd",
            },
            (res) => {
              res.resume();
              resolve(res.statusCode || 0);
            }
          );
          req.on("error", reject);
        });
        assert.strictEqual(travStatus, 400);
        const trav2 = await fetch(`${baseHttp}/uploads/email-images/hotel_alpha/not-a-valid-file.svg`);
        assert.strictEqual(trav2.status, 404);
        assert.strictEqual(resolveSafeLocalEmailImagePath("../hotel_beta", filename, tmpUploadDir), null);
        assert.strictEqual(resolveSafeLocalEmailImagePath("hotel_alpha", `../${filename}`, tmpUploadDir), null);

        // 4. Read-only: write methods rejected
        const postResp = await fetch(`${baseHttp}${urlPath}`, { method: "POST" });
        assert.strictEqual(postResp.status, 405);

        // 5. Deletion blocked (409) when referenced in a published template; file stays on disk
        const blockedDel = await deleteHotelImage("hotel_alpha", img.id, undefined, {
          storageProvider: localProvider,
          readDocFn: async (_h, id) => memoryStore.get(id) || null,
          findRefsFn: async () => ({ publishedTemplates: ["booking_confirmation"], draftTemplates: [] }),
          deleteDocFn: async () => ({ ok: true }),
        });
        assert.strictEqual(blockedDel.ok, false);
        assert.strictEqual(blockedDel.statusCode, 409);
        assert.strictEqual(fs.existsSync(diskPath), true, "Blocked delete must NOT remove file from disk");

        // 6. Unreferenced deletion removes file from disk AND returns 404 over HTTP
        const delRes = await deleteHotelImage("hotel_alpha", img.id, undefined, {
          storageProvider: localProvider,
          readDocFn: async (_h, id) => memoryStore.get(id) || null,
          findRefsFn: async () => ({ publishedTemplates: [], draftTemplates: [] }),
          deleteDocFn: async (_h, id) => {
            memoryStore.delete(id);
            return { ok: true };
          },
        });
        assert.strictEqual(delRes.ok, true);
        assert.strictEqual(fs.existsSync(diskPath), false, "Deleted image must be removed from disk");
        const afterDelResp = await fetch(`${baseHttp}${urlPath}`);
        assert.strictEqual(afterDelResp.status, 404);
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
    } finally {
      await fs.promises.rm(tmpUploadDir, { recursive: true, force: true });
    }
  });

  // 21. Env-var provider switching (local <-> cloudinary) & Cloudinary server-side signed upload/delete
  await test("21. Provider switches via IMAGE_STORAGE_PROVIDER env var; Cloudinary signs uploads/deletes per hotel without leaking secrets", async () => {
    const testSecret = "super_secret_do_not_leak_999";

    // Switching via env var with no code changes
    const pLocal = resolveImageStorageProvider({ env: { IMAGE_STORAGE_PROVIDER: "local" } });
    assert.strictEqual(pLocal.name, "local");

    assert.throws(
      () => resolveImageStorageProvider({ env: { IMAGE_STORAGE_PROVIDER: "s3_unsupported" } }),
      /Unsupported IMAGE_STORAGE_PROVIDER/
    );

    // Missing Cloudinary credentials fail cleanly without leaking any secret
    assert.throws(
      () =>
        resolveImageStorageProvider({
          env: { IMAGE_STORAGE_PROVIDER: "cloudinary", CLOUDINARY_CLOUD_NAME: "demo_cloud" },
        }),
      /CLOUDINARY_API_KEY.*CLOUDINARY_API_SECRET/
    );

    const requests: Array<{ url: string; method: string; body: any }> = [];
    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, method: init?.method || "GET", body: init?.body });

      if (url.endsWith("/image/upload")) {
        const form = init?.body as FormData;
        const folder = String(form.get("folder") || "");
        const publicId = String(form.get("public_id") || "");
        const timestamp = String(form.get("timestamp") || "");
        const signature = String(form.get("signature") || "");
        const expectedSig = buildCloudinarySignature(
          {
            folder,
            overwrite: "true",
            public_id: publicId,
            timestamp,
            unique_filename: "false",
          },
          testSecret
        );
        assert.strictEqual(folder, "pms-email-images/hotel_beta");
        assert.strictEqual(signature, expectedSig, "Cloudinary upload signature must match SHA-1 spec");
        assert.strictEqual(form.get("api_key"), "test_api_key_123");

        return new Response(
          JSON.stringify({
            secure_url: `https://res.cloudinary.com/demo_cloud/image/upload/v1/${folder}/${publicId}.png`,
            public_id: `${folder}/${publicId}`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }

      if (url.endsWith("/image/destroy")) {
        const params = new URLSearchParams(String(init?.body || ""));
        const publicId = params.get("public_id") || "";
        const timestamp = params.get("timestamp") || "";
        const signature = params.get("signature") || "";
        const expectedSig = buildCloudinarySignature(
          {
            invalidate: "true",
            public_id: publicId,
            timestamp,
          },
          testSecret
        );
        assert.ok(publicId.startsWith("pms-email-images/hotel_beta/"));
        assert.strictEqual(signature, expectedSig, "Cloudinary destroy signature must match SHA-1 spec");
        return new Response(JSON.stringify({ result: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response("Not found", { status: 404 });
    }) as typeof fetch;

    const pCloud = resolveImageStorageProvider({
      env: {
        IMAGE_STORAGE_PROVIDER: "cloudinary",
        CLOUDINARY_CLOUD_NAME: "demo_cloud",
        CLOUDINARY_API_KEY: "test_api_key_123",
        CLOUDINARY_API_SECRET: testSecret,
      },
      fetchFn: mockFetch,
    });
    assert.strictEqual(pCloud.name, "cloudinary");

    const samplePng = await sharp({
      create: { width: 100, height: 100, channels: 4, background: { r: 30, g: 80, b: 200, alpha: 1 } },
    })
      .png()
      .toBuffer();

    const memoryStore = new Map<string, any>();
    const uploadRes = await uploadHotelImage(
      "hotel_beta",
      { base64Data: samplePng.toString("base64"), label: "Hotel Beta Logo" },
      "admin@hotelbeta.example",
      undefined,
      {
        storageProvider: pCloud,
        listDocsFn: async () => Array.from(memoryStore.values()),
        setDocFn: async (_h, id, asset) => {
          memoryStore.set(id, asset);
          return { ok: true };
        },
      }
    );

    assert.strictEqual(uploadRes.ok, true, `Cloudinary upload failed: ${uploadRes.error}`);
    assert.ok(uploadRes.image!.url.startsWith("https://res.cloudinary.com/demo_cloud/"));
    assert.strictEqual(uploadRes.image!.storageProvider, "cloudinary");
    assert.ok(uploadRes.image!.storagePath.startsWith("pms-email-images/hotel_beta/"));

    // Cross-hotel delete must NOT call destroy on another hotel's asset
    const crossHotelDel = await pCloud.delete({
      hotelId: "hotel_alpha",
      storagePath: uploadRes.image!.storagePath,
    });
    assert.strictEqual(crossHotelDel.deleted, false);
    assert.strictEqual(requests.length, 1, "Cross-hotel delete must not call Cloudinary destroy");

    // Authorized hotel delete removes image from Cloudinary via signed destroy
    const delRes = await deleteHotelImage("hotel_beta", uploadRes.image!.id, undefined, {
      storageProvider: pCloud,
      readDocFn: async (_h, id) => memoryStore.get(id) || null,
      findRefsFn: async () => ({ publishedTemplates: [], draftTemplates: [] }),
      deleteDocFn: async (_h, id) => {
        memoryStore.delete(id);
        return { ok: true };
      },
    });
    assert.strictEqual(delRes.ok, true);
    assert.strictEqual(requests.length, 2);
    assert.ok(requests[1].url.endsWith("/image/destroy"));
  });

  // 22. Byte-for-byte v1 default & legacy saved template parity (no v2 CSS leak)
  await test("22. Legacy v1 defaults and saved templates remain untouched (no v2 responsive shell leak)", () => {
    for (const ev of CUSTOMIZABLE_EMAIL_EVENTS) {
      const v1 = buildDefaultTemplateForHotel(ev, SAMPLE_HOTEL, "en");
      assert.strictEqual(v1.schemaVersion, undefined, `Default ${ev} must stay v1 (no schemaVersion)`);
      assert.strictEqual(isModernV2Variant(v1), false, `Default ${ev} must use legacy v1 renderer`);

      const rendered = renderHotelEmailServerSide({
        variant: v1,
        context: BASE_CONTEXT,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: "en",
        usedDefaultLayout: true,
      });

      assert.ok(!rendered.html.includes("em-stack"), `Legacy v1 ${ev} must not include v2 CSS classes`);
      assert.ok(!rendered.html.includes("v:roundrect"), `Legacy v1 ${ev} must not include v2 VML markup`);
      assert.ok(rendered.html.includes("max-width:600px"), `Legacy v1 ${ev} must retain exact 600px shell`);
    }
  });

  // 23. All 13 new modern blocks render valid email-safe tables, VML buttons, mobile stacking, decorative PNG icons (no SVG/data URI)
  await test("23. All 13 modern blocks render table HTML, VML buttons, dir=rtl stacking, PNG icons (alt=''), plain text, zero SVG/data URIs", () => {
    const v2AllBlocks: EmailTemplateVariant = {
      schemaVersion: 2,
      subject: "Welcome to {{hotel_name}} ({{booking_reference}})",
      preheader: "Your upcoming stay details",
      branding: {
        ...buildDefaultTemplateVariant("booking_confirmation", "en").branding,
        primaryColor: "#991b1b",
        secondaryColor: "#18181b",
        buttonColor: "#991b1b",
        accentBarEnabled: false,
        showEyebrow: false,
      },
      blocks: [
        {
          id: "m1",
          type: "brand_header",
          showHotelName: true,
          showAddress: true,
          showPhone: true,
          iconTone: "muted",
        },
        {
          id: "m2",
          type: "promo_banner",
          imageUrl: "https://tidehotels.de/uploads/email-assets/placeholders/business_banner.png",
          imageAlt: "Guest portal preview",
          text: "Manage your stay online anytime.",
          buttonLabel: "Open Portal",
          buttonUrl: "{{portal_link}}",
          buttonStyle: "outlined",
          buttonCorner: "pill",
        },
        {
          id: "m3",
          type: "membership_strip",
          condition: "has_loyalty",
          tierTemplate: "{{loyalty_tier}} Member",
          pointsTemplate: "{{loyalty_points_balance}} Points",
        },
        {
          id: "m4",
          type: "icon_divider",
          icon: "calendar",
          iconTone: "muted",
        },
        {
          id: "m5",
          type: "hero_text",
          headline: "We Look Forward to Welcoming You",
          body: "Dear {{guest_name}}, your reservation is confirmed.",
          buttonLabel: "Manage Stay",
          buttonUrl: "{{portal_link}}",
          buttonStyle: "outlined",
          buttonCorner: "square",
          style: { align: "center" },
        },
        {
          id: "m6",
          type: "confirmation_number",
          label: "CONFIRMATION NUMBER",
          valueTemplate: "{{booking_reference}}",
        },
        {
          id: "m7",
          type: "stay_dates",
          checkInLabel: "CHECK-IN",
          checkInDateTemplate: "{{check_in_date}}",
          checkInTimeTemplate: "{{check_in_time}}",
          checkOutLabel: "CHECK-OUT",
          checkOutDateTemplate: "{{check_out_date}}",
          checkOutTimeTemplate: "{{check_out_time}}",
        },
        {
          id: "m8",
          type: "feature_card",
          imagePosition: "right",
          imageUrl: "https://tidehotels.de/uploads/email-assets/placeholders/spa_card.png",
          imageAlt: "Wellness lounge",
          title: "Unwind at the Spa",
          body: "Reserve a massage or sauna session before you arrive.",
          buttonLabel: "Book Spa",
          buttonUrl: "{{portal_link}}",
          buttonStyle: "filled",
          buttonCorner: "rounded",
          style: { borderRadius: 12, borderColor: "#e4e4e7" },
        },
        {
          id: "m9",
          type: "benefits_list",
          condition: "has_loyalty",
          badgeText: "{{loyalty_tier}}",
          heading: "Your {{loyalty_tier}} Benefits",
          listStyle: "icon",
          itemIcon: "check",
          iconTone: "emerald",
          items: [
            { id: "b1", text: "Late check-out subject to availability" },
            { id: "b2", text: "Points earned: {{loyalty_points_earned}}" },
          ],
          footnote: "*Subject to property availability.",
          buttonLabel: "See Benefits",
          buttonUrl: "{{portal_link}}",
          buttonStyle: "outlined",
          buttonCorner: "square",
        },
        {
          id: "m10",
          type: "icon_link_grid",
          heading: "Explore the Area",
          subheading: "Dining and activities nearby.",
          iconTone: "dark",
          items: [
            { id: "g1", icon: "dining", label: "Hotel Dining", url: "{{hotel_website}}" },
            { id: "g2", icon: "activities", label: "Activities", url: "{{hotel_website}}" },
            { id: "g3", icon: "wifi", label: "Property Wi-Fi", url: "{{hotel_website}}" },
          ],
        },
        {
          id: "m11",
          type: "image_with_list",
          imagePosition: "left",
          imageUrl: "https://tidehotels.de/uploads/email-assets/placeholders/suite_card.png",
          imageAlt: "Guest portal checklist",
          heading: "Everything ready for your arrival",
          iconTone: "dark",
          items: [
            { id: "i1", icon: "key", text: "Review check-in details" },
            { id: "i2", icon: "parking", text: "Reserve on-site parking" },
            { id: "i3", icon: "chat", text: "Message the front desk" },
          ],
          buttonLabel: "Go Now",
          buttonUrl: "{{portal_link}}",
          buttonStyle: "dark",
          buttonCorner: "square",
        },
        {
          id: "m12",
          type: "footer_nav",
          links: [
            { id: "fn1", label: "Hotel Website", url: "{{hotel_website}}" },
            { id: "fn2", label: "Contact Us", url: "{{portal_link}}" },
          ],
        },
        {
          id: "m13",
          type: "legal_section",
          sections: [
            { id: "lg1", heading: "Contact Us", body: "Call {{hotel_phone}} or email {{hotel_email}}." },
          ],
          copyrightText: "© {{hotel_name}}",
        },
      ],
    };

    const issues = validateTemplateVariant(v2AllBlocks);
    assert.strictEqual(issues.length, 0, `Valid v2 template must have 0 issues, got: ${JSON.stringify(issues)}`);
    assert.strictEqual(isModernV2Variant(v2AllBlocks), true);

    const rendered = renderHotelEmailServerSide({
      variant: v2AllBlocks,
      context: {
        ...BASE_CONTEXT,
        loyaltyTier: "Gold",
        loyaltyPointsBalance: 2400,
        loyaltyPointsEarned: 450,
      },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("undefined"), "Rendered v2 HTML must not contain literal undefined");
    assert.ok(!rendered.html.includes("<svg"), "Email HTML must never contain inline <svg>");
    assert.ok(!rendered.html.includes("data:image/"), "Email HTML must never embed data:image URIs");
    assert.ok(rendered.html.includes("v:roundrect"), "Modern buttons must render Outlook VML v:roundrect");
    assert.ok(rendered.html.includes('dir="rtl"'), "Right-aligned feature card must use dir=rtl for mobile image-on-top stacking");
    assert.ok(rendered.html.includes('alt=""'), "Decorative built-in PNG icons must have empty alt=''");
    assert.ok(rendered.html.includes("/uploads/email-assets/icons/"), "Icons must load via module PNG assets URL");
    assert.ok(rendered.html.includes("Gold Member") && rendered.html.includes("2400 Points"));
    assert.ok(rendered.html.includes("RES8A4F2") && rendered.html.includes("CHECK-IN") && rendered.html.includes("CHECK-OUT"));
    assert.ok(rendered.text.includes("RES8A4F2") && rendered.text.includes("Unwind at the Spa") && rendered.text.includes("Hotel Dining"));
  });

  // 24. Loyalty hiding, XSS & style/URL validation, and multi-block image reference tracking
  await test("24. Loyalty hides when absent, XSS & unsafe URLs/styles blocked on v2 blocks, extractReferencedImages covers all new blocks", () => {
    const preset = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");

    // Loyalty OFF -> membership_strip & benefits_list hidden, never invented
    const withoutLoyalty = renderHotelEmailServerSide({
      variant: preset,
      context: { ...BASE_CONTEXT, loyaltyTier: null, loyaltyPointsBalance: null, loyaltyPointsEarned: null },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!withoutLoyalty.html.includes("Points"), "Loyalty points must not be invented when absent");
    assert.ok(!withoutLoyalty.html.includes("Member Benefits"), "Loyalty benefits block must hide when absent");

    // Loyalty ON -> shown
    const withLoyalty = renderHotelEmailServerSide({
      variant: preset,
      context: { ...BASE_CONTEXT, loyaltyTier: "Platinum", loyaltyPointsBalance: 5120, loyaltyPointsEarned: 600 },
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(withLoyalty.html.includes("Platinum") && withLoyalty.html.includes("5120"));

    // Invalid hex color, borderRadius > 16, javascript: URL, missing alt text all rejected on validation
    const invalidV2: EmailTemplateVariant = {
      ...preset,
      blocks: [
        {
          id: "bad_card",
          type: "feature_card",
          imagePosition: "left",
          imageUrl: "http://insecure.example/pic.png",
          imageAlt: "",
          title: '<script>alert("xss")</script>Suite',
          body: "Enjoy {{unknown_var}}",
          buttonLabel: "Click",
          buttonUrl: "javascript:alert(1)",
          style: {
            backgroundColor: "url(javascript:evil)",
            borderRadius: 99,
            paddingY: 200,
          },
        },
      ],
    };
    const badIssues = validateTemplateVariant(invalidV2);
    assert.ok(badIssues.some((i) => i.path.includes("imageUrl")), "Non-HTTPS imageUrl must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("imageAlt")), "Missing imageAlt must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("buttonUrl")), "javascript: buttonUrl must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("body")), "Unknown variable must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("backgroundColor")), "Non-hex color must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("borderRadius")), "borderRadius > 16 must be rejected");
    assert.ok(badIssues.some((i) => i.path.includes("paddingY")), "paddingY > 40 must be rejected");

    // Even if rendered directly, XSS and unsafe URLs/styles are escaped/neutralized
    const safeRendered = renderHotelEmailServerSide({
      variant: invalidV2,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!safeRendered.html.includes("<script>"), "Script tags must be HTML-escaped on render");
    assert.ok(!safeRendered.html.includes("javascript:"), "javascript: URLs must be stripped on render");

    // extractReferencedImages tracks IDs & URLs across all new image-bearing blocks
    const refVariant: EmailTemplateVariant = {
      ...preset,
      blocks: [
        { id: "r1", type: "brand_header", showHotelName: true, showAddress: true, showPhone: true, logoImageId: "id_hdr", logoUrl: "https://cdn.example/hdr.webp" },
        { id: "r2", type: "promo_banner", imageId: "id_promo", imageUrl: "https://cdn.example/promo.webp", imageAlt: "Promo", text: "Hi", buttonLabel: "Go", buttonUrl: "{{portal_link}}" },
        { id: "r3", type: "feature_card", imagePosition: "left", imageId: "id_card", imageUrl: "https://cdn.example/card.gif", imageAlt: "Card", title: "T", body: "B" },
        { id: "r4", type: "benefits_list", listStyle: "bullet", badgeImageId: "id_ben", badgeImageUrl: "https://cdn.example/ben.png", heading: "H", items: [{ id: "1", text: "x" }] },
        { id: "r5", type: "image_with_list", imagePosition: "left", imageId: "id_iwl", imageUrl: "https://cdn.example/iwl.webp", imageAlt: "List", heading: "H", items: [{ id: "1", icon: "key", text: "x" }] },
        { id: "r6", type: "legal_section", footerLogoImageId: "id_leg", footerLogoUrl: "https://cdn.example/leg.png", sections: [{ id: "1", heading: "H", body: "B" }] },
      ],
    };
    const refs = extractReferencedImages(refVariant);
    for (const expectedId of ["id_hdr", "id_promo", "id_card", "id_ben", "id_iwl", "id_leg"]) {
      assert.ok(refs.imageIds.has(expectedId), `extractReferencedImages missing ${expectedId}`);
    }
    assert.ok(refs.urls.has("https://cdn.example/card.gif"));
  });

  // 25. Built-in PNG icons, neutral placeholder PNGs, and sample animated GIF middleware
  await test("25. Built-in email assets middleware serves all 15 PNG icons, 6 placeholders, sample GIF, and blocks traversal/SVG/POST", async () => {
    const assetApp = express();
    assetApp.use("/uploads/email-assets", createEmailAssetsMiddleware());
    const server = http.createServer(assetApp);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    const baseHttp = `http://127.0.0.1:${port}`;

    try {
      // Every built-in icon across all 7 tones exists as a pre-rendered PNG on disk
      for (const tone of EMAIL_ICON_TONES) {
        for (const icon of EMAIL_ICON_NAMES) {
          const diskPath = resolveSafeBundledIconPath(tone, icon);
          assert.ok(diskPath && fs.existsSync(diskPath), `Bundled PNG missing on disk: ${tone}/${icon}.png`);
        }
      }

      // Every built-in icon serves valid PNG with ETag, 304 support, nosniff, CORS, and immutable cache
      for (const icon of EMAIL_ICON_NAMES) {
        const resp = await fetch(`${baseHttp}/uploads/email-assets/icons/dark/${icon}.png`);
        assert.strictEqual(resp.status, 200, `Icon ${icon} should return 200`);
        assert.strictEqual(resp.headers.get("content-type"), "image/png");
        assert.strictEqual(resp.headers.get("x-content-type-options"), "nosniff");
        assert.strictEqual(resp.headers.get("access-control-allow-origin"), "*");
        assert.ok((resp.headers.get("cache-control") || "").includes("max-age=31536000"));
        const etag = resp.headers.get("etag");
        assert.ok(etag && etag.length > 4, `Icon ${icon} must include ETag header`);
        const buf = Buffer.from(await resp.arrayBuffer());
        assert.strictEqual(detectAllowedImageMagicBytes(buf)?.mimeType, "image/png", `Icon ${icon} must have valid PNG magic bytes`);

        if (icon === "location_pin") {
          const notMod = await fetch(`${baseHttp}/uploads/email-assets/icons/dark/${icon}.png`, {
            headers: { "If-None-Match": etag },
          });
          assert.strictEqual(notMod.status, 304, "Matching If-None-Match ETag should return 304");
          const shorthand = await fetch(`${baseHttp}/uploads/email-assets/icons/${icon}.png`);
          assert.strictEqual(shorthand.status, 200, "Shorthand /icons/{icon}.png should resolve default dark PNG");
        }
      }

      // Every neutral placeholder serves valid PNG
      for (const name of EMAIL_PLACEHOLDER_IMAGES) {
        const resp = await fetch(`${baseHttp}/uploads/email-assets/placeholders/${name}.png`);
        assert.strictEqual(resp.status, 200, `Placeholder ${name} should return 200`);
        assert.strictEqual(resp.headers.get("content-type"), "image/png");
        const buf = Buffer.from(await resp.arrayBuffer());
        assert.strictEqual(detectAllowedImageMagicBytes(buf)?.mimeType, "image/png");
      }

      // Sample animated GIF serves valid multi-frame GIF
      const gifResp = await fetch(`${baseHttp}/uploads/email-assets/samples/welcome.gif`);
      assert.strictEqual(gifResp.status, 200);
      assert.strictEqual(gifResp.headers.get("content-type"), "image/gif");
      const gifBuf = Buffer.from(await gifResp.arrayBuffer());
      assert.strictEqual(detectAllowedImageMagicBytes(gifBuf)?.mimeType, "image/gif");
      const gifMeta = await sharp(gifBuf, { animated: true }).metadata();
      assert.ok((gifMeta.pages || 1) >= 2, "Sample welcome.gif must be multi-frame animated");

      // Security checks: traversal 400, SVG/unknown 404, POST 405
      const travStatus = await new Promise<number>((resolve, reject) => {
        const req = http.get(
          { hostname: "127.0.0.1", port, path: "/uploads/email-assets/icons/%2e%2e/etc/passwd" },
          (res) => {
            res.resume();
            resolve(res.statusCode || 0);
          }
        );
        req.on("error", reject);
      });
      assert.strictEqual(travStatus, 400);

      const svgResp = await fetch(`${baseHttp}/uploads/email-assets/icons/dark/location_pin.svg`);
      assert.strictEqual(svgResp.status, 404);

      const postResp = await fetch(`${baseHttp}/uploads/email-assets/icons/dark/location_pin.png`, { method: "POST" });
      assert.strictEqual(postResp.status, 405);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // 26. All 4 starter layout presets (EN & DE) validate with 0 issues, render < 90 KB, and contain zero third-party brands
  await test("26. All 4 starter layout presets (EN & DE) validate cleanly, stay under 90 KB HTML, and contain zero third-party trademarks", () => {
    const forbiddenTerms = ["marriott", "bonvoy", "hilton", "hyatt", "airbnb"];
    for (const preset of STARTER_LAYOUT_PRESETS) {
      for (const lang of ["en", "de"] as const) {
        const variant = buildStarterPresetVariant(preset.id, "booking_confirmation", lang, "https://tidehotels.de");
        assert.strictEqual(variant.schemaVersion, 2);
        const issues = validateTemplateVariant(variant);
        assert.strictEqual(issues.length, 0, `Preset ${preset.id} (${lang}) failed validation: ${JSON.stringify(issues)}`);

        const rendered = renderHotelEmailServerSide({
          variant,
          context: { ...BASE_CONTEXT, loyaltyTier: "Gold", loyaltyPointsBalance: 1850, loyaltyPointsEarned: 320 },
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          language: lang,
          usedDefaultLayout: false,
        });
        const size = measureEmailHtmlBytes(rendered.html);
        assert.ok(size.bytes < 90 * 1024, `Preset ${preset.id} (${lang}) HTML (${size.kb} KB) must stay under 90 KB`);
        assert.ok(!rendered.html.includes("undefined"));

        const lowerHtml = rendered.html.toLowerCase();
        for (const term of forbiddenTerms) {
          assert.ok(!lowerHtml.includes(term), `Preset ${preset.id} (${lang}) must not contain third-party brand '${term}'`);
        }
      }
    }
  });

  // 27. Animated & static GIF security, animation preservation, resize <= 640px, frame/duration/size caps, and local/Cloudinary storage
  await test("27. GIF pipeline: preserves animation, resizes >640px, strips comments, enforces frame/duration/size limits, and stores/deletes cleanly", async () => {
    // Helper to build a synthetic N-frame animated GIF via Sharp
    async function makeAnimatedGif(
      width: number,
      height: number,
      frames: number,
      delayMs: number
    ): Promise<Buffer> {
      const frameBytes = width * height * 4;
      const raw = Buffer.alloc(frameBytes * frames);
      for (let f = 0; f < frames; f++) {
        const r = (f * 67 + 20) % 255;
        const g = (f * 41 + 90) % 255;
        const b = (f * 29 + 140) % 255;
        const offset = f * frameBytes;
        for (let p = 0; p < width * height; p++) {
          const i = offset + p * 4;
          raw[i] = r;
          raw[i + 1] = g;
          raw[i + 2] = b;
          raw[i + 3] = 255;
        }
      }
      return sharp(raw, {
        raw: { width, height: height * frames, channels: 4, pageHeight: height },
      })
        .gif({ delay: Array(frames).fill(delayMs), loop: 0 })
        .toBuffer();
    }

    // 27a. Multi-frame animated GIF (3 frames, 900px wide -> resized <= 640px, stays animated)
    const wideAnimGif = await makeAnimatedGif(900, 120, 3, 250);
    assert.strictEqual(detectAllowedImageMagicBytes(wideAnimGif)?.mimeType, "image/gif");

    const procAnim = await validateAndProcessImageBuffer(wideAnimGif);
    assert.strictEqual(procAnim.ok, true, `Valid animated GIF failed: ${"error" in procAnim ? procAnim.error : ""}`);
    if (procAnim.ok) {
      assert.strictEqual(procAnim.result.mimeType, "image/gif");
      assert.ok(/^[0-9a-f]{32}\.gif$/.test(procAnim.result.randomFilename));
      assert.ok(procAnim.result.width <= 640, `Expected GIF width <= 640, got ${procAnim.result.width}`);
      assert.strictEqual(procAnim.result.isAnimated, true);
      assert.strictEqual(procAnim.result.frameCount, 3);
      assert.ok((procAnim.result.durationMs || 0) >= 600);

      const postMeta = await sharp(procAnim.result.buffer, { animated: true }).metadata();
      assert.strictEqual(postMeta.pages, 3, "Re-encoded GIF must preserve all 3 animation frames");
      assert.ok(!postMeta.exif && !postMeta.xmp, "Metadata must be stripped from GIF");
    }

    // 27b. Static 1-frame GIF accepted with isAnimated === false
    const staticGif = await makeAnimatedGif(120, 80, 1, 100);
    const procStatic = await validateAndProcessImageBuffer(staticGif);
    assert.strictEqual(procStatic.ok, true);
    if (procStatic.ok) {
      assert.strictEqual(procStatic.result.isAnimated, false);
      assert.strictEqual(procStatic.result.frameCount, 1);
    }

    // 27c. Reject > 100 frames with optimization tip
    const tooManyFramesGif = await makeAnimatedGif(16, 16, 105, 50);
    const resTooMany = await validateAndProcessImageBuffer(tooManyFramesGif);
    assert.strictEqual(resTooMany.ok, false);
    if (!resTooMany.ok) {
      assert.ok(resTooMany.error.includes("100-frame"), `Expected frame limit error, got: ${resTooMany.error}`);
    }

    // 27d. Reject > 15s total duration with optimization tip
    const tooLongGif = await makeAnimatedGif(16, 16, 20, 1000); // 20s
    const resTooLong = await validateAndProcessImageBuffer(tooLongGif);
    assert.strictEqual(resTooLong.ok, false);
    if (!resTooLong.ok) {
      assert.ok(resTooLong.error.includes("15s"), `Expected duration limit error, got: ${resTooLong.error}`);
    }

    // 27e. Reject > 2 MB raw GIF with optimization tip
    const fakeHugeGif = Buffer.concat([Buffer.from("GIF89a"), Buffer.alloc(2 * 1024 * 1024 + 128, 0x20)]);
    const resHuge = await validateAndProcessImageBuffer(fakeHugeGif);
    assert.strictEqual(resHuge.ok, false);
    if (!resHuge.ok) {
      assert.ok(resHuge.error.includes("2 MB"), `Expected 2 MB limit error, got: ${resHuge.error}`);
    }

    // 27f. Local storage serves uploaded .gif with Content-Type: image/gif + nosniff and deletes cleanly
    const tmpUploadDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pms-email-gif-test-"));
    const memoryStore = new Map<string, any>();
    try {
      const localProvider = resolveImageStorageProvider({
        env: { IMAGE_STORAGE_PROVIDER: "local", IMAGE_UPLOAD_DIR: tmpUploadDir, APP_URL: "https://tidehotels.de" },
      });
      const smallAnimGif = await makeAnimatedGif(200, 100, 3, 200);
      const up = await uploadHotelImage(
        "hotel_alpha",
        { base64Data: `data:image/gif;base64,${smallAnimGif.toString("base64")}`, label: "Welcome Wave" },
        "admin@harborview.example",
        undefined,
        {
          storageProvider: localProvider,
          listDocsFn: async () => Array.from(memoryStore.values()),
          setDocFn: async (_h, id, asset) => {
            memoryStore.set(id, asset);
            return { ok: true };
          },
        }
      );
      assert.strictEqual(up.ok, true, `GIF upload failed: ${up.error}`);
      assert.ok(up.image!.url.endsWith(".gif"));
      assert.strictEqual(up.image!.isAnimated, true);
      assert.strictEqual(up.image!.frameCount, 3);

      const testApp = express();
      testApp.use("/uploads/email-images", createLocalEmailImageMiddleware({ uploadDir: tmpUploadDir }));
      const server = http.createServer(testApp);
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      const urlPath = new URL(up.image!.url).pathname;

      try {
        const resp = await fetch(`http://127.0.0.1:${port}${urlPath}`);
        assert.strictEqual(resp.status, 200);
        assert.strictEqual(resp.headers.get("content-type"), "image/gif");
        assert.strictEqual(resp.headers.get("x-content-type-options"), "nosniff");
      } finally {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }

      const del = await deleteHotelImage("hotel_alpha", up.image!.id, undefined, {
        storageProvider: localProvider,
        readDocFn: async (_h, id) => memoryStore.get(id) || null,
        findRefsFn: async () => ({ publishedTemplates: [], draftTemplates: [] }),
        deleteDocFn: async (_h, id) => {
          memoryStore.delete(id);
          return { ok: true };
        },
      });
      assert.strictEqual(del.ok, true);
    } finally {
      await fs.promises.rm(tmpUploadDir, { recursive: true, force: true });
    }
  });

  // 28. HTML size meter thresholds & EMAIL_CUSTOMIZATION_ENABLED=false instant rollback to v1 defaults
  await test("28. HTML size meter thresholds (ok / warning > 80KB / over > 90KB) & feature flag rollback from v2 to v1 default", async () => {
    const okSize = measureEmailHtmlBytes("<html><body>Small email</body></html>");
    assert.strictEqual(okSize.status, "ok");

    const warnSize = measureEmailHtmlBytes("a".repeat(82 * 1024));
    assert.strictEqual(warnSize.status, "warning");

    const overSize = measureEmailHtmlBytes("a".repeat(92 * 1024));
    assert.strictEqual(overSize.status, "over");

    // Feature flag OFF -> instant rollback to v1 defaults even if a v2 preset would otherwise be active
    const prevFlag = process.env.EMAIL_CUSTOMIZATION_ENABLED;
    process.env.EMAIL_CUSTOMIZATION_ENABLED = "false";
    const sentPayloads: SendEmailParams[] = [];
    try {
      assert.strictEqual(isEmailCustomizationEnabled(), false);
      const res = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
        reservationId: "RES_ROLLBACK_V2",
        preloaded: {
          hotel: SAMPLE_HOTEL,
          reservation: {
            id: "RES_ROLLBACK_V2",
            hotelId: "hotel_alpha",
            guestName: "Alex Morgan",
            guestEmail: "alex@example.com",
            roomNumber: "204",
            checkIn: "2026-11-24",
            checkOut: "2026-11-27",
            status: "confirmed",
          },
          guest: null,
          room: null,
        },
        overrides: {
          appUrl: "https://tidehotels.de",
          resolveTemplateFn: async () => {
            throw new Error("Resolver must NOT be called when EMAIL_CUSTOMIZATION_ENABLED=false");
          },
          sendEmailFn: async (p) => {
            sentPayloads.push(p);
            return {
              success: true,
              messageId: "msg_rollback_v2",
              deliveryState: "accepted_by_provider",
              provider: "resend",
              statusCode: 200,
            };
          },
          persistMarkerFn: async () => true,
        },
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.sent, true);
      assert.strictEqual(res.usedDefaultLayout, true);
      assert.strictEqual(sentPayloads.length, 1);
      assert.ok(!sentPayloads[0].html.includes("v:roundrect"), "Rollback must render classic v1 default HTML");
      assert.ok(sentPayloads[0].html.includes("Harborview Suites"));
    } finally {
      if (prevFlag === undefined) delete process.env.EMAIL_CUSTOMIZATION_ENABLED;
      else process.env.EMAIL_CUSTOMIZATION_ENABLED = prevFlag;
    }
  });

  if (process.exitCode && process.exitCode !== 0) {
    console.error(`\nFAILED: ${passed} tests passed, failures occurred.`);
    process.exit(1);
  }
  console.log(`\nALL ${passed} EMAIL CUSTOMIZATION TESTS PASSED!`);
}

run();
