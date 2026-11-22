import assert from "assert";
import sharp from "sharp";
import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  EMAIL_ICON_NAMES,
  EMAIL_ICON_TONES,
  type CustomizableEmailEventType,
  type EmailRenderContext,
  type EmailTemplateDocument,
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
  buildDefaultFooterBlocks,
  buildStarterPresetVariant,
  replaceFooterBlocksInList,
} from "../modules/emailCustomization/shared/presets.ts";
import {
  isModernV2Variant,
  renderEmailTemplate,
} from "../modules/emailCustomization/shared/renderer.ts";
import {
  applyDefaultFooterToTemplateDoc,
  applyDefaultLinksToTemplateDoc,
} from "../modules/emailCustomization/server/resolver.ts";
import {
  buildTemplateVariablesMap,
  extractTemplateLinksOverview,
  formatEmailCurrency,
  formatEmailDate,
  formatEmailTime,
  measureEmailHtmlBytes,
  validateAbsoluteLinkUrl,
  validateEmailUrl,
  validateHotelEmailSettings,
  validateLinkLabelAgainstUrl,
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
      assert.ok(!modular.html.includes("https://tidehotels.de"), `Guest email must NOT auto-expose PMS URL for ${pair.customEvent}`);
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

  // 11. Custom hotel portal URL renders when explicitly configured, and PMS APP_URL is NEVER auto-injected into guest emails
  await test("11. Custom hotel portal URL renders cleanly, and PMS APP_URL is not auto-leaked to guests", () => {
    const variant = buildDefaultTemplateVariant("booking_confirmation", "en");
    variant.blocks.push({
      id: "explicit_cta",
      type: "button",
      label: "Visit Hotel Website",
      url: "{{portal_link}}",
      align: "left",
      displayStyle: "solid",
    });

    const fallbackRender = renderHotelEmailServerSide({
      variant,
      context: { ...BASE_CONTEXT, appUrl: "https://tidehotels.de///" },
      settings: { ...DEFAULT_HOTEL_EMAIL_SETTINGS, portalUrl: "" },
    });
    assert.ok(!fallbackRender.html.includes("tidehotels.de"), "PMS URL must not auto-inject into guest emails");

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
        hotelWebsite: "https://harborview.example",
        loyaltyTier: "Gold",
        loyaltyPointsBalance: 2400,
        loyaltyPointsEarned: 450,
      },
      settings: {
        ...DEFAULT_HOTEL_EMAIL_SETTINGS,
        portalUrl: "https://harborview.example/bookings",
      },
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

  // 26. All 4 starter layout presets (EN & DE) validate with 0 issues, use schemaVersion 3 standalone footers, render < 90 KB, and contain zero third-party brands
  await test("26. All 4 starter layout presets (EN & DE) validate cleanly (v3 editable footers), stay under 90 KB HTML, and contain zero third-party trademarks", () => {
    const forbiddenTerms = ["marriott", "bonvoy", "hilton", "hyatt", "airbnb"];
    for (const preset of STARTER_LAYOUT_PRESETS) {
      for (const lang of ["en", "de"] as const) {
        const variant = buildStarterPresetVariant(preset.id, "booking_confirmation", lang, "https://tidehotels.de");
        assert.strictEqual(variant.schemaVersion, 3, `Preset ${preset.id} (${lang}) should use schemaVersion 3`);
        assert.ok(variant.blocks.some((b) => b.type === "footer_contact"), `Preset ${preset.id} missing footer_contact`);
        assert.ok(variant.blocks.some((b) => b.type === "footer_authenticity"), `Preset ${preset.id} missing footer_authenticity`);
        assert.ok(variant.blocks.some((b) => b.type === "footer_copyright"), `Preset ${preset.id} missing footer_copyright`);
        assert.ok(!variant.blocks.some((b) => b.type === "footer_powered_by"), `Preset ${preset.id} must NOT include footer_powered_by by default`);

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

  // 29. Untouched v1 default template remains byte-for-byte identical (including footer)
  await test("29. Untouched default template stays byte-for-byte identical (including classic footer and zero v2/v3 leak)", async () => {
    const v1Default = buildDefaultTemplateForHotel("booking_confirmation", SAMPLE_HOTEL, "en");
    assert.strictEqual(v1Default.schemaVersion, undefined, "Untouched default template must stay v1");
    assert.ok(v1Default.blocks.some((b) => b.type === "footer"), "Untouched default keeps classic footer block");
    assert.ok(!v1Default.blocks.some((b) => b.type === "footer_contact"), "Untouched default must not silently convert to v3 blocks");

    const renderedDefault = renderHotelEmailServerSide({
      variant: v1Default,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: true,
    });

    // Dispatch via sendHotelEmail with untouched default resolver and verify exact byte-for-byte match
    const dispatched: SendEmailParams[] = [];
    const dispatchRes = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES8A4F2",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES8A4F2",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex.morgan@example.com",
          roomNumber: "204",
          roomType: "Deluxe King Suite",
          checkIn: "2026-11-24",
          checkInTime: "14:00",
          checkOut: "2026-11-27",
          checkOutTime: "12:00",
          totalAmount: 270000,
          depositAmount: 90000,
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
          variant: v1Default,
          settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
          usedDefaultLayout: true,
          publishedVersion: 0,
        }),
        sendEmailFn: async (p) => {
          dispatched.push(p);
          return {
            success: true,
            messageId: "msg_v1_byte_parity",
            deliveryState: "accepted_by_provider",
            provider: "resend",
            statusCode: 200,
          };
        },
        persistMarkerFn: async () => true,
      },
    });

    assert.strictEqual(dispatchRes.ok, true);
    assert.strictEqual(dispatchRes.usedDefaultLayout, true);
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].html, renderedDefault.html, "Dispatched untouched default HTML must be byte-for-byte identical");
    assert.strictEqual(dispatched[0].text, renderedDefault.text, "Dispatched untouched default plain text must be byte-for-byte identical");
    assert.ok(renderedDefault.html.includes("Harborview Suites Contact"), "Classic v1 footer contact heading preserved");
    assert.ok(renderedDefault.html.includes("Address: 100 Marina Blvd, Coastal City"), "Classic v1 footer address preserved");
    assert.ok(!renderedDefault.html.includes("ec-stack"), "Untouched v1 default must contain zero v2/v3 CSS classes");
  });

  // 30. Edited Contact Us, Confirmation Authenticity, and Copyright blocks render with custom wording & styling in HTML and plain text
  await test("30. Edited Contact Us, Confirmation Authenticity, and Copyright blocks appear in rendered HTML and plain text with custom styling", () => {
    const preset = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");
    preset.blocks = preset.blocks.map((b) => {
      if (b.type === "footer_contact") {
        return {
          ...b,
          heading: "Concierge Desk 24/7",
          text: "Speak directly with {{hotel_name}} Concierge at {{hotel_phone}} or {{hotel_email}}.",
          style: {
            align: "center",
            fontFamily: "georgia",
            fontSizePx: 14,
            accentColor: "#0f766e",
            textColor: "#334155",
            paddingY: 16,
          },
        };
      }
      if (b.type === "footer_authenticity") {
        return {
          ...b,
          heading: "Official Booking Verification",
          text: "Verified record {{booking_reference}} issued exclusively by {{hotel_name}}.",
          style: { align: "right", fontSizePx: 12 },
        };
      }
      if (b.type === "footer_copyright") {
        return {
          ...b,
          text: "© 2026 {{hotel_name}} Hospitality Group · {{hotel_address}}",
          style: { align: "center", fontFamily: "verdana", fontSizePx: 11, textColor: "#475569" },
        };
      }
      return b;
    });

    const issues = validateTemplateVariant(preset);
    assert.strictEqual(issues.length, 0, `Edited v3 footer must validate cleanly: ${JSON.stringify(issues)}`);

    const rendered = renderHotelEmailServerSide({
      variant: preset,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(rendered.html.includes("Concierge Desk 24/7"));
    assert.ok(rendered.html.includes("Speak directly with Harborview Suites Concierge at +49 30 555 0199"));
    assert.ok(rendered.html.includes("Official Booking Verification"));
    assert.ok(rendered.html.includes("Verified record RES8A4F2 issued exclusively by Harborview Suites."));
    assert.ok(rendered.html.includes("© 2026 Harborview Suites Hospitality Group · 100 Marina Blvd, Coastal City"));
    assert.ok(rendered.html.includes("Georgia"), "Custom block fontFamily must render in HTML");
    assert.ok(rendered.html.includes("font-size:14px"), "Custom block fontSizePx must render in HTML");
    assert.ok(rendered.html.includes("color:#0f766e"), "Custom heading accentColor must render in HTML");

    assert.ok(rendered.text.includes("Concierge Desk 24/7"));
    assert.ok(rendered.text.includes("Official Booking Verification"));
    assert.ok(rendered.text.includes("© 2026 Harborview Suites Hospitality Group · 100 Marina Blvd, Coastal City"));
  });

  // 31. Deleted or hidden footer blocks never appear in rendered HTML or plain text
  await test("31. Deleting or hiding (hidden: true) a footer block completely removes it from HTML and plain text", () => {
    const preset = buildStarterPresetVariant("minimal", "booking_confirmation", "en", "https://tidehotels.de");
    // Delete footer_authenticity AND hide footer_contact
    preset.blocks = preset.blocks
      .filter((b) => b.type !== "footer_authenticity")
      .map((b) => (b.type === "footer_contact" ? { ...b, hidden: true } : b));

    const issues = validateTemplateVariant(preset);
    assert.strictEqual(issues.length, 0);

    const rendered = renderHotelEmailServerSide({
      variant: preset,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("Confirmation Authenticity"), "Deleted footer_authenticity must not appear in HTML");
    assert.ok(!rendered.text.includes("Confirmation Authenticity"), "Deleted footer_authenticity must not appear in text");
    assert.ok(!rendered.html.includes("For questions regarding your reservation"), "Hidden footer_contact must not appear in HTML");
    assert.ok(!rendered.text.includes("For questions regarding your reservation"), "Hidden footer_contact must not appear in text");
    // Remaining copyright block still renders
    assert.ok(rendered.html.includes("© Harborview Suites · 100 Marina Blvd, Coastal City"));
    assert.ok(rendered.text.includes("© Harborview Suites · 100 Marina Blvd, Coastal City"));
  });

  // 32. Added extra Legal / Impressum blocks render cleanly & resolve {{legal_imprint}} + track footer logo image refs
  await test("32. Added Legal / Impressum & Cancellation Policy blocks render cleanly, resolve {{legal_imprint}}, and track footerLogoImageId", () => {
    const preset = buildStarterPresetVariant("business_hotel", "booking_confirmation", "en", "https://tidehotels.de");
    preset.blocks.push(
      {
        id: "legal_impressum",
        type: "footer_legal",
        heading: "Impressum / Legal Notice",
        text: "{{legal_imprint}}",
      },
      {
        id: "legal_cancel",
        type: "footer_legal",
        heading: "Cancellation Policy",
        text: "Free cancellation up to 48 hours before {{check_in_date}} at {{hotel_name}}.",
      }
    );
    preset.blocks = preset.blocks.map((b) =>
      b.type === "footer_copyright"
        ? {
            ...b,
            footerLogoImageId: "img_footer_mark",
            footerLogoUrl: "https://cdn.example/footer-mark.png",
          }
        : b
    );

    const settingsWithImprint: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      legalImprint: "Harborview Suites GmbH · HRB 99120 Berlin · VAT DE123456789",
    };

    const issues = validateTemplateVariant(preset);
    assert.strictEqual(issues.length, 0);

    const rendered = renderHotelEmailServerSide({
      variant: preset,
      context: BASE_CONTEXT,
      settings: settingsWithImprint,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(rendered.html.includes("Impressum / Legal Notice"));
    assert.ok(rendered.html.includes("Harborview Suites GmbH · HRB 99120 Berlin · VAT DE123456789"));
    assert.ok(rendered.html.includes("Cancellation Policy"));
    assert.ok(rendered.html.includes("Free cancellation up to 48 hours before 2026-11-24 at Harborview Suites."));
    assert.ok(rendered.text.includes("Harborview Suites GmbH · HRB 99120 Berlin · VAT DE123456789"));
    assert.ok(rendered.text.includes("Cancellation Policy"));

    const refs = extractReferencedImages(preset);
    assert.ok(refs.imageIds.has("img_footer_mark"), "extractReferencedImages must track footer_copyright.footerLogoImageId");
    assert.ok(refs.urls.has("https://cdn.example/footer-mark.png"));
  });

  // 33. Email Settings (legalImprint, hotelFooterNotes) do NOT silently inject into schemaVersion 3 emails
  await test("33. Settings legalImprint and hotelFooterNotes are NEVER silently injected into v3 templates unless referenced by a block", () => {
    const preset = buildStarterPresetVariant("minimal", "booking_confirmation", "en", "https://tidehotels.de");
    // Remove all footer blocks so the email has zero footer references
    preset.blocks = preset.blocks.filter(
      (b) => b.type !== "footer_contact" && b.type !== "footer_authenticity" && b.type !== "footer_copyright"
    );

    const rendered = renderHotelEmailServerSide({
      variant: preset,
      context: {
        ...BASE_CONTEXT,
        hotelFooterNotes: "SECRET_SILENT_HOTEL_NOTE_999",
      },
      settings: {
        ...DEFAULT_HOTEL_EMAIL_SETTINGS,
        legalImprint: "SECRET_SILENT_IMPRINT_888",
      },
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("SECRET_SILENT_IMPRINT_888"), "settings.legalImprint must NOT be silently appended in v3");
    assert.ok(!rendered.text.includes("SECRET_SILENT_IMPRINT_888"), "settings.legalImprint must NOT appear in v3 plain text");
    assert.ok(!rendered.html.includes("SECRET_SILENT_HOTEL_NOTE_999"), "hotelFooterNotes must NOT be silently appended in v3");
    assert.ok(!rendered.html.includes("Contact Us"), "Removed Contact Us must not reappear from renderer");
    assert.ok(!rendered.html.includes("Confirmation Authenticity"), "Removed Authenticity must not reappear from renderer");
  });

  // 34. Unknown variables and template logic in footer blocks & defaultFooterBlocks are rejected on save
  await test("34. Unknown variables and template logic in footer blocks and settings.defaultFooterBlocks are rejected", () => {
    const preset = buildStarterPresetVariant("minimal", "booking_confirmation", "en", "https://tidehotels.de");
    preset.blocks.push(
      {
        id: "bad_var_footer",
        type: "footer_contact",
        heading: "Reach Us",
        text: "Secret token: {{admin_api_secret}}",
      },
      {
        id: "bad_logic_footer",
        type: "footer_legal",
        heading: "Terms",
        text: "{{#if guest_name}}Hidden branch{{/if}}",
      }
    );

    const issues = validateTemplateVariant(preset);
    assert.ok(issues.some((i) => i.message.includes("admin_api_secret") || i.message.includes("unsupported variable")));
    assert.ok(issues.some((i) => i.message.includes("logic") || i.message.includes("helpers")));

    // Same strict rules enforced on settings.defaultFooterBlocks
    const badSettings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      defaultFooterBlocks: {
        en: [
          {
            id: "def_bad",
            type: "footer_copyright",
            text: "© {{unknown_company_var}}",
          },
        ],
      },
    };
    const settingsIssues = validateHotelEmailSettings(badSettings);
    assert.ok(settingsIssues.some((i) => i.path.startsWith("defaultFooterBlocks.en")));
  });

  // 35. Dangerous HTML and javascript: links in footer blocks are rejected on save and stripped/escaped on render
  await test("35. Dangerous HTML (<script>, onerror) and javascript: links in footer blocks are rejected and neutralized", () => {
    const preset = buildStarterPresetVariant("minimal", "booking_confirmation", "en", "https://tidehotels.de");
    preset.blocks.push(
      {
        id: "xss_legal",
        type: "footer_legal",
        heading: '<img src=x onerror="alert(1)">Notice',
        text: '<script>evil()</script>Safe legal copy.',
      },
      {
        id: "bad_powered",
        type: "footer_powered_by",
        text: "Powered by Evil",
        linkLabel: "Click",
        linkUrl: "javascript:alert(document.cookie)",
      },
      {
        id: "bad_logo_copy",
        type: "footer_copyright",
        text: "© {{hotel_name}}",
        footerLogoUrl: "http://insecure.example/logo.png",
      }
    );

    const issues = validateTemplateVariant(preset);
    assert.ok(issues.some((i) => i.path.includes(".linkUrl")), "javascript: linkUrl on footer_powered_by must be rejected");
    assert.ok(issues.some((i) => i.path.includes(".footerLogoUrl")), "Non-HTTPS footerLogoUrl must be rejected");

    const rendered = renderHotelEmailServerSide({
      variant: preset,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!rendered.html.includes("<script>"), "Script tag must be escaped in footer HTML");
    assert.ok(!rendered.html.includes('onerror="alert(1)"'), "Raw HTML event handler must be escaped");
    assert.ok(!rendered.html.includes("javascript:"), "javascript: link must be stripped from footer_powered_by");
    assert.ok(rendered.html.includes("Safe legal copy."));
  });

  // 36. EN and DE footers render independently per language
  await test("36. EN and DE standalone footers render independently per language", () => {
    const enVariant = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");
    const deVariant = buildStarterPresetVariant("modern_resort", "booking_confirmation", "de", "https://tidehotels.de");

    enVariant.blocks = enVariant.blocks.map((b) =>
      b.type === "footer_contact" ? { ...b, heading: "English Front Desk" } : b
    );
    deVariant.blocks = deVariant.blocks.map((b) =>
      b.type === "footer_contact" ? { ...b, heading: "Deutsche Rezeption" } : b
    );

    const enRendered = renderHotelEmailServerSide({
      variant: enVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    const deRendered = renderHotelEmailServerSide({
      variant: deVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "de",
      usedDefaultLayout: false,
    });

    assert.ok(enRendered.html.includes("English Front Desk") && !enRendered.html.includes("Deutsche Rezeption"));
    assert.ok(deRendered.html.includes("Deutsche Rezeption") && !deRendered.html.includes("English Front Desk"));
    assert.ok(deRendered.html.includes("Echtheit dieser Bestätigung"), "DE default authenticity heading must be German");
    assert.ok(enRendered.html.includes("Confirmation Authenticity"), "EN default authenticity heading must be English");
  });

  // 37. Reusable default footer applies to drafts ONLY across events (published untouched) & footer_powered_by is OFF by default
  await test("37. applyDefaultFooterToTemplateDoc updates drafts ONLY (published untouched) and footer_powered_by is OFF by default", () => {
    const stdEn = buildDefaultFooterBlocks("en");
    const stdDe = buildDefaultFooterBlocks("de");
    assert.strictEqual(stdEn.length, 3);
    assert.strictEqual(stdDe.length, 3);
    assert.ok(!stdEn.some((b) => b.type === "footer_powered_by"), "footer_powered_by must be OFF by default in EN");
    assert.ok(!stdDe.some((b) => b.type === "footer_powered_by"), "footer_powered_by must be OFF by default in DE");

    const publishedEn = buildDefaultTemplateForHotel("booking_confirmation", SAMPLE_HOTEL, "en");
    const publishedDe = buildDefaultTemplateForHotel("booking_confirmation", SAMPLE_HOTEL, "de");
    const originalPublishedJson = JSON.stringify({ en: publishedEn, de: publishedDe });

    const doc: EmailTemplateDocument = {
      eventType: "booking_confirmation",
      enabled: true,
      isCustomized: true,
      defaultLanguage: "en",
      publishedVersion: 4,
      published: { en: JSON.parse(JSON.stringify(publishedEn)), de: JSON.parse(JSON.stringify(publishedDe)) },
      draft: { en: JSON.parse(JSON.stringify(publishedEn)), de: JSON.parse(JSON.stringify(publishedDe)) },
      versions: [],
      updatedAt: "2026-11-01T00:00:00.000Z",
      updatedBy: "admin@harborview.example",
    };

    const customDefaultFooters = {
      en: [
        { id: "c1", type: "footer_contact" as const, heading: "Hotel Support", text: "Call {{hotel_phone}}." },
        { id: "c2", type: "footer_copyright" as const, text: "© {{hotel_name}} Custom" },
      ],
      de: [
        { id: "d1", type: "footer_contact" as const, heading: "Hotel-Support", text: "Rufen Sie {{hotel_phone}} an." },
      ],
    };

    const nextDoc = applyDefaultFooterToTemplateDoc(
      doc,
      customDefaultFooters,
      "admin@harborview.example",
      "2026-11-20T12:00:00.000Z"
    );

    // Published snapshot, version, and isCustomized are 100% untouched
    assert.strictEqual(JSON.stringify(nextDoc.published), originalPublishedJson, "Published templates MUST NOT change");
    assert.strictEqual(nextDoc.publishedVersion, 4);
    assert.strictEqual(nextDoc.isCustomized, true);

    // Drafts updated to v3 with the new footer blocks while body blocks remain intact
    assert.strictEqual(nextDoc.draft.en?.schemaVersion, 3);
    assert.ok(nextDoc.draft.en?.blocks.some((b) => b.type === "footer_contact" && b.heading === "Hotel Support"));
    assert.ok(nextDoc.draft.en?.blocks.some((b) => b.type === "heading"), "Body blocks must be preserved");
    assert.ok(!nextDoc.draft.en?.blocks.some((b) => b.type === "footer"), "Old combined footer block replaced");

    assert.strictEqual(nextDoc.draft.de?.schemaVersion, 3);
    assert.ok(nextDoc.draft.de?.blocks.some((b) => b.type === "footer_contact" && b.heading === "Hotel-Support"));

    // replaceFooterBlocksInList preserves footer_nav by default
    const withNav = replaceFooterBlocksInList(
      [
        { id: "h1", type: "heading", level: 2, text: "Hello" },
        { id: "n1", type: "footer_nav", links: [{ id: "l1", label: "Web", url: "{{hotel_website}}" }] },
        { id: "f1", type: "footer_copyright", text: "Old" },
      ],
      [{ id: "f2", type: "footer_copyright", text: "New" }],
      { replaceNav: false }
    );
    assert.ok(withNav.some((b) => b.type === "heading"));
    assert.ok(withNav.some((b) => b.type === "footer_nav"));
    assert.ok(withNav.some((b) => b.type === "footer_copyright" && b.text === "New"));
  });

  // 38. Feature flag EMAIL_CUSTOMIZATION_ENABLED=false forces default templates even when v3 footers exist
  await test("38. EMAIL_CUSTOMIZATION_ENABLED=false forces exact untouched default templates (including default footer)", async () => {
    const prevFlag = process.env.EMAIL_CUSTOMIZATION_ENABLED;
    process.env.EMAIL_CUSTOMIZATION_ENABLED = "false";
    const sent: SendEmailParams[] = [];
    try {
      const res = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
        reservationId: "RES_FLAG_OFF_V3",
        preloaded: {
          hotel: SAMPLE_HOTEL,
          reservation: {
            id: "RES_FLAG_OFF_V3",
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
            throw new Error("Resolver must NOT run when feature flag is false");
          },
          sendEmailFn: async (p) => {
            sent.push(p);
            return {
              success: true,
              messageId: "msg_flag_off_v3",
              deliveryState: "accepted_by_provider",
              provider: "resend",
              statusCode: 200,
            };
          },
          persistMarkerFn: async () => true,
        },
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.usedDefaultLayout, true);
      assert.strictEqual(sent.length, 1);
      assert.ok(sent[0].html.includes("Harborview Suites"));
      assert.ok(!sent[0].html.includes("em-stack"), "Flag OFF must output classic v1 default");
    } finally {
      if (prevFlag === undefined) delete process.env.EMAIL_CUSTOMIZATION_ENABLED;
      else process.env.EMAIL_CUSTOMIZATION_ENABLED = prevFlag;
    }
  });

  // 39. Untouched default emails remain byte-for-byte identical (including every default link & plain text)
  await test("39. Untouched v1 default templates remain byte-for-byte identical including all default links", () => {
    for (const eventType of CUSTOMIZABLE_EMAIL_EVENTS) {
      const enDefault = buildDefaultTemplateForHotel(eventType, SAMPLE_HOTEL, "en");
      const deDefault = buildDefaultTemplateForHotel(eventType, SAMPLE_HOTEL, "de");
      const r1 = renderHotelEmailServerSide({
        variant: enDefault,
        context: BASE_CONTEXT,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: "en",
        usedDefaultLayout: true,
      });
      const r2 = renderEmailTemplate({
        variant: enDefault,
        context: BASE_CONTEXT,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: "en",
        usedDefaultLayout: true,
      });
      assert.strictEqual(r1.html, r2.html, `${eventType} EN server & shared renderer must match byte-for-byte`);
      assert.strictEqual(r1.text, r2.text, `${eventType} EN plain text must match byte-for-byte`);
      assert.strictEqual(enDefault.schemaVersion, undefined, `${eventType} untouched default remains v1`);
      assert.ok(!r1.html.includes("[[link:"), `${eventType} untouched default must not leak inline link tokens`);
      assert.ok(r1.html.includes('href="mailto:reservations@harborview.example"'), `${eventType} default mailto preserved`);
      assert.ok(r1.html.includes("+49 30 555 0199"), `${eventType} v1 default phone parity preserved`);
      assert.ok(!r1.html.includes('href="mailto:reservations@harborview.example" target="_blank"'), "mailto must never open in new tab");

      const rDe = renderHotelEmailServerSide({
        variant: deDefault,
        context: BASE_CONTEXT,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: "de",
        usedDefaultLayout: true,
      });
      assert.ok(!rDe.html.includes("undefined"), `${eventType} DE untouched default has no undefined`);
    }
  });

  // 40. Editing every link type updates rendered HTML & plain text ("text (URL)") in EN and DE; mailto:/tel: never get target="_blank"
  await test("40. Editing every link type (button, inline paragraph, image, header logo, footer nav, mailto/tel contact, social) renders cleanly in EN & DE", () => {
    const settings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      defaultLinks: {
        website: {
          defaultUrl: "https://harborview.example",
          byLanguage: { en: "https://harborview.example/en", de: "https://harborview.example/de" },
        },
        review: { defaultUrl: "https://harborview.example/review" },
        directions: { defaultUrl: "https://maps.example/harborview" },
        socialInstagram: { defaultUrl: "https://instagram.com/harborview" },
      },
    };

    const variant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Your Stay at {{hotel_name}}",
      preheader: "Every link edited cleanly",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: true,
        logoUrl: "https://cdn.example/hotel-logo.png",
        logoAlt: "Harborview Suites Logo",
        logoLinkUrl: "{{hotel_website}}",
        logoLinkOpenInNewTab: true,
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        {
          id: "bh1",
          type: "brand_header",
          logoUrl: "https://cdn.example/hotel-logo.png",
          logoAlt: "Harborview Suites",
          logoLinkUrl: "{{hotel_website}}",
          logoLinkOpenInNewTab: true,
          showHotelName: true,
          showAddress: true,
          showPhone: true,
          phoneLinkEnabled: true,
          phoneOverride: "+49 30 999 0001",
          showEmail: true,
          emailLinkEnabled: true,
          emailOverride: "vip@harborview.example",
        },
        {
          id: "p1",
          type: "paragraph",
          text: "Review our [[link:l_guide]] or [[link:l_email]] or [[link:l_dir]] before arrival.",
          inlineLinks: [
            {
              id: "l_guide",
              label: "Arrival Guide",
              url: "https://harborview.example/guide",
              openInNewTab: true,
              underline: true,
              color: "#0f766e",
            },
            {
              id: "l_email",
              label: "email concierge",
              url: "mailto:concierge@harborview.example",
              underline: false,
            },
            {
              id: "l_dir",
              label: "get directions",
              url: "{{directions_link}}",
              openInNewTab: true,
            },
          ],
        },
        {
          id: "img1",
          type: "image",
          src: "https://cdn.example/pool.png",
          alt: "Pool deck",
          widthPx: 544,
          linkUrl: "https://harborview.example/pool",
          linkOpenInNewTab: true,
        },
        {
          id: "btn1",
          type: "button",
          label: "Leave Feedback",
          url: "{{review_link}}",
          displayStyle: "solid",
          openInNewTab: true,
          bgColor: "#0f766e",
          textColor: "#ffffff",
          borderColor: "#134e4a",
          borderRadiusPx: 10,
        },
        {
          id: "soc1",
          type: "social_links",
          links: [
            { id: "s_ig", label: "Instagram", url: "{{social_instagram}}", openInNewTab: true },
            { id: "s_web", label: "Hotel Site", url: "{{hotel_website}}", openInNewTab: false },
          ],
        },
        {
          id: "fnav1",
          type: "footer_nav",
          links: [
            { id: "fn1", label: "Terms", url: "https://harborview.example/terms", underline: true, color: "#0f766e" },
            { id: "fn2", label: "Call Desk", url: "tel:+49 30 555 0199" },
            { id: "fn3", label: "Email Desk", url: "mailto:desk@harborview.example" },
          ],
        },
        {
          id: "fc1",
          type: "footer_contact",
          heading: "Concierge",
          text: "Reach us via [[link:fc_call]] or [[link:fc_mail]].",
          inlineLinks: [
            { id: "fc_call", label: "+49 30 555 0199", url: "tel:{{hotel_phone}}" },
            { id: "fc_mail", label: "{{hotel_email}}", url: "mailto:{{hotel_email}}" },
          ],
        },
      ],
    };

    const issues = validateTemplateVariant(variant);
    assert.strictEqual(issues.length, 0, `Valid v4 link template must pass validation: ${JSON.stringify(issues)}`);

    const enRendered = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings,
      language: "en",
      usedDefaultLayout: false,
    });
    const deRendered = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings,
      language: "de",
      usedDefaultLayout: false,
    });

    // HTML assertions (EN)
    assert.ok(enRendered.html.includes('href="https://harborview.example/en"'), "Header logo & site link resolved EN URL");
    assert.ok(enRendered.html.includes('href="https://maps.example/harborview"'), "Address link resolved directions_link");
    assert.ok(enRendered.html.includes('href="tel:+49309990001"'), "Phone override normalized cleanly");
    assert.ok(enRendered.html.includes('href="mailto:vip@harborview.example"'), "Email override rendered");
    assert.ok(enRendered.html.includes('href="https://harborview.example/guide" target="_blank" rel="noopener noreferrer"'));
    assert.ok(enRendered.html.includes('href="mailto:concierge@harborview.example"'));
    assert.ok(!enRendered.html.includes('href="mailto:concierge@harborview.example" target="_blank"'), "mailto inline link must NOT have target=_blank");
    assert.ok(!enRendered.html.includes('href="tel:+49305550199" target="_blank"'), "tel footer link must NOT have target=_blank");
    assert.ok(enRendered.html.includes('href="https://harborview.example/pool"'), "Image link rendered");
    assert.ok(enRendered.html.includes('href="https://harborview.example/review"'), "Button review link rendered");
    assert.ok(enRendered.html.includes('href="https://instagram.com/harborview"'), "Social Instagram link rendered");
    assert.ok(enRendered.html.includes('href="https://harborview.example/terms"'), "Footer nav Terms link rendered");

    // Plain-text assertions ("label (URL)")
    assert.ok(enRendered.text.includes("Arrival Guide (https://harborview.example/guide)"), "Plain text renders inline link as label (URL)");
    assert.ok(enRendered.text.includes("email concierge (mailto:concierge@harborview.example)"), "Plain text renders mailto inline link");
    assert.ok(enRendered.text.includes("Leave Feedback (https://harborview.example/review)"), "Plain text renders button link");
    assert.ok(enRendered.text.includes("Terms (https://harborview.example/terms)"), "Plain text renders footer nav link");

    // DE language override resolves DE URL
    assert.ok(deRendered.html.includes('href="https://harborview.example/de"'), "DE render resolved DE language URL override");
    assert.ok(!deRendered.html.includes('href="https://harborview.example/en"'), "DE render did not leak EN override");

    // Links overview extracts all links cleanly
    const overview = extractTemplateLinksOverview(variant, BASE_CONTEXT, settings, "en");
    assert.ok(overview.length >= 10, `Expected >= 10 links in overview, got ${overview.length}`);
    assert.ok(overview.every((item) => item.status !== "invalid"), "All valid links must not be marked invalid");
  });

  // 41. Hiding or deleting links removes them from both HTML and plain text; renderer injects zero links outside blocks
  await test("41. Hiding (hidden/buttonHidden/linkHidden) or deleting links completely removes them from HTML and plain text", () => {
    const variant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Minimal Notice",
      preheader: "",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: true,
        logoUrl: "https://cdn.example/logo.png",
        logoLinkUrl: "",
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        {
          id: "p_hide",
          type: "paragraph",
          text: "Visible copy [[link:h1]] end.",
          inlineLinks: [
            { id: "h1", label: "SECRET_HIDDEN_LINK", url: "https://harborview.example/hidden", hidden: true },
          ],
        },
        {
          id: "hero_hide",
          type: "hero_text",
          headline: "Hello {{guest_name}}",
          body: "No CTA shown.",
          buttonLabel: "HIDDEN_CTA_BUTTON",
          buttonUrl: "https://harborview.example/cta",
          buttonHidden: true,
        },
        {
          id: "img_hide",
          type: "image",
          src: "https://cdn.example/pic.png",
          alt: "Lobby",
          widthPx: 544,
          linkUrl: "https://harborview.example/img-hidden",
          linkHidden: true,
        },
        {
          id: "fnav_hide",
          type: "footer_nav",
          links: [
            { id: "fn_vis", label: "Visible Link", url: "https://harborview.example/visible" },
            { id: "fn_hid", label: "Hidden Footer Link", url: "https://harborview.example/hidden-nav", hidden: true },
          ],
        },
        {
          id: "soc_hide",
          type: "social_links",
          links: [
            { id: "s_hid", label: "Hidden Insta", url: "https://instagram.com/hidden", hidden: true },
          ],
        },
        {
          id: "bh_plain",
          type: "brand_header",
          showHotelName: true,
          showAddress: true,
          showPhone: true,
          phoneLinkEnabled: false,
          showEmail: true,
          emailLinkEnabled: false,
        },
      ],
    };

    const rendered = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("SECRET_HIDDEN_LINK") && !rendered.text.includes("SECRET_HIDDEN_LINK"));
    assert.ok(!rendered.html.includes("https://harborview.example/hidden"));
    assert.ok(!rendered.html.includes("HIDDEN_CTA_BUTTON") && !rendered.text.includes("HIDDEN_CTA_BUTTON"));
    assert.ok(!rendered.html.includes("https://harborview.example/img-hidden"));
    assert.ok(!rendered.html.includes("Hidden Footer Link") && !rendered.text.includes("Hidden Footer Link"));
    assert.ok(!rendered.html.includes("Hidden Insta"));
    assert.ok(rendered.html.includes('href="https://harborview.example/visible"'));
    // phoneAsLink: false & emailAsLink: false -> rendered as plain text, not mailto:/tel: anchors
    assert.ok(!rendered.html.includes("tel:") && !rendered.html.includes("mailto:"), "Contact info renders as plain text when *AsLink is false");
    assert.ok(rendered.html.includes("+49 30 555 0199") && rendered.html.includes("reservations@harborview.example"));
  });

  // 42. Link variables resolve from settings.defaultLinks with EN/DE fallback, portalUrlOverride priority, and clean empty-variable hiding
  await test("42. Link variables resolve with EN/DE fallback, portalUrlOverride priority, and empty variables hide cleanly without broken anchors", () => {
    const settings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      defaultLanguage: "en",
      portalUrl: "https://portal-global.example",
      defaultLinks: {
        portal: {
          defaultUrl: "https://portal-primary.example",
          byLanguage: { de: "https://portal-de.example" },
        },
        review: {
          defaultUrl: "https://reviews.example/primary",
          byLanguage: { en: "https://reviews.example/en" },
        },
        wifiGuide: { defaultUrl: "https://wifi.example/guide" },
        // directions deliberately left unset to test clean hiding
      },
    };

    const varsEn = buildTemplateVariablesMap(BASE_CONTEXT, settings, undefined, "en").variables;
    const varsDe = buildTemplateVariablesMap(BASE_CONTEXT, settings, undefined, "de").variables;
    assert.strictEqual(varsEn.review_link, "https://reviews.example/en");
    assert.strictEqual(varsDe.review_link, "https://reviews.example/primary", "DE without override falls back to primary URL");
    assert.strictEqual(varsEn.portal_link, "https://portal-primary.example");
    assert.strictEqual(varsDe.portal_link, "https://portal-de.example");
    assert.strictEqual(varsEn.wifi_guide_link, "https://wifi.example/guide");
    assert.strictEqual(varsEn.directions_link, "");

    // Per-email portalUrlOverride wins over hotel default portal link
    const varsOverride = buildTemplateVariablesMap(BASE_CONTEXT, settings, "https://override-stay.example/abc", "de").variables;
    assert.strictEqual(varsOverride.portal_link, "https://override-stay.example/abc");

    // Empty variable in a template hides the link cleanly (no empty <a href=""> or "undefined")
    const variant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Test Empty Link Vars",
      preheader: "",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: false,
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        { id: "b_empty", type: "button", label: "Get Directions", url: "{{directions_link}}", displayStyle: "solid" },
        {
          id: "p_empty",
          type: "paragraph",
          text: "Open [[link:i_empty]] for directions.",
          inlineLinks: [{ id: "i_empty", label: "Directions Map", url: "{{directions_link}}" }],
        },
        {
          id: "fn_empty",
          type: "footer_nav",
          links: [
            { id: "f1", label: "Wi-Fi", url: "{{wifi_guide_link}}" },
            { id: "f2", label: "Directions", url: "{{directions_link}}" },
          ],
        },
      ],
    };

    const rendered = renderHotelEmailServerSide({
      variant,
      context: BASE_CONTEXT,
      settings,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!rendered.html.includes('href=""'), "Empty link variable must NEVER render empty href=''");
    assert.ok(!rendered.html.includes("undefined"), "Empty link variable must NEVER render 'undefined'");
    assert.ok(!rendered.html.includes("Get Directions"), "Button with empty variable URL hides cleanly");
    assert.ok(!rendered.html.includes("Directions Map") && !rendered.html.includes('href=""'), "Inline link with empty variable hides cleanly without broken anchor");
    assert.ok(rendered.html.includes('href="https://wifi.example/guide"'));
  });

  // 43. Unsafe URLs rejected on save AND neutralized on render
  await test("43. Unsafe URLs (http, javascript, data, vbscript, file, credentials, localhost, IP, >2048 chars, mailto ?query) rejected on save & neutralized on render", () => {
    const unsafeUrls = [
      "http://insecure.example/page",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "file:///etc/passwd",
      "https://user:pass@harborview.example/secret",
      "https://localhost:3000/admin",
      "https://127.0.0.1/internal",
      "https://[::1]/internal",
      "https://192.168.1.5/admin",
      "https://harborview.example/" + "a".repeat(2050),
      "mailto:desk@harborview.example?cc=attacker@evil.example&body=injected",
      "mailto:desk@harborview.example?subject=Hack",
      "mailto:not-an-email",
      "tel:abc",
    ];

    for (const bad of unsafeUrls) {
      const check = validateEmailUrl(bad, { allowContactSchemes: true });
      assert.strictEqual(check.valid, false, `Expected unsafe URL to be rejected: ${bad}`);
    }

    // Valid safe URLs including international tel with spaces & clean mailto
    assert.strictEqual(validateEmailUrl("https://harborview.example/stay?id=123", { allowContactSchemes: true }).valid, true);
    assert.strictEqual(validateEmailUrl("mailto:frontdesk@harborview.example", { allowContactSchemes: true }).valid, true);
    const telOk = validateEmailUrl("tel:+49 30 555-0199", { allowContactSchemes: true });
    assert.strictEqual(telOk.valid, true);
    assert.strictEqual(telOk.normalized, "tel:+4930555-0199");

    // Neutralized on render even if stored directly bypassing validation
    const maliciousVariant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Security Render Check",
      preheader: "",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: true,
        logoUrl: "https://cdn.example/logo.png",
        logoLinkUrl: "javascript:alert(1)",
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        { id: "b1", type: "button", label: "Malicious Button", url: "https://user:pass@evil.example", displayStyle: "solid" },
        { id: "b2", type: "button", label: "Localhost Button", url: "https://localhost/admin", displayStyle: "solid" },
        {
          id: "p1",
          type: "paragraph",
          text: "Click [[link:m1]] or [[link:m2]].",
          inlineLinks: [
            { id: "m1", label: "Bad Mailto", url: "mailto:a@b.com?bcc=spy@evil.example" },
            { id: "m2", label: "Bad Data", url: "data:text/html,evil" },
          ],
        },
        {
          id: "fn1",
          type: "footer_nav",
          links: [{ id: "f1", label: "File Link", url: "file:///etc/passwd" }],
        },
      ],
    };

    const issues = validateTemplateVariant(maliciousVariant);
    assert.ok(issues.length >= 5, `Expected >= 5 validation issues for malicious URLs, got ${issues.length}`);

    const rendered = renderHotelEmailServerSide({
      variant: maliciousVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!rendered.html.includes("javascript:"));
    assert.ok(!rendered.html.includes("user:pass@"));
    assert.ok(!rendered.html.includes("localhost/admin"));
    assert.ok(!rendered.html.includes("bcc=spy"));
    assert.ok(!rendered.html.includes("data:text/html"));
    assert.ok(!rendered.html.includes("file:///etc/passwd"));
  });

  // 44. Phishing visible-URL mismatch rejected on save AND neutralized on render
  await test("44. Mismatched visible-URL text (phishing guard) rejected on save and neutralized on render", () => {
    const mismatch = validateLinkLabelAgainstUrl("https://trusted-hotel.com", "https://evil-phish.example/login");
    assert.strictEqual(mismatch.valid, false, "Mismatched URL text vs href must be rejected");

    const bareHostMismatch = validateLinkLabelAgainstUrl("paypal.com", "https://evil.example/steal");
    assert.strictEqual(bareHostMismatch.valid, false, "Mismatched bare domain text vs href must be rejected");

    // Matching hostname and normal descriptive labels must PASS
    assert.strictEqual(
      validateLinkLabelAgainstUrl("https://harborview.example/stay", "https://www.harborview.example/stay").valid,
      true
    );
    assert.strictEqual(validateLinkLabelAgainstUrl("Manage Your Stay", "https://harborview.example/stay").valid, true);

    const phishVariant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Phishing Check",
      preheader: "",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: false,
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        { id: "pb1", type: "button", label: "https://trusted-bank.com", url: "https://evil-phish.example", displayStyle: "solid" },
        {
          id: "pp1",
          type: "paragraph",
          text: "Visit [[link:pl1]] now.",
          inlineLinks: [
            { id: "pl1", label: "trusted-bank.com", url: "https://evil-phish.example/login" },
          ],
        },
      ],
    };

    const issues = validateTemplateVariant(phishVariant);
    assert.ok(issues.length >= 2, `Expected phishing mismatch errors, got: ${JSON.stringify(issues)}`);

    const rendered = renderHotelEmailServerSide({
      variant: phishVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });
    assert.ok(!rendered.html.includes("evil-phish.example"), "Phishing mismatched href must be neutralized on render");
  });

  // 45. Inline links cannot inject raw HTML in labels or surrounding text
  await test("45. Inline links escape raw HTML tags (<script>, <img onerror>, <a>) in both label and surrounding body text", () => {
    const xssVariant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Inline XSS Test",
      preheader: "",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: false,
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        {
          id: "px1",
          type: "paragraph",
          text: '<b>Hello</b> <script>alert(1)</script> [[link:xl1]] <img src=x onerror="evil()">',
          inlineLinks: [
            {
              id: "xl1",
              label: '<script>steal()</script>Click "Here"',
              url: "https://harborview.example/safe",
            },
          ],
        },
      ],
    };

    const rendered = renderHotelEmailServerSide({
      variant: xssVariant,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("<script>"), "Raw <script> must be stripped/escaped");
    assert.ok(!rendered.html.includes("steal()"), "Script body inside inline link label must be stripped");
    assert.ok(!rendered.html.includes('onerror="evil()"'), "Raw onerror attribute must be escaped");
    assert.ok(!rendered.html.includes("<b>Hello</b>"), "Raw <b> HTML must be escaped");
    assert.ok(rendered.html.includes('href="https://harborview.example/safe"'), "Safe inline link anchor still renders");
    assert.ok(rendered.html.includes("Click &quot;Here&quot;"), "Safe inline link label quotes are properly escaped");
  });

  // 46. applyDefaultLinksToTemplateDoc updates drafts ONLY (never modifies published, publishedVersion, or isCustomized)
  await test("46. applyDefaultLinksToTemplateDoc updates drafts ONLY while leaving published templates 100% untouched", () => {
    const publishedEn = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");
    const publishedDe = buildStarterPresetVariant("modern_resort", "booking_confirmation", "de", "https://tidehotels.de");
    const originalPublishedJson = JSON.stringify({ en: publishedEn, de: publishedDe });

    const doc: EmailTemplateDocument = {
      eventType: "booking_confirmation",
      enabled: true,
      isCustomized: true,
      defaultLanguage: "en",
      publishedVersion: 7,
      published: { en: JSON.parse(JSON.stringify(publishedEn)), de: JSON.parse(JSON.stringify(publishedDe)) },
      draft: { en: JSON.parse(JSON.stringify(publishedEn)), de: JSON.parse(JSON.stringify(publishedDe)) },
      versions: [],
      updatedAt: "2026-11-01T00:00:00.000Z",
      updatedBy: "admin@harborview.example",
    };

    const nextDoc = applyDefaultLinksToTemplateDoc(
      doc,
      {
        en: [
          { id: "new_en_1", label: "Privacy Policy", url: "https://harborview.example/privacy" },
          { id: "new_en_2", label: "Email Support", url: "mailto:support@harborview.example" },
        ],
        de: [
          { id: "new_de_1", label: "Datenschutz", url: "https://harborview.example/datenschutz" },
        ],
      },
      "admin@harborview.example",
      "2026-11-20T15:00:00.000Z"
    );

    assert.strictEqual(JSON.stringify(nextDoc.published), originalPublishedJson, "Published templates MUST NOT be altered");
    assert.strictEqual(nextDoc.publishedVersion, 7);
    assert.strictEqual(nextDoc.isCustomized, true);

    const enNav = nextDoc.draft.en?.blocks.find((b) => b.type === "footer_nav");
    const deNav = nextDoc.draft.de?.blocks.find((b) => b.type === "footer_nav");
    assert.ok(enNav && enNav.type === "footer_nav" && enNav.links.some((l) => l.label === "Privacy Policy"));
    assert.ok(deNav && deNav.type === "footer_nav" && deNav.links.some((l) => l.label === "Datenschutz"));
    assert.strictEqual(nextDoc.draft.en?.schemaVersion, 4);
    assert.strictEqual(nextDoc.draft.de?.schemaVersion, 4);
  });

  // 47. Live preview HTML matches sent Resend HTML byte-for-byte for edited links
  await test("47. Live preview HTML matches dispatched sent HTML byte-for-byte after publishing v4 edited links", async () => {
    const v4Variant: EmailTemplateVariant = {
      schemaVersion: 4,
      subject: "Booking {{booking_reference}} Ready",
      preheader: "Check your links",
      branding: {
        primaryColor: "#0f766e",
        secondaryColor: "#134e4a",
        fontFamily: "arial",
        accentBarEnabled: true,
        accentBarThicknessPx: 4,
        showEyebrow: false,
        eyebrowText: "",
        showLogo: true,
        logoUrl: "https://cdn.example/logo.png",
        logoLinkUrl: "{{hotel_website}}",
        accentBarColor: "#0f766e",
        buttonColor: "#0f766e",
        buttonTextColor: "#ffffff",
      },
      blocks: [
        {
          id: "p1",
          type: "paragraph",
          text: "Welcome {{guest_name}}! Check [[link:a1]] or [[link:a2]].",
          inlineLinks: [
            { id: "a1", label: "Directions", url: "{{directions_link}}", openInNewTab: true },
            { id: "a2", label: "Front Desk", url: "mailto:{{hotel_email}}" },
          ],
        },
        { id: "b1", type: "button", label: "Manage Reservation", url: "{{portal_link}}", displayStyle: "solid" },
        {
          id: "fn1",
          type: "footer_nav",
          links: [
            { id: "l1", label: "Privacy", url: "https://harborview.example/privacy" },
            { id: "l2", label: "Call Us", url: "tel:{{hotel_phone}}" },
          ],
        },
      ],
    };

    const settings: HotelEmailSettings = {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      portalUrl: "https://harborview.example/portal",
      defaultLinks: {
        directions: { defaultUrl: "https://maps.example/harborview" },
      },
    };

    const preview = renderEmailTemplate({
      variant: v4Variant,
      context: BASE_CONTEXT,
      settings,
      language: "en",
      usedDefaultLayout: false,
    });

    const dispatched: SendEmailParams[] = [];
    const dispatchRes = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
      reservationId: "RES8A4F2",
      preloaded: {
        hotel: SAMPLE_HOTEL,
        reservation: {
          id: "RES8A4F2",
          hotelId: "hotel_alpha",
          guestName: "Alex Morgan",
          guestEmail: "alex.morgan@example.com",
          roomNumber: "204",
          roomType: "Deluxe King Suite",
          checkIn: "2026-11-24",
          checkInTime: "14:00",
          checkOut: "2026-11-27",
          checkOutTime: "12:00",
          totalAmount: 270000,
          depositAmount: 90000,
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
          variant: v4Variant,
          settings,
          usedDefaultLayout: false,
          publishedVersion: 2,
        }),
        sendEmailFn: async (p) => {
          dispatched.push(p);
          return {
            success: true,
            messageId: "msg_v4_preview_parity",
            deliveryState: "accepted_by_provider",
            provider: "resend",
            statusCode: 200,
          };
        },
        persistMarkerFn: async () => true,
      },
    });

    assert.strictEqual(dispatchRes.ok, true);
    assert.strictEqual(dispatched.length, 1);
    assert.strictEqual(dispatched[0].html, preview.html, "Preview HTML and sent HTML MUST match byte-for-byte");
    assert.strictEqual(dispatched[0].text, preview.text, "Preview plain text and sent plain text MUST match byte-for-byte");
  });

  // 48. Tenant isolation & RBAC: cross-hotel admin and non-admin staff cannot manage links or settings
  await test("48. Cross-hotel admin and non-admin staff cannot edit links or settings (RBAC & hotel scoping)", () => {
    const hotelAlphaAdmin = {
      uid: "u_alpha_admin",
      email: "admin@harborview.example",
      profile: {
        uid: "u_alpha_admin",
        email: "admin@harborview.example",
        role: "hotelAdmin",
        hotelId: "hotel_alpha",
        status: "active",
      },
    };
    const hotelBetaAdmin = {
      uid: "u_beta_admin",
      email: "admin@otherhotel.example",
      profile: {
        uid: "u_beta_admin",
        email: "admin@otherhotel.example",
        role: "hotelAdmin",
        hotelId: "hotel_beta",
        status: "active",
      },
    };
    const receptionist = {
      uid: "u_staff",
      email: "desk@harborview.example",
      profile: {
        uid: "u_staff",
        email: "desk@harborview.example",
        role: "receptionist",
        hotelId: "hotel_alpha",
        status: "active",
      },
    };

    assert.strictEqual(callerHasEmailModuleAccess(hotelAlphaAdmin, "hotel_alpha", "manage").allowed, true);
    assert.strictEqual(callerHasEmailModuleAccess(hotelBetaAdmin, "hotel_alpha", "manage").allowed, false);
    assert.strictEqual(callerHasEmailModuleAccess(receptionist, "hotel_alpha", "manage").allowed, false);
    assert.strictEqual(callerIsStrictHotelAdmin(receptionist, "hotel_alpha").allowed, false);
  });

  // 49. Feature flag EMAIL_CUSTOMIZATION_ENABLED=false disables v4 custom links and reverts to untouched defaults
  await test("49. EMAIL_CUSTOMIZATION_ENABLED=false disables v4 edited links and outputs exact untouched default", async () => {
    const prevFlag = process.env.EMAIL_CUSTOMIZATION_ENABLED;
    process.env.EMAIL_CUSTOMIZATION_ENABLED = "false";
    const sent: SendEmailParams[] = [];
    try {
      const res = await sendHotelEmail("hotel_alpha", "booking_confirmation", {
        reservationId: "RES_FLAG_OFF_V4",
        preloaded: {
          hotel: SAMPLE_HOTEL,
          reservation: {
            id: "RES_FLAG_OFF_V4",
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
            sent.push(p);
            return {
              success: true,
              messageId: "msg_flag_off_v4",
              deliveryState: "accepted_by_provider",
              provider: "resend",
              statusCode: 200,
            };
          },
          persistMarkerFn: async () => true,
        },
      });
      assert.strictEqual(res.ok, true);
      assert.strictEqual(res.usedDefaultLayout, true);
      assert.strictEqual(sent.length, 1);
      assert.ok(sent[0].html.includes("Harborview Suites"));
    } finally {
      if (prevFlag === undefined) delete process.env.EMAIL_CUSTOMIZATION_ENABLED;
      else process.env.EMAIL_CUSTOMIZATION_ENABLED = prevFlag;
    }
  });

  // 50. URL format validation utility ensures user-defined links are absolute URLs with valid protocols
  await test("50. validateAbsoluteLinkUrl validates absolute http/https URLs and flags relative paths or missing protocols", () => {
    const okHttps = validateAbsoluteLinkUrl("https://harborview.example/manage");
    assert.strictEqual(okHttps.valid, true);
    assert.strictEqual(okHttps.isAbsolute, true);
    assert.strictEqual(okHttps.protocol, "https:");

    const httpAllowed = validateAbsoluteLinkUrl("http://harborview.example/book", { allowHttp: true });
    assert.strictEqual(httpAllowed.valid, true);
    assert.strictEqual(httpAllowed.isAbsolute, true);
    assert.strictEqual(httpAllowed.protocol, "http:");

    const httpDisallowed = validateAbsoluteLinkUrl("http://harborview.example/book", { allowHttp: false });
    assert.strictEqual(httpDisallowed.valid, false);
    assert.strictEqual(httpDisallowed.isAbsolute, true);
    assert.strictEqual(httpDisallowed.suggestedHttpsUrl, "https://harborview.example/book");

    const relativePath = validateAbsoluteLinkUrl("/reservations/123");
    assert.strictEqual(relativePath.valid, false);
    assert.strictEqual(relativePath.isAbsolute, false);

    const missingProtocol = validateAbsoluteLinkUrl("www.harborview.example/checkin");
    assert.strictEqual(missingProtocol.valid, false);
    assert.strictEqual(missingProtocol.isAbsolute, false);
    assert.strictEqual(missingProtocol.suggestedHttpsUrl, "https://www.harborview.example/checkin");

    const badScheme = validateAbsoluteLinkUrl("ftp://files.harborview.example/doc.pdf");
    assert.strictEqual(badScheme.valid, false);

    const jsScheme = validateAbsoluteLinkUrl("javascript:alert(1)");
    assert.strictEqual(jsScheme.valid, false);

    const varToken = validateAbsoluteLinkUrl("{{booking_link}}", { allowVariableToken: true });
    assert.strictEqual(varToken.valid, true);
    assert.strictEqual(varToken.protocol, "variable");
  });

  // 51. Header logos and all email images render at natural aspect ratio without squashing or object-fit:cover cropping
  await test("51. Header logos, footer logos, and all email images render with natural aspect ratio (no fixed width+max-height squash or object-fit:cover)", () => {
    const preset = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");
    preset.branding.logoUrl = "https://cdn.harborview.example/logo-square.png";
    preset.branding.logoWidthPx = 160;
    preset.blocks = preset.blocks.map((b) => {
      if (b.type === "brand_header") {
        return { ...b, logoUrl: "https://cdn.harborview.example/logo-square.png", logoWidthPx: 160 };
      }
      if (b.type === "promo_banner") {
        return { ...b, imageUrl: "https://cdn.harborview.example/promo-icon.png" };
      }
      if (b.type === "benefits_list") {
        return { ...b, badgeImageUrl: "https://cdn.harborview.example/badge.png" };
      }
      if (b.type === "footer_copyright") {
        return { ...b, showFooterLogo: true, footerLogoUrl: "https://cdn.harborview.example/footer-logo.png", footerLogoWidthPx: 120 };
      }
      return b;
    });
    preset.blocks.push({
      id: "img_natural",
      type: "image",
      src: "https://cdn.harborview.example/lobby.jpg",
      alt: "Lobby",
      widthPx: 544,
      align: "center",
    });

    const rendered = renderEmailTemplate({
      variant: preset,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(!rendered.html.includes("object-fit:cover"), "Rendered email must NOT crop uploaded images with object-fit:cover");
    assert.ok(!rendered.html.includes("max-height:52px"), "Brand header logo must NOT squash tall/square logos to max-height:52px");
    assert.ok(!rendered.html.includes("max-height:56px"), "Header logo must NOT squash tall/square logos to max-height:56px");
    assert.ok(!rendered.html.includes("max-height:44px"), "Footer logo must NOT squash tall/square logos to max-height:44px");
    assert.ok(!rendered.html.includes('width="48" height="48"'), "Promo banner image must NOT force fixed 48x48 stretch");
    assert.ok(rendered.html.includes("object-fit:contain"), "Uploaded logos and images must use object-fit:contain");
    assert.ok(rendered.html.includes("width:auto;height:auto;max-width:160px;max-height:160px;object-fit:contain"), "Header logo must scale proportionally within max-width/max-height");
  });

  // 52. Expanded horizontal, justify, and 9-point vertical+horizontal alignment for text, logos, images, headers & cards
  await test("52. Expanded text, logo, and 9-point alignment controls render email-safe attributes and reject invalid values", () => {
    const preset = buildStarterPresetVariant("modern_resort", "booking_confirmation", "en", "https://tidehotels.de");
    preset.branding.showLogo = true;
    preset.branding.logoUrl = "https://cdn.harborview.example/logo.png";
    preset.branding.logoAlign = "center";

    preset.blocks = preset.blocks.map((b) => {
      if (b.type === "brand_header") {
        return {
          ...b,
          logoUrl: "https://cdn.harborview.example/logo.png",
          logoAlign: "center",
          logoVerticalAlign: "top",
          contactAlign: "left",
          contactVerticalAlign: "bottom",
        };
      }
      if (b.type === "feature_card") {
        return {
          ...b,
          imageAlign: "right",
          imageVerticalAlign: "bottom",
          textAlign: "center",
          textVerticalAlign: "top",
        };
      }
      if (b.type === "hero_text") {
        return {
          ...b,
          style: { ...(b.style || {}), align: "right", verticalAlign: "bottom" },
        };
      }
      return b;
    });

    preset.blocks.push(
      {
        id: "p_justify",
        type: "paragraph",
        text: "Welcome to {{hotel_name}} — your suite awaits.",
        align: "justify",
      },
      {
        id: "img_pos",
        type: "image",
        src: "https://cdn.harborview.example/suite.jpg",
        alt: "Suite",
        widthPx: 420,
        align: "right",
        verticalAlign: "bottom",
      }
    );

    const validIssues = validateTemplateVariant(preset);
    assert.strictEqual(validIssues.length, 0, `Expected 0 validation issues, got: ${JSON.stringify(validIssues)}`);

    const rendered = renderEmailTemplate({
      variant: preset,
      context: BASE_CONTEXT,
      settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
      language: "en",
      usedDefaultLayout: false,
    });

    assert.ok(rendered.html.includes('valign="top" align="center"'), "Brand header logo should render Top Center");
    assert.ok(rendered.html.includes('valign="bottom" align="left"'), "Brand header contact should render Bottom Left");
    assert.ok(rendered.html.includes('align="right" valign="bottom"'), "Feature card image should render Bottom Right");
    assert.ok(rendered.html.includes('align="center" valign="top"'), "Feature card text should render Top Center");
    assert.ok(rendered.html.includes("text-align:justify;"), "Paragraph should support justify alignment");
    assert.ok(rendered.html.includes('margin-left:auto;margin-right:0;'), "Right-aligned images should apply right auto-margin");

    // Validation must reject invalid alignment tokens
    const invalidVariant = JSON.parse(JSON.stringify(preset)) as EmailTemplateVariant;
    (invalidVariant.branding as any).logoAlign = "justify";
    const imgBlock = invalidVariant.blocks.find((b) => b.id === "img_pos") as any;
    imgBlock.verticalAlign = "diagonal";
    const invalidIssues = validateTemplateVariant(invalidVariant);
    assert.ok(
      invalidIssues.some((i) => i.path === "branding.logoAlign"),
      "Invalid branding.logoAlign must be rejected"
    );
    assert.ok(
      invalidIssues.some((i) => i.path.endsWith(".verticalAlign")),
      "Invalid verticalAlign must be rejected"
    );
  });

  if (process.exitCode && process.exitCode !== 0) {
    console.error(`\nFAILED: ${passed} tests passed, failures occurred.`);
    process.exit(1);
  }
  console.log(`\nALL ${passed} EMAIL CUSTOMIZATION TESTS PASSED!`);
}

run();
