/**
 * Shared Types, Validation, and Timezone Utilities for the
 * Automated Daily Hotel Operations Report (inside the Email Module).
 *
 * Strictly additive — does not alter any existing PMS business logic.
 */

export const DEFAULT_DAILY_OPS_TIMEZONE = "Africa/Lagos";
export const DEFAULT_DAILY_OPS_TIME = "00:00";
export const MAX_DAILY_OPS_RECIPIENTS = 50;

export const COMMON_IANA_TIMEZONES: Array<{ value: string; label: string }> = [
  { value: "Africa/Lagos", label: "Africa/Lagos (WAT, UTC+1)" },
  { value: "Africa/Accra", label: "Africa/Accra (GMT, UTC+0)" },
  { value: "Africa/Johannesburg", label: "Africa/Johannesburg (SAST, UTC+2)" },
  { value: "Africa/Nairobi", label: "Africa/Nairobi (EAT, UTC+3)" },
  { value: "Africa/Cairo", label: "Africa/Cairo (EET)" },
  { value: "UTC", label: "UTC (Coordinated Universal Time)" },
  { value: "Europe/London", label: "Europe/London (GMT/BST)" },
  { value: "Europe/Berlin", label: "Europe/Berlin (CET/CEST)" },
  { value: "Europe/Paris", label: "Europe/Paris (CET/CEST)" },
  { value: "Asia/Dubai", label: "Asia/Dubai (GST, UTC+4)" },
  { value: "Asia/Singapore", label: "Asia/Singapore (SGT, UTC+8)" },
  { value: "America/New_York", label: "America/New_York (ET)" },
  { value: "America/Chicago", label: "America/Chicago (CT)" },
  { value: "America/Los_Angeles", label: "America/Los_Angeles (PT)" },
];

export interface DailyOpsRecipient {
  id: string;
  email: string;
  name?: string;
  enabled: boolean;
  addedAt: string;
  updatedAt?: string;
}

export interface DailyOpsReportSectionsConfig {
  roomStatus: boolean;
  occupancy: boolean;
  reservations: boolean;
  arrivalsDepartures: boolean;
  housekeeping: boolean;
  maintenance: boolean;
  additionalOps: boolean;
}

export const DEFAULT_DAILY_OPS_SECTIONS: DailyOpsReportSectionsConfig = {
  roomStatus: true,
  occupancy: true,
  reservations: true,
  arrivalsDepartures: true,
  housekeeping: true,
  maintenance: true,
  additionalOps: true,
};

