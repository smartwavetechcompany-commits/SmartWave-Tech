/**
 * Automated Verification Suite for the Automated Daily Hotel Operations Report
 * (Additive feature inside the Existing Email Module).
 *
 * Run with: npx tsx src/tests/testDailyOpsReport.ts
 */

import assert from "node:assert/strict";
import {
  computeCalendarDayWindow,
  computeNextScheduledDelivery,
  computePreviousCalendarDayWindow,
  DEFAULT_DAILY_OPS_TIMEZONE,
  evaluateDailyOpsScheduleDue,
  resolveHotelTimezone,
  validateAndNormalizeDailyOpsConfig,
  validateDailyOpsEmail,
} from "../modules/emailCustomization/shared/dailyOpsTypes.ts";
import { buildDailyOperationsReport } from "../modules/emailCustomization/server/dailyOpsAggregator.ts";
import { renderDailyOperationsReportEmail } from "../modules/emailCustomization/server/dailyOpsRenderer.ts";

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
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

console.log("\nRunning Daily Hotel Operations Report Verification Suite...\n");

// 1. Recipient & Config Validation
test("1. Config validation accepts valid multi-recipient config and defaults time/timezone", () => {
  const res = validateAndNormalizeDailyOpsConfig("hotel_a", {
    enabled: true,
    scheduledTime: "00:00",
    timezone: "Africa/Lagos",
    recipients: [
      { id: "r1", email: "GM@HotelA.com", name: "General Manager", enabled: true, addedAt: "2026-11-20T00:00:00Z" },
      { id: "r2", email: "owner@hotela.com", name: "Owner", enabled: false, addedAt: "2026-11-20T00:00:00Z" },
    ],
  });
  assert.equal(res.ok, true);
  assert.equal(res.config.recipients.length, 2);
  assert.equal(res.config.recipients[0].email, "gm@hotela.com");
  assert.equal(res.config.recipients[1].enabled, false);
});

test("2. Config validation rejects invalid email addresses", () => {
  assert.equal(validateDailyOpsEmail("not-an-email"), false);
  assert.equal(validateDailyOpsEmail("user@"), false);
  assert.equal(validateDailyOpsEmail("bad space@example.com"), false);
  const res = validateAndNormalizeDailyOpsConfig("hotel_a", {
    recipients: [{ id: "r1", email: "invalid-email", enabled: true, addedAt: "2026-11-20T00:00:00Z" }],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.toLowerCase().includes("invalid email")));
});

test("3. Config validation prevents duplicate recipients (case-insensitive)", () => {
  const res = validateAndNormalizeDailyOpsConfig("hotel_a", {
    recipients: [
      { id: "r1", email: "ops@hotela.com", enabled: true, addedAt: "2026-11-20T00:00:00Z" },
      { id: "r2", email: "OPS@HotelA.com", enabled: true, addedAt: "2026-11-20T00:00:00Z" },
    ],
  });
  assert.equal(res.ok, false);
  assert.ok(res.errors.some((e) => e.toLowerCase().includes("duplicate")));
});

test("4. Config validation rejects invalid timezone and invalid HH:mm time", () => {
  const res = validateAndNormalizeDailyOpsConfig("hotel_a", {
    scheduledTime: "25:99",
    timezone: "Mars/Olympus",
  });
  assert.equal(res.ok, false);
  assert.equal(res.errors.length, 2);
});

test("5. Explicit timezone fallback resolves cleanly without relying on server default timezone", () => {
  const fallback = resolveHotelTimezone({ name: "Hotel Without TZ" }, null);
  assert.equal(fallback.timezone, DEFAULT_DAILY_OPS_TIMEZONE);
  assert.equal(fallback.usedFallback, true);

  const explicit = resolveHotelTimezone({ timezone: "Europe/London" }, null);
  assert.equal(explicit.timezone, "Europe/London");
  assert.equal(explicit.usedFallback, false);
});

// 2. Timezone-Aware Preceding Calendar Day & Scheduler Due Logic
test("6. Nov 22 00:00 in Africa/Lagos (UTC+1) covers strictly Nov 21 00:00:00.000–23:59:59.999 WAT", () => {
  // 2026-11-21T23:00:00.000Z == 2026-11-22 00:00:00 Africa/Lagos
  const midnightLagos = new Date("2026-11-21T23:00:00.000Z");
  const win = computePreviousCalendarDayWindow(midnightLagos, "Africa/Lagos");
  assert.equal(win.reportDate, "2026-11-21");
  assert.equal(win.periodStartIso, "2026-11-20T23:00:00.000Z");
  assert.equal(win.periodEndIso, "2026-11-21T22:59:59.999Z");
});

