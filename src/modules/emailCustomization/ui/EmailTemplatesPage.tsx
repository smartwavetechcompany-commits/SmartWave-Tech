import React, { useCallback, useEffect, useState } from "react";
import {
  AlertCircle,
  Clock,
  FileBarChart2,
  Image as ImageIcon,
  Loader2,
  Mail,
  Pencil,
  Settings as SettingsIcon,
  ShieldAlert,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../contexts/AuthContext";
import { hasPermission, isPMSModuleAssigned } from "../../../utils/permissions";
import type {
  CustomizableEmailEventType,
  EmailRenderContext,
  EmailTemplateDocument,
  HotelEmailSettings,
} from "../shared/types";
import { DEFAULT_HOTEL_EMAIL_SETTINGS } from "../shared/types";
import {
  emailCustomizationApi,
  type EmailCustomizationConfigResponse,
  type EmailTemplateOverviewItem,
} from "./apiClient";
import { EmailSettingsPanel } from "./EmailSettingsPanel";
import { ImageLibraryPanel } from "./ImageLibraryModal";
import { TemplateBlockEditor } from "./TemplateBlockEditor";
import { DailyOperationsReportPanel } from "./DailyOperationsReportPanel";

type ActiveTab = "templates" | "daily-ops" | "settings" | "images";

export function EmailTemplatesPage() {
  const { profile, hotel, customRoles } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("templates");
  const [config, setConfig] = useState<EmailCustomizationConfigResponse | null>(null);
  const [templates, setTemplates] = useState<EmailTemplateOverviewItem[]>([]);
  const [settings, setSettings] = useState<HotelEmailSettings>(DEFAULT_HOTEL_EMAIL_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [editingEvent, setEditingEvent] = useState<{
    eventType: CustomizableEmailEventType;
    name: string;
    description: string;
    doc: EmailTemplateDocument;
    sampleContext: EmailRenderContext;
  } | null>(null);
  const [openingEvent, setOpeningEvent] = useState<string | null>(null);
  const [togglingEvent, setTogglingEvent] = useState<string | null>(null);

  const isStrictAdmin = Boolean(
    profile &&
      (profile.role === "superAdmin" ||
        profile.role === "hotelAdmin" ||
        (profile.role as string) === "admin" ||
        profile.staffRole === "admin")
  );
  const canViewEmailModule = Boolean(
    isStrictAdmin || isPMSModuleAssigned(profile, "email_templates", customRoles)
  );
  const canManageEmailModule = Boolean(
    isStrictAdmin || hasPermission(profile, "manage_email_templates", customRoles)
  );

  const targetHotelId = hotel?.id || (profile?.role !== "superAdmin" ? profile?.hotelId : undefined);

  const loadWorkspace = useCallback(async () => {
    if (!canViewEmailModule || !targetHotelId) {
      setLoading(false);
      return;
    }
    try {
      setLoading(true);
      setErrorMsg(null);
      const [cfgRes, ovRes] = await Promise.all([
        emailCustomizationApi.getConfig(targetHotelId),
        emailCustomizationApi.getOverview(targetHotelId),
      ]);
      setConfig(cfgRes);
      setTemplates(ovRes.templates || []);
      setSettings(ovRes.settings || DEFAULT_HOTEL_EMAIL_SETTINGS);
    } catch (err: any) {
      setErrorMsg(err?.message || "Failed to load Email Customization module.");
    } finally {
      setLoading(false);
    }
  }, [canViewEmailModule, targetHotelId]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const handleOpenEditor = async (item: EmailTemplateOverviewItem) => {
    try {
      setOpeningEvent(item.eventType);
      const res = await emailCustomizationApi.getTemplate(item.eventType, targetHotelId);
      setEditingEvent({
        eventType: item.eventType,
        name: item.name,
        description: item.description,
        doc: res.template,
        sampleContext: res.sampleContext,
      });
    } catch (err: any) {
      toast.error(err?.message || "Failed to open template editor.");
    } finally {
      setOpeningEvent(null);
    }
  };

  const handleToggleEvent = async (item: EmailTemplateOverviewItem) => {
    try {
      setTogglingEvent(item.eventType);
      const nextEnabled = !item.enabled;
      await emailCustomizationApi.toggleTemplate(item.eventType, nextEnabled, targetHotelId);
      setTemplates((prev) =>
        prev.map((t) => (t.eventType === item.eventType ? { ...t, enabled: nextEnabled } : t))
      );
      toast.success(
        nextEnabled ? `${item.name} enabled.` : `${item.name} paused — this email will be skipped.`
      );
    } catch (err: any) {
      toast.error(err?.message || "Could not update email toggle.");
    } finally {
      setTogglingEvent(null);
    }
  };

  if (!canViewEmailModule) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-8 text-center space-y-3">
          <ShieldAlert size={28} className="mx-auto text-amber-400" />
          <h2 className="text-base font-semibold text-zinc-100">Access Restricted</h2>
          <p className="text-xs text-zinc-400">
            Email Templates &amp; Branding is restricted to Hotel Administrators and staff explicitly assigned the Email Templates module in Role-Based Access Control.
          </p>
        </div>
      </div>
    );
  }

  if (!targetHotelId) {
    return (
      <div className="p-8 max-w-2xl mx-auto">
        <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-8 text-center space-y-3">
          <Mail size={28} className="mx-auto text-zinc-400" />
          <h2 className="text-base font-semibold text-zinc-100">Select a Hotel First</h2>
          <p className="text-xs text-zinc-400">
            Open a hotel from the Super Admin dashboard to manage its email templates and branding.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6 lg:p-8 max-w-[1440px] mx-auto space-y-6">
      {/* If actively editing a single template, render full split-pane editor */}
      {editingEvent ? (
        <TemplateBlockEditor
          hotelId={targetHotelId}
          eventType={editingEvent.eventType}
          eventName={editingEvent.name}
          eventDescription={editingEvent.description}
          initialDoc={editingEvent.doc}
          settings={settings}
          sampleContext={editingEvent.sampleContext}
          callerEmail={config?.callerEmail || profile?.email || ""}
          onBack={() => {
            setEditingEvent(null);
            void loadWorkspace();
          }}
          onDocumentUpdated={(updated) => {
            setEditingEvent((prev) => (prev ? { ...prev, doc: updated } : null));
          }}
          onSettingsUpdated={(nextSettings) => {
            setSettings(nextSettings);
          }}
        />
      ) : (
        <>
          {/* Page Header */}
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-zinc-800 pb-5">
            <div>
              <h1 className="text-xl font-semibold text-zinc-50 tracking-tight">
                Email Templates & Branding
              </h1>
              <p className="text-xs text-zinc-400 mt-1">
                Customize guest transactional emails for{" "}
                <span className="text-zinc-200 font-medium">
                  {config?.hotelName || hotel?.name || "your hotel"}
                </span>
                . Uncustomized events automatically continue using the standard PMS layout.
              </p>
            </div>

            {/* Clean Top Sub-Navigation Tabs */}
            <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-900/70 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("templates")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === "templates"
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Mail size={13} /> Templates
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("daily-ops")}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  activeTab === "daily-ops"
                    ? "bg-zinc-800 text-zinc-50"
                    : "text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <FileBarChart2 size={13} /> Daily Operations Report
              </button>
              {canManageEmailModule && (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab("settings")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      activeTab === "settings"
                        ? "bg-zinc-800 text-zinc-50"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <SettingsIcon size={13} /> Email Settings
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveTab("images")}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                      activeTab === "images"
                        ? "bg-zinc-800 text-zinc-50"
                        : "text-zinc-400 hover:text-zinc-200"
                    }`}
                  >
                    <ImageIcon size={13} /> Image Library
                  </button>
                </>
              )}
            </div>
          </div>

          {!canManageEmailModule && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-zinc-300">
              <ShieldAlert size={15} className="shrink-0 mt-0.5 text-amber-400" />
              <div>
                You have read-only access to Email Templates. Only a Hotel Administrator or an assigned administrator with <span className="font-mono text-zinc-100">manage_email_templates</span> permission can edit, toggle, or publish changes.
              </div>
            </div>
          )}

          {config && !config.enabled && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <div>
                Email customization is currently paused by the platform feature flag
                (<span className="font-mono">EMAIL_CUSTOMIZATION_ENABLED=false</span>). Live emails
                are temporarily using the default PMS templates.
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {loading ? (
            <div className="py-16 flex items-center justify-center gap-2 text-xs text-zinc-500">
              <Loader2 size={16} className="animate-spin" /> Loading email customization workspace...
            </div>
          ) : activeTab === "templates" ? (
            <div className="rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800">
              {templates.map((item) => (
                <div
                  key={item.eventType}
                  className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-zinc-900/90 transition-colors"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="text-sm font-semibold text-zinc-100">{item.name}</span>
                      <span className="text-xs text-zinc-500 tabular-nums">
                        {item.isCustomized
                          ? `Customized · v${item.publishedVersion}`
                          : "Default"}
                        {item.hasDraftChanges ? " · Draft pending" : ""}
                      </span>
                      {item.requiresScheduler && (
                        <span className="inline-flex items-center gap-1 text-[11px] text-zinc-400">
                          <Clock size={11} /> Scheduled
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-zinc-400">{item.description}</p>
                    <div className="text-[11px] text-zinc-500 tabular-nums">
                      Languages: EN / DE
                      {item.updatedAt
                        ? ` · Last updated ${new Date(item.updatedAt).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 shrink-0">
                    <label className={`inline-flex items-center gap-2 text-xs text-zinc-400 ${canManageEmailModule ? "cursor-pointer" : "opacity-60 cursor-not-allowed"}`}>
                      <span>{item.enabled ? "Enabled" : "Paused"}</span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={item.enabled}
                        disabled={!canManageEmailModule || togglingEvent === item.eventType}
                        onClick={() => canManageEmailModule && void handleToggleEvent(item)}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                          item.enabled ? "bg-emerald-600" : "bg-zinc-700"
                        } ${!canManageEmailModule ? "cursor-not-allowed" : ""}`}
                      >
                        <span
                          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
                            item.enabled ? "translate-x-4.5" : "translate-x-1"
                          }`}
                        />
                      </button>
                    </label>

                    {canManageEmailModule && (
                      <button
                        type="button"
                        disabled={openingEvent === item.eventType}
                        onClick={() => void handleOpenEditor(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-100 whitespace-nowrap transition-colors"
                      >
                        {openingEvent === item.eventType ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Pencil size={13} />
                        )}
                        Customize
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : activeTab === "daily-ops" ? (
            <DailyOperationsReportPanel
              hotelId={targetHotelId}
              hotelName={config?.hotelName || hotel?.name || "Hotel Property"}
              canManage={canManageEmailModule}
              callerEmail={config?.callerEmail || profile?.email || ""}
            />
          ) : activeTab === "settings" ? (
            <EmailSettingsPanel
              hotelId={targetHotelId}
              initialSettings={settings}
              appUrl={config?.appUrl || "https://tidehotels.de"}
              verifiedFromAddress={config?.verifiedFromAddress || ""}
              currencyCode={hotel?.defaultCurrency || "NGN"}
              onSaved={(next) => setSettings(next)}
              onAppliedDefaultFooter={() => void loadWorkspace()}
            />
          ) : (
            <ImageLibraryPanel hotelId={targetHotelId} mode="page" />
          )}
        </>
      )}
    </div>
  );
}