export interface DailyOpsReportConfig {
  hotelId: string;
  enabled: boolean;
  scheduledTime: string; // HH:mm in hotel local timezone (default "00:00")
  timezone: string; // IANA timezone string (default "Africa/Lagos")
  recipients: DailyOpsRecipient[];
  sections: DailyOpsReportSectionsConfig;
  lastSuccessfulDeliveryAt?: string;
  lastDeliveryStatus?: "pending" | "sent" | "partial" | "failed";
  lastReportDate?: string; // YYYY-MM-DD last successfully delivered scheduled reporting date
  lastError?: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface DailyOpsMovementItem {
  reservationRef: string;
  roomNumber: string;
  guestInitials: string;
  status: string;
  detail?: string;
}

export interface DailyOpsRoomTransitionItem {
  roomNumber: string;
  action: string;
  timestamp: string;
}

export interface DailyOpsMaintenanceItem {
  roomNumber: string;
  category: string;
  priority: string;
  status: string;
  summary: string;
}

export interface DailyOpsReportData {
  hotelId: string;
  hotelName: string;
  reportDate: string; // YYYY-MM-DD (preceding calendar day in hotel timezone)
  periodLabel: string;
  periodStartIso: string;
  periodEndIso: string;
  timezone: string;
  generatedAt: string;
  roomStatus: {
    endOfDaySnapshot: {
      totalRooms: number;
      occupied: number;
      vacant: number;
      available: number;
      reserved: number;
      dirty: number;
      clean: number;
      inspected: number;
      awaitingCleaning: number;
      awaitingInspection: number;
      blocked: number;
      outOfOrder: number;
      underMaintenance: number;
    };
    dailyTransitions: {
      totalRecorded: number;
      cleaningsCompleted: number;
      inspectionsPassed: number;
      inspectionsFailed: number;
      statusChangesRecorded: number;
      notableChanges: DailyOpsRoomTransitionItem[];
    };
  };
  reservations: {
    totalCreated: number;
    confirmed: number;
    pending: number;
    checkedIn: number;
    checkedOut: number;
    cancelled: number;
    noShow: number;
    walkIn: number;
    earlyCheckIns: number;
    earlyCheckOuts: number;
  };
  occupancy: {
    totalRoomInventory: number;
    occupiedRooms: number;
    vacantRooms: number;
    occupancyPercentage: number;
    totalArrivals: number;
    totalDepartures: number;
    currentInHouseGuests: number;
    expectedArrivals: number;
    expectedDepartures: number;
    extendedStays: number;
  };
  arrivalsDepartures: {
    checkedIn: DailyOpsMovementItem[];
    checkedOut: DailyOpsMovementItem[];
    expectedNotCheckedIn: DailyOpsMovementItem[];
    noShows: DailyOpsMovementItem[];
    cancelled: DailyOpsMovementItem[];
    earlyArrivals: DailyOpsMovementItem[];
    earlyDepartures: DailyOpsMovementItem[];
    walkIns: DailyOpsMovementItem[];
  };
  housekeeping: {
    dirtyRooms: number;
    cleanRooms: number;
    inspectedRooms: number;
    awaitingCleaning: number;
    awaitingInspection: number;
    releasedAndReady: number;
    pendingTasks: number;
    completedTasks: number;
    outstandingTasks: number;
    activeGuestRequests: number;
  };
  maintenance: {
    roomsUnderMaintenance: number;
    outOfOrderRooms: number;
    newRequests: number;
    pendingRequests: number;
    inProgressRequests: number;
    completedRequests: number;
    outstandingRequests: number;
    requests: DailyOpsMaintenanceItem[];
  };
  additionalOps: {
    roomTransfersCount: number;
    roomBlocksActive: number;
    vipArrivalsCount: number;
    vipArrivalsRefs: Array<{ reservationRef: string; roomNumber: string }>;
    extendedStaysCount: number;
    outstandingOperationalTasks: number;
  };
  limitations: string[];
}

export interface DailyOpsRecipientDeliveryResult {
  email: string;
  status: "sent" | "failed";
  messageId?: string;
  error?: string;
}

export interface DailyOpsManualResendEntry {
  sentAt: string;
  sentBy: string;
  recipients: string[];
  status: "sent" | "partial" | "failed";
  error?: string;
  idempotencyKey?: string;
}

export interface DailyOpsReportSummarySnapshot {
  totalRooms: number;
  occupiedRooms: number;
  occupancyPercentage: number;
  arrivalsCount: number;
  departuresCount: number;
  noShowsCount: number;
  cancelledCount: number;
  pendingHousekeepingTasks: number;
  outstandingMaintenanceRequests: number;
}

export interface DailyOpsReportRun {
  id: string;
  hotelId: string;
  reportDate: string; // YYYY-MM-DD
  periodLabel: string;
  triggerType: "scheduled" | "manual" | "manual_resend" | "test";
  dispatchMethod?: "Automatic" | "Manual";
  triggeredBy?: string;
  scheduledTime: string;
  timezone: string;
  recipients: string[];
  generationStatus: "generated" | "failed";
  deliveryStatus: "pending" | "sent" | "partial" | "failed";
  scheduledForIso?: string;
  generatedAt: string;
  deliveredAt?: string;
  errorMessage?: string;
  recipientResults: DailyOpsRecipientDeliveryResult[];
  subject: string;
  htmlSnapshot?: string;
  summarySnapshot?: DailyOpsReportSummarySnapshot;
  retryCount: number;
  manualResends: DailyOpsManualResendEntry[];
  idempotencyKey: string;
}

const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
const TIME_HHMM_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_YYYYMMDD_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function validateDailyOpsEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254 || /\s/.test(trimmed)) return false;
  return EMAIL_REGEX.test(trimmed);
}

export function isValidScheduledTime(time: unknown): boolean {
  return typeof time === "string" && TIME_HHMM_REGEX.test(time.trim());
}

