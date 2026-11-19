import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveHotelBrandContext,
  resolvePlatformBrandContext,
  isHotelEmailEventEnabled,
  resolveHotelOperationalRecipients,
  resolvePlatformAdminRecipients,
  resolveTrackingCodeAlertRecipients,
  renderMultiTenantEmail,
  verifyResendWebhookSignature,
  recordEmailDeliveryLog,
  updateEmailDeliveryStatusFromWebhook,
  getTenantEmailLogs,
  clearEmailLogStoreForTest,
} from "../services/multiTenantEmailService.ts";
import {
  validateEmailConfig,
  getAppUrl,
  getConfiguredFromAddress,
} from "../services/emailService.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`PASS: ${name}`);
  } catch (err: any) {
    console.error(`FAIL: ${name}`);
    console.error(err?.stack || err);
    process.exitCode = 1;
  }
}

console.log("=== Running Multi-Tenant Resend Email Notification Test Suite ===");

runTest("1. Multi-hotel branding isolation (Hotel A vs Hotel B, zero cross-tenant bleed)", () => {
  const appUrl = "https://platform.example";
  const hotelADoc = {
    name: "Azure Bay Resort",
    defaultCurrency: "USD",
    branding: {
      logoUrl: "https://cdn.azurebay.example/logo.png",
      primaryColor: "#0284c7",
      secondaryColor: "#0c4a6e",
      address: "10 Ocean View, Miami",
      phone: "+1-305-555-0199",
      email: "reservations@azurebay.example",
      website: "https://azurebay.example/",
      footerNotes: "Azure Bay Guest Concierge",
    },
    emailConfig: {
      senderDisplayName: "Azure Bay Reservations",
      replyToEmail: "reply@azurebay.example",
    },
  };

  const hotelBDoc = {
    name: "Emerald Crown Hotel",
    defaultCurrency: "NGN",
    branding: {
      logoUrl: "https://cdn.emeraldcrown.example/brand.png",
      primaryColor: "#059669",
      secondaryColor: "#064e3b",
      address: "42 Victoria Island, Lagos",
      phone: "+234-800-555-0100",
      email: "desk@emeraldcrown.example",
      website: "https://emeraldcrown.example",
      footerNotes: "Emerald Crown Hospitality",
    },
  };

  const brandA = resolveHotelBrandContext("hotel-a", hotelADoc, appUrl);
  const brandB = resolveHotelBrandContext("hotel-b", hotelBDoc, appUrl);

  const emailA = renderMultiTenantEmail("reservation.confirmed", brandA, {
    recipientName: "Alice Guest",
    rows: [
      { label: "Booking Reference", value: "AZ-101" },
      { label: "Room", value: "Ocean Suite 12" },
    ],
  });

  const emailB = renderMultiTenantEmail("reservation.confirmed", brandB, {
    recipientName: "Bola Guest",
    rows: [
      { label: "Booking Reference", value: "EC-202" },
      { label: "Room", value: "Executive King 301" },
    ],
  });

  // Assert Hotel A contains only Hotel A branding
  assert.equal(emailA.fromName, "Azure Bay Reservations");
  assert.equal(emailA.replyTo, "reply@azurebay.example");
  assert.ok(emailA.subject.includes("Azure Bay Resort"));
  assert.ok(emailA.html.includes("https://cdn.azurebay.example/logo.png"));
  assert.ok(emailA.html.includes("#0284c7"));
  assert.ok(emailA.html.includes("reservations@azurebay.example"));
  assert.ok(!emailA.html.includes("Emerald Crown"));
  assert.ok(!emailA.text.includes("Emerald Crown"));

  // Assert Hotel B contains only Hotel B branding
  assert.equal(emailB.fromName, "Emerald Crown Hotel");
  assert.equal(emailB.replyTo, "desk@emeraldcrown.example");
  assert.ok(emailB.subject.includes("Emerald Crown Hotel"));
  assert.ok(emailB.html.includes("https://cdn.emeraldcrown.example/brand.png"));
  assert.ok(emailB.html.includes("#059669"));
  assert.ok(!emailB.html.includes("Azure Bay"));
  assert.ok(!emailB.text.includes("Azure Bay"));
});

