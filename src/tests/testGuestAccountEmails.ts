import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveHotelBrandContext,
  isHotelEmailEventEnabled,
  resolveHotelOperationalRecipients,
  renderMultiTenantEmail,
  type MultiTenantEmailEventType,
} from "../services/multiTenantEmailService.ts";
import { resolveNotificationEventFinancials } from "../modules/emailCustomization/shared/financialEmailBreakdown.ts";
import {
  EMAIL_EVENT_CATALOG,
  buildDefaultTemplateVariant,
} from "../modules/emailCustomization/shared/defaultTemplates.ts";
import { renderEmailTemplate } from "../modules/emailCustomization/shared/renderer.ts";
import {
  isCustomizableEvent,
  normalizeHotelEmailEvent,
} from "../modules/emailCustomization/server/templateRegistry.ts";
import { validateTemplateVariant } from "../modules/emailCustomization/shared/validation.ts";
import {
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  type CustomizableEmailEventType,
  type EmailRenderContext,
} from "../modules/emailCustomization/shared/types.ts";

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

console.log("=== Running Guest Account & Folio Activity Email Test Suite ===");

const sampleHotelDoc = {
  name: "Grand Horizon Suites",
  defaultCurrency: "NGN",
  branding: {
    logoUrl: "https://cdn.grandhorizon.example/logo.png",
    primaryColor: "#1d4ed8",
    secondaryColor: "#1e3a8a",
    address: "15 Marina Road, Lagos",
    phone: "+234-800-555-0123",
    email: "concierge@grandhorizon.example",
    website: "https://grandhorizon.example",
    footerNotes: "Grand Horizon Guest Services",
  },
  emailConfig: {
    senderDisplayName: "Grand Horizon Front Desk",
    replyToEmail: "frontdesk@grandhorizon.example",
  },
};

const brand = resolveHotelBrandContext(
  "hotel-horizon",
  sampleHotelDoc,
  "https://internal-pms.example"
);

const NEW_GUEST_ACCOUNT_EVENTS: MultiTenantEmailEventType[] = [
  "folio.charge_posted",
  "folio.charge_voided",
  "folio.discount_applied",
  "folio.balance_transferred",
  "reservation.room_transferred",
  "reservation.stay_extended",
];