test("7. Multi-timezone boundary accuracy for America/New_York (UTC-5 in Nov)", () => {
  // 2026-11-22T05:00:00.000Z == 2026-11-22 00:00:00 America/New_York (EST)
  const midnightNy = new Date("2026-11-22T05:00:00.000Z");
  const win = computePreviousCalendarDayWindow(midnightNy, "America/New_York");
  assert.equal(win.reportDate, "2026-11-21");
  assert.equal(win.periodStartIso, "2026-11-21T05:00:00.000Z");
  assert.equal(win.periodEndIso, "2026-11-22T04:59:59.999Z");
});

test("8. Scheduler due check triggers at/after 00:00 local time and prevents duplicate runs for same reportDate", () => {
  const atMidnightLagos = new Date("2026-11-21T23:00:05.000Z"); // Nov 22 00:00:05 WAT
  const dueFirst = evaluateDailyOpsScheduleDue(atMidnightLagos, "Africa/Lagos", "00:00", undefined);
  assert.equal(dueFirst.due, true);
  assert.equal(dueFirst.reportDate, "2026-11-21");

  // Once delivered for 2026-11-21, repeated tick must NOT re-trigger
  const dueSecond = evaluateDailyOpsScheduleDue(atMidnightLagos, "Africa/Lagos", "00:00", "2026-11-21");
  assert.equal(dueSecond.due, false);

  // Before configured custom time (e.g. 02:00 WAT when local time is 00:00 WAT) -> not due yet
  const dueLaterTime = evaluateDailyOpsScheduleDue(atMidnightLagos, "Africa/Lagos", "02:00", undefined);
  assert.equal(dueLaterTime.due, false);

  const nextSched = computeNextScheduledDelivery(atMidnightLagos, "Africa/Lagos", "00:00", "2026-11-21");
  assert.equal(nextSched.targetReportDate, "2026-11-22");
});

// 3. Full Read-Only Operational Aggregation Tests
const winNov21 = computeCalendarDayWindow("2026-11-21", "Africa/Lagos");

const sampleHotelA = {
  id: "hotel_alpha",
  name: "Grand Sapphire Resort & <Spa>",
  defaultCheckInTime: "14:00",
  defaultCheckOutTime: "12:00",
  branding: {
    organizationName: "Grand Sapphire Resort",
    logoUrl: "https://cdn.example.com/sapphire-logo.png",
    primaryColor: "#0f766e",
    secondaryColor: "#0f172a",
    address: "10 Victoria Island, Lagos",
    phone: "+234-800-111-2222",
    email: "ops@grandsapphire.com",
  },
};

const sampleRoomsA = [
  { id: "rm101", roomNumber: "101", status: "occupied", housekeepingStatus: "inspected" },
  { id: "rm102", roomNumber: "102", status: "occupied", housekeepingStatus: "dirty" },
  { id: "rm103", roomNumber: "103", status: "clean", housekeepingStatus: "inspected" },
  { id: "rm104", roomNumber: "104", status: "dirty", housekeepingStatus: "dirty" },
  { id: "rm105", roomNumber: "105", status: "clean", housekeepingStatus: "awaiting_inspection" },
  { id: "rm106", roomNumber: "106", status: "reserved", housekeepingStatus: "ready" },
  { id: "rm107", roomNumber: "107", status: "maintenance", housekeepingStatus: "dirty" },
  { id: "rm108", roomNumber: "108", status: "out_of_order", housekeepingStatus: "dirty" },
  { id: "rm109", roomNumber: "109", status: "vacant", housekeepingStatus: "inspected" },
  { id: "rm110", roomNumber: "110", status: "vacant", housekeepingStatus: "ready" },
];