export function isValidReportDate(dateStr: unknown): boolean {
  if (typeof dateStr !== "string" || !DATE_YYYYMMDD_REGEX.test(dateStr.trim())) return false;
  const [y, m, d] = dateStr.trim().split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

export function isValidIanaTimezone(tz: unknown): boolean {
  if (typeof tz !== "string" || !tz.trim() || tz.trim().length > 80) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz.trim() }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

export function resolveHotelTimezone(
  hotelDoc?: Record<string, any> | null,
  configuredTimezone?: string | null
): { timezone: string; usedFallback: boolean } {
  if (configuredTimezone && isValidIanaTimezone(configuredTimezone)) {
    return { timezone: configuredTimezone.trim(), usedFallback: false };
  }
  const candidates = [
    hotelDoc?.timezone,
    hotelDoc?.settings?.timezone,
    hotelDoc?.settings?.general?.timezone,
    hotelDoc?.branding?.timezone,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && isValidIanaTimezone(c)) {
      return { timezone: c.trim(), usedFallback: false };
    }
  }
  return { timezone: DEFAULT_DAILY_OPS_TIMEZONE, usedFallback: true };
}

export function createDefaultDailyOpsConfig(
  hotelId: string,
  hotelDoc?: Record<string, any> | null
): DailyOpsReportConfig {
  const { timezone } = resolveHotelTimezone(hotelDoc, null);
  return {
    hotelId,
    enabled: false,
    scheduledTime: DEFAULT_DAILY_OPS_TIME,
    timezone,
    recipients: [],
    sections: { ...DEFAULT_DAILY_OPS_SECTIONS },
    updatedAt: new Date().toISOString(),
  };
}

export function validateAndNormalizeDailyOpsConfig(
  hotelId: string,
  input: Partial<DailyOpsReportConfig>,
  existing?: DailyOpsReportConfig | null,
  hotelDoc?: Record<string, any> | null,
  actor?: string
): { ok: boolean; config: DailyOpsReportConfig; errors: string[] } {
  const errors: string[] = [];
  const base = existing || createDefaultDailyOpsConfig(hotelId, hotelDoc);

  const enabled = typeof input.enabled === "boolean" ? input.enabled : base.enabled;

  const rawTime =
    typeof input.scheduledTime === "string" ? input.scheduledTime.trim() : base.scheduledTime;
  if (!isValidScheduledTime(rawTime)) {
    errors.push("Scheduled delivery time must be in 24-hour HH:mm format (e.g., 00:00).");
  }
  const scheduledTime = isValidScheduledTime(rawTime) ? rawTime : base.scheduledTime;

  const rawTz =
    typeof input.timezone === "string" && input.timezone.trim()
      ? input.timezone.trim()
      : base.timezone;
  if (!isValidIanaTimezone(rawTz)) {
    errors.push(`Invalid IANA timezone "${rawTz}". Select a valid timezone such as Africa/Lagos or UTC.`);
  }
  const timezone = isValidIanaTimezone(rawTz) ? rawTz : base.timezone;

  const rawRecipients = Array.isArray(input.recipients) ? input.recipients : base.recipients;
  if (rawRecipients.length > MAX_DAILY_OPS_RECIPIENTS) {
    errors.push(`A maximum of ${MAX_DAILY_OPS_RECIPIENTS} recipients is allowed.`);
  }

  const normalizedRecipients: DailyOpsRecipient[] = [];
  const seenEmails = new Set<string>();
  const nowIso = new Date().toISOString();

  for (let i = 0; i < rawRecipients.length; i++) {
    const item = rawRecipients[i];
    const emailRaw = typeof item?.email === "string" ? item.email.trim() : "";
    const emailLower = emailRaw.toLowerCase();

    if (!validateDailyOpsEmail(emailRaw)) {
      errors.push(`Recipient #${i + 1} has an invalid email address: "${emailRaw || "(empty)"}".`);
      continue;
    }
    if (seenEmails.has(emailLower)) {
      errors.push(`Duplicate recipient email detected: "${emailLower}".`);
      continue;
    }
    seenEmails.add(emailLower);

    const safeName =
      typeof item?.name === "string" ? item.name.trim().slice(0, 120) : "";
    const safeId =
      typeof item?.id === "string" && /^[a-zA-Z0-9_-]{3,80}$/.test(item.id.trim())
        ? item.id.trim()
        : `rcpt_${i + 1}_${emailLower.replace(/[^a-z0-9]/g, "").slice(0, 20)}`;

    normalizedRecipients.push({
      id: safeId,
      email: emailLower,
      ...(safeName ? { name: safeName } : {}),
      enabled: item?.enabled !== false,
      addedAt: typeof item?.addedAt === "string" && item.addedAt ? item.addedAt : nowIso,
      updatedAt: nowIso,
    });
  }

  const rawSections = input.sections || base.sections || DEFAULT_DAILY_OPS_SECTIONS;
  const sections: DailyOpsReportSectionsConfig = {
    roomStatus: rawSections.roomStatus !== false,
    occupancy: rawSections.occupancy !== false,
    reservations: rawSections.reservations !== false,
    arrivalsDepartures: rawSections.arrivalsDepartures !== false,
    housekeeping: rawSections.housekeeping !== false,
    maintenance: rawSections.maintenance !== false,
    additionalOps: rawSections.additionalOps !== false,
  };

  const config: DailyOpsReportConfig = {
    hotelId,
    enabled,
    scheduledTime,
    timezone,
    recipients: normalizedRecipients,
    sections,
    ...(base.lastSuccessfulDeliveryAt ? { lastSuccessfulDeliveryAt: base.lastSuccessfulDeliveryAt } : {}),
    ...(base.lastDeliveryStatus ? { lastDeliveryStatus: base.lastDeliveryStatus } : {}),
    ...(base.lastReportDate ? { lastReportDate: base.lastReportDate } : {}),
    ...(base.lastError ? { lastError: base.lastError } : {}),
    updatedAt: nowIso,
    ...(actor ? { updatedBy: actor } : base.updatedBy ? { updatedBy: base.updatedBy } : {}),
  };

  return { ok: errors.length === 0, config, errors };
}