runTest("1. All 6 new guest account events render branded emails with expected headings and rows", () => {
  const cases: {
    event: MultiTenantEmailEventType;
    rows: { label: string; value: string }[];
    expectedFragments: string[];
  }[] = [
    {
      event: "folio.charge_posted",
      rows: [
        { label: "Room", value: "305" },
        { label: "Category", value: "Laundry" },
        { label: "Item / Description", value: "Express Suit Pressing" },
        { label: "Charge Amount", value: "NGN 12,500" },
        { label: "Updated Remaining Balance", value: "NGN 42,500" },
      ],
      expectedFragments: ["Express Suit Pressing", "NGN 12,500", "NGN 42,500", "Grand Horizon Suites"],
    },
    {
      event: "folio.charge_voided",
      rows: [
        { label: "Room", value: "305" },
        { label: "Reversed Item", value: "Reversal: Mini Bar Soda" },
        { label: "Adjustment Amount", value: "NGN 3,000" },
        { label: "Updated Remaining Balance", value: "NGN 39,500" },
      ],
      expectedFragments: ["Reversal: Mini Bar Soda", "NGN 3,000", "NGN 39,500"],
    },
    {
      event: "folio.discount_applied",
      rows: [
        { label: "Room", value: "305" },
        { label: "Description", value: "VIP Returning Guest Discount (10%)" },
        { label: "Discount / Credit Amount", value: "NGN 10,000" },
        { label: "Updated Remaining Balance", value: "NGN 29,500" },
      ],
      expectedFragments: ["VIP Returning Guest Discount (10%)", "NGN 10,000", "NGN 29,500"],
    },
    {
      event: "folio.balance_transferred",
      rows: [
        { label: "Booking Reference", value: "RES-7788" },
        { label: "Transfer Amount", value: "NGN 29,500" },
        { label: "Destination", value: "Acme Corporate City Ledger" },
      ],
      expectedFragments: ["RES-7788", "NGN 29,500", "Acme Corporate City Ledger"],
    },
    {
      event: "reservation.room_transferred",
      rows: [
        { label: "Previous Room", value: "305 (Deluxe King)" },
        { label: "New Room", value: "501 (Executive Suite)" },
        { label: "Rate Difference", value: "+NGN 25,000" },
        { label: "Updated Stay Total", value: "NGN 175,000" },
      ],
      expectedFragments: ["305 (Deluxe King)", "501 (Executive Suite)", "+NGN 25,000", "NGN 175,000"],
    },
    {
      event: "reservation.stay_extended",
      rows: [
        { label: "Room", value: "501" },
        { label: "Previous Check-Out", value: "2026-11-27" },
        { label: "New Check-Out", value: "2026-11-29" },
        { label: "Additional Nights", value: "2" },
        { label: "Additional Charge", value: "NGN 120,000" },
      ],
      expectedFragments: ["2026-11-27", "2026-11-29", "NGN 120,000"],
    },
  ];

  for (const tc of cases) {
    const rendered = renderMultiTenantEmail(tc.event, brand, {
      recipientName: "Amina Bello",
      rows: tc.rows,
    });

    assert.equal(rendered.fromName, "Grand Horizon Front Desk");
    assert.equal(rendered.replyTo, "frontdesk@grandhorizon.example");
    assert.ok(rendered.subject.includes("Grand Horizon Suites"), `Subject missing hotel name for ${tc.event}`);
    assert.ok(rendered.html.includes("#1d4ed8"), `HTML missing brand color for ${tc.event}`);
    assert.ok(rendered.html.includes("Amina Bello"), `HTML missing guest name for ${tc.event}`);
    assert.ok(
      !rendered.html.includes("https://internal-pms.example"),
      `Guest email for ${tc.event} must not leak internal PMS URL`
    );
    assert.ok(
      !rendered.text.includes("https://internal-pms.example"),
      `Guest text email for ${tc.event} must not leak internal PMS URL`
    );

    for (const fragment of tc.expectedFragments) {
      assert.ok(
        rendered.html.includes(fragment) && rendered.text.includes(fragment),
        `Missing expected fragment "${fragment}" in ${tc.event}`
      );
    }
  }
});

runTest("2. Restaurant payment & room-charge order notifications render cleanly for guests", () => {
  const fnbCharge = renderMultiTenantEmail("fnb.order_posted", brand, {
    recipientName: "Amina Bello",
    rows: [
      { label: "Hotel", value: "Grand Horizon Suites" },
      { label: "Room", value: "501" },
      { label: "Order Reference", value: "ORD-9021" },
      { label: "Items", value: "2x Grilled Salmon, 1x Fresh Juice" },
      { label: "Amount Charged", value: "NGN 34,000" },
      { label: "Updated Remaining Balance", value: "NGN 63,500" },
    ],
  });
  assert.ok(fnbCharge.html.includes("2x Grilled Salmon, 1x Fresh Juice"));
  assert.ok(fnbCharge.html.includes("NGN 63,500"));
  assert.ok(!fnbCharge.html.includes("https://internal-pms.example"));

  const restaurantPayment = renderMultiTenantEmail("payment.received", brand, {
    recipientName: "Amina Bello",
    rows: [
      { label: "Outlet", value: "Skyline Restaurant & Bar" },
      { label: "Bill Reference", value: "BILL-445" },
      { label: "Amount Paid", value: "NGN 18,500" },
      { label: "Payment Method", value: "Guest Deposit" },
      { label: "Remaining Deposit Balance", value: "NGN 81,500" },
    ],
  });
  assert.ok(restaurantPayment.html.includes("Skyline Restaurant &amp; Bar"));
  assert.ok(restaurantPayment.html.includes("NGN 81,500"));
  assert.ok(!restaurantPayment.html.includes("https://internal-pms.example"));
});

