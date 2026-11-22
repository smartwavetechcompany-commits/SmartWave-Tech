import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  FileBarChart2,
  Globe,
  Loader2,
  Mail,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Send,
  ShieldCheck,
  Trash2,
  Users,
  X,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  COMMON_IANA_TIMEZONES,
  DEFAULT_DAILY_OPS_SECTIONS,
  DEFAULT_DAILY_OPS_TIME,
  DEFAULT_DAILY_OPS_TIMEZONE,
  validateDailyOpsEmail,
  type DailyOpsRecipient,
  type DailyOpsReportConfig,
  type DailyOpsReportRun,
  type DailyOpsReportSectionsConfig,
} from "../shared/dailyOpsTypes";
import { emailCustomizationApi } from "./apiClient";

interface DailyOperationsReportPanelProps {
  hotelId: string;
  hotelName: string;
  canManage: boolean;
  callerEmail: string;
}

type RunListItem = Omit<DailyOpsReportRun, "htmlSnapshot"> & { hasHtmlSnapshot?: boolean };

const SECTION_TOGGLE_META: Array<{
  key: keyof DailyOpsReportSectionsConfig;
  label: string;
  description: string;
}> = [
  {
    key: "occupancy",
    label: "Occupancy Summary",
    description: "Room inventory, occupied/vacant rooms, occupancy %, in-house guests, arrivals & departures",
  },
  {
    key: "roomStatus",
    label: "Room Status Summary",
    description: "End-of-day room status snapshot plus recorded intra-day status transitions",
  },
  {
    key: "reservations",
    label: "Reservation Summary",
    description: "Created, confirmed, pending, checked-in, checked-out, cancelled, No-Show, walk-in, early check-in/out",
  },
  {
    key: "arrivalsDepartures",
    label: "Arrivals & Departures",
    description: "Operational movement lists with booking refs & rooms (no guest PII)",
  },
  {
    key: "housekeeping",
    label: "Housekeeping Summary",
    description: "Dirty, clean, inspected, awaiting cleaning/inspection, released & ready, tasks",
  },
  {
    key: "maintenance",
    label: "Maintenance Summary",
    description: "Maintenance/out-of-order rooms and engineering request status breakdown",
  },
  {
    key: "additionalOps",
    label: "Additional Operational Info",
    description: "Room transfers, active room blocks, VIP arrivals count, extended stays, outstanding tasks",
  },
];

