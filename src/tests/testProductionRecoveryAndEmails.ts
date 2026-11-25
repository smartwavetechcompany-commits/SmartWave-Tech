import assert from "node:assert/strict";
import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  type CustomizableEmailEventType,
  type EmailRenderContext,
} from "../modules/emailCustomization/shared/types.ts";
import {
  EMAIL_EVENT_CATALOG,
  buildDefaultTemplateVariant,
} from "../modules/emailCustomization/shared/defaultTemplates.ts";
import { renderEmailTemplate } from "../modules/emailCustomization/shared/renderer.ts";
import { buildSamplePreviewContext } from "../modules/emailCustomization/server/defaultTemplates.ts";
import { normalizeHotelEmailEvent } from "../modules/emailCustomization/server/templateRegistry.ts";
import { computeEmailFinancialBreakdown } from "../modules/emailCustomization/shared/financialEmailBreakdown.ts";
import {
  renderMultiTenantEmail,
  resolveHotelBrandContext,
} from "../services/multiTenantEmailService.ts";
import {
  buildBookingConfirmationEmail,
  buildBookingCancellationEmail,
} from "../services/emailService.ts";
import {
  canCheckout,
  canCheckIn,
  canApplyDiscount,
  canEditInvoice,
  canBlockRoom,
  canManageGuest,
  canUpdateRoomStatus,
} from "../utils/policyUtils.ts";
import type { Hotel, Reservation, Room, UserProfile } from "../types.ts";

let passed = 0;
let failed = 0;

function runTest(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (err: any) {
    console.error(`  FAIL  ${name}`);
    console.error(`        ${err?.message || err}`);
    failed++;
  }
}

console.log("\n=== Phase 2, 3, 4, 5 Production Recovery & Email/Policy Verification ===\n");

// ---------------------------------------------------------------------------
// PHASE 2: COMPLETE EMAIL TEMPLATE CATALOG & ZERO UNWANTED PMS URL EXPOSURE
// ---------------------------------------------------------------------------

runTest("Phase 2.1: All 45 automated email events are registered and render cleanly in EN & DE with zero unresolved {{...}} tags", () => {
  assert.equal(CUSTOMIZABLE_EMAIL_EVENTS.length, 45, "Expected 45 customizable email events");

  const sampleHotel = {
    name: "Grand Oasis Hotel",
    branding: {
      organizationName: "Grand Oasis Hotel",
      primaryColor: "#059669",
      secondaryColor: "#18181b",
    },
    defaultCurrency: "NGN",
    email: "concierge@grandoasis.example",
    phone: "+234 800 123 4567",
    address: "12 Marina Boulevard, Lagos",
  };

  const baseCtx = buildSamplePreviewContext(
    "hotel-oasis",
    sampleHotel,
    "https://tidehotels.de",
    { includeLoyaltySample: true }
  );

  for (const eventType of CUSTOMIZABLE_EMAIL_EVENTS) {
    const entry = EMAIL_EVENT_CATALOG[eventType];
    assert.ok(entry, `Catalog entry missing for ${eventType}`);

    for (const lang of ["en", "de"] as const) {
      const variant = buildDefaultTemplateVariant(eventType, lang, {
        primaryColor: "#059669",
        secondaryColor: "#18181b",
      });
      const rendered = renderEmailTemplate({
        variant,
        context: baseCtx,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: lang,
      });

      assert.ok(rendered.subject.trim().length > 0, `Empty subject for ${eventType} (${lang})`);
      assert.ok(rendered.html.trim().length > 100, `Empty HTML for ${eventType} (${lang})`);
      assert.ok(rendered.text.trim().length > 20, `Empty text for ${eventType} (${lang})`);

      // Zero unresolved {{...}} placeholders
      assert.equal(
        /\{\{[^}]+\}\}/.test(rendered.subject),
        false,
        `Unresolved placeholder in subject for ${eventType} (${lang}): ${rendered.subject}`
      );
      assert.equal(
        /\{\{[^}]+\}\}/.test(rendered.html),
        false,
        `Unresolved placeholder in HTML for ${eventType} (${lang})`
      );
      assert.equal(
        /\{\{[^}]+\}\}/.test(rendered.text),
        false,
        `Unresolved placeholder in text for ${eventType} (${lang})`
      );

      // Guest & Corporate emails MUST NEVER leak tidehotels.de or "Open Portal" / "Hotel Portal"
      if (entry.audience === "guest" || entry.audience === "corporate") {
        assert.equal(
          rendered.html.toLowerCase().includes("tidehotels.de"),
          false,
          `Guest/corporate HTML for ${eventType} (${lang}) leaked PMS URL tidehotels.de`
        );
        assert.equal(
          rendered.text.toLowerCase().includes("tidehotels.de"),
          false,
          `Guest/corporate text for ${eventType} (${lang}) leaked PMS URL tidehotels.de`
        );
        assert.equal(
          rendered.html.includes("Open Portal"),
          false,
          `Guest/corporate HTML for ${eventType} (${lang}) contained 'Open Portal'`
        );
      }
    }
  }
});

