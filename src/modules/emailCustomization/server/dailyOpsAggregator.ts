/**
 * Strictly Read-Only Daily Hotel Operations Report Aggregation Engine.
 *
 * Reads authoritative PMS collections for a single tenant (hotelId) and
 * computes Sections A–G for the exact preceding calendar day in the hotel's
 * local timezone.
 *
 * CRITICAL GUARANTEES:
 * - Zero writes or mutations to any PMS record.
 * - Zero financial figures (no revenue, room rates, payments, folio balances, debt).
 * - Zero guest PII (no emails, phone numbers, addresses, or ID numbers).
 * - Reuses existing PMS room status normalization (`getRoomDisplayStatus`)
 *   and Dashboard occupancy math (`Math.round((occupied / total) * 100)`).
 * - Never counts No-Show or Cancelled reservations as completed stays.
 * - Deduplicates all reservation categories to prevent double counting.
 */

import {
  formatReportDateLabel,
  getZonedDateParts,
  type DailyOpsMaintenanceItem,
  type DailyOpsMovementItem,
  type DailyOpsReportData,
  type DailyOpsRoomTransitionItem,
} from "../shared/dailyOpsTypes.ts";

/**
 * Server-safe read-only room display status resolver matching src/utils/roomUtils.ts
 * without importing frontend extensionless modules under Node native ESM.
 */
function resolveRoomDisplayStatusReadOnly(
  room: Record<string, any>,
  isOccupied: boolean,
  isBlocked: boolean,
  isReserved: boolean
): string {
  if (isOccupied) return "occupied";
  if (isBlocked) return "maintenance";
  if (isReserved) return "reserved";
  const raw = String(room?.status || "").toLowerCase();
  if (raw === "occupied") return "dirty";
  return raw;
}

export interface DailyOpsAggregationInput {
  hotelId: string;
  hotelDoc: Record<string, any> | null;
  rooms: Array<Record<string, any>>;
  reservations: Array<Record<string, any>>;
  roomBlockings: Array<Record<string, any>>;
  maintenance: Array<Record<string, any>>;
  housekeepingCleanings: Array<Record<string, any>>;
  housekeepingInspections: Array<Record<string, any>>;
  housekeepingRequests: Array<Record<string, any>>;
  tasks: Array<Record<string, any>>;
  activityLogs: Array<Record<string, any>>;
  checkinHistory: Array<Record<string, any>>;
  checkoutHistory: Array<Record<string, any>>;
  guests: Array<Record<string, any>>;
  reportDate: string; // YYYY-MM-DD
  periodStartUtc: Date;
  periodEndUtc: Date;
  timezone: string;
  generatedAt?: string;
}

/**
 * Safely parse ISO strings, epoch ms, or Firestore Timestamp objects into a Date.
 */
export function parseAnyTimestamp(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const dt = new Date(value > 1e12 ? value : value * 1000);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    // Handle YYYY-MM-DD date-only strings safely without shifting timezone
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      const [y, m, d] = trimmed.split("-").map(Number);
      const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
    const dt = new Date(trimmed);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }
  if (typeof value === "object") {
    const v = value as Record<string, any>;
    if (typeof v.toDate === "function") {
      try {
        const dt = v.toDate();
        return dt instanceof Date && !Number.isNaN(dt.getTime()) ? dt : null;
      } catch {
        return null;
      }
    }
    const secs = typeof v.seconds === "number" ? v.seconds : typeof v._seconds === "number" ? v._seconds : null;
    if (secs !== null) {
      const dt = new Date(secs * 1000);
      return Number.isNaN(dt.getTime()) ? null : dt;
    }
  }
  return null;
}

/**
 * Extracts a YYYY-MM-DD calendar date from either a date-only string or a full timestamp
 * evaluated in the hotel's local timezone.
 */
function extractLocalDateStr(value: unknown, timezone: string): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    const dateOnlyMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2})$/);
    if (dateOnlyMatch) return dateOnlyMatch[1];
    // For ISO strings with time, evaluate in hotel's timezone
    const dt = parseAnyTimestamp(trimmed);
    if (!dt) return null;
    return getZonedDateParts(dt, timezone).dateStr;
  }
  const dt = parseAnyTimestamp(value);
  if (!dt) return null;
  return getZonedDateParts(dt, timezone).dateStr;
}

function isTimestampWithinWindow(value: unknown, startUtc: Date, endUtc: Date): boolean {
  const dt = parseAnyTimestamp(value);
  if (!dt) return false;
  const ms = dt.getTime();
  return ms >= startUtc.getTime() && ms <= endUtc.getTime();
}

