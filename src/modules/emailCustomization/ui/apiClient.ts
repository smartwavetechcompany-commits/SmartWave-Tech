import { auth } from "../../../firebase";
import type {
  CustomizableEmailEventType,
  EmailBlock,
  EmailImageAsset,
  EmailRenderContext,
  EmailTemplateDocument,
  EmailTemplateVariant,
  EventCatalogEntry,
  FooterNavLinkItem,
  HotelEmailSettings,
  RenderedEmailOutput,
  SupportedEmailLanguage,
} from "../shared/types";
import type { ValidationIssue } from "../shared/validation";
import type {
  DailyOpsReportConfig,
  DailyOpsReportData,
  DailyOpsReportRun,
  DailyOpsReportSectionsConfig,
} from "../shared/dailyOpsTypes";

export interface EmailCustomizationConfigResponse {
  enabled: boolean;
  canManage?: boolean;
  hotelId: string;
  hotelName: string;
  appUrl: string;
  verifiedFromAddress: string;
  emailServiceConfigured: boolean;
  callerEmail: string;
  languages: { code: SupportedEmailLanguage; label: string }[];
  fonts: { id: string; label: string; css: string }[];
  allowedVariables: string[];
  variableDescriptions: Record<string, { label: string; group: string; sample: string }>;
  eventCatalog: Record<CustomizableEmailEventType, EventCatalogEntry>;
  optionalSectionPresets: Array<{
    id: string;
    label: string;
    description: string;
  }>;
}

