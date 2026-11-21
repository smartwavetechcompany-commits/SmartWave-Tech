import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Eye,
  EyeOff,
  Link2,
  Mail,
  Phone,
  Plus,
  Trash2,
  Variable,
  X,
} from "lucide-react";
import {
  ALLOWED_CONTACT_URL_VARIABLES,
  ALLOWED_URL_VARIABLES,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type HotelEmailSettings,
  type InlineTextLink,
  type SupportedEmailLanguage,
  type TemplateLinkOverviewItem,
} from "../shared/types";
import {
  extractTemplateLinksOverview,
  validateAbsoluteLinkUrl,
  validateEmailUrl,
  validateLinkLabelAgainstUrl,
} from "../shared/validation";

const inputClass =
  "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";

const labelClass = "block text-[11px] font-medium text-zinc-400 mb-1";

export type LinkDestinationMode = "https" | "variable" | "mailto" | "tel";

const URL_VARIABLE_OPTIONS: Array<{ token: string; label: string; contact?: boolean }> = [
  { token: "{{portal_link}}", label: "Hotel Portal ({{portal_link}})" },
  { token: "{{booking_link}}", label: "Booking Page ({{booking_link}})" },
  { token: "{{hotel_website}}", label: "Hotel Website ({{hotel_website}})" },
  { token: "{{review_link}}", label: "Guest Review Page ({{review_link}})" },
  { token: "{{directions_link}}", label: "Directions / Map ({{directions_link}})" },
  { token: "{{wifi_guide_link}}", label: "Wi-Fi & Guest Guide ({{wifi_guide_link}})" },
  { token: "{{social_instagram}}", label: "Instagram ({{social_instagram}})" },
  { token: "{{social_facebook}}", label: "Facebook ({{social_facebook}})" },
  { token: "{{social_x}}", label: "X / Twitter ({{social_x}})" },
  { token: "{{social_linkedin}}", label: "LinkedIn ({{social_linkedin}})" },
  { token: "{{app_url}}", label: "Platform App URL ({{app_url}})" },
  { token: "mailto:{{hotel_email}}", label: "Hotel Email (mailto:{{hotel_email}})", contact: true },
  { token: "tel:{{hotel_phone}}", label: "Hotel Phone (tel:{{hotel_phone}})", contact: true },
];

export function detectLinkMode(url?: string, allowContactSchemes = false): LinkDestinationMode {
  const trimmed = String(url || "").trim();
  if (
    ALLOWED_URL_VARIABLES.has(trimmed) ||
    (allowContactSchemes && ALLOWED_CONTACT_URL_VARIABLES.has(trimmed))
  ) {
    return "variable";
  }
  const lower = trimmed.toLowerCase();
  if (allowContactSchemes && lower.startsWith("mailto:")) return "mailto";
  if (allowContactSchemes && lower.startsWith("tel:")) return "tel";
  return "https";
}

export function resolvePreviewLinkUrl(
  rawUrl: string | undefined,
  resolvedVariables?: Record<string, string>
): { resolved: string; isVariable: boolean; isEmptyVariable: boolean } {
  const trimmed = String(rawUrl || "").trim();
  if (!trimmed) return { resolved: "", isVariable: false, isEmptyVariable: false };
  const isVariable =
    ALLOWED_URL_VARIABLES.has(trimmed) || ALLOWED_CONTACT_URL_VARIABLES.has(trimmed);

  if (!resolvedVariables) {
    return { resolved: trimmed, isVariable, isEmptyVariable: false };
  }

  const substituted = trimmed.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
    const val = resolvedVariables[key];
    return typeof val === "string" ? val : "";
  });

  if (
    isVariable &&
    (!substituted.trim() || substituted.trim() === "mailto:" || substituted.trim() === "tel:")
  ) {
    return { resolved: "", isVariable: true, isEmptyVariable: true };
  }
  return { resolved: substituted.trim(), isVariable, isEmptyVariable: false };
}

export interface LinkDestinationFieldProps {
  label?: string;
  url: string;
  visibleLabel?: string;
  onChangeUrl: (nextUrl: string) => void;
  allowContactSchemes?: boolean;
  allowEmpty?: boolean;
  resolvedVariables?: Record<string, string>;
  openInNewTab?: boolean;
  onChangeOpenInNewTab?: (next: boolean) => void;
  hidden?: boolean;
  onChangeHidden?: (next: boolean) => void;
  color?: string;
  onChangeColor?: (next: string | undefined) => void;
  underline?: boolean;
  onChangeUnderline?: (next: boolean) => void;
  compact?: boolean;
}

