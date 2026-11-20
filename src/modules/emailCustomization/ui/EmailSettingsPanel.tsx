import React, { useMemo, useState } from "react";
import { AlertCircle, CheckCircle2, Lock, Save } from "lucide-react";
import { toast } from "sonner";
import {
  SUPPORTED_EMAIL_LANGUAGES,
  type DateFormatPreset,
  type HotelEmailSettings,
} from "../shared/types";
import {
  formatEmailCurrency,
  formatEmailDate,
  formatEmailTime,
  validateEmailUrl,
  validateHotelEmailSettings,
} from "../shared/validation";
import { emailCustomizationApi } from "./apiClient";

interface EmailSettingsPanelProps {
  hotelId?: string;
  initialSettings: HotelEmailSettings;
  appUrl: string;
  verifiedFromAddress: string;
  currencyCode?: string;
  onSaved: (next: HotelEmailSettings) => void;
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

export function EmailSettingsPanel({
  hotelId,
  initialSettings,
  appUrl,
  verifiedFromAddress,
  currencyCode = "NGN",
  onSaved,
}: EmailSettingsPanelProps) {
  const [form, setForm] = useState<HotelEmailSettings>(initialSettings);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const validationIssues = useMemo(() => validateHotelEmailSettings(form), [form]);

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
            Contact Details, Legal Imprint & Reminder Schedule
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Optional email-specific contact overrides (blank fields automatically use your main Hotel Profile).
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
          <label className={labelClass}>Legal / Imprint Footer Text (Optional — e.g. German Impressum)</label>
          <textarea
            rows={2}
            value={form.legalImprint || ""}
            onChange={(e) => setForm({ ...form, legalImprint: e.target.value })}
            placeholder="Company registration, VAT ID, managing director, or legal notice shown below contact details"
            className={inputClass}
          />
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
