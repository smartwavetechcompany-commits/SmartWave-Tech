/**
 * Server-Side Service & Background Scheduler for the Automated Daily Hotel
 * Operations Report (Additive feature within the Existing Email Module).
 *
 * Strictly reuses existing Resend email delivery (`sendEmail` in
 * `src/services/emailService.ts`) and existing hotel branding.
 * Never modifies existing PMS business logic, guest templates, or user accounts.
 */

import crypto from "crypto";
import { sendEmail, validateEmailConfig, type SendEmailParams, type SendEmailResult } from "../../../services/emailService.ts";
import { isSafeIdentifier } from "../../../utils/serverSecurity.ts";
import {
  computeCalendarDayWindow,
  computeCurrentCalendarDayWindow,
  computeNextScheduledDelivery,
  computePreviousCalendarDayWindow,
  createDefaultDailyOpsConfig,
  evaluateDailyOpsScheduleDue,
  isValidReportDate,
  resolveHotelTimezone,
  validateAndNormalizeDailyOpsConfig,
  validateDailyOpsEmail,
  type DailyOpsManualResendEntry,
  type DailyOpsRecipientDeliveryResult,
  type DailyOpsReportConfig,
  type DailyOpsReportData,
  type DailyOpsReportRun,
  type DailyOpsReportSectionsConfig,
  type DailyOpsReportSummarySnapshot,
} from "../shared/dailyOpsTypes.ts";
import { buildDailyOperationsReport } from "./dailyOpsAggregator.ts";
import {
  renderDailyOperationsReportEmail,
  type DailyOpsBrandInfo,
  type RenderedDailyOpsEmail,
} from "./dailyOpsRenderer.ts";
import {
  decodeFirestoreDocument,
  fsReadDoc,
  fsSetDoc,
  getFirebaseAppletConfig,
} from "./firestoreRest.ts";
import { getHotelEmailSettings } from "./resolver.ts";

export type DailyOpsEmailSender = (params: SendEmailParams) => Promise<SendEmailResult>;

const CONFIG_DOC_ID = "default";
const MAX_COLLECTION_READ = 2000;

let cachedAdminDb: any | null | undefined = undefined;

/**
 * Returns Firebase Admin Firestore ONLY if firebase-admin is installed AND an Admin App
 * was already initialized (e.g., via FIREBASE_SERVICE_ACCOUNT_KEY in server.ts).
 * Uses dynamic import inside try/catch so production installs without devDependencies
 * never fail to boot.
 */
async function getOptionalAdminFirestore(): Promise<any | null> {
  if (cachedAdminDb !== undefined) return cachedAdminDb;
  try {
    const { getApps: getAdminApps } = await import("firebase-admin/app");
    const apps = getAdminApps();
    if (apps.length > 0) {
      const { getFirestore: getAdminFirestore } = await import("firebase-admin/firestore");
      const cfg = getFirebaseAppletConfig();
      const databaseId =
        typeof cfg.firestoreDatabaseId === "string" &&
        cfg.firestoreDatabaseId.trim() &&
        cfg.firestoreDatabaseId.trim() !== "(default)"
          ? cfg.firestoreDatabaseId.trim()
          : undefined;
      cachedAdminDb = databaseId ? getAdminFirestore(apps[0], databaseId) : getAdminFirestore(apps[0]);
      return cachedAdminDb;
    }
    return null;
  } catch {
    cachedAdminDb = null;
    return null;
  }
}

async function readDoc(
  docPath: string,
  bearerToken?: string
): Promise<Record<string, any> | null> {
  if (!bearerToken) {
    const adminDb = await getOptionalAdminFirestore();
    if (adminDb) {
      const snap = await adminDb.doc(docPath).get();
      if (!snap.exists) return null;
      return { id: snap.id, ...(snap.data() || {}) };
    }
  }
  return fsReadDoc(docPath, bearerToken);
}

async function writeDoc(
  docPath: string,
  data: Record<string, any>,
  bearerToken?: string
): Promise<{ ok: boolean; error?: string }> {
  if (!bearerToken) {
    const adminDb = await getOptionalAdminFirestore();
    if (adminDb) {
      await adminDb.doc(docPath).set(stripUndefinedDeep(data));
      return { ok: true };
    }
  }
  const res = await fsSetDoc(docPath, stripUndefinedDeep(data), bearerToken);
  return { ok: res.ok, error: res.error };
}