runTest("3. XSS / HTML injection escaping on all dynamic guest account fields", () => {
  const maliciousPayload = `<script>alert("xss")</script><img src=x onerror=alert(1)>`;
  for (const event of NEW_GUEST_ACCOUNT_EVENTS) {
    const rendered = renderMultiTenantEmail(event, brand, {
      recipientName: `Guest ${maliciousPayload}`,
      rows: [
        { label: "Room", value: `<b>501</b> ${maliciousPayload}` },
        { label: "Description", value: maliciousPayload },
      ],
      note: `Reason: ${maliciousPayload}`,
    });

    assert.ok(!rendered.html.includes("<script>"), `Unescaped <script> found in ${event}`);
    assert.ok(!rendered.html.includes("<img src=x"), `Unescaped <img> found in ${event}`);
    assert.ok(rendered.html.includes("&lt;script&gt;"), `Expected escaped script tag in ${event}`);
  }
});

runTest("4. Guest email preferences & per-event overrides respected for all new events", () => {
  const guestsMutedHotel = {
    settings: {
      guests: { allowEmailCommunication: false },
    },
  };
  const selectiveOverrideHotel = {
    settings: {
      guests: { allowEmailCommunication: true },
    },
    emailConfig: {
      enabledEvents: {
        "folio.charge_posted": false,
        "reservation.room_transferred": true,
      },
    },
  };

  for (const event of NEW_GUEST_ACCOUNT_EVENTS) {
    assert.equal(
      isHotelEmailEventEnabled(guestsMutedHotel, event, "guest").enabled,
      false,
      `${event} should be disabled when guests.allowEmailCommunication is false`
    );
    assert.equal(
      isHotelEmailEventEnabled({ settings: { guests: { allowEmailCommunication: true } } }, event, "guest").enabled,
      true,
      `${event} should be enabled by default when guest email communication is allowed`
    );
  }

  assert.equal(
    isHotelEmailEventEnabled(selectiveOverrideHotel, "folio.charge_posted", "guest").enabled,
    false
  );
  assert.equal(
    isHotelEmailEventEnabled(selectiveOverrideHotel, "reservation.room_transferred", "guest").enabled,
    true
  );
});

runTest("5. Operational recipient routing handles all 6 new event types safely", () => {
  const staffPool = [
    { email: "frontdesk@grandhorizon.example", role: "staff", staffRole: "receptionist", status: "active" },
    { email: "accounts@grandhorizon.example", role: "staff", staffRole: "accountant", status: "active" },
    { email: "hk@grandhorizon.example", role: "staff", staffRole: "housekeeper", status: "active" },
  ];

  const roomTransferStaff = resolveHotelOperationalRecipients(
    sampleHotelDoc,
    "reservation.room_transferred",
    staffPool
  );
  assert.ok(roomTransferStaff.includes("frontdesk@grandhorizon.example"));
  assert.ok(!roomTransferStaff.includes("hk@grandhorizon.example"));

  const chargeStaff = resolveHotelOperationalRecipients(
    sampleHotelDoc,
    "folio.charge_posted",
    staffPool
  );
  assert.ok(chargeStaff.includes("accounts@grandhorizon.example"));
  assert.ok(!chargeStaff.includes("hk@grandhorizon.example"));
});