const sampleReservationsA = [
  // Checked-in early walk-in on Nov 21 (VIP guest)
  {
    id: "res_001",
    roomId: "rm101",
    roomNumber: "101",
    guestId: "guest_vip_1",
    guestName: "Adaeze Okafor",
    guestEmail: "adaeze.secret@private.com",
    guestPhone: "+2348099988776",
    checkIn: "2026-11-21",
    checkOut: "2026-11-24",
    actualCheckIn: "2026-11-21T09:30:00.000Z", // 10:30 WAT (early before 14:00)
    status: "checked_in",
    bookingSource: "Walk-in",
    adults: 2,
    totalAmount: 485000,
    createdAt: "2026-11-21T09:15:00.000Z",
  },
  // Duplicate entry of res_001 to verify strict deduplication
  {
    id: "res_001",
    roomId: "rm101",
    roomNumber: "101",
    guestId: "guest_vip_1",
    guestName: "Adaeze Okafor",
    checkIn: "2026-11-21",
    checkOut: "2026-11-24",
    actualCheckIn: "2026-11-21T09:30:00.000Z",
    status: "checked_in",
    adults: 2,
    totalAmount: 485000,
    createdAt: "2026-11-21T09:15:00.000Z",
  },
  // Checked-in stayover with extension
  {
    id: "res_002",
    roomId: "rm102",
    roomNumber: "102",
    guestId: "guest_2",
    guestName: "Chidi Bello",
    checkIn: "2026-11-19",
    checkOut: "2026-11-23",
    actualCheckIn: "2026-11-19T14:00:00.000Z",
    status: "checked_in",
    adults: 1,
    totalAmount: 310000,
    rateSnapshot: { extensions: [{ addedAt: "2026-11-21T11:00:00.000Z", nights: 1 }] },
    createdAt: "2026-11-18T10:00:00.000Z",
  },
  // Checked-out early on Nov 21
  {
    id: "res_003",
    roomId: "rm103",
    roomNumber: "103",
    guestId: "guest_3",
    guestName: "Bola Tinubu",
    checkIn: "2026-11-19",
    checkOut: "2026-11-22",
    actualCheckIn: "2026-11-19T15:00:00.000Z",
    actualCheckOut: "2026-11-21T08:00:00.000Z", // Left 1 day early
    status: "checked_out",
    totalAmount: 290000,
    createdAt: "2026-11-18T12:00:00.000Z",
  },
  // No-Show for Nov 21 — MUST NOT count as completed stay or occupied
  {
    id: "res_004",
    roomId: "rm104",
    roomNumber: "104",
    guestName: "NoShow Person",
    checkIn: "2026-11-21",
    checkOut: "2026-11-22",
    status: "no_show",
    totalAmount: 141500,
    updatedAt: "2026-11-21T22:00:00.000Z",
    createdAt: "2026-11-20T10:00:00.000Z",
  },
  // Cancelled on Nov 21 — MUST NOT count as completed stay or occupied
  {
    id: "res_005",
    roomId: "rm105",
    roomNumber: "105",
    guestName: "Cancel Guest",
    checkIn: "2026-11-21",
    checkOut: "2026-11-23",
    status: "cancelled",
    totalAmount: 220000,
    updatedAt: "2026-11-21T13:00:00.000Z",
    createdAt: "2026-11-21T07:00:00.000Z",
  },
  // Confirmed expected arrival on Nov 21 that did NOT check in
  {
    id: "res_006",
    roomId: "rm106",
    roomNumber: "106",
    guestName: "Pending Arrival",
    checkIn: "2026-11-21",
    checkOut: "2026-11-23",
    status: "confirmed",
    totalAmount: 195000,
    createdAt: "2026-11-21T10:00:00.000Z",
  },
  // New-day (Nov 22 00:30 WAT = 2026-11-21T23:30:00Z) check-in — MUST BE EXCLUDED from Nov 21 report!
  {
    id: "res_next_day",
    roomId: "rm110",
    roomNumber: "110",
    guestName: "Future Arrival",
    checkIn: "2026-11-22",
    checkOut: "2026-11-23",
    actualCheckIn: "2026-11-21T23:30:00.000Z", // Nov 22 00:30 WAT
    status: "checked_in",
    totalAmount: 175000,
    createdAt: "2026-11-21T23:25:00.000Z",
  },
];