export interface EmailTemplateOverviewItem {
  eventType: CustomizableEmailEventType;
  name: string;
  description: string;
  category?: "guest_stays" | "payments_billing" | "loyalty_rewards" | "corporate" | "staff_operations";
  audience?: "guest" | "hotel_staff" | "corporate" | "platform_admin";
  canDisable?: boolean;
  enabled: boolean;
  isCustomized: boolean;
  publishedVersion: number;
  hasDraftChanges: boolean;
  requiresScheduler: boolean;
  languagesAvailable: SupportedEmailLanguage[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface ImageLibraryResponse {
  ok: boolean;
  images: EmailImageAsset[];
  usage: {
    count: number;
    maxCount: number;
    totalBytes: number;
    maxTotalBytes: number;
  };
}

export class EmailCustomizationApiError extends Error {
  status: number;
  issues?: ValidationIssue[];
  referencedByPublished?: string[];

  constructor(
    message: string,
    status: number,
    issues?: ValidationIssue[],
    referencedByPublished?: string[]
  ) {
    super(message);
    this.status = status;
    this.issues = issues;
    this.referencedByPublished = referencedByPublished;
  }
}

async function apiFetch<T>(
  path: string,
  options: {
    method?: string;
    body?: any;
    hotelId?: string;
  } = {}
): Promise<T> {
  const user = auth.currentUser;
  if (!user) {
    throw new EmailCustomizationApiError("You must be signed in to manage email templates.", 401);
  }
  const token = await user.getIdToken();
  const sep = path.includes("?") ? "&" : "?";
  const url = options.hotelId
    ? `${path}${sep}hotelId=${encodeURIComponent(options.hotelId)}`
    : path;

  const resp = await fetch(url, {
    method: options.method || "GET",
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw new EmailCustomizationApiError(
      data?.error || `Request failed (${resp.status})`,
      resp.status,
      Array.isArray(data?.issues) ? data.issues : undefined,
      Array.isArray(data?.referencedByPublished) ? data.referencedByPublished : undefined
    );
  }
  return data as T;
}

export const emailCustomizationApi = {
  getConfig(hotelId?: string) {
    return apiFetch<EmailCustomizationConfigResponse>("/api/email-customization/config", { hotelId });
  },

  getOverview(hotelId?: string) {
    return apiFetch<{
      enabled: boolean;
      hotelId: string;
      templates: EmailTemplateOverviewItem[];
      settings: HotelEmailSettings;
    }>("/api/email-customization/overview", { hotelId });
  },

  getTemplate(eventType: CustomizableEmailEventType, hotelId?: string) {
    return apiFetch<{
      template: EmailTemplateDocument;
      settings: HotelEmailSettings;
      sampleContext: EmailRenderContext;
      meta: EventCatalogEntry;
    }>(`/api/email-customization/templates/${encodeURIComponent(eventType)}`, { hotelId });
  },

  saveTemplate(
    eventType: CustomizableEmailEventType,
    payload: {
      language: SupportedEmailLanguage;
      variant: EmailTemplateVariant;
      publish: boolean;
      note?: string;
      enabled?: boolean;
    },
    hotelId?: string
  ) {
    return apiFetch<{ ok: boolean; template: EmailTemplateDocument }>(
      `/api/email-customization/templates/${encodeURIComponent(eventType)}`,
      { method: "PUT", body: payload, hotelId }
    );
  },

  toggleTemplate(eventType: CustomizableEmailEventType, enabled: boolean, hotelId?: string) {
    return apiFetch<{ ok: boolean; template: EmailTemplateDocument }>(
      `/api/email-customization/templates/${encodeURIComponent(eventType)}/toggle`,
      { method: "PATCH", body: { enabled }, hotelId }
    );
  },

  resetTemplate(eventType: CustomizableEmailEventType, hotelId?: string) {
    return apiFetch<{ ok: boolean; template: EmailTemplateDocument }>(
      `/api/email-customization/templates/${encodeURIComponent(eventType)}/reset`,
      { method: "POST", body: {}, hotelId }
    );
  },

  restoreVersion(eventType: CustomizableEmailEventType, version: number, hotelId?: string) {
    return apiFetch<{ ok: boolean; template: EmailTemplateDocument }>(
      `/api/email-customization/templates/${encodeURIComponent(eventType)}/restore`,
      { method: "POST", body: { version }, hotelId }
    );
  },

  previewTemplate(
    eventType: CustomizableEmailEventType,
    payload: {
      language: SupportedEmailLanguage;
      variant: EmailTemplateVariant;
      includeLoyaltySample?: boolean;
    },
    hotelId?: string
  ) {
    return apiFetch<{ ok: boolean; rendered: RenderedEmailOutput }>(
      `/api/email-customization/templates/${encodeURIComponent(eventType)}/preview`,
      { method: "POST", body: payload, hotelId }
    );
  },

  sendTestEmail(
    eventType: CustomizableEmailEventType,
    payload: {
      language: SupportedEmailLanguage;
      variant?: EmailTemplateVariant;
      includeLoyaltySample?: boolean;
    },
    hotelId?: string
  ) {
    return apiFetch<{
      ok: boolean;
      sentTo: string;
      messageId?: string;
      remainingThisHour?: number;
    }>(`/api/email-customization/templates/${encodeURIComponent(eventType)}/test-send`, {
      method: "POST",
      body: payload,
      hotelId,
    });
  },

  getSettings(hotelId?: string) {
    return apiFetch<{ ok: boolean; settings: HotelEmailSettings; appUrl: string }>(
      "/api/email-customization/settings",
      { hotelId }
    );
  },

  saveSettings(settings: HotelEmailSettings, hotelId?: string) {
    return apiFetch<{ ok: boolean; settings: HotelEmailSettings }>(
      "/api/email-customization/settings",
      { method: "PUT", body: { settings }, hotelId }
    );
  },

  applyDefaultFooterToAllDrafts(
    defaultFooterBlocks?: Partial<Record<SupportedEmailLanguage, EmailBlock[]>>,
    hotelId?: string
  ) {
    return apiFetch<{ ok: boolean; updatedEvents: CustomizableEmailEventType[] }>(
      "/api/email-customization/settings/apply-default-footer",
      {
        method: "POST",
        body: defaultFooterBlocks ? { defaultFooterBlocks } : {},
        hotelId,
      }
    );
  },

  applyDefaultLinksToAllDrafts(
    defaultFooterNavLinks?: Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>>,
    hotelId?: string
  ) {
    return apiFetch<{ ok: boolean; updatedEvents: CustomizableEmailEventType[] }>(
      "/api/email-customization/settings/apply-default-links",
      {
        method: "POST",
        body: defaultFooterNavLinks ? { defaultFooterNavLinks } : {},
        hotelId,
      }
    );
  },

  listImages(hotelId?: string) {
    return apiFetch<ImageLibraryResponse>("/api/email-customization/images", { hotelId });
  },

  uploadImage(base64Data: string, label: string, hotelId?: string) {
    return apiFetch<{ ok: boolean; image: EmailImageAsset }>("/api/email-customization/images", {
      method: "POST",
      body: { base64Data, label },
      hotelId,
    });
  },

  renameImage(imageId: string, label: string, hotelId?: string) {
    return apiFetch<{ ok: boolean; image: EmailImageAsset }>(
      `/api/email-customization/images/${encodeURIComponent(imageId)}`,
      { method: "PATCH", body: { label }, hotelId }
    );
  },

  deleteImage(imageId: string, hotelId?: string) {
    return apiFetch<{ ok: boolean; referencedByDraft?: string[] }>(
      `/api/email-customization/images/${encodeURIComponent(imageId)}`,
      { method: "DELETE", hotelId }
    );
  },

  // Daily Hotel Operations Report (Additive inside Email Module)
  getDailyOpsConfig(hotelId?: string) {
    return apiFetch<{
      ok: boolean;
      canManage: boolean;
      callerEmail: string;
      config: DailyOpsReportConfig;
      timezoneFallbackUsed: boolean;
      nextScheduledDelivery: {
        iso: string;
        localDisplay: string;
        targetReportDate: string;
      };
    }>("/api/email-customization/daily-ops-report/config", { hotelId });
  },

  saveDailyOpsConfig(config: Partial<DailyOpsReportConfig>, hotelId?: string) {
    return apiFetch<{
      ok: boolean;
      config: DailyOpsReportConfig;
      nextScheduledDelivery: {
        iso: string;
        localDisplay: string;
        targetReportDate: string;
      };
    }>("/api/email-customization/daily-ops-report/config", {
      method: "PUT",
      body: { config },
      hotelId,
    });
  },

  listDailyOpsRuns(hotelId?: string, limit = 30) {
    return apiFetch<{
      ok: boolean;
      runs: Array<Omit<DailyOpsReportRun, "htmlSnapshot"> & { hasHtmlSnapshot?: boolean }>;
    }>(`/api/email-customization/daily-ops-report/runs?limit=${limit}`, { hotelId });
  },

  getDailyOpsRun(runId: string, hotelId?: string) {
    return apiFetch<{ ok: boolean; run: DailyOpsReportRun }>(
      `/api/email-customization/daily-ops-report/runs/${encodeURIComponent(runId)}`,
      { hotelId }
    );
  },

  previewDailyOpsReport(
    payload: { reportDate?: string; sections?: Partial<DailyOpsReportSectionsConfig> },
    hotelId?: string
  ) {
    return apiFetch<{
      ok: boolean;
      report: DailyOpsReportData;
      rendered: { subject: string; html: string; text: string; fromName: string };
    }>("/api/email-customization/daily-ops-report/preview", {
      method: "POST",
      body: payload,
      hotelId,
    });
  },

  sendDailyOpsTestReport(payload: { email?: string; reportDate?: string }, hotelId?: string) {
    return apiFetch<{
      ok: boolean;
      sentTo: string;
      reportDate: string;
      messageId?: string;
      remainingThisHour?: number;
    }>("/api/email-customization/daily-ops-report/test-send", {
      method: "POST",
      body: payload,
      hotelId,
    });
  },

  retryDailyOpsRun(runId: string, hotelId?: string) {
    return apiFetch<{ ok: boolean; run: DailyOpsReportRun }>(
      `/api/email-customization/daily-ops-report/runs/${encodeURIComponent(runId)}/retry`,
      { method: "POST", body: {}, hotelId }
    );
  },

  resendDailyOpsRun(
    runId: string,
    payload: { recipients?: string[]; idempotencyKey?: string },
    hotelId?: string
  ) {
    return apiFetch<{ ok: boolean; duplicate?: boolean; run: DailyOpsReportRun }>(
      `/api/email-customization/daily-ops-report/runs/${encodeURIComponent(runId)}/resend`,
      { method: "POST", body: payload, hotelId }
    );
  },

  checkDailyOpsDue(hotelId?: string) {
    return apiFetch<{
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      triggered?: boolean;
      sent?: number;
      partial?: number;
      failed?: number;
      lastReportDate?: string;
      lastDeliveryStatus?: string;
      lastSuccessfulDeliveryAt?: string;
      nextScheduledDelivery?: {
        iso: string;
        localDisplay: string;
        targetReportDate: string;
      };
    }>("/api/email-customization/daily-ops-report/check-due", {
      method: "POST",
      body: {},
      hotelId,
    });
  },

  dryRunDailyOpsReport(payload: { reportDate?: string } = {}, hotelId?: string) {
    return apiFetch<{
      ok: boolean;
      diagnostic: {
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
          nextScheduledDelivery: {
            iso: string;
            localDisplay: string;
            targetReportDate: string;
          };
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
        checks: Array<{
          id: string;
          label: string;
          status: "pass" | "warn" | "fail";
          detail: string;
        }>;
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
          summarySnapshot?: {
            totalRooms: number;
            occupiedRooms: number;
            occupancyPercentage: number;
            arrivalsCount: number;
            departuresCount: number;
            noShowsCount: number;
            cancelledCount: number;
            pendingHousekeepingTasks: number;
            outstandingMaintenanceRequests: number;
          };
          limitations?: string[];
        };
      };
    }>("/api/email-customization/daily-ops-report/dry-run", {
      method: "POST",
      body: payload,
      hotelId,
    });
  },
};