runTest("6. Server & client wiring invariants (all guest account triggers present & safe)", () => {
  const serverSource = fs.readFileSync(path.join(projectRoot, "server.ts"), "utf8");
  for (const event of NEW_GUEST_ACCOUNT_EVENTS) {
    assert.ok(
      serverSource.includes(`"${event}"`),
      `server.ts missing allowed/handler support for ${event}`
    );
  }

  const ledgerSource = fs.readFileSync(path.join(projectRoot, "src/services/ledgerService.ts"), "utf8");
  assert.ok(ledgerSource.includes("'folio.charge_posted'"), "ledgerService missing folio.charge_posted");
  assert.ok(ledgerSource.includes("'folio.charge_voided'"), "ledgerService missing folio.charge_voided");
  assert.ok(ledgerSource.includes("'folio.discount_applied'"), "ledgerService missing folio.discount_applied");
  assert.ok(ledgerSource.includes("'folio.balance_transferred'"), "ledgerService missing folio.balance_transferred");
  assert.ok(ledgerSource.includes("'fnb.order_posted'"), "ledgerService missing fnb.order_posted");

  const depositSource = fs.readFileSync(path.join(projectRoot, "src/services/guestDepositService.ts"), "utf8");
  assert.ok(depositSource.includes("'payment.received'"), "guestDepositService missing payment.received");

  const debtSource = fs.readFileSync(path.join(projectRoot, "src/services/debtService.ts"), "utf8");
  assert.ok(debtSource.includes("'folio.balance_transferred'"), "debtService missing folio.balance_transferred");

  const frontDeskSource = fs.readFileSync(path.join(projectRoot, "src/components/FrontDesk.tsx"), "utf8");
  assert.ok(frontDeskSource.includes("'reservation.room_transferred'"), "FrontDesk missing room_transferred trigger");
  assert.ok(frontDeskSource.includes("'reservation.stay_extended'"), "FrontDesk missing stay_extended trigger");

  const guestFolioSource = fs.readFileSync(path.join(projectRoot, "src/components/GuestFolio.tsx"), "utf8");
  assert.ok(guestFolioSource.includes("'folio.charge_posted'"), "GuestFolio missing folio.charge_posted trigger");
  assert.ok(guestFolioSource.includes("'folio.discount_applied'"), "GuestFolio missing folio.discount_applied trigger");

  const fnbSource = fs.readFileSync(path.join(projectRoot, "src/components/FandB.tsx"), "utf8");
  assert.ok(fnbSource.includes("'payment.received'"), "FandB missing direct payment.received trigger");
  assert.ok(fnbSource.includes("notifyGuest:"), "FandB missing notifyGuest flag on fnb.order_voided");

  const roomsSource = fs.readFileSync(path.join(projectRoot, "src/components/Rooms.tsx"), "utf8");
  assert.ok(roomsSource.includes("notifyReservationEmailEvent"), "Rooms.tsx missing checked_out email trigger");
});

