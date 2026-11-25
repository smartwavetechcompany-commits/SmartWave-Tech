import assert from "assert";
import {
  clearRecentlyDeliveredDailyOps,
  clearRegisteredDailyOpsSessions,
  getRegisteredDailyOpsHotelIds,
  registerHotelDailyOpsSessionToken,
  runDailyOpsBackgroundSchedulerPass,
  runDailyOpsDryRunDiagnostic,
} from "../modules/emailCustomization/server/dailyOpsService.ts";
import { encodeFirestoreValue } from "../modules/emailCustomization/server/firestoreRest.ts";
import {
  renderLoyaltyTierBenefitsHtml,
  renderLoyaltyTierBenefitsText,
  resolveLoyaltyTierBenefitsForEmail,
  SERVER_DEFAULT_LOYALTY_LEVELS,
} from "../modules/loyalty/shared/loyaltyPolicyCore.ts";
import { buildDefaultTemplateVariant } from "../modules/emailCustomization/shared/defaultTemplates.ts";
import { renderEmailTemplate } from "../modules/emailCustomization/shared/renderer.ts";
import {
  renderMultiTenantEmail,
  resolveHotelBrandContext,
  type MultiTenantEmailEventType,
} from "../services/multiTenantEmailService.ts";
import type { CustomizableEmailEventType, EmailRenderContext } from "../modules/emailCustomization/shared/types.ts";

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  PASS  ${name}`);
  } catch (err: any) {
    failed++;
    console.error(`  FAIL  ${name}`);
    console.error("       ", err?.stack || err);
  }
}

function toFirestoreDocJson(namePath: string, obj: Record<string, any>) {
  const fields: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) fields[k] = encodeFirestoreValue(v);
  }
  return { name: `projects/smartwave-pms/databases/(default)/documents/${namePath}`, fields };
}

async function run() {
  console.log("Running Auto-Email Scheduler, Dry-Run Diagnostic & Loyalty Tier Benefits Verification Suite...");

  // -------------------------------------------------------------------------
  // PART 1: Daily Ops Auto-Scheduler + Dry-Run Diagnostic (In-Memory Firestore Mock)
  // -------------------------------------------------------------------------
  const originalFetch = globalThis.fetch;
  const mockDb = new Map<string, Record<string, any>>();
  let firestoreWriteCount = 0;
  let failAllFirestoreWrites = false;

  const installMockFirestoreFetch = () => {
    globalThis.fetch = (async (input: any, init?: any) => {
      const url = typeof input === "string" ? input : String(input?.url || input);
      const marker = "/documents/";
      const idx = url.indexOf(marker);
      if (idx === -1) {
        return new Response("Not Found", { status: 404 });
      }
      const pathAndQuery = url.slice(idx + marker.length);
      const docOrColPath = decodeURIComponent(pathAndQuery.split("?")[0]).replace(/^\/+|\/+$/g, "");
      const method = String(init?.method || "GET").toUpperCase();

      if (method === "PATCH") {
        firestoreWriteCount++;
        if (failAllFirestoreWrites) {
          return new Response(JSON.stringify({ error: { message: "Simulated transient Firestore write error" } }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          });
        }
        const body = JSON.parse(String(init?.body || "{}"));
        const rawFields = body.fields || {};
        // Decode fields using lightweight mirror of decodeFirestoreValue
        const decodeVal = (v: any): any => {
          if (!v || typeof v !== "object") return undefined;
          if ("stringValue" in v) return v.stringValue;
          if ("integerValue" in v) return Number(v.integerValue);
          if ("doubleValue" in v) return Number(v.doubleValue);
          if ("booleanValue" in v) return Boolean(v.booleanValue);
          if ("nullValue" in v) return null;
          if ("arrayValue" in v) return (v.arrayValue?.values || []).map(decodeVal);
          if ("mapValue" in v) {
            const o: Record<string, any> = {};
            for (const [fk, fv] of Object.entries(v.mapValue?.fields || {})) {
              o[fk] = decodeVal(fv);
            }
            return o;
          }
          return undefined;
        };
        const decoded: Record<string, any> = {};
        for (const [k, v] of Object.entries(rawFields)) {
          decoded[k] = decodeVal(v);
        }
        mockDb.set(docOrColPath, decoded);
        return new Response(JSON.stringify(toFirestoreDocJson(docOrColPath, decoded)), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (method === "GET") {
        // Exact doc match
        if (mockDb.has(docOrColPath)) {
          const data = mockDb.get(docOrColPath)!;
          return new Response(JSON.stringify(toFirestoreDocJson(docOrColPath, data)), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        // Collection listing match (e.g., hotels/h1/rooms)
        const prefix = `${docOrColPath}/`;
        const docs: any[] = [];
        for (const [k, v] of mockDb.entries()) {
          if (k.startsWith(prefix) && !k.slice(prefix.length).includes("/")) {
            docs.push(toFirestoreDocJson(k, v));
          }
        }
        if (docs.length > 0 || url.includes("pageSize=")) {
          return new Response(JSON.stringify({ documents: docs }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
        return new Response("Not Found", { status: 404 });
      }

      return new Response("Method Not Allowed", { status: 405 });
    }) as typeof fetch;
  };

  const seedHotel = (hotelId: string, configOverrides: Record<string, any> = {}) => {
    mockDb.set(`hotels/${hotelId}`, {
      id: hotelId,
      name: "Tide Grand Hotel",
      branding: {
        organizationName: "Tide Grand Hotel",
        primaryColor: "#0f766e",
        email: "ops@tidegrand.example",
      },
      timezone: "Africa/Lagos",
    });
    mockDb.set(`hotels/${hotelId}/rooms/r101`, {
      id: "r101",
      number: "101",
      type: "Deluxe",
      status: "occupied",
      housekeepingStatus: "clean",
    });
    mockDb.set(`hotels/${hotelId}/rooms/r102`, {
      id: "r102",
      number: "102",
      type: "Standard",
      status: "available",
      housekeepingStatus: "inspected",
    });
    mockDb.set(`hotels/${hotelId}/dailyOpsReportConfig/default`, {
      hotelId,
      enabled: true,
      scheduledTime: "14:30",
      timezone: "Africa/Lagos",
      recipients: [
        { id: "r1", email: "gm@tidegrand.example", name: "General Manager", enabled: true },
        { id: "r2", email: "owner@tidegrand.example", name: "Owner", enabled: true },
        { id: "r3", email: "paused@tidegrand.example", name: "Paused Staff", enabled: false },
      ],
      sections: {
        occupancy: true,
        roomStatus: true,
        reservations: true,
        arrivalsDepartures: true,
        housekeeping: true,
        maintenance: true,
        additionalOps: true,
      },
      ...configOverrides,
    });
  };

  try {
    installMockFirestoreFetch();

    await test("1. Session-backed background scheduler waits before scheduled time and fires automatically at set time", async () => {
      mockDb.clear();
      clearRegisteredDailyOpsSessions();
      seedHotel("hotel_auto_1", { enabled: true, scheduledTime: "14:30", timezone: "Africa/Lagos" });
      registerHotelDailyOpsSessionToken("hotel_auto_1", "mock-firebase-bearer-token-123");
      assert.deepStrictEqual(getRegisteredDailyOpsHotelIds(), ["hotel_auto_1"]);

      const sentPayloads: any[] = [];
      const mockSend = async (params: any) => {
        sentPayloads.push(params);
        return {
          success: true,
          deliveryState: "accepted_by_provider" as const,
          provider: "resend" as const,
          statusCode: 200,
          messageId: `msg_${sentPayloads.length}`,
        };
      };

      // 14:29 WAT (13:29 UTC) — 1 minute BEFORE scheduled time -> must NOT send
      const beforeSummary = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T13:29:00.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(beforeSummary.mode, "session_tokens");
      assert.strictEqual(beforeSummary.dueHotels, 0);
      assert.strictEqual(sentPayloads.length, 0);

      // 14:30 WAT (13:30 UTC) — AT scheduled time -> MUST automatically send to both enabled recipients (excluding paused)
      const atTimeSummary = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T13:30:10.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(atTimeSummary.mode, "session_tokens");
      assert.strictEqual(atTimeSummary.dueHotels, 1);
      assert.strictEqual(atTimeSummary.sent, 1);
      assert.strictEqual(sentPayloads.length, 2);
      assert.deepStrictEqual(
        sentPayloads.map((p) => p.to).sort(),
        ["gm@tidegrand.example", "owner@tidegrand.example"]
      );

      // 14:31 WAT (13:31 UTC) — next tick -> strictly idempotent, ZERO duplicates
      const repeatSummary = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T13:31:00.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(repeatSummary.dueHotels, 0);
      assert.strictEqual(sentPayloads.length, 2);
    });

    await test("2. Failed-run automatic retry backoff prevents spam on consecutive 30s ticks", async () => {
      mockDb.clear();
      clearRegisteredDailyOpsSessions();
      seedHotel("hotel_auto_fail", { enabled: true, scheduledTime: "10:00", timezone: "Africa/Lagos" });
      registerHotelDailyOpsSessionToken("hotel_auto_fail", "mock-bearer-token-fail");

      let attempts = 0;
      const failingSender = async () => {
        attempts++;
        return {
          success: false,
          deliveryState: "failed" as const,
          provider: "resend" as const,
          statusCode: 500,
          error: "Temporary SMTP/Resend timeout",
        };
      };

      const first = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T09:05:00.000Z"),
        sendEmailFn: failingSender,
        forceSessionMode: true,
      });
      assert.strictEqual(first.failed, 1);
      assert.strictEqual(attempts, 2); // 2 active recipients attempted once

      // 30 seconds later -> backoff active, must skip without hammering email provider
      const second = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T09:05:30.000Z"),
        sendEmailFn: failingSender,
        forceSessionMode: true,
      });
      assert.strictEqual(second.skipped, 1);
      assert.strictEqual(second.details[0]?.reason, "retry_backoff_active");
      assert.strictEqual(attempts, 2);
    });

    await test("3. Dry-Run Diagnostic performs zero writes and zero sends while verifying readiness & template rendering", async () => {
      mockDb.clear();
      firestoreWriteCount = 0;
      seedHotel("hotel_dry_1", { enabled: true, scheduledTime: "14:30", timezone: "Africa/Lagos" });

      // Before scheduled time -> scheduled_ready
      const diagBefore = await runDailyOpsDryRunDiagnostic({
        hotelId: "hotel_dry_1",
        now: new Date("2026-11-24T13:00:00.000Z"),
        bearerToken: "mock-token",
      });
      assert.strictEqual(diagBefore.dryRun, true);
      assert.strictEqual(diagBefore.emailsSent, 0);
      assert.strictEqual(firestoreWriteCount, 0);
      assert.strictEqual(diagBefore.rendered.ok, true);
      assert.ok((diagBefore.rendered.html || "").includes("Tide Grand Hotel"));
      assert.ok((diagBefore.rendered.htmlBytes || 0) > 500);
      assert.strictEqual(diagBefore.recipients.activeCount, 2);
      assert.strictEqual(diagBefore.recipients.pausedCount, 1);
      if (diagBefore.emailProviderReady) {
        assert.strictEqual(diagBefore.verdict, "scheduled_ready");
        assert.strictEqual(diagBefore.wouldSendNow, false);
      }

      // At scheduled time -> due_now
      const diagDue = await runDailyOpsDryRunDiagnostic({
        hotelId: "hotel_dry_1",
        now: new Date("2026-11-24T13:35:00.000Z"),
        bearerToken: "mock-token",
      });
      assert.strictEqual(diagDue.emailsSent, 0);
      assert.strictEqual(firestoreWriteCount, 0);
      assert.strictEqual(diagDue.schedule.dueNow, true);
      if (diagDue.emailProviderReady) {
        assert.strictEqual(diagDue.verdict, "due_now");
        assert.strictEqual(diagDue.wouldSendNow, true);
      }

      // Disabled -> disabled verdict, still renders template cleanly
      seedHotel("hotel_dry_off", { enabled: false, scheduledTime: "14:30", timezone: "Africa/Lagos" });
      const diagDisabled = await runDailyOpsDryRunDiagnostic({
        hotelId: "hotel_dry_off",
        now: new Date("2026-11-24T13:35:00.000Z"),
        bearerToken: "mock-token",
      });
      assert.strictEqual(diagDisabled.rendered.ok, true);
      assert.strictEqual(firestoreWriteCount, 0);
      if (diagDisabled.emailProviderReady) {
        assert.strictEqual(diagDisabled.verdict, "disabled");
      }
    });

    await test("7. In-memory duplicate guard prevents re-sending even if Firestore write transiently fails after Resend succeeds", async () => {
      mockDb.clear();
      clearRegisteredDailyOpsSessions();
      clearRecentlyDeliveredDailyOps();
      seedHotel("hotel_write_blip", { enabled: true, scheduledTime: "11:00", timezone: "Africa/Lagos" });
      registerHotelDailyOpsSessionToken("hotel_write_blip", "mock-bearer-write-blip");

      let sendCalls = 0;
      const mockSend = async () => {
        sendCalls++;
        return {
          success: true,
          deliveryState: "accepted_by_provider" as const,
          provider: "resend" as const,
          statusCode: 200,
          messageId: `msg_blip_${sendCalls}`,
        };
      };

      failAllFirestoreWrites = true;
      try {
        // First tick at 11:00 WAT (10:00 UTC) sends to both active recipients despite simulated 503 on Firestore write
        const first = await runDailyOpsBackgroundSchedulerPass({
          now: new Date("2026-11-24T10:00:15.000Z"),
          sendEmailFn: mockSend,
          forceSessionMode: true,
        });
        assert.strictEqual(first.sent, 1);
        assert.strictEqual(sendCalls, 2);

        // Next 15s tick at 11:00:30 WAT MUST skip via volatile in-memory duplicate guard (zero duplicate emails!)
        const second = await runDailyOpsBackgroundSchedulerPass({
          now: new Date("2026-11-24T10:00:30.000Z"),
          sendEmailFn: mockSend,
          forceSessionMode: true,
        });
        assert.strictEqual(second.sent, 0);
        assert.strictEqual(second.skipped, 1);
        assert.strictEqual(second.details[0]?.reason, "already_sent");
        assert.strictEqual(sendCalls, 2);
      } finally {
        failAllFirestoreWrites = false;
      }
    });

    await test("8. Updating scheduledTime triggers cleanly at the newly saved minute with zero duplicates across 15s ticks", async () => {
      mockDb.clear();
      clearRegisteredDailyOpsSessions();
      clearRecentlyDeliveredDailyOps();
      seedHotel("hotel_time_change", { enabled: true, scheduledTime: "15:45", timezone: "Africa/Lagos" });
      registerHotelDailyOpsSessionToken("hotel_time_change", "mock-bearer-time-change");

      const sentTo: string[] = [];
      const mockSend = async (params: any) => {
        sentTo.push(params.to);
        return {
          success: true,
          deliveryState: "accepted_by_provider" as const,
          provider: "resend" as const,
          statusCode: 200,
          messageId: `msg_tc_${sentTo.length}`,
        };
      };

      // 15:44:45 WAT (14:44:45 UTC) -> not due yet
      const t1 = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T14:44:45.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(t1.dueHotels, 0);
      assert.strictEqual(sentTo.length, 0);

      // 15:45:00 WAT (14:45:00 UTC) -> fires immediately at the set minute
      const t2 = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T14:45:00.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(t2.sent, 1);
      assert.strictEqual(sentTo.length, 2);

      // 15:45:15 WAT -> zero duplicates
      const t3 = await runDailyOpsBackgroundSchedulerPass({
        now: new Date("2026-11-24T14:45:15.000Z"),
        sendEmailFn: mockSend,
        forceSessionMode: true,
      });
      assert.strictEqual(t3.dueHotels, 0);
      assert.strictEqual(sentTo.length, 2);
    });
  } finally {
    failAllFirestoreWrites = false;
    globalThis.fetch = originalFetch;
    clearRegisteredDailyOpsSessions();
    clearRecentlyDeliveredDailyOps();
  }

  // -------------------------------------------------------------------------
  // PART 2: All Loyalty Tier Benefits in Every Loyalty Email
  // -------------------------------------------------------------------------
  await test("4. All 6 customizable loyalty templates include EVERY default tier & EVERY benefit in HTML & plain text", () => {
    const tierSummary = resolveLoyaltyTierBenefitsForEmail(null, "Gold");
    assert.strictEqual(tierSummary.allTiers.length, SERVER_DEFAULT_LOYALTY_LEVELS.length);
    assert.strictEqual(tierSummary.allTiers.find((t) => t.name === "Gold")?.isCurrent, true);

    const loyaltyEvents: CustomizableEmailEventType[] = [
      "loyalty_account_activated",
      "loyalty_points_awarded",
      "loyalty_points_deducted",
      "loyalty_points_redeemed",
      "loyalty_tier_upgraded",
      "loyalty_points_expiring",
    ];

    const baseCtx: EmailRenderContext = {
      hotelId: "hotel_loy_1",
      hotelName: "Tide Grand Hotel",
      currencyCode: "NGN",
      appUrl: "",
      guestName: "Ada Lovelace",
      loyaltyPointsFormatted: "+500 pts",
      loyaltyPointsEarned: 500,
      loyaltyPointsBalance: 2450,
      loyaltyTier: "Gold",
      previousTier: "Silver",
      loyaltyTierBenefits: tierSummary.currentTierBenefits,
      loyaltyAllTiers: tierSummary.allTiers,
      redemptionValueFormatted: "NGN 5,000.00",
      expiryDate: "2027-01-31",
      transactionDate: "Nov 24, 2026",
      reason: "Completed stay settlement",
    };

    for (const evt of loyaltyEvents) {
      const variant = buildDefaultTemplateVariant(evt, "en");
      const rendered = renderEmailTemplate({ variant, context: baseCtx });
      assert.ok(rendered.html.includes("Current Tier"), `${evt} HTML missing Current Tier badge`);
      assert.ok(rendered.text.includes("(Current Tier)"), `${evt} text missing Current Tier marker`);

      for (const level of SERVER_DEFAULT_LOYALTY_LEVELS) {
        assert.ok(rendered.html.includes(level.name), `${evt} HTML missing tier ${level.name}`);
        assert.ok(rendered.text.includes(level.name), `${evt} text missing tier ${level.name}`);
        for (const benefit of level.benefits) {
          assert.ok(rendered.html.includes(benefit), `${evt} HTML missing benefit "${benefit}"`);
          assert.ok(rendered.text.includes(benefit), `${evt} text missing benefit "${benefit}"`);
        }
      }
    }
  });

  await test("5. Custom hotel loyalty tiers & XSS payloads render safely in all 7 multi-tenant loyalty emails", () => {
    const customHotel: any = {
      id: "hotel_custom_loy",
      name: "Oceanic Resort",
      branding: { primaryColor: "#0284c7" },
      settings: {
        loyalty: {
          enabled: true,
          membershipLevels: [
            {
              id: "t1",
              name: "Bronze Member",
              minPoints: 0,
              color: "#92400e",
              benefits: ["Free bottled water", "Digital receipt perks"],
            },
            {
              id: "t2",
              name: "Sapphire <script>alert(1)</script>",
              minPoints: 1500,
              color: "#2563eb",
              benefits: ["Free airport pickup", "Spa 15% discount <img src=x onerror=alert(2)>"],
            },
            {
              id: "t3",
              name: "Diamond VIP",
              minPoints: 10000,
              color: "#7c3aed",
              benefits: ["Presidential suite priority", "Private butler service", "Unlimited lounge access"],
            },
          ],
        },
      },
    };

    const tierSummary = resolveLoyaltyTierBenefitsForEmail(customHotel, "Diamond VIP");
    assert.strictEqual(tierSummary.allTiers.length, 3);
    assert.strictEqual(tierSummary.currentTierBenefits.length, 3);

    const brand = resolveHotelBrandContext("hotel_custom_loy", customHotel, "https://oceanic.example");
    const extraHtml = renderLoyaltyTierBenefitsHtml(tierSummary.allTiers, brand.primaryColor);
    const extraText = renderLoyaltyTierBenefitsText(tierSummary.allTiers);

    const all7Events: MultiTenantEmailEventType[] = [
      "loyalty.account_activated",
      "loyalty.points_awarded",
      "loyalty.points_deducted",
      "loyalty.points_redeemed",
      "loyalty.tier_upgraded",
      "loyalty.points_expiring",
      "loyalty.points_expired",
    ];

    for (const evt of all7Events) {
      const email = renderMultiTenantEmail(evt, brand, {
        recipientName: "Chinedu Okafor",
        rows: [
          { label: "Hotel", value: brand.hotelName },
          { label: "Membership Level", value: "Diamond VIP" },
          { label: "Current Tier Benefits", value: tierSummary.currentTierBenefitsText },
        ],
        extraHtml,
        extraText,
      });

      // All custom tiers & benefits present
      assert.ok(email.html.includes("Bronze Member"), `${evt} missing Bronze Member`);
      assert.ok(email.html.includes("Free bottled water"), `${evt} missing Bronze benefit`);
      assert.ok(email.html.includes("Free airport pickup"), `${evt} missing Sapphire benefit`);
      assert.ok(email.html.includes("Presidential suite priority"), `${evt} missing Diamond benefit 1`);
      assert.ok(email.html.includes("Private butler service"), `${evt} missing Diamond benefit 2`);
      assert.ok(email.html.includes("Unlimited lounge access"), `${evt} missing Diamond benefit 3`);
      assert.ok(email.text.includes("Unlimited lounge access"), `${evt} plain text missing Diamond benefit 3`);

      // Strict XSS escaping verified
      assert.ok(!email.html.includes("<script>"), `${evt} failed to escape <script> tag`);
      assert.ok(!email.html.includes("<img src=x onerror="), `${evt} failed to escape raw <img> tag`);
      assert.ok(email.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), `${evt} missing escaped script text`);
    }
  });

  await test("6. Non-loyalty emails do NOT display loyalty tier benefit sections", () => {
    const variant = buildDefaultTemplateVariant("booking_confirmation", "en");
    const nonLoyaltyCtx: EmailRenderContext = {
      hotelId: "hotel_non_loy",
      hotelName: "Tide Grand Hotel",
      currencyCode: "NGN",
      appUrl: "",
      guestName: "Jane Doe",
      bookingReference: "RES12345",
      roomName: "Room 301",
      checkInDate: "2026-12-01",
      checkOutDate: "2026-12-03",
      totalAmount: 150000,
    };
    const rendered = renderEmailTemplate({ variant, context: nonLoyaltyCtx });
    assert.ok(!rendered.html.includes("Loyalty Membership Tiers &amp; Benefits"));
    assert.ok(!rendered.text.includes("Loyalty Membership Tiers & Benefits"));
  });

  console.log(`\nSummary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch((err) => {
  console.error("Test suite fatal error:", err);
  process.exit(1);
});
