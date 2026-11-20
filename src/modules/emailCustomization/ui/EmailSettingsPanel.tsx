import React, { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CopyCheck,
  Eye,
  EyeOff,
  Link2,
  Loader2,
  Lock,
  Plus,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import {
  SUPPORTED_EMAIL_LANGUAGES,
  type DateFormatPreset,
  type EmailBlock,
  type FooterNavLinkItem,
  type HotelDefaultLinks,
  type HotelEmailSettings,
  type LocalizedLinkValue,
  type SupportedEmailLanguage,
} from "../shared/types";
import { buildDefaultFooterBlocks } from "../shared/presets";
import {
  formatEmailCurrency,
  formatEmailDate,
  formatEmailTime,
  validateEmailUrl,
  validateHotelEmailSettings,
} from "../shared/validation";
import { emailCustomizationApi } from "./apiClient";
import { createEmailBlock } from "./components/BlockEditor";
import { LinkDestinationField } from "./LinkControls";

interface EmailSettingsPanelProps {
  hotelId?: string;
  initialSettings: HotelEmailSettings;
  appUrl: string;
  verifiedFromAddress: string;
  currencyCode?: string;
  onSaved: (next: HotelEmailSettings) => void;
  onAppliedDefaultFooter?: () => void;
}

const COMMON_TIMEZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/London",
  "Africa/Lagos",
  "Africa/Johannesburg",
  "Africa/Nairobi",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Asia/Dubai",
  "Asia/Singapore",
];

const DATE_FORMATS: { id: DateFormatPreset; label: string }[] = [
  { id: "iso", label: "YYYY-MM-DD (2026-11-24)" },
  { id: "dd_mmm_yyyy", label: "DD MMM YYYY (24 Nov 2026)" },
  { id: "dd_dot_mm_dot_yyyy", label: "DD.MM.YYYY (24.11.2026)" },
  { id: "dd_slash_mm_slash_yyyy", label: "DD/MM/YYYY (24/11/2026)" },
  { id: "mm_slash_dd_slash_yyyy", label: "MM/DD/YYYY (11/24/2026)" },
];

const DEFAULT_LINK_FIELDS: Array<{
  key: keyof HotelDefaultLinks;
  label: string;
  variable: string;
  placeholder: string;
}> = [
  {
    key: "website",
    label: "Hotel Website",
    variable: "{{hotel_website}}",
    placeholder: "https://yourhotel.com",
  },
  {
    key: "booking",
    label: "Booking Page",
    variable: "{{booking_link}}",
    placeholder: "https://yourhotel.com/book",
  },
  {
    key: "portal",
    label: "Hotel Guest Portal",
    variable: "{{portal_link}}",
    placeholder: "https://yourhotel.com/portal",
  },
  {
    key: "review",
    label: "Guest Review Page",
    variable: "{{review_link}}",
    placeholder: "https://yourhotel.com/review",
  },
  {
    key: "directions",
    label: "Directions / Map",
    variable: "{{directions_link}}",
    placeholder: "https://maps.google.com/?q=Your+Hotel",
  },
  {
    key: "wifiGuide",
    label: "Wi-Fi & Guest Guide",
    variable: "{{wifi_guide_link}}",
    placeholder: "https://yourhotel.com/guest-guide",
  },
  {
    key: "socialInstagram",
    label: "Instagram",
    variable: "{{social_instagram}}",
    placeholder: "https://instagram.com/yourhotel",
  },
  {
    key: "socialFacebook",
    label: "Facebook",
    variable: "{{social_facebook}}",
    placeholder: "https://facebook.com/yourhotel",
  },
  {
    key: "socialX",
    label: "X / Twitter",
    variable: "{{social_x}}",
    placeholder: "https://x.com/yourhotel",
  },
  {
    key: "socialLinkedin",
    label: "LinkedIn",
    variable: "{{social_linkedin}}",
    placeholder: "https://linkedin.com/company/yourhotel",
  },
];

function buildStandardFooterNavLinks(lang: SupportedEmailLanguage): FooterNavLinkItem[] {
  if (lang === "de") {
    return [
      { id: "fnav_de_website", label: "Webseite", url: "{{hotel_website}}", openInNewTab: true },
      { id: "fnav_de_directions", label: "Anfahrt", url: "{{directions_link}}", openInNewTab: true },
      { id: "fnav_de_contact", label: "Kontakt", url: "mailto:{{hotel_email}}" },
      { id: "fnav_de_portal", label: "Gästeportal", url: "{{portal_link}}", openInNewTab: true },
    ];
  }
  return [
    { id: "fnav_en_website", label: "Hotel Website", url: "{{hotel_website}}", openInNewTab: true },
    { id: "fnav_en_directions", label: "Directions", url: "{{directions_link}}", openInNewTab: true },
    { id: "fnav_en_contact", label: "Contact Us", url: "mailto:{{hotel_email}}" },
    { id: "fnav_en_portal", label: "Guest Portal", url: "{{portal_link}}", openInNewTab: true },
  ];
}