runTest("7. F&B 20,000 charge on a 239,100 stay strictly renders NGN 20,000.00 (NEVER 239,100) for both default and legacy custom templates", () => {
  // Scenario A: Unpaid reservation (239,100 room charge) + 20,000 F&B order just posted
  const unpaidRes = {
    id: "res-239100",
    totalAmount: 239100,
    paidAmount: 0,
    status: "checked_in",
    roomNumber: "204",
  };
  const ledgerWithFnb = [
    { type: "debit", category: "room", amount: 239100 },
    { type: "debit", category: "F & B", amount: 20000 },
  ];
  const resolvedUnpaid = resolveNotificationEventFinancials({
    eventType: "fnb.order_posted",
    reservation: unpaidRes,
    ledgerEntries: ledgerWithFnb,
    meta: { amount: 20000, billNumber: "FB-1001", outletName: "Main Restaurant" },
  });

  assert.equal(resolvedUnpaid.chargeAmount, 20000, "chargeAmount must equal exact posted F&B order (20,000)");
  assert.equal(resolvedUnpaid.totalAmount, 20000, "totalAmount must equal exact posted F&B order (20,000), NEVER 239,100");
  assert.equal(resolvedUnpaid.amountPaid, undefined, "F&B charge must NEVER be miscounted as a payment");
  assert.equal(resolvedUnpaid.balanceDue, 259100, "Remaining balance must reflect room (239,100) + F&B (20,000) = 259,100");

  // Scenario B: Room already paid in full (239,100), then 20,000 F&B order posted
  const paidRes = {
    id: "res-239100-paid",
    totalAmount: 239100,
    paidAmount: 239100,
    status: "checked_in",
    roomNumber: "204",
  };
  const ledgerPaidRoomPlusFnb = [
    { type: "debit", category: "room", amount: 239100 },
    { type: "credit", category: "payment", amount: 239100 },
    { type: "debit", category: "F & B", amount: 20000 },
  ];
  const resolvedPaidRoom = resolveNotificationEventFinancials({
    eventType: "fnb.order_posted",
    reservation: paidRes,
    ledgerEntries: ledgerPaidRoomPlusFnb,
    meta: { amount: 20000 },
  });

  assert.equal(resolvedPaidRoom.chargeAmount, 20000);
  assert.equal(resolvedPaidRoom.totalAmount, 20000);
  assert.equal(resolvedPaidRoom.balanceDue, 20000, "Remaining balance after paid room + 20k F&B must be exactly 20,000");

  // Render default fnb_order_posted template (uses {{charge_amount}})
  const ctx: EmailRenderContext = {
    hotelId: "hotel-horizon",
    hotelName: "Grand Horizon Suites",
    currencyCode: "NGN",
    appUrl: "",
    guestName: "Amina Bello",
    bookingReference: "RES23910",
    roomName: "Room 204",
    outletName: "Main Restaurant",
    billNumber: "FB-1001",
    itemDescription: "Grilled Chicken & Fresh Juice",
    chargeAmount: resolvedPaidRoom.chargeAmount,
    totalAmount: resolvedPaidRoom.totalAmount,
    balanceDue: resolvedPaidRoom.balanceDue,
    transactionDate: "2026-11-25 14:30",
  };

  const defaultVariant = buildDefaultTemplateVariant("fnb_order_posted", "en");
  const renderedDefault = renderEmailTemplate({
    variant: defaultVariant,
    context: ctx,
    settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    language: "en",
  });
  assert.ok(renderedDefault.text.includes("Amount Posted: NGN 20,000.00"), "Default template must show NGN 20,000.00");
  assert.ok(!renderedDefault.text.includes("239,100"), "Default F&B email must NEVER show stay total 239,100");
  assert.ok(renderedDefault.text.includes("Updated Remaining Balance: NGN 20,000.00"), "Default template must show updated remaining balance");

  // Render legacy custom fnb_order_posted template that still uses {{total_amount}}
  const legacyCustomVariant = buildDefaultTemplateVariant("fnb_order_posted", "en");
  legacyCustomVariant.blocks = legacyCustomVariant.blocks.map((b) =>
    b.type === "booking_details_table"
      ? {
          ...b,
          rows: b.rows.map((r) =>
            r.id === "row_amt" ? { ...r, valueTemplate: "{{total_amount}}" } : r
          ),
        }
      : b
  );
  const renderedLegacyCustom = renderEmailTemplate({
    variant: legacyCustomVariant,
    context: ctx,
    settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
    language: "en",
  });
  assert.ok(
    renderedLegacyCustom.text.includes("Amount Posted: NGN 20,000.00"),
    "Saved custom templates using {{total_amount}} must ALSO render exact posted NGN 20,000.00"
  );
  assert.ok(!renderedLegacyCustom.text.includes("239,100"), "Legacy custom F&B email must NEVER leak 239,100");
});

runTest("8. All non-payment transaction events bind exact transaction amount and never miscount debits as payments", () => {
  const baseRes = { totalAmount: 239100, paidAmount: 0, status: "checked_in" };

  const folioCharge = resolveNotificationEventFinancials({
    eventType: "folio.charge_posted",
    reservation: baseRes,
    ledgerEntries: [
      { type: "debit", category: "room", amount: 239100 },
      { type: "debit", category: "laundry", amount: 15000 },
    ],
    meta: { amount: 15000, category: "laundry" },
  });
  assert.equal(folioCharge.chargeAmount, 15000);
  assert.equal(folioCharge.totalAmount, 15000);
  assert.equal(folioCharge.amountPaid, undefined);
  assert.equal(folioCharge.balanceDue, 254100);

  const folioVoid = resolveNotificationEventFinancials({
    eventType: "folio.charge_voided",
    reservation: baseRes,
    ledgerEntries: [{ type: "debit", category: "room", amount: 239100 }],
    meta: { amount: 15000, reason: "Duplicate charge" },
  });
  assert.equal(folioVoid.chargeAmount, 15000);
  assert.equal(folioVoid.totalAmount, 15000);
  assert.equal(folioVoid.balanceDue, 239100);

  const folioDiscount = resolveNotificationEventFinancials({
    eventType: "folio.discount_applied",
    reservation: baseRes,
    ledgerEntries: [
      { type: "debit", category: "room", amount: 239100 },
      { type: "credit", category: "discount", amount: 25000 },
    ],
    meta: { amount: 25000 },
  });
  assert.equal(folioDiscount.discountAmount, 25000);
  assert.equal(folioDiscount.chargeAmount, 25000);
  assert.equal(folioDiscount.balanceDue, 214100);

  const stayExt = resolveNotificationEventFinancials({
    eventType: "reservation.stay_extended",
    reservation: { totalAmount: 359100, paidAmount: 239100, status: "checked_in" },
    meta: { additionalCharge: 120000, newTotalAmount: 359100, extraNights: 2 },
  });
  assert.equal(stayExt.chargeAmount, 120000);
  assert.equal(stayExt.totalAmount, 359100);
  assert.equal(stayExt.balanceDue, 120000);
});