runTest("Phase 2.2: Security-critical staff activation & password reset preserve action_link and cannot be disabled", () => {
  assert.equal(EMAIL_EVENT_CATALOG.staff_account_activation.canDisable, false);
  assert.equal(EMAIL_EVENT_CATALOG.staff_password_reset.canDisable, false);

  const ctx: EmailRenderContext = {
    hotelId: "hotel-sec",
    hotelName: "Crown Suites",
    currencyCode: "NGN",
    appUrl: "https://tidehotels.de",
    staffName: "Chidi Okafor",
    actionLink: "https://tidehotels.de/activate-account?token=sec_tok_123",
    expiryDate: "24 hours",
  };

  for (const ev of ["staff_account_activation", "staff_password_reset"] as const) {
    const variant = buildDefaultTemplateVariant(ev, "en");
    const rendered = renderEmailTemplate({ variant, context: ctx, language: "en" });
    assert.ok(
      rendered.html.includes(ctx.actionLink!),
      `${ev} HTML must contain the security action link`
    );
    assert.ok(
      rendered.text.includes(ctx.actionLink!),
      `${ev} text must contain the security action link`
    );
  }
});

runTest("Phase 2.3: Multi-tenant fallback & emailService builders never inject PMS appUrl into guest emails", () => {
  const brand = resolveHotelBrandContext(
    "hotel-a",
    { name: "Seaside Resort", email: "info@seaside.example" },
    "https://tidehotels.de"
  );
  assert.equal(brand.website, "", "brand.website must NOT fall back to PMS appUrl");

  const mt = renderMultiTenantEmail("payment.received", brand, {
    recipientName: "Ada Lovelace",
    rows: [{ label: "Amount Paid", value: "NGN 80,000" }],
  });
  assert.equal(mt.html.includes("tidehotels.de"), false, "renderMultiTenantEmail leaked PMS URL");
  assert.equal(mt.text.includes("Open Portal"), false, "renderMultiTenantEmail leaked Open Portal");

  const confirm = buildBookingConfirmationEmail({
    hotelName: "Seaside Resort",
    guestName: "Ada Lovelace",
    bookingRef: "ABC12345",
    roomLabel: "Deluxe King (Room 204)",
    checkIn: "2026-12-01",
    checkOut: "2026-12-03",
    appUrl: "https://tidehotels.de",
  });
  assert.equal(confirm.html.includes("tidehotels.de"), false, "Booking confirmation leaked PMS URL");
  assert.equal(confirm.text.includes("tidehotels.de"), false, "Booking confirmation text leaked PMS URL");

  const cancel = buildBookingCancellationEmail({
    hotelName: "Seaside Resort",
    guestName: "Ada Lovelace",
    bookingRef: "ABC12345",
    roomLabel: "Deluxe King (Room 204)",
    checkIn: "2026-12-01",
    checkOut: "2026-12-03",
    appUrl: "https://tidehotels.de",
  });
  assert.equal(cancel.html.includes("tidehotels.de"), false, "Booking cancellation leaked PMS URL");
});