function formatReservationRef(res: Record<string, any>): string {
  const raw = String(res.confirmationCode || res.bookingRef || res.id || "").trim();
  if (!raw) return "REF-N/A";
  const cleaned = raw.replace(/[^a-zA-Z0-9-]/g, "");
  return `#${cleaned.slice(0, 8).toUpperCase()}`;
}

/**
 * Produces strictly PII-free initials from a guest name (e.g. "John Doe" -> "J.D.").
 * Never exposes full name, email, phone, address, or ID number.
 */
function maskGuestInitials(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) return "Guest";
  const tokens = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  if (tokens.length === 0) return "Guest";
  return tokens.map((t) => `${t.charAt(0).toUpperCase()}.`).join("");
}

function parseMaintenanceCategory(issue: unknown): { category: string; summary: string } {
  const raw = typeof issue === "string" ? issue.trim() : "";
  if (!raw) return { category: "General", summary: "Maintenance issue" };
  const match = raw.match(/^\[([^\]]+)\]\s*(.*)$/);
  if (match) {
    return {
      category: match[1].trim() || "General",
      summary: (match[2] || match[1]).trim().slice(0, 140),
    };
  }
  return { category: "General", summary: raw.slice(0, 140) };
}

function isWalkInReservation(res: Record<string, any>): boolean {
  const fields = [res.bookingSource, res.source, res.channel, res.reservationType];
  return fields.some(
    (f) => typeof f === "string" && f.toLowerCase().replace(/[\s_-]/g, "") === "walkin"
  );
}

function parseHhMmToMinutes(hhmm: unknown, fallbackMinutes: number): number {
  if (typeof hhmm !== "string") return fallbackMinutes;
  const m = hhmm.trim().match(/^(\d{1,2}):(\d{2})/);
  if (!m) return fallbackMinutes;
  return Number(m[1]) * 60 + Number(m[2]);
}

function toMovementItem(
  res: Record<string, any>,
  roomMap: Map<string, string>,
  detail?: string
): DailyOpsMovementItem {
  const roomNum =
    String(res.roomNumber || roomMap.get(String(res.roomId || "")) || "Unassigned").trim();
  return {
    reservationRef: formatReservationRef(res),
    roomNumber: roomNum,
    guestInitials: maskGuestInitials(res.guestName),
    status: String(res.status || "unknown"),
    ...(detail ? { detail } : {}),
  };
}

