import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Braces,
  Clock,
  Columns2,
  Eye,
  FileBarChart2,
  Image as ImageIcon,
  Loader2,
  Lock,
  Mail,
  Monitor,
  Pencil,
  Search,
  Settings as SettingsIcon,
  ShieldAlert,
  Smartphone,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../contexts/AuthContext";
import { hasPermission, isPMSModuleAssigned } from "../../../utils/permissions";
import {
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  SUPPORTED_EMAIL_LANGUAGES,
  type AllowedTemplateVariable,
  type CustomizableEmailEventType,
  type EmailRenderContext,
  type EmailTemplateDocument,
  type HotelEmailSettings,
  type SupportedEmailLanguage,
} from "../shared/types";
import { renderEmailTemplate } from "../shared/renderer";
import {
  emailCustomizationApi,
  type EmailCustomizationConfigResponse,
  type EmailTemplateOverviewItem,
} from "./apiClient";
import { AvailableVariablesDrawer } from "./AvailableVariablesDrawer";
import { EmailSettingsPanel } from "./EmailSettingsPanel";
import { ImageLibraryPanel } from "./ImageLibraryModal";
import { TemplateBlockEditor } from "./TemplateBlockEditor";
import { DailyOperationsReportPanel } from "./DailyOperationsReportPanel";

type ActiveTab = "templates" | "daily-ops" | "settings" | "images";
type TemplateCategoryFilter =
  | "all"
  | "guest_stays"
  | "payments_billing"
  | "loyalty_rewards"
  | "corporate"
  | "staff_operations";

const TEMPLATE_CATEGORY_TABS: Array<{ id: TemplateCategoryFilter; label: string }> = [
  { id: "all", label: "All Templates" },
  { id: "guest_stays", label: "Guest Stays" },
  { id: "payments_billing", label: "Payments & Deposits" },
  { id: "loyalty_rewards", label: "Loyalty & Rewards" },
  { id: "corporate", label: "Corporate" },
  { id: "staff_operations", label: "Staff & Operations" },
];

const AUDIENCE_LABEL: Record<string, string> = {
  guest: "Guest",
  corporate: "Corporate",
  hotel_staff: "Staff",
  platform_admin: "Admin",
};