export function EmailSettingsPanel({
  hotelId,
  initialSettings,
  appUrl,
  verifiedFromAddress,
  currencyCode = "NGN",
  onSaved,
  onAppliedDefaultFooter,
}: EmailSettingsPanelProps) {
  const [form, setForm] = useState<HotelEmailSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [applyingFooter, setApplyingFooter] = useState(false);
  const [applyingLinks, setApplyingLinks] = useState(false);
  const [footerLang, setFooterLang] = useState<SupportedEmailLanguage>(
    initialSettings.defaultLanguage || "en"
  );
  const [navLang, setNavLang] = useState<SupportedEmailLanguage>(
    initialSettings.defaultLanguage || "en"
  );
  const [expandedOverrides, setExpandedOverrides] = useState<Record<string, boolean>>({});
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const validationIssues = useMemo(() => validateHotelEmailSettings(form), [form]);

  const currentFooterBlocks: EmailBlock[] = form.defaultFooterBlocks?.[footerLang] || [];
  const hasAnyDefaultFooter = Boolean(
    (form.defaultFooterBlocks?.en && form.defaultFooterBlocks.en.length > 0) ||
      (form.defaultFooterBlocks?.de && form.defaultFooterBlocks.de.length > 0)
  );

  const currentFooterNavLinks: FooterNavLinkItem[] = form.defaultFooterNavLinks?.[navLang] || [];
  const hasAnyDefaultFooterNav = Boolean(
    (form.defaultFooterNavLinks?.en && form.defaultFooterNavLinks.en.length > 0) ||
      (form.defaultFooterNavLinks?.de && form.defaultFooterNavLinks.de.length > 0)
  );

  const updateDefaultLink = (
    key: keyof HotelDefaultLinks,
    field: "defaultUrl" | "en" | "de",
    value: string
  ) => {
    setForm((prev) => {
      const prevMap: HotelDefaultLinks = prev.defaultLinks || {};
      const existing: LocalizedLinkValue = prevMap[key] || {};
      const nextEntry: LocalizedLinkValue =
        field === "defaultUrl"
          ? { ...existing, defaultUrl: value }
          : {
              ...existing,
              byLanguage: {
                ...(existing.byLanguage || {}),
                [field]: value,
              },
            };
      return {
        ...prev,
        defaultLinks: {
          ...prevMap,
          [key]: nextEntry,
        },
      };
    });
  };

  const updateDefaultFooterNavForLang = (
    lang: SupportedEmailLanguage,
    updater: (prev: FooterNavLinkItem[]) => FooterNavLinkItem[]
  ) => {
    setForm((prev) => {
      const existing = prev.defaultFooterNavLinks?.[lang] || [];
      const nextList = updater(existing);
      return {
        ...prev,
        defaultFooterNavLinks: {
          ...(prev.defaultFooterNavLinks || {}),
          [lang]: nextList,
        },
      };
    });
  };

  const handleLoadStandardFooterNav = () => {
    const standard = buildStandardFooterNavLinks(navLang);
    updateDefaultFooterNavForLang(navLang, () => standard);
    toast.success(`Loaded standard ${navLang.toUpperCase()} footer navigation links.`);
  };

  const handleAddFooterNavLink = () => {
    const newItem: FooterNavLinkItem = {
      id: `fnav_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label: navLang === "de" ? "Neuer Link" : "New Link",
      url: "{{hotel_website}}",
      openInNewTab: true,
    };
    updateDefaultFooterNavForLang(navLang, (prev) => [...prev, newItem]);
  };

  const handleApplyLinksToAllDrafts = async () => {
    setServerErrors([]);
    if (!hasAnyDefaultFooterNav) {
      toast.error("Add at least one default footer navigation link before applying to drafts.");
      return;
    }
    if (validationIssues.length > 0) {
      setServerErrors(validationIssues.map((i) => i.message));
      return;
    }
    try {
      setApplyingLinks(true);
      const saved = await emailCustomizationApi.saveSettings(form, hotelId);
      const effectiveSettings = saved.settings || form;
      if (saved.settings) {
        setForm(saved.settings);
        onSaved(saved.settings);
      }
      const res = await emailCustomizationApi.applyDefaultLinksToAllDrafts(
        effectiveSettings.defaultFooterNavLinks,
        hotelId
      );
      onAppliedDefaultFooter?.();
      toast.success(
        `Applied your default footer links to drafts for all ${res.updatedEvents.length} events. Live published templates were not modified — review and publish each event when ready.`
      );
    } catch (err: any) {
      const msgs =
        Array.isArray(err?.issues) && err.issues.length > 0
          ? err.issues.map((i: any) => i.message)
          : [err?.message || "Failed to apply default footer links to drafts."];
      setServerErrors(msgs);
    } finally {
      setApplyingLinks(false);
    }
  };

  const updateFooterBlocksForLang = (
    lang: SupportedEmailLanguage,
    updater: (prev: EmailBlock[]) => EmailBlock[]
  ) => {
    setForm((prev) => {
      const existing = prev.defaultFooterBlocks?.[lang] || [];
      const nextList = updater(existing);
      return {
        ...prev,
        defaultFooterBlocks: {
          ...(prev.defaultFooterBlocks || {}),
          [lang]: nextList,
        },
      };
    });
  };

  const handleLoadStandardDefaultFooter = () => {
    const standard = buildDefaultFooterBlocks(footerLang);
    updateFooterBlocksForLang(footerLang, () => standard);
    toast.success(`Loaded standard 3-block ${footerLang.toUpperCase()} footer.`);
  };

  const handleAddDefaultFooterBlock = (
    type:
      | "footer_contact"
      | "footer_authenticity"
      | "footer_copyright"
      | "footer_legal"
      | "footer_powered_by"
  ) => {
    const blk = createEmailBlock(type, appUrl, footerLang);
    updateFooterBlocksForLang(footerLang, (prev) => [...prev, blk]);
  };

  const handleApplyFooterToAllDrafts = async () => {
    setServerErrors([]);
    if (!hasAnyDefaultFooter) {
      toast.error("Configure at least one default footer block before applying to drafts.");
      return;
    }
    if (validationIssues.length > 0) {
      setServerErrors(validationIssues.map((i) => i.message));
      return;
    }
    try {
      setApplyingFooter(true);
      const saved = await emailCustomizationApi.saveSettings(form, hotelId);
      const effectiveSettings = saved.settings || form;
      if (saved.settings) {
        setForm(saved.settings);
        onSaved(saved.settings);
      }
      const res = await emailCustomizationApi.applyDefaultFooterToAllDrafts(
        effectiveSettings.defaultFooterBlocks,
        hotelId
      );
      onAppliedDefaultFooter?.();
      toast.success(
        `Applied your default footer to drafts for all ${res.updatedEvents.length} events. Live published templates were not modified — review and publish each event when ready.`
      );
    } catch (err: any) {
      const msgs =
        Array.isArray(err?.issues) && err.issues.length > 0
          ? err.issues.map((i: any) => i.message)
          : [err?.message || "Failed to apply default footer to drafts."];
      setServerErrors(msgs);
    } finally {
      setApplyingFooter(false);
    }
  };

  const resolvedPortalPreview = useMemo(() => {
    const cleanFallback = (appUrl || "https://tidehotels.de").replace(/\/+$/, "");
    if (!form.portalUrl?.trim()) return cleanFallback;
    const check = validateEmailUrl(form.portalUrl.trim());
    return check.valid && check.normalized ? check.normalized : cleanFallback;
  }, [form.portalUrl, appUrl]);

  const liveFormatSample = useMemo(() => {
    const dateStr = formatEmailDate(
      "2026-11-24",
      form.dateFormat,
      form.timeZone || "UTC",
      form.defaultLanguage
    );
    const timeStr = formatEmailTime("14:30", form.timeFormat);
    const moneyStr = formatEmailCurrency(270000, currencyCode, form.currencyDisplay);
    return `${dateStr} · ${timeStr} · ${moneyStr}`;
  }, [form, currencyCode]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setServerErrors([]);
    if (validationIssues.length > 0) {
      setServerErrors(validationIssues.map((i) => i.message));
      return;
    }

    try {
      setSaving(true);
      const res = await emailCustomizationApi.saveSettings(form, hotelId);
      if (res.settings) {
        setForm(res.settings);
        onSaved(res.settings);
        toast.success("Hotel email settings saved.");
      }
    } catch (err: any) {
      const msgs =
        Array.isArray(err?.issues) && err.issues.length > 0
          ? err.issues.map((i: any) => i.message)
          : [err?.message || "Failed to save email settings."];
      setServerErrors(msgs);
    } finally {
      setSaving(false);
    }
  };

  const inputClass =
    "w-full rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:outline-none focus:border-emerald-500 transition-colors";
  const labelClass = "block text-xs font-medium text-zinc-300 mb-1.5";

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-4xl">
      {serverErrors.length > 0 && (
        <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 space-y-1">
          <div className="flex items-center gap-2 font-semibold">
            <AlertCircle size={15} /> Please fix the following before saving:
          </div>
          <ul className="list-disc pl-5 space-y-0.5">
            {serverErrors.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Links & Sender Identity */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">Portal Links & Sender Identity</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Configure where guest email buttons point and how your hotel appears in guest inboxes.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Hotel Portal URL (HTTPS)</label>
            <input
              type="url"
              value={form.portalUrl || ""}
              onChange={(e) => setForm({ ...form, portalUrl: e.target.value })}
              placeholder={appUrl || "https://yourhotel.com"}
              className={inputClass}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Active link in emails:{" "}
              <span className="text-emerald-400 font-mono">{resolvedPortalPreview}</span>
            </p>
          </div>

          <div>
            <label className={labelClass}>Booking Page URL (Optional, HTTPS)</label>
            <input
              type="url"
              value={form.bookingUrl || ""}
              onChange={(e) => setForm({ ...form, bookingUrl: e.target.value })}
              placeholder="https://yourhotel.com/book"
              className={inputClass}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              Used for the <span className="font-mono text-zinc-400">{"{{booking_link}}"}</span> merge tag. Falls back to Portal URL if empty.
            </p>
          </div>

          <div>
            <label className={labelClass}>Sender Display Name</label>
            <input
              type="text"
              maxLength={80}
              value={form.senderDisplayName || ""}
              onChange={(e) => setForm({ ...form, senderDisplayName: e.target.value })}
              placeholder="e.g. Harborview Suites Reservations"
              className={inputClass}
            />
            <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 mt-1">
              <Lock size={11} className="shrink-0" />
              <span>
                Sent via verified domain address:{" "}
                <span className="text-zinc-300 font-mono">
                  {verifiedFromAddress || "RESEND_FROM_EMAIL (server-locked)"}
                </span>
              </span>
            </div>
          </div>

          <div>
            <label className={labelClass}>Reply-To Email Address</label>
            <input
              type="email"
              value={form.replyToEmail || ""}
              onChange={(e) => setForm({ ...form, replyToEmail: e.target.value })}
              placeholder="reservations@yourhotel.com"
              className={inputClass}
            />
            <p className="text-[11px] text-zinc-500 mt-1">
              When guests reply to an email, replies route to this hotel inbox.
            </p>
          </div>
        </div>
      </section>

      {/* Regional & Display Formatting */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Language, Date, Time & Currency Display
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Controls how dates, times, and amounts are formatted inside emails only. Stored PMS data is never altered.
            </p>
          </div>
          <div className="text-xs text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 tabular-nums">
            Preview: <span className="text-emerald-400 font-medium">{liveFormatSample}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Default Email Language</label>
            <select
              value={form.defaultLanguage}
              onChange={(e) =>
                setForm({ ...form, defaultLanguage: e.target.value as "en" | "de" })
              }
              className={inputClass}
            >
              {SUPPORTED_EMAIL_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label} ({l.code.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Hotel Time Zone (IANA)</label>
            <input
              list="email-tz-list"
              value={form.timeZone}
              onChange={(e) => setForm({ ...form, timeZone: e.target.value })}
              className={inputClass}
            />
            <datalist id="email-tz-list">
              {COMMON_TIMEZONES.map((tz) => (
                <option key={tz} value={tz} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={labelClass}>Date Format</label>
            <select
              value={form.dateFormat}
              onChange={(e) =>
                setForm({ ...form, dateFormat: e.target.value as DateFormatPreset })
              }
              className={inputClass}
            >
              {DATE_FORMATS.map((df) => (
                <option key={df.id} value={df.id}>
                  {df.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className={labelClass}>Time Format</label>
            <select
              value={form.timeFormat}
              onChange={(e) =>
                setForm({ ...form, timeFormat: e.target.value as "12h" | "24h" })
              }
              className={inputClass}
            >
              <option value="24h">24-hour (14:30)</option>
              <option value="12h">12-hour (2:30 PM)</option>
            </select>
          </div>

          <div>
            <label className={labelClass}>Currency Display</label>
            <select
              value={form.currencyDisplay.mode}
              onChange={(e) =>
                setForm({
                  ...form,
                  currencyDisplay: {
                    ...form.currencyDisplay,
                    mode: e.target.value as "code" | "symbol",
                  },
                })
              }
              className={inputClass}
            >
              <option value="code">ISO Code (e.g. NGN 270,000.00)</option>
              <option value="symbol">Symbol (e.g. ₦270,000.00)</option>
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className={labelClass}>Decimals</label>
              <select
                value={String(form.currencyDisplay.decimals)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    currencyDisplay: {
                      ...form.currencyDisplay,
                      decimals: e.target.value === "0" ? 0 : 2,
                    },
                  })
                }
                className={inputClass}
              >
                <option value="2">2 (100.00)</option>
                <option value="0">0 (100)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Grouping</label>
              <select
                value={form.currencyDisplay.thousandsSeparator}
                onChange={(e) =>
                  setForm({
                    ...form,
                    currencyDisplay: {
                      ...form.currencyDisplay,
                      thousandsSeparator: e.target.value as "," | "." | " ",
                    },
                  })
                }
                className={inputClass}
              >
                <option value=",">Comma (1,000.00)</option>
                <option value=".">Dot (1.000,00)</option>
                <option value=" ">Space (1 000.00)</option>
              </select>
            </div>
          </div>
        </div>
      </section>

      {/* Contact Overrides, Legal Imprint & Scheduled Offsets */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">
            Contact Details, Legal Imprint &amp; Reminder Schedule
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Feeds allow-listed merge variables (
            <span className="font-mono text-zinc-300">{"{{hotel_address}}"}</span>,{" "}
            <span className="font-mono text-zinc-300">{"{{hotel_phone}}"}</span>,{" "}
            <span className="font-mono text-zinc-300">{"{{hotel_email}}"}</span>,{" "}
            <span className="font-mono text-zinc-300">{"{{hotel_website}}"}</span>,{" "}
            <span className="font-mono text-zinc-300">{"{{legal_imprint}}"}</span>). Blank fields
            fall back to your Hotel Profile. Never silently injected into customized templates
            unless referenced by a block.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>Contact Address Override</label>
            <input
              type="text"
              value={form.contactOverrides?.address || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  contactOverrides: { ...form.contactOverrides, address: e.target.value },
                })
              }
              placeholder="Leave blank to use Hotel Profile address"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Contact Phone Override</label>
            <input
              type="text"
              value={form.contactOverrides?.phone || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  contactOverrides: { ...form.contactOverrides, phone: e.target.value },
                })
              }
              placeholder="Leave blank to use Hotel Profile phone"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Contact Email Override</label>
            <input
              type="email"
              value={form.contactOverrides?.email || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  contactOverrides: { ...form.contactOverrides, email: e.target.value },
                })
              }
              placeholder="Leave blank to use Hotel Profile email"
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Contact Website Override (HTTPS)</label>
            <input
              type="url"
              value={form.contactOverrides?.website || ""}
              onChange={(e) =>
                setForm({
                  ...form,
                  contactOverrides: { ...form.contactOverrides, website: e.target.value },
                })
              }
              placeholder="https://yourhotel.com"
              className={inputClass}
            />
          </div>
        </div>

        <div>
          <label className={labelClass}>
            Legal / Imprint Text (Optional — feeds{" "}
            <span className="font-mono text-emerald-400">{"{{legal_imprint}}"}</span>)
          </label>
          <textarea
            rows={2}
            value={form.legalImprint || ""}
            onChange={(e) => setForm({ ...form, legalImprint: e.target.value })}
            placeholder="Company registration, VAT ID, managing director, or German Impressum"
            className={inputClass}
          />
          <p className="text-[11px] text-zinc-500 mt-1">
            Populates the <span className="font-mono text-zinc-400">{"{{legal_imprint}}"}</span>{" "}
            variable and prefills new Legal / Impressum blocks. Never shown in customized templates
            unless you include a block that uses it.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2 border-t border-zinc-800/80">
          <div>
            <label className={labelClass}>Pre-Arrival Reminder (Days Before Check-In)</label>
            <input
              type="number"
              min={1}
              max={14}
              value={form.preArrivalDaysBefore}
              onChange={(e) =>
                setForm({ ...form, preArrivalDaysBefore: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })
              }
              className={`${inputClass} tabular-nums`}
            />
          </div>
          <div>
            <label className={labelClass}>Post-Stay Feedback Request (Days After Check-Out)</label>
            <input
              type="number"
              min={1}
              max={14}
              value={form.postStayDaysAfter}
              onChange={(e) =>
                setForm({ ...form, postStayDaysAfter: Math.max(1, Math.min(14, Number(e.target.value) || 1)) })
              }
              className={`${inputClass} tabular-nums`}
            />
          </div>
        </div>
      </section>

      {/* Hotel Default Links (Primary + EN / DE Overrides) */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          <Link2 size={16} className="text-emerald-400 mt-0.5 shrink-0" />
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Hotel Default Links (Primary &amp; Language Overrides)
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Set reusable HTTPS links once per hotel. Each link powers its merge variable across all
              email blocks. Expand EN / DE overrides if your hotel uses separate language URLs
              (blank overrides automatically fall back to the primary URL).
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {DEFAULT_LINK_FIELDS.map((field) => {
            const entry = form.defaultLinks?.[field.key];
            const enOverride = entry?.byLanguage?.en || "";
            const deOverride = entry?.byLanguage?.de || "";
            const hasOverrides = Boolean(enOverride.trim() || deOverride.trim());
            const isExpanded = Boolean(expandedOverrides[field.key]);

            return (
              <div
                key={field.key}
                className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-3 space-y-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-zinc-200">{field.label}</label>
                  <span className="font-mono text-[10px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-1.5 py-0.5 rounded">
                    {field.variable}
                  </span>
                </div>
                <input
                  type="url"
                  value={entry?.defaultUrl || ""}
                  onChange={(e) => updateDefaultLink(field.key, "defaultUrl", e.target.value)}
                  placeholder={field.placeholder}
                  className={inputClass}
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedOverrides((prev) => ({
                        ...prev,
                        [field.key]: !prev[field.key],
                      }))
                    }
                    className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>EN / DE URL overrides</span>
                    {hasOverrides && (
                      <span className="ml-1 px-1.5 py-0.2 rounded bg-emerald-500/15 text-emerald-300 text-[10px]">
                        Active
                      </span>
                    )}
                  </button>
                </div>
                {isExpanded && (
                  <div className="grid grid-cols-1 gap-2 pt-1.5 border-t border-zinc-800/80">
                    <div>
                      <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                        English (EN) Override (Optional HTTPS)
                      </label>
                      <input
                        type="url"
                        value={enOverride}
                        onChange={(e) => updateDefaultLink(field.key, "en", e.target.value)}
                        placeholder="Leave blank to use primary URL"
                        className={inputClass}
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-medium text-zinc-400 mb-1">
                        German (DE) Override (Optional HTTPS)
                      </label>
                      <input
                        type="url"
                        value={deOverride}
                        onChange={(e) => updateDefaultLink(field.key, "de", e.target.value)}
                        placeholder="Leave blank to use primary URL"
                        className={inputClass}
                      />
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Default Footer Navigation Links (EN / DE, Draft-only bulk apply) */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Default Footer Navigation Links (Optional)
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Define your hotel&apos;s standard footer link row (e.g. Terms, Privacy, Imprint,
              Directions, Contact) per language and apply it to event drafts. Live published emails
              stay untouched until you publish.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {SUPPORTED_EMAIL_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setNavLang(l.code)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  navLang === l.code
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {l.label} ({(form.defaultFooterNavLinks?.[l.code] || []).length})
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleLoadStandardFooterNav}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 whitespace-nowrap"
          >
            <RotateCcw size={12} /> Load Standard Links
          </button>
          <button
            type="button"
            onClick={handleAddFooterNavLink}
            disabled={currentFooterNavLinks.length >= 10}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 disabled:opacity-40 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Add Footer Link
          </button>
        </div>

        {currentFooterNavLinks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-center text-xs text-zinc-500">
            No default footer navigation links configured for {navLang.toUpperCase()} yet. Click{" "}
            <span className="text-zinc-300 font-medium">Load Standard Links</span> or{" "}
            <span className="text-zinc-300 font-medium">Add Footer Link</span>.
          </div>
        ) : (
          <div className="space-y-3">
            {currentFooterNavLinks.map((item, idx) => {
              const updateNavLink = (patch: Partial<FooterNavLinkItem>) =>
                updateDefaultFooterNavForLang(navLang, (list) =>
                  list.map((entry, i) => (i === idx ? { ...entry, ...patch } : entry))
                );

              return (
                <div
                  key={item.id || idx}
                  className={`rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2.5 ${
                    item.hidden ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <input
                        type="text"
                        value={item.label}
                        onChange={(e) => updateNavLink({ label: e.target.value })}
                        placeholder="Link text (e.g. Privacy Policy)"
                        className={inputClass}
                      />
                      {item.hidden && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400 shrink-0">
                          Hidden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        title={item.hidden ? "Show link" : "Hide link"}
                        onClick={() => updateNavLink({ hidden: !item.hidden })}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      >
                        {item.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() =>
                          updateDefaultFooterNavForLang(navLang, (list) => {
                            if (idx === 0) return list;
                            const copy = [...list];
                            const [moved] = copy.splice(idx, 1);
                            copy.splice(idx - 1, 0, moved);
                            return copy;
                          })
                        }
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === currentFooterNavLinks.length - 1}
                        onClick={() =>
                          updateDefaultFooterNavForLang(navLang, (list) => {
                            if (idx >= list.length - 1) return list;
                            const copy = [...list];
                            const [moved] = copy.splice(idx, 1);
                            copy.splice(idx + 1, 0, moved);
                            return copy;
                          })
                        }
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateDefaultFooterNavForLang(navLang, (list) =>
                            list.filter((_, i) => i !== idx)
                          )
                        }
                        className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  <LinkDestinationField
                    url={item.url}
                    visibleLabel={item.label}
                    allowContactSchemes
                    allowEmpty={false}
                    onChangeUrl={(nextUrl) => updateNavLink({ url: nextUrl })}
                    openInNewTab={item.openInNewTab !== false}
                    onChangeOpenInNewTab={(next) => updateNavLink({ openInNewTab: next })}
                    underline={item.underline}
                    onChangeUnderline={(next) => updateNavLink({ underline: next })}
                    color={item.color}
                    onChangeColor={(next) => updateNavLink({ color: next })}
                    compact
                  />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
          <span className="text-[11px] text-zinc-500">
            Updates draft footer navigation rows across all events. Published emails are never
            modified automatically.
          </span>
          <button
            type="button"
            disabled={applyingLinks || !hasAnyDefaultFooterNav || validationIssues.length > 0}
            onClick={() => void handleApplyLinksToAllDrafts()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 text-xs font-semibold text-emerald-300 whitespace-nowrap transition-colors"
          >
            {applyingLinks ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CopyCheck size={13} />
            )}
            {applyingLinks
              ? "Applying to drafts..."
              : "Apply default footer links to all events (Drafts only)"}
          </button>
        </div>
      </section>

      {/* Reusable Default Footer (Optional, per-language, Draft-only bulk apply) */}
      <section className="rounded-xl bg-zinc-900/60 border border-zinc-800 p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-100">
              Reusable Default Footer (Optional)
            </h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Define your hotel&apos;s standard footer blocks once per language and copy them into
              all event drafts. Applying never modifies live published templates until you review
              and publish each event.
            </p>
          </div>
          <div className="inline-flex rounded-lg border border-zinc-800 bg-zinc-950 p-0.5">
            {SUPPORTED_EMAIL_LANGUAGES.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => setFooterLang(l.code)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors ${
                  footerLang === l.code
                    ? "bg-zinc-800 text-zinc-100"
                    : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {l.label} ({(form.defaultFooterBlocks?.[l.code] || []).length})
              </button>
            ))}
          </div>
        </div>

        {/* Add / Load controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleLoadStandardDefaultFooter}
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 text-[11px] font-medium text-zinc-200 whitespace-nowrap"
          >
            <RotateCcw size={12} /> Load Standard 3-Block Footer
          </button>
          <button
            type="button"
            onClick={() => handleAddDefaultFooterBlock("footer_contact")}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Contact Us
          </button>
          <button
            type="button"
            onClick={() => handleAddDefaultFooterBlock("footer_authenticity")}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Authenticity
          </button>
          <button
            type="button"
            onClick={() => handleAddDefaultFooterBlock("footer_copyright")}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Copyright
          </button>
          <button
            type="button"
            onClick={() => handleAddDefaultFooterBlock("footer_legal")}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Legal / Impressum
          </button>
          <button
            type="button"
            onClick={() => handleAddDefaultFooterBlock("footer_powered_by")}
            className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-zinc-800 bg-zinc-950 hover:bg-zinc-900 text-[11px] text-zinc-300 whitespace-nowrap"
          >
            <Plus size={11} /> Powered By (Optional)
          </button>
        </div>

        {currentFooterBlocks.length === 0 ? (
          <div className="rounded-lg border border-dashed border-zinc-800 bg-zinc-950/60 p-4 text-center text-xs text-zinc-500">
            No reusable default footer blocks saved for {footerLang.toUpperCase()} yet. Click{" "}
            <span className="text-zinc-300 font-medium">Load Standard 3-Block Footer</span> or save
            a footer directly from any template editor.
          </div>
        ) : (
          <div className="space-y-3">
            {currentFooterBlocks.map((blk, idx) => {
              const titleMap: Record<string, string> = {
                footer_contact: "Contact Us",
                footer_authenticity: "Confirmation Authenticity",
                footer_copyright: "Copyright / Legal Line",
                footer_legal: "Legal / Impressum",
                footer_powered_by: "Powered By Credit",
                footer_nav: "Footer Navigation",
                social_links: "Social Links",
              };
              const updateBlk = (fn: (b: EmailBlock) => EmailBlock) =>
                updateFooterBlocksForLang(footerLang, (list) =>
                  list.map((item, i) => (i === idx ? fn(item) : item))
                );

              return (
                <div
                  key={blk.id || idx}
                  className={`rounded-lg border border-zinc-800 bg-zinc-950/80 p-3 space-y-2.5 ${
                    blk.hidden ? "opacity-60" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-xs font-semibold text-zinc-200">
                        {titleMap[blk.type] || blk.type}
                      </span>
                      {blk.hidden && (
                        <span className="px-1.5 py-0.5 rounded bg-zinc-800 text-[10px] text-zinc-400">
                          Hidden
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        title={blk.hidden ? "Show block" : "Hide block"}
                        onClick={() => updateBlk((b) => ({ ...b, hidden: !b.hidden }))}
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800"
                      >
                        {blk.hidden ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() =>
                          updateFooterBlocksForLang(footerLang, (list) => {
                            if (idx === 0) return list;
                            const copy = [...list];
                            const [moved] = copy.splice(idx, 1);
                            copy.splice(idx - 1, 0, moved);
                            return copy;
                          })
                        }
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        disabled={idx === currentFooterBlocks.length - 1}
                        onClick={() =>
                          updateFooterBlocksForLang(footerLang, (list) => {
                            if (idx >= list.length - 1) return list;
                            const copy = [...list];
                            const [moved] = copy.splice(idx, 1);
                            copy.splice(idx + 1, 0, moved);
                            return copy;
                          })
                        }
                        className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 disabled:opacity-30"
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          updateFooterBlocksForLang(footerLang, (list) =>
                            list.filter((_, i) => i !== idx)
                          )
                        }
                        className="p-1 rounded text-zinc-400 hover:text-red-400 hover:bg-zinc-800"
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>

                  {(blk.type === "footer_contact" ||
                    blk.type === "footer_authenticity" ||
                    blk.type === "footer_legal") && (
                    <div className="space-y-2">
                      <input
                        type="text"
                        value={blk.heading}
                        onChange={(e) =>
                          updateBlk((b) =>
                            b.type === "footer_contact" ||
                            b.type === "footer_authenticity" ||
                            b.type === "footer_legal"
                              ? { ...b, heading: e.target.value }
                              : b
                          )
                        }
                        placeholder="Heading"
                        className={inputClass}
                      />
                      <textarea
                        rows={2}
                        value={blk.text}
                        onChange={(e) =>
                          updateBlk((b) =>
                            b.type === "footer_contact" ||
                            b.type === "footer_authenticity" ||
                            b.type === "footer_legal"
                              ? { ...b, text: e.target.value }
                              : b
                          )
                        }
                        placeholder="Body text (supports {{hotel_name}}, {{hotel_phone}}, {{hotel_email}}, {{booking_reference}}, {{legal_imprint}})"
                        className={inputClass}
                      />
                    </div>
                  )}

                  {blk.type === "footer_copyright" && (
                    <input
                      type="text"
                      value={blk.text}
                      onChange={(e) =>
                        updateBlk((b) =>
                          b.type === "footer_copyright" ? { ...b, text: e.target.value } : b
                        )
                      }
                      placeholder="© {{hotel_name}} · {{hotel_address}}"
                      className={inputClass}
                    />
                  )}

                  {blk.type === "footer_powered_by" && (
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        value={blk.text}
                        onChange={(e) =>
                          updateBlk((b) =>
                            b.type === "footer_powered_by" ? { ...b, text: e.target.value } : b
                          )
                        }
                        placeholder="Powered by {{hotel_name}}"
                        className={inputClass}
                      />
                      <input
                        type="text"
                        value={blk.linkLabel || ""}
                        onChange={(e) =>
                          updateBlk((b) =>
                            b.type === "footer_powered_by" ? { ...b, linkLabel: e.target.value } : b
                          )
                        }
                        placeholder="Optional link label"
                        className={inputClass}
                      />
                      <input
                        type="url"
                        value={blk.linkUrl || ""}
                        onChange={(e) =>
                          updateBlk((b) =>
                            b.type === "footer_powered_by" ? { ...b, linkUrl: e.target.value } : b
                          )
                        }
                        placeholder="Optional HTTPS URL"
                        className={inputClass}
                      />
                    </div>
                  )}

                  {(blk.type === "footer_nav" || blk.type === "social_links") && (
                    <div className="text-[11px] text-zinc-500">
                      Saved from template editor ({blk.type === "footer_nav" ? `${blk.links.length} nav links` : `${blk.links.length} social links`}).
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-zinc-800/80">
          <span className="text-[11px] text-zinc-500">
            Applies only to drafts across all events. Live published emails stay unchanged until
            you publish.
          </span>
          <button
            type="button"
            disabled={applyingFooter || !hasAnyDefaultFooter || validationIssues.length > 0}
            onClick={() => void handleApplyFooterToAllDrafts()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/40 bg-emerald-500/10 hover:bg-emerald-500/20 disabled:opacity-40 text-xs font-semibold text-emerald-300 whitespace-nowrap transition-colors"
          >
            {applyingFooter ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <CopyCheck size={13} />
            )}
            {applyingFooter
              ? "Applying to drafts..."
              : "Apply my default footer to all events (Drafts only)"}
          </button>
        </div>
      </section>

      <div className="flex items-center justify-between pt-2">
        <div className="flex items-center gap-1.5 text-xs text-zinc-500">
          {validationIssues.length === 0 ? (
            <>
              <CheckCircle2 size={14} className="text-emerald-500" />
              <span>All settings valid</span>
            </>
          ) : (
            <>
              <AlertCircle size={14} className="text-amber-400" />
              <span>{validationIssues[0].message}</span>
            </>
          )}
        </div>

        <button
          type="submit"
          disabled={saving || validationIssues.length > 0}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-semibold whitespace-nowrap transition-colors"
        >
          <Save size={14} />
          {saving ? "Saving..." : "Save Email Settings"}
        </button>
      </div>
    </form>
  );
}