export interface ZonedDateParts {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number; // 0-23
  minute: number; // 0-59
  second: number; // 0-59
  dateStr: string; // YYYY-MM-DD
  timeStr: string; // HH:mm
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function getZonedDateParts(date: Date, timezone: string): ZonedDateParts {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: safeTz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") {
      map[p.type] = Number(p.value);
    }
  }
  const year = map.year || date.getUTCFullYear();
  const month = map.month || date.getUTCMonth() + 1;
  const day = map.day || date.getUTCDate();
  const hour = map.hour === 24 ? 0 : map.hour || 0;
  const minute = map.minute || 0;
  const second = map.second || 0;

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    dateStr: `${year}-${pad2(month)}-${pad2(day)}`,
    timeStr: `${pad2(hour)}:${pad2(minute)}`,
  };
}

/**
 * Converts a local wall-clock timestamp in an IANA timezone to the exact UTC Date.
 * Uses 2-pass offset refinement to stay accurate across DST transitions.
 */
export function zonedWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  ms: number,
  timezone: string
): Date {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const targetAsUtcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
  let guess = targetAsUtcMs;

  for (let pass = 0; pass < 3; pass++) {
    const observed = getZonedDateParts(new Date(guess), safeTz);
    const observedAsUtcMs = Date.UTC(
      observed.year,
      observed.month - 1,
      observed.day,
      observed.hour,
      observed.minute,
      observed.second,
      ms
    );
    const diff = targetAsUtcMs - observedAsUtcMs;
    if (diff === 0) break;
    guess += diff;
  }

  return new Date(guess);
}

export function shiftCalendarDate(dateStr: string, deltaDays: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + deltaDays));
  return `${dt.getUTCFullYear()}-${pad2(dt.getUTCMonth() + 1)}-${pad2(dt.getUTCDate())}`;
}

export function formatReportDateLabel(reportDate: string): string {
  const [y, m, d] = reportDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(dt);
}

/**
 * Computes the exact UTC bounds for a specific local calendar day (00:00:00.000 to 23:59:59.999)
 * in the hotel's configured timezone.
 */
export function computeCalendarDayWindow(
  reportDate: string,
  timezone: string
): {
  reportDate: string;
  periodStartUtc: Date;
  periodEndUtc: Date;
  periodStartIso: string;
  periodEndIso: string;
  periodLabel: string;
} {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const [y, m, d] = reportDate.split("-").map(Number);
  const nextDateStr = shiftCalendarDate(reportDate, 1);
  const [ny, nm, nd] = nextDateStr.split("-").map(Number);

  const periodStartUtc = zonedWallTimeToUtc(y, m, d, 0, 0, 0, 0, safeTz);
  const nextDayStartUtc = zonedWallTimeToUtc(ny, nm, nd, 0, 0, 0, 0, safeTz);
  const periodEndUtc = new Date(nextDayStartUtc.getTime() - 1);

  return {
    reportDate,
    periodStartUtc,
    periodEndUtc,
    periodStartIso: periodStartUtc.toISOString(),
    periodEndIso: periodEndUtc.toISOString(),
    periodLabel: `${formatReportDateLabel(reportDate)} (12:00 AM – 11:59 PM ${safeTz})`,
  };
}