async function listCollectionAll(
  collectionPath: string,
  bearerToken?: string,
  maxDocs = MAX_COLLECTION_READ
): Promise<Array<Record<string, any> & { id: string }>> {
  if (!bearerToken) {
    const adminDb = await getOptionalAdminFirestore();
    if (adminDb) {
      const snap = await adminDb.collection(collectionPath).limit(maxDocs).get();
      return snap.docs.map((d: any) => ({ ...(d.data() as Record<string, any>), id: d.id }));
    }
  }

  const cfg = getFirebaseAppletConfig();
  const projectId = cfg.projectId;
  if (!projectId) {
    throw new Error("Firebase projectId is missing in firebase-applet-config.json.");
  }
  const databaseId =
    typeof cfg.firestoreDatabaseId === "string" && cfg.firestoreDatabaseId.trim()
      ? cfg.firestoreDatabaseId.trim()
      : "(default)";
  const baseUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${encodeURIComponent(databaseId)}/documents`;
  const headers: Record<string, string> = {};
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const results: Array<Record<string, any> & { id: string }> = [];
  let pageToken = "";

  while (results.length < maxDocs) {
    const pageSize = Math.min(300, maxDocs - results.length);
    const qs = new URLSearchParams({ pageSize: String(pageSize) });
    if (pageToken) qs.set("pageToken", pageToken);

    const resp = await fetch(`${baseUrl}/${collectionPath}?${qs.toString()}`, { headers });
    if (resp.status === 404) break;
    if (!resp.ok) {
      const errText = await resp.text().catch(() => "");
      throw new Error(
        `Firestore list failed (${resp.status}) for ${collectionPath}: ${errText.slice(0, 140)}`
      );
    }
    const json = await resp.json();
    const docs = Array.isArray(json?.documents) ? json.documents : [];
    for (const d of docs) {
      const decoded = decodeFirestoreDocument(d);
      const id =
        typeof d?.name === "string" ? d.name.split("/").pop() || "" : decoded.id || "";
      results.push({ ...decoded, id });
    }
    if (!json?.nextPageToken || docs.length === 0) break;
    pageToken = String(json.nextPageToken);
  }

  return results;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((v) => stripUndefinedDeep(v)) as unknown as T;
  }
  if (value && typeof value === "object" && !(value instanceof Date)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value as Record<string, any>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function summarizeReport(report: DailyOpsReportData): DailyOpsReportSummarySnapshot {
  return {
    totalRooms: report.roomStatus.endOfDaySnapshot.totalRooms,
    occupiedRooms: report.occupancy.occupiedRooms,
    occupancyPercentage: report.occupancy.occupancyPercentage,
    arrivalsCount: report.occupancy.totalArrivals,
    departuresCount: report.occupancy.totalDepartures,
    noShowsCount: report.reservations.noShow,
    cancelledCount: report.reservations.cancelled,
    pendingHousekeepingTasks: report.housekeeping.outstandingTasks,
    outstandingMaintenanceRequests: report.maintenance.outstandingRequests,
  };
}

function resolveHotelBrand(
  hotelDoc: Record<string, any> | null,
  emailSettings?: Record<string, any> | null
): DailyOpsBrandInfo {
  const branding = hotelDoc?.branding || {};
  return {
    hotelName:
      emailSettings?.senderName ||
      branding.organizationName ||
      hotelDoc?.name ||
      "Hotel Property",
    logoUrl: emailSettings?.logoUrl || branding.logoUrl || hotelDoc?.logoUrl || "",
    primaryColor: emailSettings?.primaryColor || branding.primaryColor || "#0f766e",
    secondaryColor: branding.secondaryColor || "#0f172a",
    address: branding.address || hotelDoc?.address || "",
    phone: branding.phone || hotelDoc?.phone || "",
    supportEmail: branding.email || hotelDoc?.email || "",
    replyTo: emailSettings?.replyTo || branding.email || hotelDoc?.email || undefined,
  };
}

function buildConfigPath(hotelId: string): string {
  return `hotels/${hotelId}/dailyOpsReportConfig/${CONFIG_DOC_ID}`;
}

function buildRunPath(hotelId: string, runId: string): string {
  return `hotels/${hotelId}/dailyOpsReportRuns/${runId}`;
}

export async function getDailyOpsConfig(
  hotelId: string,
  hotelDoc?: Record<string, any> | null,
  bearerToken?: string
): Promise<{
  config: DailyOpsReportConfig;
  timezoneFallbackUsed: boolean;
  nextScheduledDelivery: ReturnType<typeof computeNextScheduledDelivery>;
}> {
  const resolvedHotelDoc =
    hotelDoc !== undefined
      ? hotelDoc
      : await readDoc(`hotels/${hotelId}`, bearerToken).catch(() => null);
  const stored = await readDoc(buildConfigPath(hotelId), bearerToken).catch(() => null);

  let config: DailyOpsReportConfig;
  let timezoneFallbackUsed = false;

  if (stored && typeof stored === "object") {
    const { config: normalized } = validateAndNormalizeDailyOpsConfig(
      hotelId,
      stored as Partial<DailyOpsReportConfig>,
      createDefaultDailyOpsConfig(hotelId, resolvedHotelDoc),
      resolvedHotelDoc
    );
    config = {
      ...normalized,
      lastSuccessfulDeliveryAt: stored.lastSuccessfulDeliveryAt || undefined,
      lastDeliveryStatus: stored.lastDeliveryStatus || undefined,
      lastReportDate: stored.lastReportDate || undefined,
      lastError: stored.lastError || undefined,
    };
  } else {
    config = createDefaultDailyOpsConfig(hotelId, resolvedHotelDoc);
    timezoneFallbackUsed = resolveHotelTimezone(resolvedHotelDoc, null).usedFallback;
  }

  const nextScheduledDelivery = computeNextScheduledDelivery(
    new Date(),
    config.timezone,
    config.scheduledTime,
    config.lastReportDate
  );

  return { config, timezoneFallbackUsed, nextScheduledDelivery };
}

export async function saveDailyOpsConfig(
  hotelId: string,
  patch: Partial<DailyOpsReportConfig>,
  actor: string,
  hotelDoc?: Record<string, any> | null,
  bearerToken?: string
): Promise<{
  ok: boolean;
  config?: DailyOpsReportConfig;
  errors?: string[];
  nextScheduledDelivery?: ReturnType<typeof computeNextScheduledDelivery>;
}> {
  const resolvedHotelDoc =
    hotelDoc !== undefined
      ? hotelDoc
      : await readDoc(`hotels/${hotelId}`, bearerToken).catch(() => null);
  const existingWrap = await getDailyOpsConfig(hotelId, resolvedHotelDoc, bearerToken);

  const validation = validateAndNormalizeDailyOpsConfig(
    hotelId,
    patch,
    existingWrap.config,
    resolvedHotelDoc,
    actor
  );

  if (!validation.ok) {
    return { ok: false, errors: validation.errors };
  }

  const writeRes = await writeDoc(
    buildConfigPath(hotelId),
    validation.config,
    bearerToken
  );
  if (!writeRes.ok) {
    return { ok: false, errors: [writeRes.error || "Failed to save Daily Operations Report configuration."] };
  }

  const nextScheduledDelivery = computeNextScheduledDelivery(
    new Date(),
    validation.config.timezone,
    validation.config.scheduledTime,
    validation.config.lastReportDate
  );

  return {
    ok: true,
    config: validation.config,
    nextScheduledDelivery,
  };
}

export async function listDailyOpsRuns(
  hotelId: string,
  bearerToken?: string,
  limitCount = 30
): Promise<DailyOpsReportRun[]> {
  const docs = await listCollectionAll(
    `hotels/${hotelId}/dailyOpsReportRuns`,
    bearerToken,
    Math.min(200, Math.max(10, limitCount * 2))
  ).catch(() => []);

  const runs = docs
    .map((d) => ({
      ...d,
      id: String(d.id || d.reportDate || ""),
      recipients: Array.isArray(d.recipients) ? d.recipients : [],
      recipientResults: Array.isArray(d.recipientResults) ? d.recipientResults : [],
      manualResends: Array.isArray(d.manualResends) ? d.manualResends : [],
      retryCount: typeof d.retryCount === "number" ? d.retryCount : 0,
    })) as DailyOpsReportRun[];

  runs.sort((a, b) => {
    const tA = new Date(a.generatedAt || a.reportDate || 0).getTime();
    const tB = new Date(b.generatedAt || b.reportDate || 0).getTime();
    return tB - tA;
  });

  return runs.slice(0, limitCount);
}

export async function getDailyOpsRun(
  hotelId: string,
  runId: string,
  bearerToken?: string
): Promise<DailyOpsReportRun | null> {
  if (!isSafeIdentifier(runId)) return null;
  const doc = await readDoc(buildRunPath(hotelId, runId), bearerToken).catch(() => null);
  if (!doc) return null;
  return {
    ...(doc as DailyOpsReportRun),
    id: String(doc.id || runId),
    recipients: Array.isArray(doc.recipients) ? doc.recipients : [],
    recipientResults: Array.isArray(doc.recipientResults) ? doc.recipientResults : [],
    manualResends: Array.isArray(doc.manualResends) ? doc.manualResends : [],
    retryCount: typeof doc.retryCount === "number" ? doc.retryCount : 0,
  };
}

/**
 * Strictly read-only live generation of the Daily Hotel Operations Report for a single hotel.
 */
export async function generateDailyOpsReportForHotel(params: {
  hotelId: string;
  reportDate?: string;
  defaultToCurrentDay?: boolean;
  timezoneOverride?: string;
  sectionsOverride?: Partial<DailyOpsReportSectionsConfig>;
  bearerToken?: string;
}): Promise<{
  report: DailyOpsReportData;
  rendered: RenderedDailyOpsEmail;
  config: DailyOpsReportConfig;
}> {
  const { hotelId, bearerToken, defaultToCurrentDay = false } = params;

  const [hotelDoc, emailSettings] = await Promise.all([
    readDoc(`hotels/${hotelId}`, bearerToken).catch(() => null),
    getHotelEmailSettings(hotelId, bearerToken).catch(() => null),
  ]);
  const { config } = await getDailyOpsConfig(hotelId, hotelDoc, bearerToken);

  const timezone = params.timezoneOverride || config.timezone;
  const window =
    params.reportDate && isValidReportDate(params.reportDate)
      ? computeCalendarDayWindow(params.reportDate, timezone)
      : defaultToCurrentDay
        ? computeCurrentCalendarDayWindow(new Date(), timezone)
        : computePreviousCalendarDayWindow(new Date(), timezone);

  // Read authoritative tenant-scoped PMS collections in parallel (strictly read-only)
  const readLimitations: string[] = [];
  const safeList = (sub: string, critical = false) =>
    listCollectionAll(`hotels/${hotelId}/${sub}`, bearerToken).catch((err: any) => {
      console.warn(
        `[DailyOpsReport] Failed to read hotels/${hotelId}/${sub}:`,
        err?.message || err
      );
      if (critical) {
        readLimitations.push(
          `Could not load live "${sub}" records due to a data-read error; figures may be incomplete.`
        );
      }
      return [];
    });

  const [
    rooms,
    reservations,
    roomBlockings,
    maintenance,
    housekeepingCleanings,
    housekeepingInspections,
    housekeepingRequests,
    tasks,
    activityLogs,
    checkinHistory,
    checkoutHistory,
    guests,
  ] = await Promise.all([
    safeList("rooms", true),
    safeList("reservations", true),
    safeList("room_blockings"),
    safeList("maintenance"),
    safeList("housekeeping_cleanings"),
    safeList("housekeeping_inspections"),
    safeList("housekeeping_requests"),
    safeList("tasks"),
    safeList("activityLogs"),
    safeList("checkin_history"),
    safeList("checkout_history"),
    safeList("guests"),
  ]);

  const report = buildDailyOperationsReport({
    hotelId,
    hotelDoc,
    rooms,
    reservations,
    roomBlockings,
    maintenance,
    housekeepingCleanings,
    housekeepingInspections,
    housekeepingRequests,
    tasks,
    activityLogs,
    checkinHistory,
    checkoutHistory,
    guests,
    reportDate: window.reportDate,
    periodStartUtc: window.periodStartUtc,
    periodEndUtc: window.periodEndUtc,
    timezone,
    initialLimitations: readLimitations,
  });

  const brand = resolveHotelBrand(hotelDoc, emailSettings as any);
  const rendered = renderDailyOperationsReportEmail(
    report,
    brand,
    params.sectionsOverride || config.sections
  );

  return { report, rendered, config };
}

async function deliverToRecipientList(params: {
  hotelId: string;
  recipients: string[];
  subject: string;
  html: string;
  text: string;
  fromName: string;
  replyTo?: string;
  idempotencyPrefix: string;
  eventTag: string;
  sendEmailFn?: DailyOpsEmailSender;
}): Promise<{
  deliveryStatus: "sent" | "partial" | "failed";
  recipientResults: DailyOpsRecipientDeliveryResult[];
  errorMessage?: string;
}> {
  const sender = params.sendEmailFn || sendEmail;
  const recipientResults: DailyOpsRecipientDeliveryResult[] = [];

  for (let i = 0; i < params.recipients.length; i++) {
    const email = params.recipients[i];
    // Space out live Resend deliveries slightly to stay safely within 2 req/s rate limits
    if (i > 0 && !params.sendEmailFn) {
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    const emailHash = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 12);
    const idempotencyKey = `${params.idempotencyPrefix}_${emailHash}`;
    try {
      const res = await sender({
        to: email,
        subject: params.subject,
        html: params.html,
        text: params.text,
        fromName: params.fromName,
        replyTo: params.replyTo,
        idempotencyKey,
        tags: [
          { name: "hotel_id", value: params.hotelId },
          { name: "event", value: params.eventTag },
        ],
      });
      if (res.success) {
        recipientResults.push({
          email,
          status: "sent",
          messageId: res.messageId,
        });
      } else {
        recipientResults.push({
          email,
          status: "failed",
          error: res.error || "Email provider declined delivery.",
        });
      }
    } catch (err: any) {
      recipientResults.push({
        email,
        status: "failed",
        error: err?.message || "Unexpected error while delivering report email.",
      });
    }
  }

  const sentCount = recipientResults.filter((r) => r.status === "sent").length;
  const failedResults = recipientResults.filter((r) => r.status === "failed");

  let deliveryStatus: "sent" | "partial" | "failed";
  if (recipientResults.length > 0 && sentCount === recipientResults.length) {
    deliveryStatus = "sent";
  } else if (sentCount > 0) {
    deliveryStatus = "partial";
  } else {
    deliveryStatus = "failed";
  }

  const errorMessage =
    failedResults.length > 0
      ? failedResults
          .slice(0, 3)
          .map((r) => `${r.email}: ${r.error || "failed"}`)
          .join("; ")
      : undefined;

  return { deliveryStatus, recipientResults, errorMessage };
}

async function logEmailNotificationAudit(params: {
  hotelId: string;
  eventType: string;
  recipients: string[];
  subject: string;
  status: string;
  error?: string;
  bearerToken?: string;
}): Promise<void> {
  try {
    const logId = `daily_ops_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
    await writeDoc(
      `hotels/${params.hotelId}/emailNotifications/${logId}`,
      {
        logId,
        hotelId: params.hotelId,
        eventType: params.eventType,
        audience: "hotel_staff",
        recipients: params.recipients,
        subject: params.subject,
        status: params.status,
        error: params.error || "",
        provider: "resend",
        createdAt: new Date().toISOString(),
      },
      params.bearerToken
    );
  } catch {
    // Audit logging is non-blocking
  }
}