function formatDateTimeSafe(iso?: string, timezone?: string): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone || DEFAULT_DAILY_OPS_TIMEZONE,
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DailyOperationsReportPanel({
  hotelId,
  hotelName,
  canManage,
  callerEmail,
}: DailyOperationsReportPanelProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<DailyOpsReportConfig | null>(null);
  const [timezoneFallbackUsed, setTimezoneFallbackUsed] = useState(false);
  const [nextScheduled, setNextScheduled] = useState<{
    iso: string;
    localDisplay: string;
    targetReportDate: string;
  } | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Add / edit recipient form state
  const [newRecipientEmail, setNewRecipientEmail] = useState("");
  const [newRecipientName, setNewRecipientName] = useState("");
  const [editingRecipientId, setEditingRecipientId] = useState<string | null>(null);
  const [editRecipientEmail, setEditRecipientEmail] = useState("");
  const [editRecipientName, setEditRecipientName] = useState("");
  const [savingRecipient, setSavingRecipient] = useState(false);

  // Preview & Test Send state
  const [previewDate, setPreviewDate] = useState("");
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewModal, setPreviewModal] = useState<{
    title: string;
    subject: string;
    html: string;
    reportDate: string;
    periodLabel?: string;
  } | null>(null);
  const [testEmail, setTestEmail] = useState(callerEmail || "");
  const [sendingTest, setSendingTest] = useState(false);

  // History row action states
  const [viewingRunId, setViewingRunId] = useState<string | null>(null);
  const [retryingRunId, setRetryingRunId] = useState<string | null>(null);
  const [resendingRunId, setResendingRunId] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [cfgRes, runsRes] = await Promise.all([
        emailCustomizationApi.getDailyOpsConfig(hotelId),
        emailCustomizationApi.listDailyOpsRuns(hotelId, 30),
      ]);
      setConfig(cfgRes.config);
      setTimezoneFallbackUsed(cfgRes.timezoneFallbackUsed);
      setNextScheduled(cfgRes.nextScheduledDelivery);
      setRuns(runsRes.runs || []);
      setDirty(false);
      if (!testEmail && (cfgRes.callerEmail || callerEmail)) {
        setTestEmail(cfgRes.callerEmail || callerEmail);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to load Daily Operations Report configuration.");
    } finally {
      setLoading(false);
    }
  }, [hotelId, callerEmail]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const refreshRuns = async () => {
    try {
      setLoadingRuns(true);
      const [cfgRes, runsRes] = await Promise.all([
        emailCustomizationApi.getDailyOpsConfig(hotelId),
        emailCustomizationApi.listDailyOpsRuns(hotelId, 30),
      ]);
      setRuns(runsRes.runs || []);
      setNextScheduled(cfgRes.nextScheduledDelivery);
      if (!dirty) {
        setConfig(cfgRes.config);
      }
    } catch (err: any) {
      toast.error(err?.message || "Failed to refresh delivery history.");
    } finally {
      setLoadingRuns(false);
    }
  };

  const updateLocalConfig = (updater: (prev: DailyOpsReportConfig) => DailyOpsReportConfig) => {
    setConfig((prev) => (prev ? updater(prev) : prev));
    setDirty(true);
  };

  const handleSaveConfig = async (overrideConfig?: DailyOpsReportConfig) => {
    const target = overrideConfig || config;
    if (!target || !canManage) return;

    // Client-side validation guard before API call
    if (target.enabled && target.recipients.filter((r) => r.enabled).length === 0) {
      toast.error("Add and enable at least one report recipient email before enabling automated daily delivery.");
      return;
    }

    try {
      setSaving(true);
      const res = await emailCustomizationApi.saveDailyOpsConfig(
        {
          enabled: target.enabled,
          scheduledTime: target.scheduledTime,
          timezone: target.timezone,
          recipients: target.recipients,
          sections: target.sections,
        },
        hotelId
      );
      setConfig(res.config);
      setNextScheduled(res.nextScheduledDelivery);
      setTimezoneFallbackUsed(false);
      setDirty(false);
      toast.success("Daily Hotel Operations Report settings saved.");
    } catch (err: any) {
      toast.error(err?.message || "Could not save Daily Operations Report settings.");
    } finally {
      setSaving(false);
    }
  };

  const persistRecipientsUpdate = async (
    nextConfig: DailyOpsReportConfig,
    previousConfig: DailyOpsReportConfig,
    successMessage: string
  ): Promise<boolean> => {
    if (nextConfig.enabled && nextConfig.recipients.filter((r) => r.enabled).length === 0) {
      toast.error(
        "At least one enabled recipient is required while automated daily delivery is enabled. Disable automation first or keep one active recipient."
      );
      return false;
    }

    setConfig(nextConfig);
    setSavingRecipient(true);
    try {
      const res = await emailCustomizationApi.saveDailyOpsConfig(
        {
          enabled: nextConfig.enabled,
          scheduledTime: nextConfig.scheduledTime,
          timezone: nextConfig.timezone,
          recipients: nextConfig.recipients,
          sections: nextConfig.sections,
        },
        hotelId
      );
      setConfig(res.config);
      setNextScheduled(res.nextScheduledDelivery);
      setTimezoneFallbackUsed(false);
      setDirty(false);
      toast.success(successMessage);
      return true;
    } catch (err: any) {
      setConfig(previousConfig);
      toast.error(err?.message || "Failed to save recipient changes.");
      return false;
    } finally {
      setSavingRecipient(false);
    }
  };

  const handleAddRecipient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canManage || !config || savingRecipient) return;

    const emailClean = newRecipientEmail.trim().toLowerCase();
    const nameClean = newRecipientName.trim().slice(0, 120);

    if (!validateDailyOpsEmail(emailClean)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (config.recipients.some((r) => r.email.toLowerCase() === emailClean)) {
      toast.error("This email address is already in the Daily Operations Report recipient list.");
      return;
    }

    const nextRecipient: DailyOpsRecipient = {
      id: `rcpt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      email: emailClean,
      ...(nameClean ? { name: nameClean } : {}),
      enabled: true,
      addedAt: new Date().toISOString(),
    };

    const nextConfig: DailyOpsReportConfig = {
      ...config,
      recipients: [...config.recipients, nextRecipient],
    };

    const saved = await persistRecipientsUpdate(
      nextConfig,
      config,
      `Recipient ${emailClean} added and saved.`
    );
    if (saved) {
      setNewRecipientEmail("");
      setNewRecipientName("");
    }
  };

  const handleStartEditRecipient = (r: DailyOpsRecipient) => {
    setEditingRecipientId(r.id);
    setEditRecipientEmail(r.email);
    setEditRecipientName(r.name || "");
  };

  const handleSaveEditRecipient = async (id: string) => {
    if (!config || !canManage || savingRecipient) return;
    const emailClean = editRecipientEmail.trim().toLowerCase();
    const nameClean = editRecipientName.trim().slice(0, 120);
    if (!validateDailyOpsEmail(emailClean)) {
      toast.error("Please enter a valid email address.");
      return;
    }
    if (config.recipients.some((r) => r.id !== id && r.email.toLowerCase() === emailClean)) {
      toast.error("Another recipient already uses this email address.");
      return;
    }
    const nextConfig: DailyOpsReportConfig = {
      ...config,
      recipients: config.recipients.map((r) =>
        r.id === id
          ? {
              ...r,
              email: emailClean,
              name: nameClean || undefined,
              updatedAt: new Date().toISOString(),
            }
          : r
      ),
    };
    const saved = await persistRecipientsUpdate(
      nextConfig,
      config,
      `Recipient ${emailClean} updated and saved.`
    );
    if (saved) {
      setEditingRecipientId(null);
    }
  };

  const handleToggleRecipient = async (id: string) => {
    if (!canManage || !config || savingRecipient) return;
    const target = config.recipients.find((r) => r.id === id);
    if (!target) return;
    const nextEnabled = !target.enabled;
    const nextConfig: DailyOpsReportConfig = {
      ...config,
      recipients: config.recipients.map((r) =>
        r.id === id ? { ...r, enabled: nextEnabled, updatedAt: new Date().toISOString() } : r
      ),
    };
    await persistRecipientsUpdate(
      nextConfig,
      config,
      `${target.email} ${nextEnabled ? "enabled" : "paused"} and saved.`
    );
  };

  const handleRemoveRecipient = async (id: string) => {
    if (!canManage || !config || savingRecipient) return;
    const target = config.recipients.find((r) => r.id === id);
    const nextConfig: DailyOpsReportConfig = {
      ...config,
      recipients: config.recipients.filter((r) => r.id !== id),
    };
    await persistRecipientsUpdate(
      nextConfig,
      config,
      target ? `Removed ${target.email} from report recipients.` : "Recipient removed."
    );
  };

  const handlePreviewReport = async () => {
    try {
      setPreviewLoading(true);
      const res = await emailCustomizationApi.previewDailyOpsReport(
        {
          reportDate: previewDate || undefined,
          sections: config?.sections || DEFAULT_DAILY_OPS_SECTIONS,
        },
        hotelId
      );
      setPreviewModal({
        title: "Live Daily Operations Report Preview",
        subject: res.rendered.subject,
        html: res.rendered.html,
        reportDate: res.report.reportDate,
        periodLabel: res.report.periodLabel,
      });
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate report preview.");
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleSendTestReport = async () => {
    if (!canManage) return;
    const emailClean = testEmail.trim().toLowerCase();
    if (!validateDailyOpsEmail(emailClean)) {
      toast.error("Enter a valid email address to receive the test report.");
      return;
    }
    try {
      setSendingTest(true);
      const res = await emailCustomizationApi.sendDailyOpsTestReport(
        {
          email: emailClean,
          reportDate: previewDate || undefined,
        },
        hotelId
      );
      toast.success(
        `Test Operations Report (${res.reportDate}) sent to ${res.sentTo} without affecting scheduled delivery.`
      );
    } catch (err: any) {
      toast.error(err?.message || "Failed to send test report.");
    } finally {
      setSendingTest(false);
    }
  };

  const handleViewHistoricalRun = async (runId: string) => {
    try {
      setViewingRunId(runId);
      const res = await emailCustomizationApi.getDailyOpsRun(runId, hotelId);
      if (!res.run.htmlSnapshot) {
        toast.info("No HTML snapshot was preserved for this failed generation run.");
        return;
      }
      setPreviewModal({
        title: `Archived Report — ${res.run.reportDate}`,
        subject: res.run.subject,
        html: res.run.htmlSnapshot,
        reportDate: res.run.reportDate,
        periodLabel: res.run.periodLabel,
      });
    } catch (err: any) {
      toast.error(err?.message || "Failed to load archived report.");
    } finally {
      setViewingRunId(null);
    }
  };

  const handleRetryFailedRun = async (runId: string) => {
    if (!canManage) return;
    try {
      setRetryingRunId(runId);
      const res = await emailCustomizationApi.retryDailyOpsRun(runId, hotelId);
      toast.success(
        res.run.deliveryStatus === "sent"
          ? `Report ${res.run.reportDate} delivered successfully on retry.`
          : `Retry completed with status: ${res.run.deliveryStatus}.`
      );
      await refreshRuns();
    } catch (err: any) {
      toast.error(err?.message || "Failed to retry report delivery.");
      await refreshRuns();
    } finally {
      setRetryingRunId(null);
    }
  };

  const handleManualResendRun = async (runId: string) => {
    if (!canManage) return;
    try {
      setResendingRunId(runId);
      const idempotencyKey = `resend_${runId}_${Date.now()}`;
      const res = await emailCustomizationApi.resendDailyOpsRun(
        runId,
        { idempotencyKey },
        hotelId
      );
      if (res.duplicate) {
        toast.info("This resend request was already processed.");
      } else {
        toast.success(
          `Manually resent report ${res.run.reportDate} to active recipients without altering schedule.`
        );
      }
      await refreshRuns();
    } catch (err: any) {
      toast.error(err?.message || "Failed to manually resend report.");
    } finally {
      setResendingRunId(null);
    }
  };

  if (loading || !config) {
    return (
      <div className="py-16 flex items-center justify-center gap-2 text-xs text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Loading Daily Hotel Operations Report settings...
      </div>
    );
  }

  const activeRecipientsCount = config.recipients.filter((r) => r.enabled).length;
  const knownTzValues = new Set(COMMON_IANA_TIMEZONES.map((t) => t.value));
  const timezoneOptions = knownTzValues.has(config.timezone)
    ? COMMON_IANA_TIMEZONES
    : [{ value: config.timezone, label: config.timezone }, ...COMMON_IANA_TIMEZONES];

  return (
    <div className="space-y-6">
      {/* Top Status Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Automation Status
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            <span
              className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-bold border ${
                config.enabled
                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
              }`}
            >
              {config.enabled ? <CheckCircle2 size={12} /> : <Clock size={12} />}
              {config.enabled ? "Enabled (Automated)" : "Disabled"}
            </span>
          </div>
          <div className="text-[11px] text-zinc-500 mt-2">
            {activeRecipientsCount} active recipient{activeRecipientsCount === 1 ? "" : "s"} configured
          </div>
        </div>

        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Next Scheduled Delivery
          </div>
          <div className="text-sm font-bold text-zinc-100 mt-1.5">
            {config.enabled && nextScheduled ? nextScheduled.localDisplay : "Paused (Disabled)"}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {config.enabled && nextScheduled
              ? `Covers preceding day (${nextScheduled.targetReportDate})`
              : `Default schedule: ${config.scheduledTime || DEFAULT_DAILY_OPS_TIME} (${config.timezone})`}
          </div>
        </div>

        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Last Successful Delivery
          </div>
          <div className="text-sm font-bold text-zinc-100 mt-1.5">
            {config.lastSuccessfulDeliveryAt
              ? formatDateTimeSafe(config.lastSuccessfulDeliveryAt, config.timezone)
              : "Not yet delivered"}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1">
            {config.lastReportDate ? `Reporting Date: ${config.lastReportDate}` : "Awaiting first scheduled run"}
          </div>
        </div>

        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Last Delivery Status
          </div>
          <div className="mt-1.5">
            {config.lastDeliveryStatus ? (
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold uppercase border ${
                  config.lastDeliveryStatus === "sent"
                    ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                    : config.lastDeliveryStatus === "partial"
                      ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
                      : "bg-rose-500/10 text-rose-400 border-rose-500/30"
                }`}
              >
                {config.lastDeliveryStatus}
              </span>
            ) : (
              <span className="text-sm font-semibold text-zinc-400">No runs yet</span>
            )}
          </div>
          <div className="text-[11px] text-zinc-500 mt-1 truncate" title={config.lastError || ""}>
            {config.lastError ? config.lastError : "Operational summary only (no financial data)"}
          </div>
        </div>
      </div>

      {/* Main Grid: Configuration + Recipients */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Left Column: Schedule, Timezone & Report Sections */}
        <div className="xl:col-span-5 space-y-5">
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-5">
            <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-800">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                  <CalendarClock size={18} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-100">
                    Daily Operations Report Schedule
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Automatically compiles and emails {hotelName}&apos;s preceding-day operational summary at 12:00 AM hotel time.
                  </p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={config.enabled}
                disabled={!canManage}
                onClick={() =>
                  canManage &&
                  updateLocalConfig((prev) => ({ ...prev, enabled: !prev.enabled }))
                }
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  config.enabled ? "bg-emerald-600" : "bg-zinc-700"
                } ${!canManage ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    config.enabled ? "translate-x-6" : "translate-x-1"
                  }`}
                />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-1.5">
                  <Clock size={12} /> Scheduled Delivery Time
                </label>
                <input
                  type="time"
                  value={config.scheduledTime}
                  disabled={!canManage}
                  onChange={(e) =>
                    updateLocalConfig((prev) => ({
                      ...prev,
                      scheduledTime: e.target.value || DEFAULT_DAILY_OPS_TIME,
                    }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs font-mono text-zinc-100 focus:outline-none focus:border-emerald-500/60 disabled:opacity-60"
                />
                <p className="text-[10px] text-zinc-500 mt-1">
                  Default: 00:00 (12:00 AM). Report always covers the preceding full calendar day (00:00–23:59).
                </p>
              </div>

              <div>
                <label className="text-[11px] font-bold uppercase tracking-wider text-zinc-400 flex items-center gap-1.5 mb-1.5">
                  <Globe size={12} /> Hotel Timezone
                </label>
                <select
                  value={config.timezone}
                  disabled={!canManage}
                  onChange={(e) =>
                    updateLocalConfig((prev) => ({ ...prev, timezone: e.target.value }))
                  }
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60 disabled:opacity-60"
                >
                  {timezoneOptions.map((tz) => (
                    <option key={tz.value} value={tz.value} className="bg-zinc-900">
                      {tz.label}
                    </option>
                  ))}
                </select>
                {timezoneFallbackUsed && (
                  <p className="text-[10px] text-amber-400 mt-1">
                    Using explicit fallback timezone ({DEFAULT_DAILY_OPS_TIMEZONE}). Save to lock in your property&apos;s timezone.
                  </p>
                )}
              </div>
            </div>

            {/* Report Content Sections */}
            <div className="pt-2 border-t border-zinc-800 space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-zinc-200 flex items-center gap-1.5">
                  <FileBarChart2 size={14} className="text-emerald-400" />
                  Included Operational Sections
                </h3>
                <span className="text-[10px] text-zinc-500">Operational data only • No financial figures</span>
              </div>

              <div className="space-y-2">
                {SECTION_TOGGLE_META.map((sec) => {
                  const checked = config.sections?.[sec.key] !== false;
                  return (
                    <label
                      key={sec.key}
                      className={`flex items-start gap-2.5 p-2.5 rounded-lg bg-zinc-950/70 border border-zinc-800/80 ${
                        canManage ? "cursor-pointer hover:border-zinc-700" : "opacity-70 cursor-not-allowed"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canManage}
                        onChange={() =>
                          canManage &&
                          updateLocalConfig((prev) => ({
                            ...prev,
                            sections: {
                              ...DEFAULT_DAILY_OPS_SECTIONS,
                              ...prev.sections,
                              [sec.key]: !checked,
                            },
                          }))
                        }
                        className="mt-0.5 rounded border-zinc-700 bg-zinc-900 text-emerald-500 focus:ring-emerald-500/30"
                      />
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-200">{sec.label}</div>
                        <div className="text-[10px] text-zinc-500">{sec.description}</div>
                      </div>
                    </label>
                  );
                })}
              </div>
            </div>

            {canManage && (
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-3">
                <span className="text-[11px] text-zinc-400">
                  {dirty ? "Unsaved changes pending." : "All settings saved."}
                </span>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void handleSaveConfig()}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-xs font-bold text-white transition-colors"
                >
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                  Save Configuration
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Multiple External Email Recipients + Preview & Test Delivery */}
        <div className="xl:col-span-7 space-y-5">
          {/* Recipient Management */}
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-zinc-800">
              <div className="flex items-start gap-2.5">
                <div className="p-2 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400">
                  <Users size={16} />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-zinc-100">
                    Report Email Recipients ({config.recipients.length})
                  </h2>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Add executives, hotel owners, or operations managers. Recipients only receive daily report emails — no PMS staff or guest accounts are created.
                  </p>
                </div>
              </div>
            </div>

            {canManage && (
              <form
                onSubmit={handleAddRecipient}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3 rounded-lg bg-zinc-950 border border-zinc-800"
              >
                <div className="sm:col-span-5">
                  <input
                    type="email"
                    required
                    placeholder="recipient@example.com *"
                    value={newRecipientEmail}
                    onChange={(e) => setNewRecipientEmail(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="sm:col-span-4">
                  <input
                    type="text"
                    placeholder="Name / Title (optional)"
                    value={newRecipientName}
                    onChange={(e) => setNewRecipientName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                  />
                </div>
                <div className="sm:col-span-3">
                  <button
                    type="submit"
                    disabled={savingRecipient}
                    className="w-full h-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 border border-zinc-700 text-xs font-bold text-zinc-100 inline-flex items-center justify-center gap-1.5 transition-colors"
                  >
                    {savingRecipient ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
                    {savingRecipient ? "Saving..." : "Add Recipient"}
                  </button>
                </div>
              </form>
            )}

            {config.recipients.length === 0 ? (
              <div className="py-8 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/50 text-xs text-zinc-500">
                No recipients configured yet. Add one or more email addresses above — recipients are saved automatically.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                      <th className="py-2.5 px-3">Email Address</th>
                      <th className="py-2.5 px-3">Name / Role Label</th>
                      <th className="py-2.5 px-3">Status</th>
                      {canManage && <th className="py-2.5 px-3 text-right">Actions</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/70">
                    {config.recipients.map((rcpt) => {
                      const isEditing = editingRecipientId === rcpt.id;
                      return (
                        <tr key={rcpt.id} className="hover:bg-zinc-900/50">
                          <td className="py-2.5 px-3 font-mono text-zinc-200">
                            {isEditing ? (
                              <input
                                type="email"
                                value={editRecipientEmail}
                                onChange={(e) => setEditRecipientEmail(e.target.value)}
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-100"
                              />
                            ) : (
                              rcpt.email
                            )}
                          </td>
                          <td className="py-2.5 px-3 text-zinc-400">
                            {isEditing ? (
                              <input
                                type="text"
                                value={editRecipientName}
                                onChange={(e) => setEditRecipientName(e.target.value)}
                                placeholder="Optional label"
                                className="w-full px-2 py-1 rounded bg-zinc-900 border border-zinc-700 text-xs text-zinc-100"
                              />
                            ) : (
                              rcpt.name || <span className="text-zinc-600">—</span>
                            )}
                          </td>
                          <td className="py-2.5 px-3">
                            <button
                              type="button"
                              disabled={!canManage || savingRecipient}
                              onClick={() => void handleToggleRecipient(rcpt.id)}
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold border transition-colors ${
                                rcpt.enabled
                                  ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                                  : "bg-zinc-800 text-zinc-400 border-zinc-700"
                              } ${!canManage || savingRecipient ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
                            >
                              {rcpt.enabled ? "Enabled" : "Paused"}
                            </button>
                          </td>
                          {canManage && (
                            <td className="py-2.5 px-3 text-right whitespace-nowrap">
                              {isEditing ? (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={savingRecipient}
                                    onClick={() => void handleSaveEditRecipient(rcpt.id)}
                                    className="p-1.5 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white"
                                    title="Save changes"
                                  >
                                    <Check size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingRecipient}
                                    onClick={() => setEditingRecipientId(null)}
                                    className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-zinc-300"
                                    title="Cancel"
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              ) : (
                                <div className="inline-flex items-center gap-1">
                                  <button
                                    type="button"
                                    disabled={savingRecipient}
                                    onClick={() => handleStartEditRecipient(rcpt)}
                                    className="p-1.5 rounded hover:bg-zinc-800 disabled:opacity-50 text-zinc-400 hover:text-zinc-100"
                                    title="Edit recipient"
                                  >
                                    <Pencil size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    disabled={savingRecipient}
                                    onClick={() => void handleRemoveRecipient(rcpt.id)}
                                    className="p-1.5 rounded hover:bg-rose-500/15 disabled:opacity-50 text-zinc-400 hover:text-rose-400"
                                    title="Remove recipient"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                </div>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <div className="flex items-start gap-2 text-[11px] text-zinc-500">
              <ShieldCheck size={14} className="text-emerald-500 shrink-0 mt-0.5" />
              <span>
                Emails are delivered individually per recipient using your existing Resend email infrastructure so recipients never see each other&apos;s email addresses.
              </span>
            </div>
          </div>

          {/* Preview & Send Test Report Box */}
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 pb-3 border-b border-zinc-800">
              <div>
                <h2 className="text-sm font-bold text-zinc-100">Preview &amp; Test Delivery</h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Inspect live operational figures for today (or any specific date) and send a safe test email without affecting scheduled midnight runs.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
              <div className="sm:col-span-4">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Reporting Date (Optional)
                </label>
                <input
                  type="date"
                  value={previewDate}
                  onChange={(e) => setPreviewDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60"
                />
                <p className="text-[10px] text-zinc-500 mt-1">Leave blank for today&apos;s live summary.</p>
              </div>

              <div className="sm:col-span-5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-zinc-400 block mb-1">
                  Test Recipient Email
                </label>
                <input
                  type="email"
                  value={testEmail}
                  disabled={!canManage}
                  onChange={(e) => setTestEmail(e.target.value)}
                  placeholder="admin@hotel.com"
                  className="w-full px-3 py-2 rounded-lg bg-zinc-950 border border-zinc-800 text-xs text-zinc-100 focus:outline-none focus:border-emerald-500/60 disabled:opacity-60"
                />
                <p className="text-[10px] text-zinc-500 mt-1">Sent with [TEST] subject prefix.</p>
              </div>

              <div className="sm:col-span-3 flex flex-col gap-2">
                <button
                  type="button"
                  disabled={previewLoading}
                  onClick={() => void handlePreviewReport()}
                  className="w-full px-3 py-2 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-bold text-zinc-100 inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  {previewLoading ? <Loader2 size={13} className="animate-spin" /> : <Eye size={13} />}
                  Preview Report
                </button>
                {canManage && (
                  <button
                    type="button"
                    disabled={sendingTest}
                    onClick={() => void handleSendTestReport()}
                    className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  >
                    {sendingTest ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                    Send Test
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Report Delivery History Table */}
      <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-zinc-800">
          <div>
            <h2 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
              <Mail size={15} className="text-emerald-400" />
              Report Delivery History &amp; Audit Log
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              Tracks generation and delivery status separately, preserves generated reports on failure, and supports safe retry or manual resend.
            </p>
          </div>
          <button
            type="button"
            disabled={loadingRuns}
            onClick={() => void refreshRuns()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-xs font-semibold text-zinc-200 transition-colors"
          >
            <RefreshCw size={12} className={loadingRuns ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {runs.length === 0 ? (
          <div className="py-10 text-center rounded-lg border border-dashed border-zinc-800 bg-zinc-950/40 text-xs text-zinc-500">
            No scheduled Daily Operations Reports have executed yet for this property.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-zinc-800 bg-zinc-950/60">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-zinc-800 text-[10px] font-bold uppercase tracking-wider text-zinc-400">
                  <th className="py-2.5 px-3">Reporting Date</th>
                  <th className="py-2.5 px-3">Recipients</th>
                  <th className="py-2.5 px-3">Scheduled / Delivered</th>
                  <th className="py-2.5 px-3">Generation</th>
                  <th className="py-2.5 px-3">Delivery Status</th>
                  <th className="py-2.5 px-3">Details / Errors</th>
                  <th className="py-2.5 px-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800/70">
                {runs.map((run) => {
                  const canRetry =
                    canManage &&
                    (run.deliveryStatus === "failed" ||
                      run.deliveryStatus === "partial" ||
                      run.deliveryStatus === "pending");
                  return (
                    <tr key={run.id} className="hover:bg-zinc-900/50">
                      <td className="py-3 px-3 whitespace-nowrap">
                        <div className="font-bold text-zinc-100 font-mono">{run.reportDate}</div>
                        <div className="text-[10px] text-zinc-500">
                          {run.summarySnapshot
                            ? `Occ: ${run.summarySnapshot.occupancyPercentage}% (${run.summarySnapshot.occupiedRooms}/${run.summarySnapshot.totalRooms})`
                            : run.timezone}
                        </div>
                      </td>
                      <td className="py-3 px-3">
                        <div className="text-zinc-200 font-medium">
                          {run.recipients.length} recipient{run.recipients.length === 1 ? "" : "s"}
                        </div>
                        <div
                          className="text-[10px] text-zinc-500 max-w-[200px] truncate"
                          title={run.recipients.join(", ")}
                        >
                          {run.recipients.join(", ") || "—"}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap text-[11px] text-zinc-400">
                        <div>Sched: {run.scheduledTime} ({run.timezone})</div>
                        <div className="text-zinc-300">
                          Sent: {run.deliveredAt ? formatDateTimeSafe(run.deliveredAt, run.timezone) : "—"}
                        </div>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            run.generationStatus === "generated"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                              : "bg-rose-500/10 text-rose-400 border-rose-500/25"
                          }`}
                        >
                          {run.generationStatus === "generated" ? (
                            <CheckCircle2 size={10} />
                          ) : (
                            <XCircle size={10} />
                          )}
                          {run.generationStatus}
                        </span>
                      </td>
                      <td className="py-3 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase border ${
                            run.deliveryStatus === "sent"
                              ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/25"
                              : run.deliveryStatus === "partial"
                                ? "bg-amber-500/10 text-amber-300 border-amber-500/25"
                                : "bg-rose-500/10 text-rose-400 border-rose-500/25"
                          }`}
                        >
                          {run.deliveryStatus}
                        </span>
                        {run.retryCount > 0 && (
                          <div className="text-[10px] text-zinc-500 mt-0.5">
                            Retries: {run.retryCount}
                          </div>
                        )}
                      </td>
                      <td className="py-3 px-3 max-w-[220px]">
                        {run.errorMessage ? (
                          <div
                            className="text-[11px] text-rose-300 flex items-start gap-1"
                            title={run.errorMessage}
                          >
                            <AlertCircle size={12} className="shrink-0 mt-0.5" />
                            <span className="truncate">{run.errorMessage}</span>
                          </div>
                        ) : (
                          <span className="text-[11px] text-zinc-500">
                            {run.manualResends && run.manualResends.length > 0
                              ? `${run.manualResends.length} manual resend(s)`
                              : "Delivered cleanly"}
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          {run.hasHtmlSnapshot && (
                            <button
                              type="button"
                              disabled={viewingRunId === run.id}
                              onClick={() => void handleViewHistoricalRun(run.id)}
                              className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-semibold text-zinc-200 inline-flex items-center gap-1"
                              title="View preserved report"
                            >
                              {viewingRunId === run.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Eye size={11} />
                              )}
                              View
                            </button>
                          )}
                          {canRetry && (
                            <button
                              type="button"
                              disabled={retryingRunId === run.id}
                              onClick={() => void handleRetryFailedRun(run.id)}
                              className="px-2 py-1 rounded bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/30 text-[11px] font-semibold text-amber-300 inline-flex items-center gap-1"
                              title="Retry failed delivery"
                            >
                              {retryingRunId === run.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <RotateCcw size={11} />
                              )}
                              Retry
                            </button>
                          )}
                          {canManage && run.hasHtmlSnapshot && run.deliveryStatus === "sent" && (
                            <button
                              type="button"
                              disabled={resendingRunId === run.id}
                              onClick={() => void handleManualResendRun(run.id)}
                              className="px-2 py-1 rounded bg-blue-500/15 hover:bg-blue-500/25 border border-blue-500/30 text-[11px] font-semibold text-blue-300 inline-flex items-center gap-1"
                              title="Manually resend this report without modifying schedule"
                            >
                              {resendingRunId === run.id ? (
                                <Loader2 size={11} className="animate-spin" />
                              ) : (
                                <Send size={11} />
                              )}
                              Resend
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Responsive HTML Report Preview Modal */}
      {previewModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-zinc-100 truncate">{previewModal.title}</h3>
                <p className="text-xs text-zinc-400 truncate mt-0.5">
                  Subject: <span className="text-zinc-200">{previewModal.subject}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPreviewModal(null)}
                className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
              >
                <X size={18} />
              </button>
            </div>
            <div className="flex-1 bg-zinc-950 p-4 overflow-hidden">
              <iframe
                title="Daily Hotel Operations Report Preview"
                sandbox=""
                srcDoc={previewModal.html}
                className="w-full h-[70vh] rounded-xl bg-white border border-zinc-800"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