runTest("9. All 7 newly customizable guest account & loyalty events normalize, validate cleanly, and render in EN & DE", () => {
  const newlyCustomizable: Array<[string, CustomizableEmailEventType]> = [
    ["reservation.room_transferred", "room_transferred"],
    ["reservation.stay_extended", "stay_extended"],
    ["folio.charge_posted", "folio_charge_posted"],
    ["folio.charge_voided", "folio_charge_voided"],
    ["folio.discount_applied", "folio_discount_applied"],
    ["folio.balance_transferred", "folio_balance_transferred"],
    ["loyalty.points_expired", "loyalty_points_expired"],
  ];

  const sampleCtx: EmailRenderContext = {
    hotelId: "hotel-horizon",
    hotelName: "Grand Horizon Suites",
    currencyCode: "NGN",
    appUrl: "",
    guestName: "Amina Bello",
    bookingReference: "RES9911",
    roomName: "Room 501 (Executive Suite)",
    previousRoom: "Room 305 (Deluxe King)",
    checkInDate: "2026-11-24",
    checkOutDate: "2026-11-29",
    previousCheckOut: "2026-11-27",
    nights: 5,
    extraNights: 2,
    rateAdjustment: "+NGN 25,000.00",
    chargeAmount: 20000,
    totalAmount: 175000,
    discountAmount: 10000,
    balanceDue: 45000,
    paymentStatus: "Partially Paid",
    chargeCategory: "Laundry",
    itemDescription: "Express Suit Pressing",
    transferTarget: "Acme Corporate City Ledger",
    billNumber: "FB-1009",
    transactionReference: "TXN-5541",
    transactionDate: "2026-11-25",
    reason: "Guest request",
    loyaltyPointsFormatted: "-250 pts",
    loyaltyPointsBalance: 1400,
    loyaltyTier: "Gold",
  };

  for (const [wireEvent, expectedKey] of newlyCustomizable) {
    const normalized = normalizeHotelEmailEvent(wireEvent);
    assert.equal(normalized, expectedKey, `normalizeHotelEmailEvent failed for ${wireEvent}`);
    assert.equal(isCustomizableEvent(expectedKey), true, `${expectedKey} must be customizable`);
    assert.ok(EMAIL_EVENT_CATALOG[expectedKey], `Missing catalog entry for ${expectedKey}`);

    for (const lang of ["en", "de"] as const) {
      const variant = buildDefaultTemplateVariant(expectedKey, lang);
      const issues = validateTemplateVariant(variant);
      assert.equal(
        issues.length,
        0,
        `Template validation failed for ${expectedKey} (${lang}): ${issues.map((i) => i.message).join("; ")}`
      );

      const rendered = renderEmailTemplate({
        variant,
        context: sampleCtx,
        settings: DEFAULT_HOTEL_EMAIL_SETTINGS,
        language: lang,
      });
      assert.equal(/\{\{[^}]+\}\}/.test(rendered.subject), false, `Unresolved tag in subject for ${expectedKey} (${lang})`);
      assert.equal(/\{\{[^}]+\}\}/.test(rendered.html), false, `Unresolved tag in HTML for ${expectedKey} (${lang})`);
      assert.equal(/\{\{[^}]+\}\}/.test(rendered.text), false, `Unresolved tag in text for ${expectedKey} (${lang})`);
    }
  }
});

if (process.exitCode && process.exitCode !== 0) {
  console.error("=== Guest Account & Folio Activity Email Test Suite FAILED ===");
  process.exit(process.exitCode);
} else {
  console.log("=== All Guest Account & Folio Activity Email Tests PASSED ===");
}