const inFlightDailyOpsHotels = new Set<string>();
const RECENTLY_DELIVERED_TTL_MS = 12 * 60 * 60 * 1000; // 12h volatile in-memory duplicate guard
const recentlyDeliveredDailyOps = new Map<string, number>();
const AUTO_RETRY_BACKOFF_MS = 15 * 60 * 1000;
const MAX_AUTO_RETRIES = 3;

export function clearRecentlyDeliveredDailyOps(): void {
  recentlyDeliveredDailyOps.clear();
}

function isRecentlyDeliveredInMemory(lockKey: string, nowMs = Date.now()): boolean {
  const expiresAt = recentlyDeliveredDailyOps.get(lockKey);
  if (!expiresAt) return false;
  if (expiresAt <= nowMs) {
    recentlyDeliveredDailyOps.delete(lockKey);
    return false;
  }
  return true;
}

function markRecentlyDeliveredInMemory(lockKey: string, nowMs = Date.now()): void {
  recentlyDeliveredDailyOps.set(lockKey, nowMs + RECENTLY_DELIVERED_TTL_MS);
}

/**
 * Executes a single scheduled daily operations report run for a hotel & reporting date.
 * Strictly idempotent via deterministic runId = reportDate (`YYYY-MM-DD`), in-flight mutex,
 * and volatile in-memory duplicate guard in case of transient Firestore write blips.
 */