/**
 * Computes the preceding full calendar day window relative to `referenceNow` in the hotel's timezone.
 * Example: On Nov 22 at 00:00 local time, returns Nov 21 00:00:00.000 to Nov 21 23:59:59.999 local time.
 */
export function computePreviousCalendarDayWindow(referenceNow: Date, timezone: string) {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const localNow = getZonedDateParts(referenceNow, safeTz);
  const previousDate = shiftCalendarDate(localNow.dateStr, -1);
  return computeCalendarDayWindow(previousDate, safeTz);
}

/**
 * Computes the current calendar day window relative to `referenceNow` in the hotel's timezone.
 * Used for interactive Preview and Send Test operations so live current-day PMS figures match
 * the Dashboard 1-to-1 when no historical date is explicitly chosen.
 */
export function computeCurrentCalendarDayWindow(referenceNow: Date, timezone: string) {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const localNow = getZonedDateParts(referenceNow, safeTz);
  return computeCalendarDayWindow(localNow.dateStr, safeTz);
}

/**
 * Determines whether a hotel is currently due for its scheduled daily operations report delivery.
 * Because the report covers the preceding calendar day, once the hotel's local clock reaches
 * or passes `scheduledTime` (default 00:00) on calendar day D, the target reportDate is D-1.
 */
export function evaluateDailyOpsScheduleDue(
  now: Date,
  timezone: string,
  scheduledTime: string,
  lastCompletedReportDate?: string
): {
  due: boolean;
  reportDate: string;
  scheduledForIso: string;
  localDateStr: string;
  localTimeStr: string;
} {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const safeTime = isValidScheduledTime(scheduledTime) ? scheduledTime : DEFAULT_DAILY_OPS_TIME;
  const [schedHour, schedMinute] = safeTime.split(":").map(Number);

  const localNow = getZonedDateParts(now, safeTz);
  const reportDate = shiftCalendarDate(localNow.dateStr, -1);
  const scheduledForUtc = zonedWallTimeToUtc(
    localNow.year,
    localNow.month,
    localNow.day,
    schedHour,
    schedMinute,
    0,
    0,
    safeTz
  );

  const currentMinutes = localNow.hour * 60 + localNow.minute;
  const scheduledMinutes = schedHour * 60 + schedMinute;

  const hasReachedScheduledTime = currentMinutes >= scheduledMinutes;
  const alreadyDeliveredForDate = lastCompletedReportDate === reportDate;

  return {
    due: hasReachedScheduledTime && !alreadyDeliveredForDate,
    reportDate,
    scheduledForIso: scheduledForUtc.toISOString(),
    localDateStr: localNow.dateStr,
    localTimeStr: localNow.timeStr,
  };
}

/**
 * Computes the next scheduled delivery timestamp in the hotel's timezone for UI display.
 */
export function computeNextScheduledDelivery(
  now: Date,
  timezone: string,
  scheduledTime: string,
  lastCompletedReportDate?: string
): {
  iso: string;
  localDisplay: string;
  targetReportDate: string;
} {
  const safeTz = isValidIanaTimezone(timezone) ? timezone : DEFAULT_DAILY_OPS_TIMEZONE;
  const safeTime = isValidScheduledTime(scheduledTime) ? scheduledTime : DEFAULT_DAILY_OPS_TIME;
  const [schedHour, schedMinute] = safeTime.split(":").map(Number);
  const localNow = getZonedDateParts(now, safeTz);

  const currentMinutes = localNow.hour * 60 + localNow.minute;
  const scheduledMinutes = schedHour * 60 + schedMinute;
  const todayReportDate = shiftCalendarDate(localNow.dateStr, -1);

  let deliveryDateStr = localNow.dateStr;
  if (currentMinutes > scheduledMinutes || lastCompletedReportDate === todayReportDate) {
    deliveryDateStr = shiftCalendarDate(localNow.dateStr, 1);
  }

  const [dy, dm, dd] = deliveryDateStr.split("-").map(Number);
  const nextUtc = zonedWallTimeToUtc(dy, dm, dd, schedHour, schedMinute, 0, 0, safeTz);
  const targetReportDate = shiftCalendarDate(deliveryDateStr, -1);

  const localDisplay = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTz,
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(nextUtc);

  return {
    iso: nextUtc.toISOString(),
    localDisplay,
    targetReportDate,
  };
}