export function buildDailyOperationsReport(input: DailyOpsAggregationInput): DailyOpsReportData {
  const {
    hotelId,
    hotelDoc,
    rooms = [],
    reservations = [],
    roomBlockings = [],
    maintenance = [],
    housekeepingCleanings = [],
    housekeepingInspections = [],
    housekeepingRequests = [],
    tasks = [],
    activityLogs = [],
    checkinHistory = [],
    checkoutHistory = [],
    guests = [],
    reportDate,
    periodStartUtc,
    periodEndUtc,
    timezone,
  } = input;

  const generatedAt = input.generatedAt || new Date().toISOString();
  const hotelName =
    hotelDoc?.branding?.organizationName || hotelDoc?.name || "Hotel Property";

  const limitations: string[] = [];

  // Map roomId -> roomNumber for consistent lookup
  const roomNumberById = new Map<string, string>();
  for (const r of rooms) {
    if (r?.id) {
      roomNumberById.set(String(r.id), String(r.roomNumber || r.name || r.id));
    }
  }

  // Standard hotel check-in / check-out cutoff times for early arrival / early departure detection
  const standardCheckInMinutes = parseHhMmToMinutes(
    hotelDoc?.defaultCheckInTime || hotelDoc?.settings?.operations?.defaultCheckInTime,
    14 * 60 // 14:00 default
  );
  const standardCheckOutMinutes = parseHhMmToMinutes(
    hotelDoc?.defaultCheckOutTime || hotelDoc?.settings?.operations?.defaultCheckOutTime,
    12 * 60 // 12:00 default
  );

  // Deduplicate reservations by ID to prevent any double counting
  const uniqueReservations: Array<Record<string, any>> = [];
  const seenResIds = new Set<string>();
  for (const res of reservations) {
    const id = String(res?.id || "");
    if (!id || seenResIds.has(id)) continue;
    seenResIds.add(id);
    uniqueReservations.push(res);
  }

  // Active room blockings overlapping the reporting day
  const activeBlockedRoomIds = new Set<string>();
  for (const blk of roomBlockings) {
    const blkStart = extractLocalDateStr(blk.startDate, timezone);
    const blkEnd = extractLocalDateStr(blk.endDate, timezone);
    if (!blkStart || !blkEnd) continue;
    if (blkStart <= reportDate && blkEnd >= reportDate) {
      if (blk.roomId) activeBlockedRoomIds.add(String(blk.roomId));
    }
  }

  // In-house reservations overlapping the reporting cutoff
  // Strictly excludes cancelled and no_show (never counted as occupied/completed stays)
  const inHouseReservations = uniqueReservations.filter((res) => {
    const status = String(res.status || "").toLowerCase();
    if (status === "cancelled" || status === "no_show") return false;
    if (status === "checked_in") {
      // Ensure the reservation started on or before the reporting day
      const ciDate = extractLocalDateStr(res.actualCheckIn || res.checkIn, timezone);
      return !ciDate || ciDate <= reportDate;
    }
    if (status === "checked_out") {
      // Was in-house at end of reporting day if checked in <= reportDate and checked out > reportDate
      const ciDate = extractLocalDateStr(res.actualCheckIn || res.checkIn, timezone);
      const coDate = extractLocalDateStr(res.actualCheckOut || res.checkOut, timezone);
      return Boolean(ciDate && coDate && ciDate <= reportDate && coDate > reportDate);
    }
    return false;
  });

  const occupiedRoomIds = new Set<string>();
  for (const res of inHouseReservations) {
    if (res.roomId) occupiedRoomIds.add(String(res.roomId));
  }

  // Reserved rooms for the reporting day (confirmed/pending arriving on or staying over reportDate)
  const reservedRoomIds = new Set<string>();
  for (const res of uniqueReservations) {
    const status = String(res.status || "").toLowerCase();
    if (status !== "confirmed" && status !== "pending") continue;
    const ciDate = extractLocalDateStr(res.checkIn, timezone);
    const coDate = extractLocalDateStr(res.checkOut, timezone);
    if (ciDate && coDate && ciDate <= reportDate && coDate > reportDate && res.roomId) {
      reservedRoomIds.add(String(res.roomId));
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION A: ROOM STATUS SUMMARY (End-of-Day Snapshot vs Intra-Day Transitions)
  // ---------------------------------------------------------------------------
  let occupiedRoomsCount = 0;
  let vacantRoomsCount = 0;
  let availableRoomsCount = 0;
  let reservedRoomsCount = 0;
  let dirtyRoomsCount = 0;
  let cleanRoomsCount = 0;
  let inspectedRoomsCount = 0;
  let awaitingCleaningCount = 0;
  let awaitingInspectionCount = 0;
  let blockedRoomsCount = 0;
  let outOfOrderCount = 0;
  let underMaintenanceCount = 0;
  let releasedAndReadyCount = 0;

  for (const room of rooms) {
    const roomId = String(room.id || "");
    const rawStatus = String(room.status || "").toLowerCase();
    const hkStatus = String(room.housekeepingStatus || "").toLowerCase();

    const isOccupied =
      occupiedRoomIds.has(roomId) ||
      (rawStatus === "occupied" && inHouseReservations.length === 0 && false); // Reuse Dashboard's authoritative in-house reservation match
    const isOutOfOrder = rawStatus === "out_of_order" || rawStatus === "out_of_service";
    const isMaintenance = rawStatus === "maintenance";
    const isBlocked = activeBlockedRoomIds.has(roomId);
    const isReserved = !isOccupied && !isOutOfOrder && !isMaintenance && !isBlocked && (reservedRoomIds.has(roomId) || rawStatus === "reserved");

    // Server-safe display status matching src/utils/roomUtils.ts precedence
    const displayStatus = resolveRoomDisplayStatusReadOnly(
      room,
      isOccupied,
      isBlocked,
      isReserved
    );

    if (isOccupied) {
      occupiedRoomsCount++;
    } else {
      vacantRoomsCount++;
    }

    if (isMaintenance) underMaintenanceCount++;
    if (isOutOfOrder) outOfOrderCount++;
    if (isBlocked) blockedRoomsCount++;
    if (isReserved) reservedRoomsCount++;

    const isDirty =
      hkStatus === "dirty" ||
      hkStatus === "failed" ||
      rawStatus === "dirty" ||
      displayStatus === "dirty";
    const isAwaitingInspection = hkStatus === "awaiting_inspection";
    const isCleaning = hkStatus === "cleaning" || rawStatus === "cleaning" || displayStatus === "cleaning";
    const isInspected =
      hkStatus === "inspected" ||
      hkStatus === "ready" ||
      rawStatus === "inspected" ||
      displayStatus === "inspected";
    const isClean =
      !isDirty &&
      !isAwaitingInspection &&
      !isCleaning &&
      (rawStatus === "clean" || rawStatus === "vacant" || isInspected || displayStatus === "clean" || displayStatus === "vacant");

    if (isDirty) {
      dirtyRoomsCount++;
      awaitingCleaningCount++;
    } else if (isCleaning) {
      awaitingCleaningCount++;
    } else if (isAwaitingInspection) {
      awaitingInspectionCount++;
    }

    if (isInspected) inspectedRoomsCount++;
    if (isClean) cleanRoomsCount++;

    const isReleasedReady =
      !isOccupied &&
      !isOutOfOrder &&
      !isMaintenance &&
      !isBlocked &&
      !isDirty &&
      !isAwaitingInspection &&
      !isCleaning &&
      (isInspected || isClean);

    if (isReleasedReady) {
      releasedAndReadyCount++;
      if (!isReserved) {
        availableRoomsCount++;
      }
    }
  }

  // Intra-day room status changes from cleanings, inspections, and activityLogs
  const periodCleanings = housekeepingCleanings.filter((c) =>
    isTimestampWithinWindow(c.completedAt || c.timestamp || c.createdAt, periodStartUtc, periodEndUtc)
  );
  const periodInspections = housekeepingInspections.filter((ins) =>
    isTimestampWithinWindow(ins.timestamp || ins.inspectedAt || ins.createdAt, periodStartUtc, periodEndUtc)
  );
  const inspectionsPassed = periodInspections.filter(
    (ins) => String(ins.result || ins.status || "").toLowerCase() === "passed" || ins.passed === true
  ).length;
  const inspectionsFailed = periodInspections.filter(
    (ins) => String(ins.result || ins.status || "").toLowerCase() === "failed" || ins.passed === false
  ).length;

  const periodRoomLogs = activityLogs.filter((log) => {
    if (!isTimestampWithinWindow(log.timestamp || log.createdAt, periodStartUtc, periodEndUtc)) {
      return false;
    }
    const action = String(log.action || "").toLowerCase();
    const moduleName = String(log.module || "").toLowerCase();
    return (
      moduleName.includes("room") ||
      moduleName.includes("housekeeping") ||
      action.includes("room status") ||
      action.includes("marked dirty") ||
      action.includes("marked clean") ||
      action.includes("inspected") ||
      action.includes("maintenance") ||
      action.includes("out of order") ||
      action.includes("transfer")
    );
  });

  const notableChanges: DailyOpsRoomTransitionItem[] = [];
  for (const log of periodRoomLogs.slice(0, 10)) {
    notableChanges.push({
      roomNumber: String(log.roomNumber || log.details?.roomNumber || "Room"),
      action: String(log.action || "Room status updated").slice(0, 120),
      timestamp: String(log.timestamp || log.createdAt || ""),
    });
  }
  for (const cl of periodCleanings.slice(0, Math.max(0, 10 - notableChanges.length))) {
    notableChanges.push({
      roomNumber: String(cl.roomNumber || roomNumberById.get(String(cl.roomId || "")) || "Room"),
      action: "Housekeeping cleaning completed",
      timestamp: String(cl.completedAt || cl.timestamp || ""),
    });
  }

  // ---------------------------------------------------------------------------
  // SECTION B & D: RESERVATION SUMMARY & ARRIVALS / DEPARTURES
  // ---------------------------------------------------------------------------
  const createdIds = new Set<string>();
  const confirmedIds = new Set<string>();
  const pendingIds = new Set<string>();
  const checkedInIds = new Set<string>();
  const checkedOutIds = new Set<string>();
  const cancelledIds = new Set<string>();
  const noShowIds = new Set<string>();
  const walkInIds = new Set<string>();
  const earlyCheckInIds = new Set<string>();
  const earlyCheckOutIds = new Set<string>();
  const expectedArrivalsIds = new Set<string>();
  const expectedDeparturesIds = new Set<string>();
  const expectedNotCheckedInIds = new Set<string>();
  const extendedStayIds = new Set<string>();

  const checkedInItems: DailyOpsMovementItem[] = [];
  const checkedOutItems: DailyOpsMovementItem[] = [];
  const expectedNotCheckedInItems: DailyOpsMovementItem[] = [];
  const noShowItems: DailyOpsMovementItem[] = [];
  const cancelledItems: DailyOpsMovementItem[] = [];
  const earlyArrivalItems: DailyOpsMovementItem[] = [];
  const earlyDepartureItems: DailyOpsMovementItem[] = [];
  const walkInItems: DailyOpsMovementItem[] = [];

  // Index check-in and check-out history events within the reporting window
  const checkinEventResIds = new Set<string>();
  for (const ev of checkinHistory) {
    if (
      ev.reservationId &&
      isTimestampWithinWindow(ev.timestamp || ev.checkedInAt || ev.createdAt, periodStartUtc, periodEndUtc)
    ) {
      checkinEventResIds.add(String(ev.reservationId));
    }
  }
  const checkoutEventResIds = new Set<string>();
  for (const ev of checkoutHistory) {
    if (
      ev.reservationId &&
      isTimestampWithinWindow(ev.timestamp || ev.checkedOutAt || ev.createdAt, periodStartUtc, periodEndUtc)
    ) {
      checkoutEventResIds.add(String(ev.reservationId));
    }
  }

  for (const res of uniqueReservations) {
    const id = String(res.id);
    const status = String(res.status || "").toLowerCase();
    const scheduledCheckInDate = extractLocalDateStr(res.checkIn, timezone);
    const scheduledCheckOutDate = extractLocalDateStr(res.checkOut, timezone);
    const createdInWindow = isTimestampWithinWindow(res.createdAt, periodStartUtc, periodEndUtc);

    if (createdInWindow) {
      createdIds.add(id);
      if (status === "confirmed") confirmedIds.add(id);
      if (status === "pending") pendingIds.add(id);
    } else {
      // Also count confirmed/pending reservations arriving on the reporting date
      if (scheduledCheckInDate === reportDate) {
        if (status === "confirmed") confirmedIds.add(id);
        if (status === "pending") pendingIds.add(id);
      }
    }

    // Expected arrivals for the reporting day (excluding reservations cancelled before the day if timestamp available)
    if (scheduledCheckInDate === reportDate) {
      expectedArrivalsIds.add(id);
    }

    // Expected departures for the reporting day (only non-cancelled, non-no-show)
    if (scheduledCheckOutDate === reportDate && status !== "cancelled" && status !== "no_show") {
      expectedDeparturesIds.add(id);
    }

    // Actual check-ins during the reporting day
    const actualCiTs = res.actualCheckIn || res.checkInDateTime;
    const checkedInInWindow =
      status !== "cancelled" &&
      status !== "no_show" &&
      (checkinEventResIds.has(id) ||
        (actualCiTs && isTimestampWithinWindow(actualCiTs, periodStartUtc, periodEndUtc)) ||
        (!actualCiTs &&
          (status === "checked_in" || status === "checked_out") &&
          scheduledCheckInDate === reportDate));

    if (checkedInInWindow) {
      checkedInIds.add(id);
      checkedInItems.push(toMovementItem(res, roomNumberById, "Checked In"));

      // Walk-in arrival check
      if (isWalkInReservation(res)) {
        walkInIds.add(id);
        walkInItems.push(toMovementItem(res, roomNumberById, "Walk-in Arrival"));
      }

      // Early check-in detection (if explicit actualCheckIn timestamp exists)
      const actualCiDate = parseAnyTimestamp(actualCiTs);
      if (actualCiDate) {
        const ciParts = getZonedDateParts(actualCiDate, timezone);
        const ciMinutes = ciParts.hour * 60 + ciParts.minute;
        const isBeforeScheduledDate =
          scheduledCheckInDate !== null && ciParts.dateStr < scheduledCheckInDate;
        const isBeforeStandardTime =
          ciParts.dateStr === scheduledCheckInDate && ciMinutes < standardCheckInMinutes;
        if (isBeforeScheduledDate || isBeforeStandardTime) {
          earlyCheckInIds.add(id);
          earlyArrivalItems.push(
            toMovementItem(res, roomNumberById, `Early arrival at ${ciParts.timeStr}`)
          );
        }
      }
    } else if (createdInWindow && isWalkInReservation(res) && status !== "cancelled" && status !== "no_show") {
      walkInIds.add(id);
      walkInItems.push(toMovementItem(res, roomNumberById, "Walk-in Booking"));
    }

    // Actual check-outs during the reporting day (NEVER counts cancelled or no_show!)
    const actualCoTs = res.actualCheckOut || res.checkOutDateTime;
    const checkedOutInWindow =
      status === "checked_out" &&
      (checkoutEventResIds.has(id) ||
        (actualCoTs && isTimestampWithinWindow(actualCoTs, periodStartUtc, periodEndUtc)) ||
        (!actualCoTs && scheduledCheckOutDate === reportDate));

    if (checkedOutInWindow) {
      checkedOutIds.add(id);
      checkedOutItems.push(toMovementItem(res, roomNumberById, "Checked Out"));

      // Early departure detection
      const actualCoDate = parseAnyTimestamp(actualCoTs);
      if (actualCoDate && scheduledCheckOutDate) {
        const coParts = getZonedDateParts(actualCoDate, timezone);
        const coMinutes = coParts.hour * 60 + coParts.minute;
        const leftEarlierDate = coParts.dateStr < scheduledCheckOutDate;
        const leftEarlySameDay =
          coParts.dateStr === scheduledCheckOutDate && coMinutes < standardCheckOutMinutes - 120;
        if (leftEarlierDate || leftEarlySameDay) {
          earlyCheckOutIds.add(id);
          earlyDepartureItems.push(
            toMovementItem(
              res,
              roomNumberById,
              leftEarlierDate
                ? `Departed before scheduled ${scheduledCheckOutDate}`
                : `Early departure at ${coParts.timeStr}`
            )
          );
        }
      }
    }

    // No-Show reservations for the reporting day
    if (status === "no_show") {
      const noShowTs = res.noShowAt || res.updatedAt;
      const markedInWindow =
        (noShowTs && isTimestampWithinWindow(noShowTs, periodStartUtc, periodEndUtc)) ||
        scheduledCheckInDate === reportDate;
      if (markedInWindow) {
        noShowIds.add(id);
        noShowItems.push(toMovementItem(res, roomNumberById, "No-Show"));
      }
    }

    // Cancelled reservations for the reporting day
    if (status === "cancelled") {
      const cancelTs = res.cancelledAt || res.updatedAt;
      const cancelledInWindow =
        (cancelTs && isTimestampWithinWindow(cancelTs, periodStartUtc, periodEndUtc)) ||
        (!cancelTs && scheduledCheckInDate === reportDate);
      if (cancelledInWindow) {
        cancelledIds.add(id);
        cancelledItems.push(toMovementItem(res, roomNumberById, "Cancelled"));
      }
    }

    // Expected arrivals that did NOT check in (still pending/confirmed for reportDate)
    if (
      scheduledCheckInDate === reportDate &&
      (status === "confirmed" || status === "pending") &&
      !checkedInIds.has(id)
    ) {
      expectedNotCheckedInIds.add(id);
      expectedNotCheckedInItems.push(
        toMovementItem(res, roomNumberById, `Expected arrival (${status}) — did not check in`)
      );
    }

    // Extended stays (recorded via rateSnapshot.extensions, overstayNights, or gracePeriodRequestsHistory)
    const extensions = Array.isArray(res.rateSnapshot?.extensions)
      ? res.rateSnapshot.extensions
      : [];
    const hasExtensionInWindow = extensions.some((ext: any) =>
      isTimestampWithinWindow(ext.addedAt || ext.timestamp || ext.createdAt, periodStartUtc, periodEndUtc)
    );
    const hasGraceExtInWindow =
      Array.isArray(res.gracePeriodRequestsHistory) &&
      res.gracePeriodRequestsHistory.some(
        (gp: any) =>
          gp.status === "approved" &&
          isTimestampWithinWindow(gp.reviewedAt || gp.requestedAt, periodStartUtc, periodEndUtc)
      );
    const isActiveOverstay =
      status === "checked_in" && Number(res.overstayNights || 0) > 0;

    if (hasExtensionInWindow || hasGraceExtInWindow || isActiveOverstay) {
      extendedStayIds.add(id);
    }
  }

  // ---------------------------------------------------------------------------
  // SECTION C: OCCUPANCY SUMMARY (Reuses Dashboard's Exact Formula)
  // ---------------------------------------------------------------------------
  const totalRoomInventory = rooms.length;
  const occupancyPercentage =
    totalRoomInventory > 0 ? Math.round((occupiedRoomsCount / totalRoomInventory) * 100) : 0;

  const currentInHouseGuests = inHouseReservations.reduce((sum, res) => {
    const adults = Number(res.adults || res.guestCount || 1);
    const children = Number(res.children || 0);
    return sum + Math.max(1, (Number.isFinite(adults) ? adults : 1) + (Number.isFinite(children) ? children : 0));
  }, 0);

  // ---------------------------------------------------------------------------
  // SECTION E: HOUSEKEEPING SUMMARY
  // ---------------------------------------------------------------------------
  const hkTasks = tasks.filter(
    (t) => String(t.category || "").toLowerCase() === "housekeeping"
  );
  const hkPendingTasks = hkTasks.filter((t) =>
    ["pending", "in_progress", "open"].includes(String(t.status || "").toLowerCase())
  ).length;
  const hkCompletedTasks =
    hkTasks.filter(
      (t) =>
        String(t.status || "").toLowerCase() === "completed" &&
        isTimestampWithinWindow(t.completedAt || t.updatedAt || t.createdAt, periodStartUtc, periodEndUtc)
    ).length + periodCleanings.length;
  const hkOutstandingTasks = hkPendingTasks + awaitingCleaningCount + awaitingInspectionCount;
  const activeGuestHkRequests = housekeepingRequests.filter(
    (req) => !["completed", "resolved", "cancelled"].includes(String(req.status || "").toLowerCase())
  ).length;

  // ---------------------------------------------------------------------------
  // SECTION F: MAINTENANCE SUMMARY
  // ---------------------------------------------------------------------------
  let maintNewRequests = 0;
  let maintPendingRequests = 0;
  let maintInProgressRequests = 0;
  let maintCompletedRequests = 0;
  const maintenanceItems: DailyOpsMaintenanceItem[] = [];

  for (const m of maintenance) {
    const status = String(m.status || "pending").toLowerCase();
    const createdInWindow = isTimestampWithinWindow(m.timestamp || m.createdAt, periodStartUtc, periodEndUtc);
    const completedInWindow =
      status === "completed" &&
      isTimestampWithinWindow(m.completedAt || m.updatedAt || m.timestamp, periodStartUtc, periodEndUtc);

    if (createdInWindow) maintNewRequests++;
    if (status === "pending") maintPendingRequests++;
    if (status === "in_progress") maintInProgressRequests++;
    if (completedInWindow) maintCompletedRequests++;

    // Include open items or items created/completed on the reporting day
    if (status === "pending" || status === "in_progress" || createdInWindow || completedInWindow) {
      const parsed = parseMaintenanceCategory(m.issue);
      maintenanceItems.push({
        roomNumber: String(m.roomNumber || roomNumberById.get(String(m.roomId || "")) || "Facility"),
        category: String(m.category || parsed.category),
        priority: String(m.priority || "medium"),
        status,
        summary: parsed.summary,
      });
    }
  }

  const maintOutstandingRequests = maintPendingRequests + maintInProgressRequests;

  // ---------------------------------------------------------------------------
  // SECTION G: ADDITIONAL OPERATIONAL INFORMATION (VIPs, Transfers, Blocks, Tasks)
  // ---------------------------------------------------------------------------
  const roomTransfersCount = activityLogs.filter((log) => {
    if (!isTimestampWithinWindow(log.timestamp || log.createdAt, periodStartUtc, periodEndUtc)) {
      return false;
    }
    const action = String(log.action || "").toLowerCase();
    return action.includes("room transfer") || action.includes("transferred room") || action.includes("room move");
  }).length;

  // VIP arrivals (cross-reference existing guest tags without exposing guest PII)
  const vipGuestIds = new Set<string>();
  for (const g of guests) {
    const tags = Array.isArray(g.tags) ? g.tags.map((t: any) => String(t).toLowerCase()) : [];
    if (tags.includes("vip")) {
      if (g.id) vipGuestIds.add(String(g.id));
    }
  }

  const vipArrivalsRefs: Array<{ reservationRef: string; roomNumber: string }> = [];
  const seenVipRes = new Set<string>();
  for (const res of uniqueReservations) {
    const id = String(res.id);
    if (!checkedInIds.has(id) && !expectedArrivalsIds.has(id)) continue;
    const status = String(res.status || "").toLowerCase();
    if (status === "cancelled" || status === "no_show") continue;
    const isVip =
      (res.guestId && vipGuestIds.has(String(res.guestId))) ||
      res.isVip === true ||
      (Array.isArray(res.tags) && res.tags.some((t: any) => String(t).toLowerCase() === "vip"));
    if (isVip && !seenVipRes.has(id)) {
      seenVipRes.add(id);
      vipArrivalsRefs.push({
        reservationRef: formatReservationRef(res),
        roomNumber: String(res.roomNumber || roomNumberById.get(String(res.roomId || "")) || "Unassigned"),
      });
    }
  }

  const outstandingOperationalTasks = tasks.filter(
    (t) => !["completed", "cancelled", "done"].includes(String(t.status || "").toLowerCase())
  ).length;

  // Transparently note any unavailable data streams rather than inventing figures
  if (activityLogs.length === 0) {
    limitations.push(
      "Intra-day room status transition logs and room transfer logs had no recorded entries for this period."
    );
  }
  if (rooms.length === 0) {
    limitations.push("No room inventory records were found for this property.");
  }

  return {
    hotelId,
    hotelName,
    reportDate,
    periodLabel: `${formatReportDateLabel(reportDate)} (12:00 AM – 11:59 PM ${timezone})`,
    periodStartIso: periodStartUtc.toISOString(),
    periodEndIso: periodEndUtc.toISOString(),
    timezone,
    generatedAt,
    roomStatus: {
      endOfDaySnapshot: {
        totalRooms: totalRoomInventory,
        occupied: occupiedRoomsCount,
        vacant: vacantRoomsCount,
        available: availableRoomsCount,
        reserved: reservedRoomsCount,
        dirty: dirtyRoomsCount,
        clean: cleanRoomsCount,
        inspected: inspectedRoomsCount,
        awaitingCleaning: awaitingCleaningCount,
        awaitingInspection: awaitingInspectionCount,
        blocked: blockedRoomsCount,
        outOfOrder: outOfOrderCount,
        underMaintenance: underMaintenanceCount,
      },
      dailyTransitions: {
        totalRecorded: periodRoomLogs.length + periodCleanings.length + periodInspections.length,
        cleaningsCompleted: periodCleanings.length,
        inspectionsPassed,
        inspectionsFailed,
        statusChangesRecorded: periodRoomLogs.length,
        notableChanges,
      },
    },
    reservations: {
      totalCreated: createdIds.size,
      confirmed: confirmedIds.size,
      pending: pendingIds.size,
      checkedIn: checkedInIds.size,
      checkedOut: checkedOutIds.size,
      cancelled: cancelledIds.size,
      noShow: noShowIds.size,
      walkIn: walkInIds.size,
      earlyCheckIns: earlyCheckInIds.size,
      earlyCheckOuts: earlyCheckOutIds.size,
    },
    occupancy: {
      totalRoomInventory,
      occupiedRooms: occupiedRoomsCount,
      vacantRooms: vacantRoomsCount,
      occupancyPercentage,
      totalArrivals: checkedInIds.size,
      totalDepartures: checkedOutIds.size,
      currentInHouseGuests,
      expectedArrivals: expectedArrivalsIds.size,
      expectedDepartures: expectedDeparturesIds.size,
      extendedStays: extendedStayIds.size,
    },
    arrivalsDepartures: {
      checkedIn: checkedInItems.slice(0, 25),
      checkedOut: checkedOutItems.slice(0, 25),
      expectedNotCheckedIn: expectedNotCheckedInItems.slice(0, 25),
      noShows: noShowItems.slice(0, 25),
      cancelled: cancelledItems.slice(0, 25),
      earlyArrivals: earlyArrivalItems.slice(0, 25),
      earlyDepartures: earlyDepartureItems.slice(0, 25),
      walkIns: walkInItems.slice(0, 25),
    },
    housekeeping: {
      dirtyRooms: dirtyRoomsCount,
      cleanRooms: cleanRoomsCount,
      inspectedRooms: inspectedRoomsCount,
      awaitingCleaning: awaitingCleaningCount,
      awaitingInspection: awaitingInspectionCount,
      releasedAndReady: releasedAndReadyCount,
      pendingTasks: hkPendingTasks,
      completedTasks: hkCompletedTasks,
      outstandingTasks: hkOutstandingTasks,
      activeGuestRequests: activeGuestHkRequests,
    },
    maintenance: {
      roomsUnderMaintenance: underMaintenanceCount,
      outOfOrderRooms: outOfOrderCount,
      newRequests: maintNewRequests,
      pendingRequests: maintPendingRequests,
      inProgressRequests: maintInProgressRequests,
      completedRequests: maintCompletedRequests,
      outstandingRequests: maintOutstandingRequests,
      requests: maintenanceItems.slice(0, 25),
    },
    additionalOps: {
      roomTransfersCount,
      roomBlocksActive: activeBlockedRoomIds.size,
      vipArrivalsCount: vipArrivalsRefs.length,
      vipArrivalsRefs: vipArrivalsRefs.slice(0, 20),
      extendedStaysCount: extendedStayIds.size,
      outstandingOperationalTasks,
    },
    limitations,
  };
}