runTest("2. Zero hardcoded single-tenant branding in global email services", () => {
  const filesToInspect = [
    "src/services/emailService.ts",
    "src/services/resendEmailService.ts",
    "src/services/multiTenantEmailService.ts",
    "scripts/test-resend-email.ts",
  ];
  for (const relPath of filesToInspect) {
    const content = fs.readFileSync(path.join(projectRoot, relPath), "utf8");
    assert.ok(
      !/tid[eé]\s+hotels/i.test(content),
      `Found hardcoded single-hotel branding in ${relPath}`
    );
  }
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  try {
    delete process.env.RESEND_FROM_EMAIL;
    assert.throws(
      () => getConfiguredFromAddress(),
      /RESEND_FROM_EMAIL/,
      "getConfiguredFromAddress must fail fast with no default sender fallback"
    );
  } finally {
    if (prevFrom !== undefined) process.env.RESEND_FROM_EMAIL = prevFrom;
    else delete process.env.RESEND_FROM_EMAIL;
  }
});

runTest("3. HTML escaping prevents XSS injection in dynamic email fields", () => {
  const brand = resolveHotelBrandContext(
    "hotel-xss",
    {
      name: 'Hotel <script>alert("h")</script>',
      branding: {
        address: '123 Main <img src=x onerror=alert(1)>',
      },
    },
    "https://app.example"
  );

  const rendered = renderMultiTenantEmail("reservation.checked_in", brand, {
    recipientName: '<script>alert("guest")</script>',
    rows: [{ label: "Room", value: "<b>101</b>" }],
    note: 'Check <a href="javascript:alert(1)">here</a>',
  });

  assert.ok(!rendered.html.includes("<script>"));
  assert.ok(!rendered.html.includes("<img src=x"));
  assert.ok(rendered.html.includes("&lt;script&gt;"));
  assert.ok(rendered.html.includes("&lt;b&gt;101&lt;/b&gt;"));
});

runTest("4. Per-hotel independent notification preference evaluation", () => {
  const hotelQuietGuests = {
    settings: {
      guests: { allowEmailCommunication: false },
      notifications: { enableEmail: true, sendMaintenanceAlerts: false },
      payments: { autoSendReceipts: false },
    },
  };
  const hotelExplicitOverride = {
    settings: {
      guests: { allowEmailCommunication: false },
    },
    emailConfig: {
      enabledEvents: {
        "reservation.confirmed": true,
        "housekeeping.room_ready": false,
      },
    },
  };

  assert.equal(
    isHotelEmailEventEnabled(hotelQuietGuests, "reservation.confirmed", "guest").enabled,
    false
  );
  assert.equal(
    isHotelEmailEventEnabled(hotelQuietGuests, "maintenance.issue_reported", "hotel_staff").enabled,
    false
  );
  assert.equal(
    isHotelEmailEventEnabled(hotelQuietGuests, "housekeeping.room_ready", "hotel_staff").enabled,
    true
  );
  // Explicit hotel emailConfig.enabledEvents takes precedence
  assert.equal(
    isHotelEmailEventEnabled(hotelExplicitOverride, "reservation.confirmed", "guest").enabled,
    true
  );
  assert.equal(
    isHotelEmailEventEnabled(hotelExplicitOverride, "housekeeping.room_ready", "hotel_staff").enabled,
    false
  );
});

runTest("5. Strict multi-tenant recipient routing (department -> admin -> active staff -> fallback)", () => {
  const staffPool = [
    { email: "gm@hotel-a.example", role: "hotelAdmin", status: "active" },
    { email: "chief@hotel-a.example", role: "staff", staffRole: "maintenance", status: "active" },
    { email: "suspended@hotel-a.example", role: "staff", staffRole: "maintenance", status: "suspended" },
    { email: "hk@hotel-a.example", role: "staff", staffRole: "housekeeper", status: "active" },
  ];

  // 1) Explicit department recipient takes priority
  const hotelWithDept = {
    emailConfig: {
      departmentRecipients: {
        maintenance: ["engineering@hotel-a.example"],
      },
      adminRecipients: ["admin@hotel-a.example"],
    },
  };
  assert.deepEqual(
    resolveHotelOperationalRecipients(hotelWithDept, "maintenance.issue_reported", staffPool),
    ["engineering@hotel-a.example"]
  );

  // 2) No department override -> active staff role matching (excluding suspended staff)
  const hotelUsingStaff = { branding: { email: "fallback@hotel-a.example" } };
  const maintRecips = resolveHotelOperationalRecipients(
    hotelUsingStaff,
    "maintenance.issue_reported",
    staffPool
  );
  assert.ok(maintRecips.includes("gm@hotel-a.example"));
  assert.ok(maintRecips.includes("chief@hotel-a.example"));
  assert.ok(!maintRecips.includes("suspended@hotel-a.example"));
  assert.ok(!maintRecips.includes("hk@hotel-a.example"));

  // 3) No staff matched -> fallback to hotel branding support email
  const fallbackRecips = resolveHotelOperationalRecipients(
    hotelUsingStaff,
    "maintenance.issue_reported",
    []
  );
  assert.deepEqual(fallbackRecips, ["fallback@hotel-a.example"]);
});