export async function executeScheduledDailyOpsRun(params: {
  hotelId: string;
  reportDate: string;
  scheduledForIso?: string;
  bearerToken?: string;
  dryRun?: boolean;
  forceRetry?: boolean;
  sendEmailFn?: DailyOpsEmailSender;
}): Promise<{
  status: "sent" | "partial" | "failed" | "skipped" | "dry_run";
  reason?: string;
  run?: DailyOpsReportRun;
}> {
  const { hotelId, reportDate, scheduledForIso, bearerToken, dryRun, forceRetry, sendEmailFn } = params;
  const runId = reportDate;
  const idempotencyKey = `daily_ops_${hotelId}_${reportDate}`;
  const lockKey = `${hotelId}:${reportDate}`;

  if (inFlightDailyOpsHotels.has(lockKey)) {
    return { status: "skipped", reason: "in_flight" };
  }
  if (!dryRun && isRecentlyDeliveredInMemory(lockKey)) {
    return { status: "skipped", reason: "already_sent" };
  }
  inFlightDailyOpsHotels.add(lockKey);

  try {
    // 1. Check existing scheduled run for strict duplicate prevention & failed-run auto-retry backoff
    const existingRun = await getDailyOpsRun(hotelId, runId, bearerToken);
    if (existingRun && existingRun.deliveryStatus === "sent") {
      markRecentlyDeliveredInMemory(lockKey);
      return { status: "skipped", reason: "already_sent", run: existingRun };
    }
    if (
      !forceRetry &&
      existingRun &&
      (existingRun.deliveryStatus === "failed" || existingRun.deliveryStatus === "partial")
    ) {
      if ((existingRun.retryCount || 0) >= MAX_AUTO_RETRIES) {
        return { status: "skipped", reason: "max_auto_retries_reached", run: existingRun };
      }
      const lastAttemptMs = existingRun.generatedAt ? new Date(existingRun.generatedAt).getTime() : 0;
      if (Number.isFinite(lastAttemptMs) && lastAttemptMs > 0 && Date.now() - lastAttemptMs < AUTO_RETRY_BACKOFF_MS) {
        return { status: "skipped", reason: "retry_backoff_active", run: existingRun };
      }
    }

    const { config } = await getDailyOpsConfig(hotelId, undefined, bearerToken);
    const activeRecipients = config.recipients
      .filter((r) => r.enabled && validateDailyOpsEmail(r.email))
      .map((r) => r.email.toLowerCase());

    if (activeRecipients.length === 0) {
      return { status: "skipped", reason: "no_active_recipients" };
    }

    if (dryRun) {
      return { status: "dry_run", reason: `would_send_to_${activeRecipients.length}_recipients` };
    }

  const nowIso = new Date().toISOString();

  // 2. Generate report (or reuse preserved snapshot if retrying)
  let rendered: RenderedDailyOpsEmail;
  let periodLabel: string;
  let summarySnapshot: DailyOpsReportSummarySnapshot;

  try {
    const generated = await generateDailyOpsReportForHotel({
      hotelId,
      reportDate,
      bearerToken,
    });
    rendered = generated.rendered;
    periodLabel = generated.report.periodLabel;
    summarySnapshot = summarizeReport(generated.report);
  } catch (err: any) {
    const failedRun: DailyOpsReportRun = {
      id: runId,
      hotelId,
      reportDate,
      periodLabel: reportDate,
      triggerType: "scheduled",
      scheduledTime: config.scheduledTime,
      timezone: config.timezone,
      recipients: activeRecipients,
      generationStatus: "failed",
      deliveryStatus: "failed",
      scheduledForIso,
      generatedAt: nowIso,
      errorMessage: err?.message || "Failed to generate Daily Operations Report.",
      recipientResults: [],
      subject: `Daily Hotel Operations Report – ${reportDate}`,
      retryCount: existingRun ? existingRun.retryCount + 1 : 0,
      manualResends: existingRun?.manualResends || [],
      idempotencyKey,
    };
    await writeDoc(buildRunPath(hotelId, runId), failedRun, bearerToken);
    await writeDoc(
      buildConfigPath(hotelId),
      {
        ...config,
        lastDeliveryStatus: "failed",
        lastError: failedRun.errorMessage,
        updatedAt: nowIso,
      },
      bearerToken
    );
    return { status: "failed", reason: failedRun.errorMessage, run: failedRun };
  }

  // 3. Deliver via existing Resend email service
  const delivery = await deliverToRecipientList({
    hotelId,
    recipients: activeRecipients,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
    fromName: rendered.fromName,
    replyTo: rendered.replyTo,
    idempotencyPrefix: idempotencyKey,
    eventTag: "daily_operations_report",
    sendEmailFn,
  });

  const deliveredAt = delivery.deliveryStatus === "sent" ? new Date().toISOString() : undefined;
  if (delivery.deliveryStatus === "sent") {
    markRecentlyDeliveredInMemory(lockKey);
  }

  // 4. Persist complete run record including preserved HTML snapshot for audit & retry
  const runRecord: DailyOpsReportRun = {
    id: runId,
    hotelId,
    reportDate,
    periodLabel,
    triggerType: "scheduled",
    scheduledTime: config.scheduledTime,
    timezone: config.timezone,
    recipients: activeRecipients,
    generationStatus: "generated",
    deliveryStatus: delivery.deliveryStatus,
    scheduledForIso,
    generatedAt: nowIso,
    ...(deliveredAt ? { deliveredAt } : {}),
    ...(delivery.errorMessage ? { errorMessage: delivery.errorMessage } : {}),
    recipientResults: delivery.recipientResults,
    subject: rendered.subject,
    htmlSnapshot: rendered.html,
    summarySnapshot,
    retryCount: existingRun ? existingRun.retryCount + 1 : 0,
    manualResends: existingRun?.manualResends || [],
    idempotencyKey,
  };

  const runWriteRes = await writeDoc(buildRunPath(hotelId, runId), runRecord, bearerToken);
  if (!runWriteRes.ok) {
    console.warn(
      `[DailyOpsScheduler] Could not persist run record for hotel=${hotelId} date=${reportDate}: ${runWriteRes.error || "write failed"}`
    );
  }

  // 5. Update config status fields without touching recipients or schedule settings
  const updatedConfig: DailyOpsReportConfig = {
    ...config,
    lastDeliveryStatus: delivery.deliveryStatus,
    ...(deliveredAt
      ? {
          lastSuccessfulDeliveryAt: deliveredAt,
          lastReportDate: reportDate,
          lastError: "",
        }
      : {
          lastError: delivery.errorMessage || "Delivery failed.",
        }),
    updatedAt: new Date().toISOString(),
  };
  const cfgWriteRes = await writeDoc(buildConfigPath(hotelId), updatedConfig, bearerToken);
  if (!cfgWriteRes.ok) {
    console.warn(
      `[DailyOpsScheduler] Could not update config status for hotel=${hotelId} date=${reportDate}: ${cfgWriteRes.error || "write failed"}`
    );
  }

  await logEmailNotificationAudit({
    hotelId,
    eventType: "daily_operations_report",
    recipients: activeRecipients,
    subject: rendered.subject,
    status: delivery.deliveryStatus,
    error: delivery.errorMessage,
    bearerToken,
  });

    return { status: delivery.deliveryStatus, run: runRecord };
  } finally {
    inFlightDailyOpsHotels.delete(lockKey);
  }
}

/**
 * Retries a previously failed or partially delivered run without duplicating already-sent recipients.
 */
export async function retryFailedDailyOpsRun(params: {
  hotelId: string;
  runId: string;
  actor: string;
  bearerToken?: string;
  sendEmailFn?: DailyOpsEmailSender;
}): Promise<{ ok: boolean; error?: string; run?: DailyOpsReportRun }> {
  const { hotelId, runId, bearerToken, sendEmailFn } = params;
  const existing = await getDailyOpsRun(hotelId, runId, bearerToken);
  if (!existing) {
    return { ok: false, error: "Report run not found." };
  }
  if (existing.deliveryStatus === "sent") {
    return { ok: false, error: "This report was already delivered successfully. Use Manual Resend instead." };
  }

  // If generation originally failed or no preserved HTML exists, regenerate cleanly
  if (existing.generationStatus === "failed" || !existing.htmlSnapshot) {
    const result = await executeScheduledDailyOpsRun({
      hotelId,
      reportDate: existing.reportDate,
      scheduledForIso: existing.scheduledForIso,
      bearerToken,
      forceRetry: true,
      sendEmailFn,
    });
    return {
      ok: result.status === "sent" || result.status === "partial",
      error: result.status === "failed" ? result.reason : undefined,
      run: result.run,
    };
  }

  // Determine which recipients still need delivery
  const alreadySentEmails = new Set(
    existing.recipientResults
      .filter((r) => r.status === "sent")
      .map((r) => r.email.toLowerCase())
  );

  const { config } = await getDailyOpsConfig(hotelId, undefined, bearerToken);
  const baseRecipients =
    existing.recipients.length > 0
      ? existing.recipients
      : config.recipients.filter((r) => r.enabled).map((r) => r.email.toLowerCase());

  const pendingRecipients = baseRecipients.filter(
    (email) => validateDailyOpsEmail(email) && !alreadySentEmails.has(email.toLowerCase())
  );

  if (pendingRecipients.length === 0) {
    return { ok: false, error: "No failed or pending recipients remain to retry." };
  }

  const hotelDoc = await readDoc(`hotels/${hotelId}`, bearerToken).catch(() => null);
  const emailSettings = await getHotelEmailSettings(hotelId, bearerToken).catch(() => null);
  const brand = resolveHotelBrand(hotelDoc, emailSettings as any);

  const nextRetryNumber = existing.retryCount + 1;
  const retryDelivery = await deliverToRecipientList({
    hotelId,
    recipients: pendingRecipients,
    subject: existing.subject,
    html: existing.htmlSnapshot,
    text: `Daily Hotel Operations Report (${existing.reportDate})`,
    fromName: brand.hotelName,
    replyTo: brand.replyTo,
    idempotencyPrefix: `${existing.idempotencyKey}_retry${nextRetryNumber}`,
    eventTag: "daily_operations_report_retry",
    sendEmailFn,
  });

  // Merge prior successful results with new retry results
  const mergedResultsMap = new Map<string, DailyOpsRecipientDeliveryResult>();
  for (const r of existing.recipientResults) {
    if (r.status === "sent") mergedResultsMap.set(r.email.toLowerCase(), r);
  }
  for (const r of retryDelivery.recipientResults) {
    mergedResultsMap.set(r.email.toLowerCase(), r);
  }
  const mergedResults = Array.from(mergedResultsMap.values());
  const allSent = mergedResults.length > 0 && mergedResults.every((r) => r.status === "sent");
  const anySent = mergedResults.some((r) => r.status === "sent");
  const finalStatus: "sent" | "partial" | "failed" = allSent
    ? "sent"
    : anySent
      ? "partial"
      : "failed";
  const deliveredAt = allSent ? new Date().toISOString() : existing.deliveredAt;
  const remainingErrors = mergedResults
    .filter((r) => r.status === "failed")
    .map((r) => `${r.email}: ${r.error || "failed"}`)
    .join("; ");

  const updatedRun: DailyOpsReportRun = {
    ...existing,
    deliveryStatus: finalStatus,
    ...(deliveredAt ? { deliveredAt } : {}),
    errorMessage: remainingErrors || undefined,
    recipientResults: mergedResults,
    retryCount: nextRetryNumber,
  };

  if (allSent && existing.triggerType === "scheduled") {
    markRecentlyDeliveredInMemory(`${hotelId}:${existing.reportDate}`);
  }

  await writeDoc(buildRunPath(hotelId, runId), updatedRun, bearerToken);

  if (existing.triggerType === "scheduled") {
    await writeDoc(
      buildConfigPath(hotelId),
      {
        ...config,
        lastDeliveryStatus: finalStatus,
        ...(allSent
          ? {
              lastSuccessfulDeliveryAt: deliveredAt,
              lastReportDate: existing.reportDate,
              lastError: "",
            }
          : {
              lastError: remainingErrors || "Retry failed.",
            }),
        updatedAt: new Date().toISOString(),
      },
      bearerToken
    );
  }

  return {
    ok: finalStatus === "sent" || finalStatus === "partial",
    error: finalStatus === "failed" ? remainingErrors || "Retry delivery failed." : undefined,
    run: updatedRun,
  };
}

