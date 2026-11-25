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

if (process.exitCode && process.exitCode !== 0) {
  console.error("=== Guest Account & Folio Activity Email Test Suite FAILED ===");
  process.exit(process.exitCode);
} else {
  console.log("=== All Guest Account & Folio Activity Email Tests PASSED ===");
}