runTest("6. Platform SuperAdmin and tracking code request alert routing", () => {
  const prevPlatformEnv = process.env.PLATFORM_ADMIN_EMAIL;
  const prevLegacyEnv = process.env.ADMIN_ALERT_EMAIL;
  try {
    process.env.PLATFORM_ADMIN_EMAIL = "superadmin@platform.example";
    delete process.env.ADMIN_ALERT_EMAIL;

    const systemSettings = { supportEmail: "ops@platform.example" };
    const platformBrand = resolvePlatformBrandContext(systemSettings, "https://app.example/");
    assert.equal(platformBrand.hotelId, "SYSTEM");
    assert.equal(platformBrand.isPlatformScope, true);
    assert.equal(platformBrand.website, "https://app.example");

    const superAdmins = resolvePlatformAdminRecipients(systemSettings);
    assert.ok(superAdmins.includes("superadmin@platform.example"));
    assert.ok(superAdmins.includes("ops@platform.example"));

    // Renewal tracking code alert includes platform admins + hotel's optional trackingCodeAlertRecipients
    const renewalHotel = {
      emailConfig: {
        trackingCodeAlertRecipients: ["billing@hotel-b.example"],
      },
    };
    const trackingRecipients = resolveTrackingCodeAlertRecipients(systemSettings, renewalHotel);
    assert.ok(trackingRecipients.includes("superadmin@platform.example"));
    assert.ok(trackingRecipients.includes("ops@platform.example"));
    assert.ok(trackingRecipients.includes("billing@hotel-b.example"));
  } finally {
    if (prevPlatformEnv !== undefined) process.env.PLATFORM_ADMIN_EMAIL = prevPlatformEnv;
    else delete process.env.PLATFORM_ADMIN_EMAIL;
    if (prevLegacyEnv !== undefined) process.env.ADMIN_ALERT_EMAIL = prevLegacyEnv;
    else delete process.env.ADMIN_ALERT_EMAIL;
  }
});