/**
 * Manually resends a previously generated report without modifying scheduled execution markers.
 * Includes idempotencyKey guard to protect against duplicate rapid clicks.
 */
export async function manualResendDailyOpsRun(params: {
  hotelId: string;
  runId: string;
  recipientsOverride?: string[];
  actor: string;
  idempotencyKey?: string;
  bearerToken?: string;
  sendEmailFn?: DailyOpsEmailSender;
}): Promise<{ ok: boolean; duplicate?: boolean; error?: string; run?: DailyOpsReportRun }> {
  const { hotelId, runId, recipientsOverride, actor, idempotencyKey, bearerToken, sendEmailFn } =
    params;

  const existing = await getDailyOpsRun(hotelId, runId, bearerToken);
  if (!existing) {
    return { ok: false, error: "Report run not found." };
  }
  if (!existing.htmlSnapshot) {
    return { ok: false, error: "No preserved report snapshot is available for this run." };
  }

  // Guard against duplicate clicks using client-supplied idempotencyKey
  if (
    idempotencyKey &&
    existing.manualResends.some((entry) => entry.idempotencyKey === idempotencyKey)
  ) {
    return { ok: true, duplicate: true, run: existing };
  }

  const { config } = await getDailyOpsConfig(hotelId, undefined, bearerToken);
  const rawTargets =
    Array.isArray(recipientsOverride) && recipientsOverride.length > 0
      ? recipientsOverride
      : config.recipients.filter((r) => r.enabled).map((r) => r.email);

  const uniqueTargets = Array.from(
    new Set(
      rawTargets
        .map((e) => (typeof e === "string" ? e.trim().toLowerCase() : ""))
        .filter((e) => validateDailyOpsEmail(e))
    )
  );

  if (uniqueTargets.length === 0) {
    return { ok: false, error: "No valid enabled recipients found for manual resend." };
  }

  const hotelDoc = await readDoc(`hotels/${hotelId}`, bearerToken).catch(() => null);
  const emailSettings = await getHotelEmailSettings(hotelId, bearerToken).catch(() => null);
  const brand = resolveHotelBrand(hotelDoc, emailSettings as any);

  const resendKey = idempotencyKey || `resend_${Date.now()}_${crypto.randomBytes(3).toString("hex")}`;
  const delivery = await deliverToRecipientList({
    hotelId,
    recipients: uniqueTargets,
    subject: existing.subject,
    html: existing.htmlSnapshot,
    text: `Daily Hotel Operations Report (${existing.reportDate})`,
    fromName: brand.hotelName,
    replyTo: brand.replyTo,
    idempotencyPrefix: `daily_ops_manual_${hotelId}_${runId}_${resendKey}`,
    eventTag: "daily_operations_report_resend",
    sendEmailFn,
  });

  const auditEntry: DailyOpsManualResendEntry = {
    sentAt: new Date().toISOString(),
    sentBy: actor,
    recipients: uniqueTargets,
    status: delivery.deliveryStatus,
    ...(delivery.errorMessage ? { error: delivery.errorMessage } : {}),
    idempotencyKey: resendKey,
  };

  const updatedRun: DailyOpsReportRun = {
    ...existing,
    manualResends: [auditEntry, ...existing.manualResends].slice(0, 25),
  };

  await writeDoc(buildRunPath(hotelId, runId), updatedRun, bearerToken);

  await logEmailNotificationAudit({
    hotelId,
    eventType: "daily_operations_report_resend",
    recipients: uniqueTargets,
    subject: existing.subject,
    status: delivery.deliveryStatus,
    error: delivery.errorMessage,
    bearerToken,
  });

  return {
    ok: delivery.deliveryStatus === "sent" || delivery.deliveryStatus === "partial",
    error: delivery.deliveryStatus === "failed" ? delivery.errorMessage : undefined,
    run: updatedRun,
  };
}

/**
 * Sends a test Daily Operations Report email strictly without affecting scheduled markers
 * or production scheduled run records.
 */
export async function sendDailyOpsTestReport(params: {
  hotelId: string;
  targetEmail: string;
  reportDate?: string;
  actor: string;
  bearerToken?: string;
  sendEmailFn?: DailyOpsEmailSender;
}): Promise<{
  ok: boolean;
  sentTo?: string;
  reportDate?: string;
  messageId?: string;
  error?: string;
}> {
  const { hotelId, targetEmail, reportDate, bearerToken, sendEmailFn } = params;
  const cleanedEmail = targetEmail.trim().toLowerCase();
  if (!validateDailyOpsEmail(cleanedEmail)) {
    return { ok: false, error: "Please provide a valid email address for the test report." };
  }

  const generated = await generateDailyOpsReportForHotel({
    hotelId,
    reportDate,
    defaultToCurrentDay: true,
    bearerToken,
  });

  const sender = sendEmailFn || sendEmail;
  const sendRes = await sender({
    to: cleanedEmail,
    subject: `[TEST] ${generated.rendered.subject}`.slice(0, 195),
    html: generated.rendered.html,
    text: generated.rendered.text,
    fromName: generated.rendered.fromName,
    replyTo: generated.rendered.replyTo,
    tags: [
      { name: "hotel_id", value: hotelId },
      { name: "event", value: "daily_operations_report_test" },
    ],
  });

  if (!sendRes.success) {
    return { ok: false, error: sendRes.error || "Test report email could not be sent." };
  }

  return {
    ok: true,
    sentTo: cleanedEmail,
    reportDate: generated.report.reportDate,
    messageId: sendRes.messageId,
  };
}