export function LinkDestinationField({
  label,
  url,
  visibleLabel,
  onChangeUrl,
  allowContactSchemes = false,
  allowEmpty = true,
  resolvedVariables,
  openInNewTab,
  onChangeOpenInNewTab,
  hidden,
  onChangeHidden,
  color,
  onChangeColor,
  underline,
  onChangeUnderline,
  compact = false,
}: LinkDestinationFieldProps) {
  const detectedMode = detectLinkMode(url, allowContactSchemes);
  const [explicitMode, setExplicitMode] = useState<LinkDestinationMode | null>(null);
  const mode: LinkDestinationMode = explicitMode ?? detectedMode;

  const variableOptions = useMemo(
    () => URL_VARIABLE_OPTIONS.filter((opt) => allowContactSchemes || !opt.contact),
    [allowContactSchemes]
  );

  const preview = useMemo(
    () => resolvePreviewLinkUrl(url, resolvedVariables),
    [url, resolvedVariables]
  );

  const isContactTarget =
    mode === "mailto" ||
    mode === "tel" ||
    url.trim().toLowerCase().startsWith("mailto:") ||
    url.trim().toLowerCase().startsWith("tel:");

  const formatCheck = useMemo(() => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      return allowEmpty
        ? { valid: true, isAbsolute: false }
        : { valid: false, isAbsolute: false, error: "Destination URL is required." };
    }
    return validateAbsoluteLinkUrl(trimmed, {
      allowHttp: false,
      allowEmpty,
      allowVariableToken: true,
      allowContactSchemes,
      fieldName: label || "Link URL",
    });
  }, [url, allowEmpty, allowContactSchemes, label]);

  const validationError = useMemo(() => {
    const trimmed = (url || "").trim();
    if (!trimmed) {
      return allowEmpty ? null : "Destination URL is required.";
    }
    if (!formatCheck.valid) return formatCheck.error || "Invalid link URL.";

    const urlCheck = validateEmailUrl(trimmed, {
      allowEmpty,
      allowVariableToken: true,
      allowContactSchemes,
      fieldName: label || "Link URL",
    });
    if (!urlCheck.valid) return urlCheck.error || "Invalid link URL.";

    if (visibleLabel && visibleLabel.trim() && preview.resolved) {
      const phish = validateLinkLabelAgainstUrl(visibleLabel, preview.resolved, label || "Link");
      if (!phish.valid) return phish.error || "Visible text does not match link destination.";
    }
    return null;
  }, [url, allowEmpty, allowContactSchemes, label, visibleLabel, preview.resolved, formatCheck]);

  const handleSelectMode = (nextMode: LinkDestinationMode) => {
    setExplicitMode(nextMode);
    if (nextMode === "variable") {
      if (
        !ALLOWED_URL_VARIABLES.has(url.trim()) &&
        !(allowContactSchemes && ALLOWED_CONTACT_URL_VARIABLES.has(url.trim()))
      ) {
        onChangeUrl("{{portal_link}}");
      }
    } else if (nextMode === "mailto") {
      if (!url.trim().toLowerCase().startsWith("mailto:")) {
        const clean = url.trim().replace(/^https?:\/\/|^tel:/i, "");
        onChangeUrl(clean.includes("@") ? `mailto:${clean}` : "mailto:");
      }
    } else if (nextMode === "tel") {
      if (!url.trim().toLowerCase().startsWith("tel:")) {
        onChangeUrl("tel:");
      }
    } else {
      if (
        ALLOWED_URL_VARIABLES.has(url.trim()) ||
        ALLOWED_CONTACT_URL_VARIABLES.has(url.trim()) ||
        url.trim().toLowerCase().startsWith("mailto:") ||
        url.trim().toLowerCase().startsWith("tel:")
      ) {
        onChangeUrl("");
      }
    }
  };

  const mailtoDisplay = url.trim().toLowerCase().startsWith("mailto:")
    ? url.trim().slice(7)
    : url.trim();
  const telDisplay = url.trim().toLowerCase().startsWith("tel:")
    ? url.trim().slice(4)
    : url.trim();

  return (
    <div className={compact ? "space-y-1.5" : "space-y-2"}>
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        {label ? <span className={labelClass + " mb-0"}>{label}</span> : <span />}
        <div className="inline-flex rounded-md border border-zinc-800 bg-zinc-950 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => handleSelectMode("https")}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              mode === "https" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Link2 size={10} /> HTTPS
          </button>
          <button
            type="button"
            onClick={() => handleSelectMode("variable")}
            className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
              mode === "variable" ? "bg-zinc-800 text-emerald-300" : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            <Variable size={10} /> Variable
          </button>
          {allowContactSchemes && (
            <>
              <button
                type="button"
                onClick={() => handleSelectMode("mailto")}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                  mode === "mailto" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Mail size={10} /> Email
              </button>
              <button
                type="button"
                onClick={() => handleSelectMode("tel")}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded transition-colors ${
                  mode === "tel" ? "bg-zinc-800 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                <Phone size={10} /> Phone
              </button>
            </>
          )}
        </div>
      </div>

      {mode === "variable" ? (
        <select
          value={variableOptions.some((o) => o.token === url.trim()) ? url.trim() : "{{portal_link}}"}
          onChange={(e) => onChangeUrl(e.target.value)}
          className={`${inputClass} font-mono`}
        >
          {variableOptions.map((opt) => (
            <option key={opt.token} value={opt.token}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : mode === "mailto" ? (
        <div className="flex items-center rounded-lg bg-zinc-950 border border-zinc-800 focus-within:border-emerald-500 overflow-hidden">
          <span className="px-2 py-1.5 text-[11px] font-mono text-zinc-500 bg-zinc-900/70 border-r border-zinc-800 shrink-0">
            mailto:
          </span>
          <input
            type="email"
            value={mailtoDisplay}
            onChange={(e) => {
              const v = e.target.value.trim();
              onChangeUrl(v ? `mailto:${v}` : "");
            }}
            placeholder="reservations@yourhotel.com"
            className="w-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      ) : mode === "tel" ? (
        <div className="flex items-center rounded-lg bg-zinc-950 border border-zinc-800 focus-within:border-emerald-500 overflow-hidden">
          <span className="px-2 py-1.5 text-[11px] font-mono text-zinc-500 bg-zinc-900/70 border-r border-zinc-800 shrink-0">
            tel:
          </span>
          <input
            type="tel"
            value={telDisplay}
            onChange={(e) => {
              const v = e.target.value;
              onChangeUrl(v.trim() ? `tel:${v.trim()}` : "");
            }}
            placeholder="+49 30 555 0199"
            className="w-full bg-transparent px-2.5 py-1.5 text-xs font-mono text-zinc-100 placeholder:text-zinc-600 focus:outline-none"
          />
        </div>
      ) : (
        <input
          type="text"
          value={url || ""}
          onChange={(e) => {
            const val = e.target.value;
            setExplicitMode(null);
            onChangeUrl(val);
          }}
          placeholder="https://yourhotel.com/... (or {{portal_link}})"
          className={`${inputClass} font-mono`}
        />
      )}

      {/* Live resolved URL preview & validation */}
      {validationError ? (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-red-400 leading-snug">
          <div className="flex items-start gap-1.5 min-w-0">
            <AlertCircle size={12} className="shrink-0 mt-0.5" />
            <span>{validationError}</span>
          </div>
          {formatCheck.suggestedHttpsUrl && (
            <button
              type="button"
              onClick={() => {
                setExplicitMode("https");
                onChangeUrl(formatCheck.suggestedHttpsUrl!);
              }}
              className="px-2 py-0.5 rounded bg-emerald-600/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/30 text-[10px] font-medium whitespace-nowrap"
            >
              Use https://
            </button>
          )}
        </div>
      ) : preview.isEmptyVariable ? (
        <div className="flex items-start gap-1.5 text-[11px] text-amber-400 leading-snug">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>
            This variable is currently empty in Email Settings — the link will be hidden cleanly
            until configured.
          </span>
        </div>
      ) : preview.resolved ? (
        <div className="text-[11px] text-zinc-500 truncate">
          Resolves to: <span className="font-mono text-emerald-400">{preview.resolved}</span>
        </div>
      ) : null}

      {/* Optional compact style / behavior controls */}
      {(onChangeOpenInNewTab || onChangeHidden || onChangeColor || onChangeUnderline) && (
        <div className="flex flex-wrap items-center gap-3 pt-0.5 text-[11px] text-zinc-400">
          {onChangeOpenInNewTab && !isContactTarget && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={openInNewTab !== false}
                onChange={(e) => onChangeOpenInNewTab(e.target.checked)}
              />
              Open in new tab
            </label>
          )}
          {onChangeUnderline && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={underline !== false}
                onChange={(e) => onChangeUnderline(e.target.checked)}
              />
              Underline
            </label>
          )}
          {onChangeColor && (
            <label className="inline-flex items-center gap-1.5">
              <span>Link color</span>
              <input
                type="color"
                value={color || "#059669"}
                onChange={(e) => onChangeColor(e.target.value)}
                className="h-5 w-7 rounded bg-zinc-950 border border-zinc-800 cursor-pointer"
              />
              {color && (
                <button
                  type="button"
                  onClick={() => onChangeColor(undefined)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  Reset
                </button>
              )}
            </label>
          )}
          {onChangeHidden && (
            <label className="inline-flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(hidden)}
                onChange={(e) => onChangeHidden(e.target.checked)}
              />
              Hide link
            </label>
          )}
        </div>
      )}
    </div>
  );
}

export interface InlineLinksEditorProps {
  inlineLinks?: InlineTextLink[];
  onChangeLinks: (nextLinks: InlineTextLink[]) => void;
  onInsertToken: (token: string) => void;
  onRemoveToken?: (token: string) => void;
  resolvedVariables?: Record<string, string>;
  helperHint?: string;
}

export function InlineLinksEditor({
  inlineLinks = [],
  onChangeLinks,
  onInsertToken,
  onRemoveToken,
  resolvedVariables,
  helperHint,
}: InlineLinksEditorProps) {
  const [composerOpen, setComposerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftLabel, setDraftLabel] = useState("");
  const [draftUrl, setDraftUrl] = useState("{{portal_link}}");
  const [draftColor, setDraftColor] = useState<string | undefined>(undefined);
  const [draftUnderline, setDraftUnderline] = useState(true);
  const [draftOpenInNewTab, setDraftOpenInNewTab] = useState(true);

  const resetComposer = () => {
    setComposerOpen(false);
    setEditingId(null);
    setDraftLabel("");
    setDraftUrl("{{portal_link}}");
    setDraftColor(undefined);
    setDraftUnderline(true);
    setDraftOpenInNewTab(true);
  };

  const openEdit = (link: InlineTextLink) => {
    setEditingId(link.id);
    setDraftLabel(link.label);
    setDraftUrl(link.url);
    setDraftColor(link.color);
    setDraftUnderline(link.underline !== false);
    setDraftOpenInNewTab(link.openInNewTab !== false);
    setComposerOpen(true);
  };

  const handleSaveInlineLink = () => {
    const cleanLabel = draftLabel.trim();
    const cleanUrl = draftUrl.trim();
    if (!cleanLabel || !cleanUrl) return;

    const urlCheck = validateEmailUrl(cleanUrl, {
      allowEmpty: false,
      allowVariableToken: true,
      allowContactSchemes: true,
    });
    if (!urlCheck.valid) return;

    const resolved = resolvePreviewLinkUrl(cleanUrl, resolvedVariables).resolved;
    if (resolved) {
      const phish = validateLinkLabelAgainstUrl(cleanLabel, resolved);
      if (!phish.valid) return;
    }

    if (editingId) {
      onChangeLinks(
        inlineLinks.map((l) =>
          l.id === editingId
            ? {
                ...l,
                label: cleanLabel,
                url: cleanUrl,
                color: draftColor,
                underline: draftUnderline,
                openInNewTab: draftOpenInNewTab,
              }
            : l
        )
      );
      resetComposer();
      return;
    }

    const newId = `il_${Date.now().toString(36).slice(-4)}${Math.random().toString(36).slice(2, 5)}`;
    const newLink: InlineTextLink = {
      id: newId,
      label: cleanLabel,
      url: cleanUrl,
      ...(draftColor ? { color: draftColor } : {}),
      underline: draftUnderline,
      openInNewTab: draftOpenInNewTab,
    };
    onChangeLinks([...inlineLinks, newLink]);
    onInsertToken(`[[link:${newId}]]`);
    resetComposer();
  };

  const handleDeleteInlineLink = (id: string) => {
    onChangeLinks(inlineLinks.filter((l) => l.id !== id));
    onRemoveToken?.(`[[link:${id}]]`);
    if (editingId === id) resetComposer();
  };

  const draftCanSave = useMemo(() => {
    const cleanLabel = draftLabel.trim();
    const cleanUrl = draftUrl.trim();
    if (!cleanLabel || !cleanUrl) return false;
    const urlCheck = validateEmailUrl(cleanUrl, {
      allowEmpty: false,
      allowVariableToken: true,
      allowContactSchemes: true,
    });
    if (!urlCheck.valid) return false;
    const resolved = resolvePreviewLinkUrl(cleanUrl, resolvedVariables).resolved;
    if (resolved && !validateLinkLabelAgainstUrl(cleanLabel, resolved).valid) return false;
    return true;
  }, [draftLabel, draftUrl, resolvedVariables]);

  return (
    <div className="rounded-lg bg-zinc-950/70 border border-zinc-800/80 p-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-zinc-300">
          <Link2 size={12} className="text-emerald-400" />
          <span>Inline Text Links ({inlineLinks.length})</span>
        </div>
        {!composerOpen && (
          <button
            type="button"
            onClick={() => {
              setEditingId(null);
              setDraftLabel("");
              setDraftUrl("{{portal_link}}");
              setComposerOpen(true);
            }}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-emerald-300 whitespace-nowrap"
          >
            <Plus size={11} /> Insert Link
          </button>
        )}
      </div>

      {helperHint && (
        <p className="text-[10px] text-zinc-500 leading-snug">{helperHint}</p>
      )}

      {inlineLinks.length > 0 && (
        <div className="space-y-1.5">
          {inlineLinks.map((lnk) => {
            const preview = resolvePreviewLinkUrl(lnk.url, resolvedVariables);
            return (
              <div
                key={lnk.id}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-2 py-1.5 text-[11px] ${
                  lnk.hidden
                    ? "border-zinc-800/70 bg-zinc-950/50 opacity-60"
                    : "border-zinc-800 bg-zinc-900/60"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-medium text-zinc-200 truncate">{lnk.label}</span>
                    <span className="font-mono text-[10px] text-zinc-500">
                      {`[[link:${lnk.id}]]`}
                    </span>
                    {lnk.hidden && (
                      <span className="text-[10px] text-amber-400">Hidden</span>
                    )}
                  </div>
                  <div className="text-[10px] font-mono text-emerald-400/90 truncate">
                    {preview.isEmptyVariable
                      ? `${lnk.url} (empty in Email Settings)`
                      : preview.resolved || lnk.url}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => onInsertToken(`[[link:${lnk.id}]]`)}
                    title="Insert token into text"
                    className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-300"
                  >
                    Place
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(lnk)}
                    className="px-1.5 py-0.5 rounded bg-zinc-800 hover:bg-zinc-700 text-[10px] text-zinc-200"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    title={lnk.hidden ? "Show inline link" : "Hide inline link"}
                    onClick={() =>
                      onChangeLinks(
                        inlineLinks.map((x) =>
                          x.id === lnk.id ? { ...x, hidden: !x.hidden } : x
                        )
                      )
                    }
                    className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                  >
                    {lnk.hidden ? <EyeOff size={11} /> : <Eye size={11} />}
                  </button>
                  <button
                    type="button"
                    title="Remove inline link"
                    onClick={() => handleDeleteInlineLink(lnk.id)}
                    className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {composerOpen && (
        <div className="rounded-lg bg-zinc-900/90 border border-zinc-700/80 p-2.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-zinc-200">
              {editingId ? "Edit Inline Link" : "Insert New Inline Link"}
            </span>
            <button
              type="button"
              onClick={resetComposer}
              className="p-0.5 text-zinc-400 hover:text-zinc-100"
            >
              <X size={13} />
            </button>
          </div>
          <div>
            <label className={labelClass}>Visible Link Text (no raw HTML)</label>
            <input
              type="text"
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="e.g. view check-in directions or email reception"
              className={inputClass}
            />
          </div>
          <LinkDestinationField
            label="Destination"
            url={draftUrl}
            visibleLabel={draftLabel}
            onChangeUrl={setDraftUrl}
            allowContactSchemes
            allowEmpty={false}
            resolvedVariables={resolvedVariables}
            color={draftColor}
            onChangeColor={setDraftColor}
            underline={draftUnderline}
            onChangeUnderline={setDraftUnderline}
            openInNewTab={draftOpenInNewTab}
            onChangeOpenInNewTab={setDraftOpenInNewTab}
            compact
          />
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={resetComposer}
              className="px-2.5 py-1 rounded-md border border-zinc-700 text-[11px] text-zinc-300 hover:bg-zinc-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!draftCanSave}
              onClick={handleSaveInlineLink}
              className="px-2.5 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-[11px] font-semibold text-white"
            >
              {editingId ? "Update Link" : "Insert into Text"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export interface LinksOverviewPanelProps {
  variant: EmailTemplateVariant;
  sampleContext: EmailRenderContext;
  settings: HotelEmailSettings;
  language: SupportedEmailLanguage;
  onSelectBlock: (blockId: string) => void;
  onClose?: () => void;
}

export function LinksOverviewPanel({
  variant,
  sampleContext,
  settings,
  language,
  onSelectBlock,
  onClose,
}: LinksOverviewPanelProps) {
  const items: TemplateLinkOverviewItem[] = useMemo(
    () => extractTemplateLinksOverview(variant, sampleContext, settings, language),
    [variant, sampleContext, settings, language]
  );

  const invalidCount = items.filter((i) => !i.hidden && i.status === "invalid").length;
  const emptyVarCount = items.filter((i) => !i.hidden && i.status === "empty_variable").length;
  const hiddenCount = items.filter((i) => i.hidden).length;
  const activeCount = items.filter((i) => !i.hidden && i.status === "valid").length;

  return (
    <div className="rounded-xl bg-zinc-900/90 border border-zinc-700/90 p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link2 size={14} className="text-emerald-400" />
            <h3 className="text-xs font-semibold text-zinc-100">
              All Links in This Email ({items.length})
            </h3>
          </div>
          <p className="text-[11px] text-zinc-400 mt-0.5">
            Transactional emails only — keep links focused on reservation management, directions,
            contact details, and hotel policies.
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
            aria-label="Close links overview"
          >
            <X size={14} />
          </button>
        )}
      </div>

      {/* Summary Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] tabular-nums">
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5">
          <div className="text-zinc-500">Active &amp; Valid</div>
          <div className="text-emerald-400 font-semibold">{activeCount}</div>
        </div>
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5">
          <div className="text-zinc-500">Empty Variables</div>
          <div className={emptyVarCount > 0 ? "text-amber-400 font-semibold" : "text-zinc-300 font-semibold"}>
            {emptyVarCount}
          </div>
        </div>
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5">
          <div className="text-zinc-500">Hidden</div>
          <div className="text-zinc-300 font-semibold">{hiddenCount}</div>
        </div>
        <div className="rounded-lg bg-zinc-950 border border-zinc-800 px-2.5 py-1.5">
          <div className="text-zinc-500">Warnings / Invalid</div>
          <div className={invalidCount > 0 ? "text-red-400 font-semibold" : "text-zinc-300 font-semibold"}>
            {invalidCount}
          </div>
        </div>
      </div>

      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-center text-xs text-zinc-500">
          No links currently exist in this template.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800/90 border border-zinc-800 rounded-lg max-h-72 overflow-y-auto bg-zinc-950/70">
          {items.map((item) => (
            <div
              key={item.id}
              className="px-3 py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-zinc-900/60 transition-colors"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex items-center gap-1.5 flex-wrap text-xs">
                  {item.hidden ? (
                    <EyeOff size={12} className="text-zinc-500 shrink-0" />
                  ) : item.status === "valid" ? (
                    <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                  ) : item.status === "empty_variable" ? (
                    <AlertTriangle size={12} className="text-amber-400 shrink-0" />
                  ) : (
                    <AlertCircle size={12} className="text-red-400 shrink-0" />
                  )}
                  <span className="font-medium text-zinc-200 truncate">{item.text}</span>
                  <span className="text-[10px] text-zinc-500">
                    · {item.blockIndex >= 0 ? `#${item.blockIndex + 1} ` : ""}
                    {item.blockLabel} ({item.location})
                  </span>
                  {item.hidden && (
                    <span className="text-[10px] text-amber-300">Hidden</span>
                  )}
                </div>
                <div className="text-[11px] font-mono truncate">
                  {item.status === "valid" ? (
                    <span className="text-emerald-400">{item.resolvedUrl}</span>
                  ) : item.status === "empty_variable" ? (
                    <span className="text-amber-400">
                      {item.rawUrl} — {item.error}
                    </span>
                  ) : (
                    <span className="text-red-400">
                      {item.rawUrl || "(empty)"} — {item.error}
                    </span>
                  )}
                </div>
              </div>
              <button
                type="button"
                onClick={() => onSelectBlock(item.blockId)}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-md border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-[11px] font-medium text-zinc-200 whitespace-nowrap"
              >
                <ExternalLink size={11} /> Edit
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