runTest("7. Resend (Svix) HMAC-SHA256 webhook signature verification", () => {
  const keyBytes = crypto.randomBytes(32);
  const webhookSecret = `whsec_${keyBytes.toString("base64")}`;
  const svixId = "msg_test_12345";
  const svixTimestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    type: "email.delivered",
    data: { email_id: "re_abc123", tags: { hotelId: "hotel-a", logId: "em_1" } },
  });

  const expectedSig = crypto
    .createHmac("sha256", keyBytes)
    .update(`${svixId}.${svixTimestamp}.${rawBody}`)
    .digest("base64");

  const validCheck = verifyResendWebhookSignature(
    rawBody,
    {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${expectedSig}`,
    },
    webhookSecret
  );
  assert.equal(validCheck.valid, true);

  // Tampered payload must fail
  const tamperedCheck = verifyResendWebhookSignature(
    rawBody.replace("re_abc123", "re_hacked"),
    {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": `v1,${expectedSig}`,
    },
    webhookSecret
  );
  assert.equal(tamperedCheck.valid, false);

  // Expired timestamp must fail replay protection
  const oldTs = String(Math.floor(Date.now() / 1000) - 600);
  const oldSig = crypto
    .createHmac("sha256", keyBytes)
    .update(`${svixId}.${oldTs}.${rawBody}`)
    .digest("base64");
  const expiredCheck = verifyResendWebhookSignature(
    rawBody,
    {
      "svix-id": svixId,
      "svix-timestamp": oldTs,
      "svix-signature": `v1,${oldSig}`,
    },
    webhookSecret
  );
  assert.equal(expiredCheck.valid, false);
});

runTest("8. Tenant-isolated email delivery logs & webhook status lifecycle", () => {
  clearEmailLogStoreForTest();
  const now = new Date().toISOString();

  recordEmailDeliveryLog({
    logId: "log-a-1",
    hotelId: "hotel-a",
    eventType: "reservation.confirmed",
    audience: "guest",
    recipients: ["guest-a@example.com"],
    subject: "Booking Confirmation - Hotel A",
    provider: "resend",
    messageId: "re_msg_a_1",
    status: "accepted_by_provider",
    createdAt: now,
    updatedAt: now,
  });

  recordEmailDeliveryLog({
    logId: "log-b-1",
    hotelId: "hotel-b",
    eventType: "reservation.checked_in",
    audience: "guest",
    recipients: ["guest-b@example.com"],
    subject: "Check-In Confirmation - Hotel B",
    provider: "resend",
    messageId: "re_msg_b_1",
    status: "accepted_by_provider",
    createdAt: now,
    updatedAt: now,
  });

  // Update Hotel A log via webhook
  const updated = updateEmailDeliveryStatusFromWebhook({
    webhookType: "email.delivered",
    messageId: "re_msg_a_1",
    tags: { hotelId: "hotel-a", logId: "log-a-1" },
  });
  assert.ok(updated);
  assert.equal(updated?.status, "delivered");

  // Reconstruct a bounced record for Hotel C after simulated server restart
  const reconstructed = updateEmailDeliveryStatusFromWebhook({
    webhookType: "email.bounced",
    messageId: "re_msg_c_99",
    tags: {
      hotelId: "hotel-c",
      logId: "log-c-99",
      eventType: "reservation.cancelled",
      audience: "guest",
    },
  });
  assert.ok(reconstructed);
  assert.equal(reconstructed?.hotelId, "hotel-c");
  assert.equal(reconstructed?.status, "bounced");

  // Strict tenant isolation on log reads
  const logsA = getTenantEmailLogs("hotel-a");
  const logsB = getTenantEmailLogs("hotel-b");
  const logsC = getTenantEmailLogs("hotel-c");
  assert.equal(logsA.length, 1);
  assert.equal(logsA[0].status, "delivered");
  assert.equal(logsB.length, 1);
  assert.equal(logsB[0].status, "accepted_by_provider");
  assert.equal(logsC.length, 1);
  assert.equal(logsC[0].status, "bounced");

  clearEmailLogStoreForTest();
});

runTest("9. Email service fail-fast config validation & APP_URL trailing-slash stripping", () => {
  const prevKey = process.env.RESEND_API_KEY;
  const prevFrom = process.env.RESEND_FROM_EMAIL;
  const prevUrl = process.env.APP_URL;

  try {
    delete process.env.RESEND_API_KEY;
    process.env.RESEND_FROM_EMAIL = "Hotel Notifications <notifications@mail.example>";
    process.env.APP_URL = "https://hotels.example///";
    assert.equal(validateEmailConfig().ok, false);

    process.env.RESEND_API_KEY = "re_test_dummy_value";
    delete process.env.RESEND_FROM_EMAIL;
    assert.equal(validateEmailConfig().ok, false);

    process.env.RESEND_FROM_EMAIL = "Hotel Notifications <notifications@mail.example>";
    delete process.env.APP_URL;
    assert.equal(validateEmailConfig().ok, false);

    process.env.APP_URL = "https://hotels.example///";
    assert.equal(validateEmailConfig().ok, true);
    assert.equal(getAppUrl(), "https://hotels.example");
  } finally {
    if (prevKey !== undefined) process.env.RESEND_API_KEY = prevKey;
    else delete process.env.RESEND_API_KEY;
    if (prevFrom !== undefined) process.env.RESEND_FROM_EMAIL = prevFrom;
    else delete process.env.RESEND_FROM_EMAIL;
    if (prevUrl !== undefined) process.env.APP_URL = prevUrl;
    else delete process.env.APP_URL;
  }
});

if (process.exitCode && process.exitCode !== 0) {
  console.error("=== Multi-Tenant Email Test Suite FAILED ===");
  process.exit(process.exitCode);
} else {
  console.log("=== All Multi-Tenant Email Tests PASSED ===");
}