runTest("Phase 2.4: Event alias mapping covers deposit, billing, loyalty, corporate, and operations events", () => {
  const pairs: Array<[string, CustomizableEmailEventType]> = [
    ["deposit.received", "deposit_received"],
    ["payment.received", "payment_receipt"],
    ["invoice.issued", "invoice_issued"],
    ["receipt.sent", "receipt_sent"],
    ["refund.processed", "refund_processed"],
    ["loyalty.points_awarded", "loyalty_points_awarded"],
    ["loyalty.points_redeemed", "loyalty_points_redeemed"],
    ["loyalty.tier_upgraded", "loyalty_tier_upgraded"],
    ["corporate.account_created", "corporate_account_created"],
    ["corporate.payment_settled", "corporate_payment_settled"],
    ["housekeeping.room_ready", "housekeeping_room_ready"],
    ["maintenance.issue_reported", "maintenance_issue_reported"],
    ["fnb.order_posted", "fnb_order_posted"],
    ["staff.account_status_changed", "staff_account_status_changed"],
    ["reservation.room_transferred", "room_transferred"],
    ["reservation.stay_extended", "stay_extended"],
    ["folio.charge_posted", "folio_charge_posted"],
    ["folio.charge_voided", "folio_charge_voided"],
    ["folio.discount_applied", "folio_discount_applied"],
    ["folio.balance_transferred", "folio_balance_transferred"],
    ["loyalty.points_expired", "loyalty_points_expired"],
  ];
  for (const [alias, expected] of pairs) {
    assert.equal(normalizeHotelEmailEvent(alias), expected, `Failed alias mapping for ${alias}`);
  }
});

// ---------------------------------------------------------------------------
// PHASE 3: DISCOUNT & SETTLEMENT FINANCIAL EMAIL ACCURACY
// ---------------------------------------------------------------------------

runTest("Phase 3.1: Fully settled discounted stay (100,000 - 20,000 discount, 80,000 paid) shows ₦0 remaining balance and Fully Settled", () => {
  const breakdown = computeEmailFinancialBreakdown({
    reservation: {
      totalAmount: 100000,
      totalDiscount: 20000,
      paidAmount: 80000,
      status: "checked_in",
    },
    paymentAmount: 80000,
  });

  assert.equal(breakdown.originalAmount, 100000);
  assert.equal(breakdown.discountAmount, 20000);
  assert.equal(breakdown.netPayableAmount, 80000);
  assert.equal(breakdown.amountPaid, 80000);
  assert.equal(breakdown.remainingBalance, 0, "Discount must NEVER appear as remaining balance");
  assert.equal(breakdown.paymentStatus, "Fully Settled");

  // Also verify rendered payment_receipt template reflects 0 balance and discount granted
  const variant = buildDefaultTemplateVariant("payment_receipt", "en");
  const rendered = renderEmailTemplate({
    variant,
    context: {
      hotelId: "hotel-1",
      hotelName: "Lagos Grand",
      appUrl: "https://tidehotels.de",
      currencyCode: "NGN",
      guestName: "Tunde Bakare",
      bookingReference: "RES8899",
      originalAmount: breakdown.originalAmount,
      discountAmount: breakdown.discountAmount,
      amountPaid: breakdown.amountPaid,
      balanceDue: breakdown.remainingBalance,
      paymentStatus: breakdown.paymentStatus,
      paymentMethod: "CARD",
    },
    language: "en",
  });
  assert.ok(rendered.text.includes("Original Amount: NGN 100,000"), "Should show original amount");
  assert.ok(rendered.text.includes("Discount Granted: NGN 20,000"), "Should show discount granted");
  assert.ok(rendered.text.includes("Amount Paid / Settled: NGN 80,000"), "Should show amount paid / settled");
  assert.ok(rendered.text.includes("Remaining Balance: NGN 0"), "Should show NGN 0 remaining balance");
  assert.ok(rendered.text.includes("Payment Status: Fully Settled"), "Should show Fully Settled");
  assert.equal(rendered.html.includes("tidehotels.de"), false, "Receipt email must not leak PMS URL");
});