const reportA = buildDailyOperationsReport({
  hotelId: "hotel_alpha",
  hotelDoc: sampleHotelA,
  rooms: sampleRoomsA,
  reservations: sampleReservationsA,
  roomBlockings: [
    { id: "blk1", roomId: "rm109", startDate: "2026-11-21", endDate: "2026-11-22", reason: "vip" },
  ],
  maintenance: [
    {
      id: "m1",
      roomId: "rm107",
      roomNumber: "107",
      issue: "[HVAC] AC compressor noisy <script>alert(1)</script>",
      priority: "high",
      status: "in_progress",
      timestamp: "2026-11-21T10:00:00.000Z",
    },
    {
      id: "m2",
      roomId: "rm108",
      roomNumber: "108",
      issue: "[Plumbing] Replaced shower mixer",
      priority: "medium",
      status: "completed",
      timestamp: "2026-11-20T10:00:00.000Z",
      completedAt: "2026-11-21T15:00:00.000Z",
    },
  ],
  housekeepingCleanings: [
    { id: "cl1", roomId: "rm103", roomNumber: "103", completedAt: "2026-11-21T11:30:00.000Z" },
  ],
  housekeepingInspections: [
    { id: "in1", roomId: "rm103", roomNumber: "103", result: "passed", timestamp: "2026-11-21T12:00:00.000Z" },
  ],
  housekeepingRequests: [{ id: "hr1", roomId: "rm101", status: "pending" }],
  tasks: [
    { id: "t1", category: "housekeeping", status: "pending" },
    { id: "t2", category: "front_desk", status: "open" },
  ],
  activityLogs: [
    { id: "al1", module: "Rooms", roomNumber: "103", action: "Room status updated to inspected", timestamp: "2026-11-21T12:05:00.000Z" },
    { id: "al2", module: "Reservations", roomNumber: "102", action: "Room transfer from 104 to 102", timestamp: "2026-11-21T14:00:00.000Z" },
  ],
  checkinHistory: [],
  checkoutHistory: [],
  guests: [{ id: "guest_vip_1", name: "Adaeze Okafor", tags: ["VIP"], email: "adaeze.secret@private.com" }],
  reportDate: winNov21.reportDate,
  periodStartUtc: winNov21.periodStartUtc,
  periodEndUtc: winNov21.periodEndUtc,
  timezone: "Africa/Lagos",
  generatedAt: "2026-11-21T23:00:10.000Z",
});

test("9. Room status summary matches inventory snapshot & separates intra-day transitions", () => {
  const snap = reportA.roomStatus.endOfDaySnapshot;
  assert.equal(snap.totalRooms, 10);
  assert.equal(snap.occupied, 2); // rm101 & rm102 only (res_next_day on rm110 excluded!)
  assert.equal(snap.vacant, 8);
  assert.equal(snap.reserved, 1); // rm106
  assert.equal(snap.blocked, 1); // rm109
  assert.equal(snap.underMaintenance, 1); // rm107
  assert.equal(snap.outOfOrder, 1); // rm108
  assert.equal(snap.awaitingInspection, 1); // rm105
  assert.equal(reportA.roomStatus.dailyTransitions.cleaningsCompleted, 1);
  assert.equal(reportA.roomStatus.dailyTransitions.inspectionsPassed, 1);
  assert.equal(reportA.roomStatus.dailyTransitions.statusChangesRecorded, 2);
});

test("10. Occupancy matches Dashboard formula (occupied/total * 100) and excludes next-day & No-Show/Cancelled", () => {
  assert.equal(reportA.occupancy.totalRoomInventory, 10);
  assert.equal(reportA.occupancy.occupiedRooms, 2);
  assert.equal(reportA.occupancy.vacantRooms, 8);
  assert.equal(reportA.occupancy.occupancyPercentage, 20); // Math.round(2/10 * 100)
  assert.equal(reportA.occupancy.currentInHouseGuests, 3); // 2 adults (rm101) + 1 adult (rm102)
  assert.equal(reportA.occupancy.totalArrivals, 1); // res_001 only (res_next_day excluded)
  assert.equal(reportA.occupancy.totalDepartures, 1); // res_003 only
  assert.equal(reportA.occupancy.extendedStays, 1); // res_002
});

test("11. Reservation summary deduplicates, excludes next-day records, and separates No-Show & Cancelled", () => {
  const r = reportA.reservations;
  assert.equal(r.totalCreated, 3); // res_001 (deduped), res_005, res_006 (res_next_day excluded)
  assert.equal(r.checkedIn, 1);
  assert.equal(r.checkedOut, 1);
  assert.equal(r.noShow, 1);
  assert.equal(r.cancelled, 1);
  assert.equal(r.walkIn, 1);
  assert.equal(r.earlyCheckIns, 1);
  assert.equal(r.earlyCheckOuts, 1);
  assert.equal(reportA.arrivalsDepartures.expectedNotCheckedIn.length, 1);
  assert.equal(reportA.arrivalsDepartures.noShows.length, 1);
  assert.equal(reportA.arrivalsDepartures.cancelled.length, 1);
});