export interface DailyOpsDryRunCheckItem {
  id: string;
  label: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DailyOpsDryRunDiagnosticResult {
  dryRun: true;
  emailsSent: 0;
  hotelId: string;
  checkedAtIso: string;
  verdict:
    | "due_now"
    | "scheduled_ready"
    | "already_sent"
    | "disabled"
    | "no_active_recipients"
    | "provider_unconfigured"
    | "render_failed";
  verdictLabel: string;
  verdictSummary: string;
  wouldSendNow: boolean;
  emailProviderReady: boolean;
  schedule: {
    enabled: boolean;
    scheduledTime: string;
    timezone: string;
    hotelLocalDate: string;
    hotelLocalTime: string;
    targetReportDate: string;
    dueNow: boolean;
    scheduledForIso: string;
    nextScheduledDelivery: ReturnType<typeof computeNextScheduledDelivery>;
  };
  recipients: {
    activeCount: number;
    pausedCount: number;
    activeEmails: string[];
  };
  existingRunForDate: {
    exists: boolean;
    deliveryStatus?: string;
    generationStatus?: string;
    deliveredAt?: string;
    retryCount?: number;
  };
  checks: DailyOpsDryRunCheckItem[];
  rendered: {
    ok: boolean;
    error?: string;
    subject?: string;
    fromName?: string;
    replyTo?: string;
    periodLabel?: string;
    html?: string;
    htmlBytes?: number;
    textBytes?: number;
    summarySnapshot?: DailyOpsReportSummarySnapshot;
    limitations?: string[];
  };
}

/**
 * Strictly read-only, side-effect-free dry-run diagnostic for a hotel's automated
 * Daily Hotel Operations Report. Verifies configuration, schedule evaluation,
 * recipient readiness, email provider availability, duplicate-run guard, and full
 * HTML/text template rendering without sending any emails or writing to Firestore.
 */
export async function runDailyOpsDryRunDiagnostic(params: {
  hotelId: string;
  reportDate?: string;
  now?: Date;
  bearerToken?: string;
}): Promise<DailyOpsDryRunDiagnosticResult> {
  const { hotelId, bearerToken } = params;
  const now = params.now || new Date();
  const checkedAtIso = now.toISOString();

  const { config, nextScheduledDelivery } = await getDailyOpsConfig(
    hotelId,
    undefined,
    bearerToken
  );

  const dueEval = evaluateDailyOpsScheduleDue(
    now,
    config.timezone,
    config.scheduledTime,
    config.lastReportDate
  );

  const targetReportDate =
    params.reportDate && isValidReportDate(params.reportDate)
      ? params.reportDate
      : dueEval.reportDate;

  const existingRun = await getDailyOpsRun(hotelId, targetReportDate, bearerToken).catch(() => null);

  const activeEmails = config.recipients
    .filter((r) => r.enabled && validateDailyOpsEmail(r.email))
    .map((r) => r.email.toLowerCase());
  const pausedCount = Math.max(0, config.recipients.length - activeEmails.length);

  const providerCheck = validateEmailConfig();
  const emailProviderReady = Boolean(providerCheck.ok);

  // Verify live data aggregation & HTML/text template rendering (strictly read-only)
  let renderedInfo: DailyOpsDryRunDiagnosticResult["rendered"] = { ok: false };
  try {
    const generated = await generateDailyOpsReportForHotel({
      hotelId,
      reportDate: targetReportDate,
      bearerToken,
    });
    const htmlBytes = Buffer.byteLength(generated.rendered.html || "", "utf8");
    const textBytes = Buffer.byteLength(generated.rendered.text || "", "utf8");
    renderedInfo = {
      ok: true,
      subject: generated.rendered.subject,
      fromName: generated.rendered.fromName,
      replyTo: generated.rendered.replyTo,
      periodLabel: generated.report.periodLabel,
      html: generated.rendered.html,
      htmlBytes,
      textBytes,
      summarySnapshot: summarizeReport(generated.report),
      limitations: generated.report.limitations || [],
    };
  } catch (err: any) {
    renderedInfo = {
      ok: false,
      error: err?.message || "Template rendering failed during dry-run.",
    };
  }

  const alreadySentForDate = existingRun?.deliveryStatus === "sent";
  const checks: DailyOpsDryRunCheckItem[] = [
    {
      id: "automation_enabled",
      label: "Automation Schedule Switch",
      status: config.enabled ? "pass" : "warn",
      detail: config.enabled
        ? `Enabled — scheduled daily at ${config.scheduledTime} (${config.timezone}).`
        : `Currently paused (disabled). Switch automation ON to trigger automatically at ${config.scheduledTime}.`,
    },
    {
      id: "recipients",
      label: "Active Recipients",
      status: activeEmails.length > 0 ? "pass" : "fail",
      detail:
        activeEmails.length > 0
          ? `${activeEmails.length} active recipient${activeEmails.length === 1 ? "" : "s"} ready${pausedCount > 0 ? ` (${pausedCount} paused)` : ""}.`
          : "No active valid email recipients configured.",
    },
    {
      id: "email_provider",
      label: "Email Delivery Provider",
      status: emailProviderReady ? "pass" : "fail",
      detail: emailProviderReady
        ? "Resend email delivery service is configured and ready."
        : "Email delivery service is not configured on the server.",
    },
    {
      id: "schedule_clock",
      label: "Schedule Clock & Window",
      status: "pass",
      detail: `Hotel local clock: ${dueEval.localDateStr} ${dueEval.localTimeStr} (${config.timezone}). Target reporting date: ${targetReportDate}. Next scheduled run: ${nextScheduledDelivery.localDisplay}.`,
    },
    {
      id: "duplicate_guard",
      label: "Duplicate-Delivery Guard",
      status: alreadySentForDate ? "warn" : "pass",
      detail: alreadySentForDate
        ? `Report for ${targetReportDate} was already delivered${existingRun?.deliveredAt ? ` at ${existingRun.deliveredAt}` : ""}; scheduler will skip duplicates.`
        : existingRun
          ? `Prior attempt for ${targetReportDate} recorded status "${existingRun.deliveryStatus}" (retries: ${existingRun.retryCount || 0}).`
          : `No existing sent run for ${targetReportDate} — eligible for delivery when due.`,
    },
    {
      id: "template_render",
      label: "Report Template Rendering",
      status: renderedInfo.ok ? "pass" : "fail",
      detail: renderedInfo.ok
        ? `Rendered cleanly (${((renderedInfo.htmlBytes || 0) / 1024).toFixed(1)} KB HTML) — Subject: "${renderedInfo.subject}".`
        : renderedInfo.error || "Failed to render report template.",
    },
  ];

  let verdict: DailyOpsDryRunDiagnosticResult["verdict"];
  let verdictLabel: string;
  let verdictSummary: string;
  let wouldSendNow = false;

  if (!renderedInfo.ok) {
    verdict = "render_failed";
    verdictLabel = "Template Render Failed";
    verdictSummary = renderedInfo.error || "The report template could not be rendered.";
  } else if (!emailProviderReady) {
    verdict = "provider_unconfigured";
    verdictLabel = "Email Provider Not Configured";
    verdictSummary = "Template rendered cleanly, but the server email provider is not configured.";
  } else if (!config.enabled) {
    verdict = "disabled";
    verdictLabel = "Automation Paused (Disabled)";
    verdictSummary =
      "Template rendered cleanly, but automated daily delivery is switched OFF. Toggle the schedule switch ON to deliver automatically.";
  } else if (activeEmails.length === 0) {
    verdict = "no_active_recipients";
    verdictLabel = "No Active Recipients";
    verdictSummary =
      "Template rendered cleanly, but there are no enabled recipient email addresses configured.";
  } else if (alreadySentForDate) {
    verdict = "already_sent";
    verdictLabel = "Already Delivered for Date";
    verdictSummary = `Report for ${targetReportDate} has already been delivered. Next scheduled delivery: ${nextScheduledDelivery.localDisplay}.`;
  } else if (dueEval.due) {
    verdict = "due_now";
    verdictLabel = "Due Now — Ready to Deliver";
    verdictSummary = `All checks passed. A live scheduled run would immediately deliver this report to ${activeEmails.length} active recipient${activeEmails.length === 1 ? "" : "s"}.`;
    wouldSendNow = true;
  } else {
    verdict = "scheduled_ready";
    verdictLabel = "Scheduled & Ready";
    verdictSummary = `All checks passed. Automated delivery will trigger for ${activeEmails.length} active recipient${activeEmails.length === 1 ? "" : "s"} at ${nextScheduledDelivery.localDisplay}.`;
  }

  return {
    dryRun: true,
    emailsSent: 0,
    hotelId,
    checkedAtIso,
    verdict,
    verdictLabel,
    verdictSummary,
    wouldSendNow,
    emailProviderReady,
    schedule: {
      enabled: config.enabled,
      scheduledTime: config.scheduledTime,
      timezone: config.timezone,
      hotelLocalDate: dueEval.localDateStr,
      hotelLocalTime: dueEval.localTimeStr,
      targetReportDate,
      dueNow: dueEval.due,
      scheduledForIso: dueEval.scheduledForIso,
      nextScheduledDelivery,
    },
    recipients: {
      activeCount: activeEmails.length,
      pausedCount,
      activeEmails,
    },
    existingRunForDate: {
      exists: Boolean(existingRun),
      deliveryStatus: existingRun?.deliveryStatus,
      generationStatus: existingRun?.generationStatus,
      deliveredAt: existingRun?.deliveredAt,
      retryCount: existingRun?.retryCount,
    },
    checks,
    rendered: renderedInfo,
  };
}

/**
 * Evaluates all enabled hotels against their local timezone clocks and executes
 * any due Daily Operations Report runs idempotently.
 */
export async function runScheduledDailyOpsTick(options: {
  now?: Date;
  dryRun?: boolean;
  hotelIds?: string[];
  bearerToken?: string;
  sendEmailFn?: DailyOpsEmailSender;
} = {}): Promise<{
  checkedHotels: number;
  dueHotels: number;
  sent: number;
  partial: number;
  failed: number;
  skipped: number;
  details: Array<{ hotelId: string; reportDate?: string; status: string; reason?: string }>;
}> {
  const now = options.now || new Date();
  const details: Array<{ hotelId: string; reportDate?: string; status: string; reason?: string }> = [];
  let checkedHotels = 0;
  let dueHotels = 0;
  let sent = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;

  let hotelIdsToCheck: string[] = [];
  if (Array.isArray(options.hotelIds) && options.hotelIds.length > 0) {
    hotelIdsToCheck = options.hotelIds.filter((id) => isSafeIdentifier(id));
  } else {
    const hotels = await listCollectionAll("hotels", options.bearerToken, 500);
    hotelIdsToCheck = hotels.map((h) => h.id).filter((id) => isSafeIdentifier(id));
  }

  for (const hotelId of hotelIdsToCheck) {
    checkedHotels++;
    try {
      const { config } = await getDailyOpsConfig(hotelId, undefined, options.bearerToken);
      if (!config.enabled) {
        skipped++;
        continue;
      }

      const activeRecipients = config.recipients.filter(
        (r) => r.enabled && validateDailyOpsEmail(r.email)
      );
      if (activeRecipients.length === 0) {
        skipped++;
        details.push({ hotelId, status: "skipped", reason: "no_active_recipients" });
        continue;
      }

      const dueEval = evaluateDailyOpsScheduleDue(
        now,
        config.timezone,
        config.scheduledTime,
        config.lastReportDate
      );

      if (!dueEval.due) {
        skipped++;
        continue;
      }

      dueHotels++;
      const res = await executeScheduledDailyOpsRun({
        hotelId,
        reportDate: dueEval.reportDate,
        scheduledForIso: dueEval.scheduledForIso,
        bearerToken: options.bearerToken,
        dryRun: options.dryRun,
        sendEmailFn: options.sendEmailFn,
      });

      if (res.status === "sent") sent++;
      else if (res.status === "partial") partial++;
      else if (res.status === "failed") failed++;
      else skipped++;

      details.push({
        hotelId,
        reportDate: dueEval.reportDate,
        status: res.status,
        reason: res.reason,
      });
    } catch (err: any) {
      failed++;
      details.push({
        hotelId,
        status: "failed",
        reason: err?.message || "Unexpected scheduler error",
      });
    }
  }

  return {
    checkedHotels,
    dueHotels,
    sent,
    partial,
    failed,
    skipped,
    details,
  };
}

// ---------------------------------------------------------------------------
// In-Memory Authorized Session Registry (Fallback when Admin SDK is absent)
// Strictly volatile in server RAM — never logged, never returned, never persisted to disk or DB.
// ---------------------------------------------------------------------------
interface RegisteredDailyOpsSession {
  bearerToken: string;
  /** Optional Firebase refresh token held strictly in volatile RAM to mint fresh ID tokens at midnight/scheduled time */
  refreshToken?: string;
  registeredAt: number;
  expiresAt: number;
}

const SESSION_TOKEN_TTL_MS = 50 * 60 * 1000; // 50 min (Firebase ID tokens last 60 min)
const SESSION_REFRESH_LEAD_MS = 5 * 60 * 1000; // Proactively refresh 5 min before expiry
const GOOGLE_SECURE_TOKEN_ENDPOINT = "https://securetoken.googleapis.com/v1/token";
const registeredHotelSessions = new Map<string, RegisteredDailyOpsSession>();

export type DailyOpsTokenRefreshFn = (
  refreshToken: string
) => Promise<{ idToken: string; refreshToken?: string; expiresInSec?: number } | null>;

async function defaultRefreshFirebaseIdToken(
  refreshToken: string
): Promise<{ idToken: string; refreshToken?: string; expiresInSec?: number } | null> {
  const cfg = getFirebaseAppletConfig();
  const apiKey = typeof cfg.apiKey === "string" ? cfg.apiKey.trim() : "";
  if (!apiKey || !refreshToken) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    });
    const resp = await fetch(`${GOOGLE_SECURE_TOKEN_ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!resp.ok) {
      return null;
    }
    const json: any = await resp.json().catch(() => null);
    const idToken = typeof json?.id_token === "string" ? json.id_token.trim() : "";
    if (!idToken) return null;
    const nextRefresh =
      typeof json?.refresh_token === "string" && json.refresh_token.trim()
        ? json.refresh_token.trim()
        : refreshToken;
    const expiresInSec = Number(json?.expires_in);
    return {
      idToken,
      refreshToken: nextRefresh,
      expiresInSec: Number.isFinite(expiresInSec) && expiresInSec > 60 ? expiresInSec : 3600,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export function registerHotelDailyOpsSessionToken(
  hotelId: string,
  bearerToken?: string | null,
  refreshToken?: string | null
): void {
  if (!hotelId || !isSafeIdentifier(hotelId)) return;
  const token = typeof bearerToken === "string" ? bearerToken.trim() : "";
  if (!token) return;
  const cleanRefresh =
    typeof refreshToken === "string" && refreshToken.trim().length >= 20 && refreshToken.trim().length <= 4096
      ? refreshToken.trim()
      : undefined;
  const existing = registeredHotelSessions.get(hotelId);
  const now = Date.now();
  registeredHotelSessions.set(hotelId, {
    bearerToken: token,
    refreshToken: cleanRefresh || existing?.refreshToken,
    registeredAt: now,
    expiresAt: now + SESSION_TOKEN_TTL_MS,
  });
}

export function revokeHotelDailyOpsSession(hotelId: string): void {
  if (!hotelId) return;
  registeredHotelSessions.delete(hotelId);
}

export function clearRegisteredDailyOpsSessions(): void {
  registeredHotelSessions.clear();
}

export function getRegisteredDailyOpsHotelIds(nowMs = Date.now()): string[] {
  const active: string[] = [];
  for (const [hid, entry] of registeredHotelSessions.entries()) {
    if (entry.expiresAt <= nowMs && !entry.refreshToken) {
      registeredHotelSessions.delete(hid);
    } else {
      active.push(hid);
    }
  }
  return active;
}

/**
 * Runs a single background scheduler pass:
 * - Uses Firebase Admin SDK across all hotels when configured.
 * - Falls back seamlessly to active authorized hotel sessions held strictly in volatile server RAM
 *   when FIREBASE_SERVICE_ACCOUNT_KEY is not configured, automatically refreshing expiring ID tokens
 *   via Google's Secure Token API so scheduled reports fire reliably on the exact stipulated time
 *   (including overnight / midnight) even after admin browsers close.
 */
export async function runDailyOpsBackgroundSchedulerPass(options: {
  now?: Date;
  dryRun?: boolean;
  hotelIds?: string[];
  sendEmailFn?: DailyOpsEmailSender;
  forceSessionMode?: boolean;
  tokenRefreshFn?: DailyOpsTokenRefreshFn;
} = {}): Promise<{
  mode: "admin_sdk" | "session_tokens" | "idle";
  checkedHotels: number;
  dueHotels: number;
  sent: number;
  partial: number;
  failed: number;
  skipped: number;
  details: Array<{ hotelId: string; reportDate?: string; status: string; reason?: string }>;
}> {
  const adminDb = options.forceSessionMode ? null : await getOptionalAdminFirestore();
  if (adminDb) {
    const summary = await runScheduledDailyOpsTick({
      now: options.now,
      dryRun: options.dryRun,
      hotelIds: options.hotelIds,
      sendEmailFn: options.sendEmailFn,
    });
    return { mode: "admin_sdk", ...summary };
  }

  const refreshFn = options.tokenRefreshFn || defaultRefreshFirebaseIdToken;
  const nowMs = (options.now || new Date()).getTime();
  const filterSet =
    Array.isArray(options.hotelIds) && options.hotelIds.length > 0
      ? new Set(options.hotelIds.filter((id) => isSafeIdentifier(id)))
      : null;

  const activeEntries: Array<[string, RegisteredDailyOpsSession]> = [];
  for (const [hid, entry] of registeredHotelSessions.entries()) {
    if (filterSet && !filterSet.has(hid)) continue;
    if (entry.expiresAt <= nowMs && !entry.refreshToken) {
      registeredHotelSessions.delete(hid);
    } else {
      activeEntries.push([hid, entry]);
    }
  }

  if (activeEntries.length === 0) {
    return {
      mode: "idle",
      checkedHotels: 0,
      dueHotels: 0,
      sent: 0,
      partial: 0,
      failed: 0,
      skipped: 0,
      details: [],
    };
  }

  let checkedHotels = 0;
  let dueHotels = 0;
  let sent = 0;
  let partial = 0;
  let failed = 0;
  let skipped = 0;
  const details: Array<{ hotelId: string; reportDate?: string; status: string; reason?: string }> = [];

  for (const [hotelId, entry] of activeEntries) {
    let activeBearer = entry.bearerToken;

    // Proactively mint a fresh Firebase ID token if current token is expired or within 5 min of expiry
    if (entry.expiresAt <= nowMs + SESSION_REFRESH_LEAD_MS) {
      if (!entry.refreshToken) {
        registeredHotelSessions.delete(hotelId);
        continue;
      }
      const refreshed = await refreshFn(entry.refreshToken);
      if (!refreshed?.idToken) {
        registeredHotelSessions.delete(hotelId);
        continue;
      }
      activeBearer = refreshed.idToken;
      const ttlMs = Math.max(
        5 * 60 * 1000,
        Math.min(SESSION_TOKEN_TTL_MS, ((refreshed.expiresInSec || 3600) - 600) * 1000)
      );
      const updatedSession: RegisteredDailyOpsSession = {
        bearerToken: refreshed.idToken,
        refreshToken: refreshed.refreshToken || entry.refreshToken,
        registeredAt: nowMs,
        expiresAt: nowMs + ttlMs,
      };
      registeredHotelSessions.set(hotelId, updatedSession);
      entry.bearerToken = updatedSession.bearerToken;
      entry.refreshToken = updatedSession.refreshToken;
      entry.expiresAt = updatedSession.expiresAt;
    }

    const executeForHotel = async (bearer: string) =>
      runScheduledDailyOpsTick({
        now: options.now,
        dryRun: options.dryRun,
        hotelIds: [hotelId],
        bearerToken: bearer,
        sendEmailFn: options.sendEmailFn,
      });

    try {
      let sub = await executeForHotel(activeBearer);

      // If Firestore rejected with 401/403 and a volatile refresh token is available, refresh once and retry
      const hadAuthFailure = sub.details.some(
        (d) =>
          d.status === "failed" &&
          typeof d.reason === "string" &&
          (d.reason.includes("(401)") || d.reason.includes("(403)"))
      );

      if (hadAuthFailure && entry.refreshToken) {
        const refreshed = await refreshFn(entry.refreshToken);
        if (refreshed?.idToken) {
          activeBearer = refreshed.idToken;
          registeredHotelSessions.set(hotelId, {
            bearerToken: refreshed.idToken,
            refreshToken: refreshed.refreshToken || entry.refreshToken,
            registeredAt: nowMs,
            expiresAt: nowMs + SESSION_TOKEN_TTL_MS,
          });
          sub = await executeForHotel(activeBearer);
        }
      }

      checkedHotels += sub.checkedHotels;
      dueHotels += sub.dueHotels;
      sent += sub.sent;
      partial += sub.partial;
      failed += sub.failed;
      skipped += sub.skipped;
      details.push(...sub.details);

      // Evict revoked/unauthorized sessions cleanly if Firestore still rejects with 401/403
      if (
        sub.details.some(
          (d) =>
            d.status === "failed" &&
            typeof d.reason === "string" &&
            (d.reason.includes("(401)") || d.reason.includes("(403)"))
        )
      ) {
        registeredHotelSessions.delete(hotelId);
      }
    } catch (err: any) {
      const msg = String(err?.message || "");
      if (msg.includes("(401)") || msg.includes("(403)")) {
        registeredHotelSessions.delete(hotelId);
      }
      failed++;
      details.push({
        hotelId,
        status: "failed",
        reason: msg || "Unexpected session-backed scheduler error",
      });
    }
  }

  return {
    mode: "session_tokens",
    checkedHotels,
    dueHotels,
    sent,
    partial,
    failed,
    skipped,
    details,
  };
}

// ---------------------------------------------------------------------------
// Server-Side Background Scheduler
// ---------------------------------------------------------------------------
let schedulerStarted = false;
let schedulerInFlight = false;

export function startDailyOpsBackgroundScheduler(intervalMs = 15_000): void {
  if (schedulerStarted) return;
  schedulerStarted = true;

  const runTick = async () => {
    if (schedulerInFlight) return;
    schedulerInFlight = true;
    try {
      const summary = await runDailyOpsBackgroundSchedulerPass();
      if (summary.dueHotels > 0) {
        console.log(
          `[DailyOpsScheduler] Tick complete (${summary.mode}) — checked=${summary.checkedHotels}, due=${summary.dueHotels}, sent=${summary.sent}, partial=${summary.partial}, failed=${summary.failed}`
        );
      }
    } catch (err: any) {
      console.error("[DailyOpsScheduler] Tick error:", err?.message || err);
    } finally {
      schedulerInFlight = false;
    }
  };

  // Initial startup check (10s after boot) to recover any missed run after restart/redeploy
  const bootTimer = setTimeout(() => {
    void runTick();
  }, 10_000);
  if (typeof bootTimer.unref === "function") bootTimer.unref();

  const loopTimer = setInterval(() => {
    void runTick();
  }, intervalMs);
  if (typeof loopTimer.unref === "function") loopTimer.unref();

  console.log(
    `[DailyOpsScheduler] Server-side Daily Hotel Operations Report scheduler initialized (${Math.round(intervalMs / 1000)}s interval).`
  );
}