runTest("Phase 3.2: Partially settled discounted stay (100,000 - 20,000 discount, 50,000 paid) shows genuine 30,000 remaining balance", () => {
  const breakdown = computeEmailFinancialBreakdown({
    reservation: {
      totalAmount: 100000,
      totalDiscount: 20000,
      paidAmount: 50000,
      status: "checked_in",
    },
    paymentAmount: 50000,
  });

  assert.equal(breakdown.originalAmount, 100000);
  assert.equal(breakdown.discountAmount, 20000);
  assert.equal(breakdown.netPayableAmount, 80000);
  assert.equal(breakdown.amountPaid, 50000);
  assert.equal(breakdown.remainingBalance, 30000);
  assert.equal(breakdown.paymentStatus, "Partially Paid");
});

runTest("Phase 3.3: No-Show reservation without penalty shows 0 remaining balance", () => {
  const breakdown = computeEmailFinancialBreakdown({
    reservation: {
      totalAmount: 141500,
      paidAmount: 0,
      status: "no_show",
    },
  });
  assert.equal(breakdown.remainingBalance, 0);
  assert.equal(breakdown.paymentStatus, "No Balance Due");
});

// ---------------------------------------------------------------------------
// PHASE 4: GUEST ACCOUNT DEPOSIT EMAIL NOTIFICATION
// ---------------------------------------------------------------------------

runTest("Phase 4.1: Deposit Received template renders guest name, hotel name, amount, date, reference, updated balance & zero PMS URL", () => {
  const variant = buildDefaultTemplateVariant("deposit_received", "en");
  const rendered = renderEmailTemplate({
    variant,
    context: {
      hotelId: "hotel-dep",
      hotelName: "Eko Palm Suites",
      hotelEmail: "billing@ekopalm.example",
      appUrl: "https://tidehotels.de",
      currencyCode: "NGN",
      guestName: "Amaka Nwosu",
      depositAmount: 150000,
      transactionDate: "2026-11-22",
      transactionReference: "DEP-2026-0091",
      paymentMethod: "BANK TRANSFER",
      depositBalance: 225000,
    },
    language: "en",
  });

  assert.equal(rendered.subject, "Deposit Received – Eko Palm Suites");
  assert.ok(rendered.text.includes("Amaka Nwosu"), "Must include guest name");
  assert.ok(rendered.text.includes("Eko Palm Suites"), "Must include hotel name");
  assert.ok(rendered.text.includes("NGN 150,000"), "Must include deposit amount");
  assert.ok(rendered.text.includes("2026-11-22"), "Must include deposit date");
  assert.ok(rendered.text.includes("DEP-2026-0091"), "Must include deposit reference");
  assert.ok(rendered.text.includes("NGN 225,000"), "Must include updated deposit balance");
  assert.equal(rendered.html.includes("tidehotels.de"), false, "Deposit email must NOT contain PMS URL");
});

// ---------------------------------------------------------------------------
// PHASE 5: DYNAMIC ADMIN CONTROL POLICY ERROR MESSAGES
// ---------------------------------------------------------------------------

const makeHotel = (settingsOverrides: any, currency = "NGN"): Hotel =>
  ({
    id: "hotel-pol-1",
    name: "Test Policy Hotel",
    defaultCurrency: currency,
    defaultCheckInTime: "14:00",
    settings: settingsOverrides,
  } as unknown as Hotel);

const staffProfile: UserProfile = {
  uid: "staff-1",
  email: "frontdesk@hotel.test",
  role: "staff",
  staffRole: "receptionist",
  hotelId: "hotel-pol-1",
  permissions: [
    "check_in_guests",
    "check_out_guests",
    "edit_reservations",
    "cancel_reservations",
    "change_room_status",
    "edit_guests",
    "delete_guests",
  ],
} as unknown as UserProfile;

runTest("Phase 5.1: Checkout blocked by Hard Pay-First Rule dynamically names exact Admin Control Policy & balance", () => {
  const hotel = makeHotel({
    checkout: { requireFullPaymentBeforeCheckout: true, allowBalanceOutstanding: false },
  });
  const res = {
    id: "r1",
    guestName: "John Doe",
    status: "checked_in",
    totalAmount: 100000,
    paidAmount: 40000,
    ledgerBalance: 60000,
    checkIn: "2026-11-20",
    checkOut: "2026-11-22",
  } as unknown as Reservation;

  const result = canCheckout(hotel, staffProfile, res);
  assert.equal(result.allowed, false);
  assert.ok(result.detail, "Must include structured policy detail");
  assert.equal(result.detail!.title, "Operation Blocked by Hotel Policy");
  assert.ok(result.detail!.policyName.includes("Hard Pay-First Rule"));
  assert.ok(result.detail!.policySection.includes("Checkout Policies"));
  assert.ok(result.detail!.reason.includes("60,000"));
  assert.ok(result.detail!.suggestedAction.length > 10);
});