test("12. Housekeeping, Maintenance & Additional Operational Info aggregate accurately", () => {
  assert.equal(reportA.housekeeping.completedTasks, 1);
  assert.equal(reportA.housekeeping.pendingTasks, 1);
  assert.equal(reportA.housekeeping.activeGuestRequests, 1);

  assert.equal(reportA.maintenance.roomsUnderMaintenance, 1);
  assert.equal(reportA.maintenance.outOfOrderRooms, 1);
  assert.equal(reportA.maintenance.newRequests, 1);
  assert.equal(reportA.maintenance.inProgressRequests, 1);
  assert.equal(reportA.maintenance.completedRequests, 1);
  assert.equal(reportA.maintenance.requests[0].category, "HVAC");

  assert.equal(reportA.additionalOps.roomTransfersCount, 1);
  assert.equal(reportA.additionalOps.roomBlocksActive, 1);
  assert.equal(reportA.additionalOps.vipArrivalsCount, 1);
  assert.equal(reportA.additionalOps.outstandingOperationalTasks, 2);
});

test("13. Rendered branded HTML contains zero guest PII, zero financial figures, escapes XSS, and preserves logo ratio", () => {
  const rendered = renderDailyOperationsReportEmail(reportA, {
    hotelName: sampleHotelA.branding.organizationName,
    logoUrl: sampleHotelA.branding.logoUrl,
    primaryColor: sampleHotelA.branding.primaryColor,
    secondaryColor: sampleHotelA.branding.secondaryColor,
    address: sampleHotelA.branding.address,
    phone: sampleHotelA.branding.phone,
    supportEmail: sampleHotelA.branding.email,
  });

  assert.equal(rendered.subject, "Daily Hotel Operations Report – Grand Sapphire Resort – 2026-11-21");
  assert.ok(rendered.html.includes("width:auto;height:auto"));
  assert.ok(rendered.html.includes("20%"));
  assert.ok(!rendered.html.includes("<script>alert(1)</script>"), "XSS payload must be escaped");
  assert.ok(rendered.html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));

  // Privacy guard: no guest full name, email, or phone
  assert.ok(!rendered.html.includes("Adaeze Okafor"));
  assert.ok(!rendered.html.includes("adaeze.secret@private.com"));
  assert.ok(!rendered.html.includes("+2348099988776"));
  assert.ok(!rendered.text.includes("Adaeze Okafor"));

  // No financial data guard
  assert.ok(!rendered.html.includes("485000"));
  assert.ok(!rendered.html.includes("485,000"));
  assert.ok(!rendered.html.includes("141500"));
  assert.ok(!rendered.html.includes("310000"));
});

test("14. Multi-tenant isolation: Hotel B report contains strictly Hotel B data & branding", () => {
  const reportB = buildDailyOperationsReport({
    hotelId: "hotel_beta",
    hotelDoc: { id: "hotel_beta", name: "Emerald Bay Suites" },
    rooms: [{ id: "b1", roomNumber: "B-1", status: "vacant", housekeepingStatus: "inspected" }],
    reservations: [],
    roomBlockings: [],
    maintenance: [],
    housekeepingCleanings: [],
    housekeepingInspections: [],
    housekeepingRequests: [],
    tasks: [],
    activityLogs: [],
    checkinHistory: [],
    checkoutHistory: [],
    guests: [],
    reportDate: winNov21.reportDate,
    periodStartUtc: winNov21.periodStartUtc,
    periodEndUtc: winNov21.periodEndUtc,
    timezone: "UTC",
  });

  assert.equal(reportB.hotelId, "hotel_beta");
  assert.equal(reportB.roomStatus.endOfDaySnapshot.totalRooms, 1);
  assert.equal(reportB.occupancy.occupancyPercentage, 0);

  const renderedB = renderDailyOperationsReportEmail(reportB, { hotelName: "Emerald Bay Suites" });
  assert.equal(renderedB.subject, "Daily Hotel Operations Report – Emerald Bay Suites – 2026-11-21");
  assert.ok(!renderedB.html.includes("Grand Sapphire"));
});

console.log(`\nSummary: ${passed} passed, ${failed} failed\n`);
if (failed > 0) {
  process.exit(1);
}