export function EmailTemplatesPage() {
  const { profile, hotel, customRoles } = useAuth();
  const [activeTab, setActiveTab] = useState<ActiveTab>("templates");
  const [categoryFilter, setCategoryFilter] = useState<TemplateCategoryFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
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

  // Available Variables side-drawer & Split-Screen Preview state
  const [variablesDrawerOpen, setVariablesDrawerOpen] = useState(false);
  const [editorSplitPreview, setEditorSplitPreview] = useState(true);
  const [listSplitPreview, setListSplitPreview] = useState(false);
  const [selectedPreviewEvent, setSelectedPreviewEvent] =
    useState<CustomizableEmailEventType | null>(null);
  const [listPreviewLang, setListPreviewLang] = useState<SupportedEmailLanguage>("en");
  const [listPreviewMode, setListPreviewMode] = useState<"desktop" | "mobile">("desktop");
  const [previewCache, setPreviewCache] = useState<
    Record<string, { doc: EmailTemplateDocument; sampleContext: EmailRenderContext }>
  >({});
  const [loadingPreviewEvent, setLoadingPreviewEvent] = useState<string | null>(null);
  const [activeFieldLabel, setActiveFieldLabel] = useState<string | null>(null);
  const [activeResolvedVariables, setActiveResolvedVariables] = useState<
    Record<string, string> | undefined
  >(undefined);
  const insertVariableHandlerRef = useRef<((varName: string) => void) | null>(null);

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return templates.filter((item) => {
      if (categoryFilter !== "all" && item.category && item.category !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q) ||
        item.eventType.toLowerCase().includes(q)
      );
    });
  }, [templates, categoryFilter, searchQuery]);

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

  const loadPreviewForEvent = useCallback(
    async (eventType: CustomizableEmailEventType) => {
      if (!targetHotelId) return;
      setSelectedPreviewEvent(eventType);
      if (previewCache[eventType]) return;
      try {
        setLoadingPreviewEvent(eventType);
        const res = await emailCustomizationApi.getTemplate(eventType, targetHotelId);
        setPreviewCache((prev) => ({
          ...prev,
          [eventType]: {
            doc: res.template,
            sampleContext: res.sampleContext,
          },
        }));
      } catch (err: any) {
        toast.error(err?.message || "Failed to load template preview.");
      } finally {
        setLoadingPreviewEvent((curr) => (curr === eventType ? null : curr));
      }
    },
    [targetHotelId, previewCache]
  );

  // Auto-select the first visible template when split-screen preview is turned on in the templates list
  useEffect(() => {
    if (!listSplitPreview || editingEvent || activeTab !== "templates") return;
    if (filteredTemplates.length === 0) return;
    const stillVisible =
      selectedPreviewEvent &&
      filteredTemplates.some((t) => t.eventType === selectedPreviewEvent);
    if (!stillVisible) {
      void loadPreviewForEvent(filteredTemplates[0].eventType);
    } else if (selectedPreviewEvent && !previewCache[selectedPreviewEvent]) {
      void loadPreviewForEvent(selectedPreviewEvent);
    }
  }, [
    listSplitPreview,
    editingEvent,
    activeTab,
    filteredTemplates,
    selectedPreviewEvent,
    previewCache,
    loadPreviewForEvent,
  ]);

  const selectedListPreviewItem = useMemo(
    () =>
      selectedPreviewEvent
        ? templates.find((t) => t.eventType === selectedPreviewEvent) || null
        : null,
    [templates, selectedPreviewEvent]
  );

  const selectedListPreviewRendered = useMemo(() => {
    if (!selectedPreviewEvent) return null;
    const cached = previewCache[selectedPreviewEvent];
    if (!cached) return null;
    const variant =
      cached.doc.draft?.[listPreviewLang] ||
      cached.doc.published?.[listPreviewLang] ||
      cached.doc.draft?.en ||
      cached.doc.published?.en;
    if (!variant) return null;
    return renderEmailTemplate({
      variant,
      context: cached.sampleContext,
      settings,
      language: listPreviewLang,
      usedDefaultLayout: !cached.doc.isCustomized,
    });
  }, [selectedPreviewEvent, previewCache, listPreviewLang, settings]);

  const handleInsertVariableFromDrawer = useCallback(
    (varName: AllowedTemplateVariable) => {
      if (editingEvent && insertVariableHandlerRef.current) {
        insertVariableHandlerRef.current(varName);
        return;
      }
      const tag = `{{${varName}}}`;
      if (navigator?.clipboard?.writeText) {
        void navigator.clipboard.writeText(tag);
        toast.success(`Copied ${tag} — open any template with Customize to insert at cursor.`);
      }
    },
    [editingEvent]
  );

  const handleOpenEditor = async (item: EmailTemplateOverviewItem) => {
    try {
      setOpeningEvent(item.eventType);
      const res = await emailCustomizationApi.getTemplate(item.eventType, targetHotelId);
      setPreviewCache((prev) => ({
        ...prev,
        [item.eventType]: {
          doc: res.template,
          sampleContext: res.sampleContext,
        },
      }));
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
          splitPreview={editorSplitPreview}
          onToggleSplitPreview={() => setEditorSplitPreview((v) => !v)}
          variablesDrawerOpen={variablesDrawerOpen}
          onToggleVariablesDrawer={() => setVariablesDrawerOpen((v) => !v)}
          onActiveFieldLabelChange={setActiveFieldLabel}
          onResolvedVariablesChange={setActiveResolvedVariables}
          insertVariableHandlerRef={insertVariableHandlerRef}
          onBack={() => {
            setEditingEvent(null);
            setActiveFieldLabel(null);
            setActiveResolvedVariables(undefined);
            void loadWorkspace();
          }}
          onDocumentUpdated={(updated) => {
            setEditingEvent((prev) => (prev ? { ...prev, doc: updated } : null));
            setPreviewCache((prev) => {
              const existing = prev[updated.eventType];
              if (!existing) return prev;
              return { ...prev, [updated.eventType]: { ...existing, doc: updated } };
            });
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
                Customize all automated guest, deposit, billing, loyalty, corporate, and staff emails for{" "}
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
            <div className="space-y-4">
              {/* Category Filter, Search, Available Variables & Split Preview Controls */}
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  {TEMPLATE_CATEGORY_TABS.map((cat) => {
                    const count =
                      cat.id === "all"
                        ? templates.length
                        : templates.filter((t) => t.category === cat.id).length;
                    const active = categoryFilter === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setCategoryFilter(cat.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? "bg-emerald-500/15 border-emerald-500/40 text-emerald-300"
                            : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
                        }`}
                      >
                        {cat.label} <span className="text-[11px] opacity-70 tabular-nums">({count})</span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative flex-1 sm:flex-none sm:w-56">
                    <Search
                      size={13}
                      className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 pointer-events-none"
                    />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search templates..."
                      className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-100 placeholder:text-zinc-500 focus:outline-none focus:border-emerald-500/60"
                    />
                  </div>

                  <button
                    type="button"
                    onClick={() => setVariablesDrawerOpen((v) => !v)}
                    aria-pressed={variablesDrawerOpen}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                      variablesDrawerOpen
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    <Braces size={13} /> Available Variables
                  </button>

                  <button
                    type="button"
                    onClick={() => setListSplitPreview((v) => !v)}
                    aria-pressed={listSplitPreview}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                      listSplitPreview
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                    }`}
                  >
                    <Columns2 size={13} /> {listSplitPreview ? "Split Preview: On" : "Split Preview"}
                  </button>
                </div>
              </div>

              <div
                className={
                  listSplitPreview
                    ? "grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
                    : ""
                }
              >
                <div
                  className={`rounded-xl bg-zinc-900/60 border border-zinc-800 divide-y divide-zinc-800 ${
                    listSplitPreview ? "lg:col-span-6" : ""
                  }`}
                >
                  {filteredTemplates.length === 0 ? (
                    <div className="p-8 text-center text-xs text-zinc-500">
                      No email templates match your current filter.
                    </div>
                  ) : (
                    filteredTemplates.map((item) => {
                      const isRequired = item.canDisable === false;
                      const isSelectedForPreview =
                        listSplitPreview && selectedPreviewEvent === item.eventType;
                      return (
                        <div
                          key={item.eventType}
                          onClick={() => {
                            if (listSplitPreview) {
                              void loadPreviewForEvent(item.eventType);
                            }
                          }}
                          className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4 transition-colors ${
                            listSplitPreview ? "cursor-pointer" : ""
                          } ${
                            isSelectedForPreview
                              ? "bg-emerald-500/10 border-l-2 border-l-emerald-500"
                              : "hover:bg-zinc-900/90"
                          }`}
                        >
                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2.5 flex-wrap">
                              <span className="text-sm font-semibold text-zinc-100">{item.name}</span>
                              {item.audience && AUDIENCE_LABEL[item.audience] && (
                                <span className="text-[10px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700/70">
                                  {AUDIENCE_LABEL[item.audience]}
                                </span>
                              )}
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

                          <div
                            className="flex items-center gap-3 shrink-0"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {isRequired ? (
                              <span
                                title="Security-critical emails cannot be disabled, but their branding and copy can be customized."
                                className="inline-flex items-center gap-1 text-[11px] text-zinc-400"
                              >
                                <Lock size={11} /> Required
                              </span>
                            ) : (
                              <label
                                className={`inline-flex items-center gap-2 text-xs text-zinc-400 ${
                                  canManageEmailModule
                                    ? "cursor-pointer"
                                    : "opacity-60 cursor-not-allowed"
                                }`}
                              >
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
                            )}

                            <button
                              type="button"
                              onClick={() => {
                                setListSplitPreview(true);
                                void loadPreviewForEvent(item.eventType);
                              }}
                              title="Preview live rendering in split-screen"
                              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border text-xs font-medium whitespace-nowrap transition-colors ${
                                isSelectedForPreview
                                  ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                                  : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800 text-zinc-300"
                              }`}
                            >
                              <Eye size={13} /> Preview
                            </button>

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
                      );
                    })
                  )}
                </div>

                {/* Split-Screen Live Template Preview Pane */}
                {listSplitPreview && (
                  <div className="lg:col-span-6 lg:sticky lg:top-4 rounded-xl bg-zinc-900/60 border border-zinc-800 overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-800 flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-zinc-100 truncate">
                          {selectedListPreviewItem?.name || "Live Template Preview"}
                        </div>
                        <div className="text-[11px] text-zinc-500 truncate">
                          {selectedListPreviewItem
                            ? "Select any template on the left to preview its live rendering."
                            : "Choose a template to preview."}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-wrap">
                        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                          {SUPPORTED_EMAIL_LANGUAGES.map((l) => (
                            <button
                              key={l.code}
                              type="button"
                              onClick={() => setListPreviewLang(l.code)}
                              className={`px-2 py-1 rounded text-[11px] font-medium transition-colors ${
                                listPreviewLang === l.code
                                  ? "bg-zinc-800 text-zinc-100"
                                  : "text-zinc-500 hover:text-zinc-300"
                              }`}
                            >
                              {l.code.toUpperCase()}
                            </button>
                          ))}
                        </div>

                        <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
                          <button
                            type="button"
                            onClick={() => setListPreviewMode("desktop")}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                              listPreviewMode === "desktop"
                                ? "bg-zinc-800 text-zinc-100"
                                : "text-zinc-500 hover:text-zinc-300"
                            }`}
                          >
                            <Monitor size={12} /> Desktop
                          </button>
                          <button
                            type="button"
                            onClick={() => setListPreviewMode("mobile")}
                            className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[11px] font-medium ${
                              listPreviewMode === "mobile"
                                ? "bg-zinc-800 text-zinc-100"
                                : "text-zinc-500 hover:text-zinc-300"
                            }`}
                          >
                            <Smartphone size={12} /> Mobile
                          </button>
                        </div>

                        {canManageEmailModule && selectedListPreviewItem && (
                          <button
                            type="button"
                            disabled={openingEvent === selectedListPreviewItem.eventType}
                            onClick={() => {
                              setEditorSplitPreview(true);
                              void handleOpenEditor(selectedListPreviewItem);
                            }}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-xs font-semibold text-white whitespace-nowrap transition-colors"
                          >
                            <Pencil size={12} /> Edit Template
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => setListSplitPreview(false)}
                          title="Close split preview"
                          className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </div>

                    {loadingPreviewEvent === selectedPreviewEvent || !selectedListPreviewRendered ? (
                      <div className="py-24 flex items-center justify-center gap-2 text-xs text-zinc-500">
                        <Loader2 size={16} className="animate-spin" />
                        {selectedListPreviewItem
                          ? `Rendering ${selectedListPreviewItem.name}...`
                          : "Select a template to preview"}
                      </div>
                    ) : (
                      <>
                        <div className="px-4 py-2.5 bg-zinc-950/70 border-b border-zinc-800 text-xs space-y-1">
                          <div className="flex gap-2">
                            <span className="text-zinc-500 w-16 shrink-0">From:</span>
                            <span className="text-zinc-300 truncate">
                              {selectedListPreviewRendered.fromName}
                            </span>
                          </div>
                          <div className="flex gap-2">
                            <span className="text-zinc-500 w-16 shrink-0">Subject:</span>
                            <span className="text-zinc-100 font-medium truncate">
                              {selectedListPreviewRendered.subject}
                            </span>
                          </div>
                          {selectedListPreviewRendered.preheader && (
                            <div className="flex gap-2">
                              <span className="text-zinc-500 w-16 shrink-0">Preview:</span>
                              <span className="text-zinc-400 truncate">
                                {selectedListPreviewRendered.preheader}
                              </span>
                            </div>
                          )}
                        </div>

                        <div className="bg-zinc-950 p-4 flex justify-center overflow-x-auto">
                          <iframe
                            title="Selected email template live preview"
                            sandbox="allow-same-origin"
                            srcDoc={selectedListPreviewRendered.html}
                            className="bg-white rounded-lg border border-zinc-800 transition-all"
                            style={{
                              width: listPreviewMode === "mobile" ? "375px" : "100%",
                              maxWidth: "660px",
                              height: "620px",
                            }}
                          />
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
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

      {/* Available Variables Side-Drawer (accessible across template list & editor with one-click cursor insertion) */}
      <AvailableVariablesDrawer
        open={variablesDrawerOpen}
        onClose={() => setVariablesDrawerOpen(false)}
        canInsertDirectly={Boolean(editingEvent)}
        activeFieldLabel={activeFieldLabel}
        resolvedVariables={activeResolvedVariables}
        onInsertVariable={handleInsertVariableFromDrawer}
      />
    </div>
  );
}