runTest("Phase 5.2: Check-in blocked by Dirty Room Hygiene policy dynamically names Strict Hygiene Check", () => {
  const hotel = makeHotel({
    checkIn: { preventCheckInDirty: true, allowEarlyCheckIn: true },
  });
  const res = {
    id: "r2",
    roomId: "rm1",
    roomNumber: "204",
    guestName: "Jane Doe",
    status: "confirmed",
    totalAmount: 50000,
    paidAmount: 50000,
    checkIn: "2026-11-20",
    checkOut: "2026-11-22",
  } as unknown as Reservation;
  const dirtyRoom = {
    id: "rm1",
    roomNumber: "204",
    status: "dirty",
    housekeepingStatus: "dirty",
  } as unknown as Room;

  const result = canCheckIn(hotel, staffProfile, res, dirtyRoom);
  assert.equal(result.allowed, false);
  assert.ok(result.detail!.policyName.includes("Strict Hygiene Check"));
  assert.ok(result.detail!.policySection.includes("Check-In Protocols"));
  assert.ok(result.detail!.reason.includes("204"));
});

runTest("Phase 5.3: Discount above hotel-configured threshold dynamically reflects exact hotel percentage (e.g. 15% vs 25%)", () => {
  const hotel15 = makeHotel({
    financial: {
      allowDiscounts: true,
      requireApprovalForLargeDiscounts: true,
      largeDiscountThreshold: 15,
    },
  });
  const hotel25 = makeHotel({
    financial: {
      allowDiscounts: true,
      requireApprovalForLargeDiscounts: true,
      largeDiscountThreshold: 25,
    },
  });

  const block15 = canApplyDiscount(hotel15, staffProfile, 20000, 100000);
  assert.equal(block15.allowed, false);
  assert.ok(block15.detail!.configuredCondition?.includes("15%"));
  assert.ok(block15.detail!.policySection.includes("Accounting Policies"));

  // Under hotel25, 20% discount is allowed (confirms dynamic hotel settings, zero logic change!)
  const ok25 = canApplyDiscount(hotel25, staffProfile, 20000, 100000);
  assert.equal(ok25.allowed, true);
});

runTest("Phase 5.4: Locked invoice after checkout, room block duration, dirty-to-clean & guest edit restriction all return structured details", () => {
  const hotel = makeHotel({
    financial: { lockInvoicesAfterCheckout: true },
    roomBlocking: { allowBlocking: true, allowMaintenanceBlocks: true, maxBlockDuration: 7 },
    housekeeping: { allowStatusUpdates: true, allowDirtyToCleanChanges: false },
    guests: { allowProfileEditing: false },
  });

  const invRes = canEditInvoice(
    hotel,
    staffProfile,
    { id: "r3", status: "checked_out", ledgerBalance: 0 } as unknown as Reservation
  );
  assert.equal(invRes.allowed, false);
  assert.equal(invRes.detail!.policyName, "Lock Invoices After Checkout");

  const blockRes = canBlockRoom(hotel, staffProfile, "2026-12-01", "2026-12-15", "maintenance");
  assert.equal(blockRes.allowed, false);
  assert.equal(blockRes.detail!.policyName, "Maximum Block Duration (Days)");
  assert.ok(blockRes.detail!.configuredCondition?.includes("7"));

  const hkRes = canUpdateRoomStatus(
    hotel,
    staffProfile,
    { id: "rm2", roomNumber: "305", status: "dirty" } as unknown as Room,
    "clean"
  );
  assert.equal(hkRes.allowed, false);
  assert.equal(hkRes.detail!.policyName, "Enable Dirty-to-Clean Flow");

  const guestRes = canManageGuest(hotel, staffProfile, "edit");
  assert.equal(guestRes.allowed, false);
  assert.equal(guestRes.detail!.policyName, "Enable Profile Updates");
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
