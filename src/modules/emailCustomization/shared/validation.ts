import {
  ALLOWED_TEMPLATE_VARIABLES,
  ALLOWED_URL_VARIABLES,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  WEB_SAFE_FONTS,
  type AllowedTemplateVariable,
  type CurrencyDisplaySettings,
  type DateFormatPreset,
  type EmailBlock,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type HotelEmailSettings,
  type WebSafeFontId,
} from "./types.ts";

const ALLOWED_VAR_SET = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
const WEB_SAFE_FONT_SET = new Set<string>(WEB_SAFE_FONTS.map((f) => f.id));
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const STRICT_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const MAX_URL_LENGTH = 2048;

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/`/g, "&#96;");
}

export function sanitizeHeaderText(value: unknown, fallback = "Hotel Notifications"): string {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\0\x00-\x1f\x7f]/g, " ")
    .replace(/["<>\\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

export function isValidEmail(email: unknown): boolean {
  if (typeof email !== "string") return false;
  const trimmed = email.trim();
  return trimmed.length > 0 && trimmed.length <= 254 && STRICT_EMAIL_RE.test(trimmed);
}

export function isValidHexColor(color: unknown): boolean {
  return typeof color === "string" && HEX_COLOR_RE.test(color.trim());
}

export function sanitizeHexColor(color: unknown, fallback: string): string {
  return isValidHexColor(color) ? String(color).trim() : fallback;
}

export function resolveWebSafeFontCss(fontId?: string): string {
  const found = WEB_SAFE_FONTS.find((f) => f.id === fontId);
  return found ? found.css : WEB_SAFE_FONTS[0].css;
}

export function isValidWebSafeFont(fontId: unknown): fontId is WebSafeFontId {
  return typeof fontId === "string" && WEB_SAFE_FONT_SET.has(fontId);
}

/**
 * Strips potentially dangerous HTML tags, event handlers, and scriptable URL schemes
 * before storing or rendering text content.
 */
export function stripDangerousMarkup(input: string): string {
  return String(input || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\bon[a-z]+\s*=/gi, "")
    .replace(/\b(?:javascript|vbscript|data):/gi, "");
}

export interface UrlValidationResult {
  valid: boolean;
  normalized?: string;
  error?: string;
}

/**
 * Strict URL validation used on BOTH save and render:
 * - Allows https:// URLs only (plus mailto: and tel: when `allowContactSchemes` is true)
 * - Allows exact allow-listed link variables (`{{portal_link}}`, `{{hotel_website}}`, `{{booking_link}}`, `{{app_url}}`) when `allowVariableToken` is true
 * - Rejects http:, javascript:, data:, vbscript:, credentials (user:pass@), and overly long or malformed URLs
 */
export function validateEmailUrl(
  rawUrl: unknown,
  options: {
    allowEmpty?: boolean;
    allowContactSchemes?: boolean;
    allowVariableToken?: boolean;
    fieldName?: string;
  } = {}
): UrlValidationResult {
  const field = options.fieldName || "Link URL";
  if (rawUrl === undefined || rawUrl === null || String(rawUrl).trim() === "") {
    if (options.allowEmpty) return { valid: true, normalized: "" };
    return { valid: false, error: `${field} is required.` };
  }

  const trimmed = String(rawUrl).trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      error: `${field} exceeds the maximum length of ${MAX_URL_LENGTH} characters.`,
    };
  }

  if (/[\x00-\x1f\x7f\s]/.test(trimmed)) {
    return {
      valid: false,
      error: `${field} must not contain spaces or control characters.`,
    };
  }

  if (options.allowVariableToken && ALLOWED_URL_VARIABLES.has(trimmed)) {
    return { valid: true, normalized: trimmed };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:")
  ) {
    return {
      valid: false,
      error: `${field} cannot use javascript:, data:, or scriptable URLs.`,
    };
  }

  if (lower.startsWith("mailto:")) {
    if (!options.allowContactSchemes) {
      return { valid: false, error: `${field} must start with https://.` };
    }
    const addr = trimmed.slice(7).split("?")[0].trim();
    if (!isValidEmail(addr)) {
      return { valid: false, error: `${field} contains an invalid mailto: email address.` };
    }
    return { valid: true, normalized: `mailto:${addr}` };
  }

  if (lower.startsWith("tel:")) {
    if (!options.allowContactSchemes) {
      return { valid: false, error: `${field} must start with https://.` };
    }
    const phone = trimmed.slice(4).trim();
    if (!/^\+?[0-9()\-.\s]{5,30}$/.test(phone)) {
      return { valid: false, error: `${field} contains an invalid tel: phone number.` };
    }
    return { valid: true, normalized: `tel:${phone.replace(/\s+/g, "")}` };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      error: `${field} must be a valid https:// web address (for example, https://yourhotel.com).`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `${field} must use https:// (insecure http:// and other protocols are not allowed).`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      error: `${field} must not include embedded credentials (username:password@).`,
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".")) {
    return {
      valid: false,
      error: `${field} must include a valid public domain name.`,
    };
  }

  const normalized =
    parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.origin
      : parsed.toString();

  return { valid: true, normalized };
}

/**
 * Validates all `{{...}}` tokens in a text string against the strict allow-list.
 * Rejects unknown variables and any Handlebars/code expression syntax.
 */
export function validateTemplateVariables(
  text: string,
  fieldName = "Text"
): { valid: boolean; unknownVariables: string[]; error?: string } {
  if (!text) return { valid: true, unknownVariables: [] };

  // Block triple braces, block helpers, partials, or template literal code execution patterns
  if (/\{\{\{|\{\{[#/>^!]|\$\{/.test(text)) {
    return {
      valid: false,
      unknownVariables: [],
      error: `${fieldName} cannot contain template logic, helpers, or code expressions. Use plain text and allowed {{variable}} tags only.`,
    };
  }

  const unknown: string[] = [];
  const tokenRe = /\{\{\s*([^}]*?)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(text)) !== null) {
    const varName = match[1].trim();
    if (!varName || !/^[a-z0-9_]+$/.test(varName) || !ALLOWED_VAR_SET.has(varName)) {
      unknown.push(varName || "(empty)");
    }
  }

  if (unknown.length > 0) {
    const unique = Array.from(new Set(unknown));
    return {
      valid: false,
      unknownVariables: unique,
      error: `${fieldName} contains unsupported variable(s): ${unique.map((v) => `{{${v}}}`).join(", ")}. Please choose variables from the allowed list.`,
    };
  }

  return { valid: true, unknownVariables: [] };
}

export interface ValidationIssue {
  path: string;
  message: string;
}

export function validateTemplateVariant(variant: EmailTemplateVariant): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!variant || typeof variant !== "object") {
    return [{ path: "variant", message: "Template data is missing." }];
  }

  if (!variant.subject || !variant.subject.trim()) {
    issues.push({ path: "subject", message: "Subject line is required." });
  } else if (variant.subject.trim().length > 180) {
    issues.push({ path: "subject", message: "Subject line must be 180 characters or fewer." });
  } else {
    const sv = validateTemplateVariables(variant.subject, "Subject line");
    if (!sv.valid && sv.error) issues.push({ path: "subject", message: sv.error });
  }

  if (variant.preheader) {
    if (variant.preheader.length > 220) {
      issues.push({ path: "preheader", message: "Preheader text must be 220 characters or fewer." });
    }
    const pv = validateTemplateVariables(variant.preheader, "Preheader text");
    if (!pv.valid && pv.error) issues.push({ path: "preheader", message: pv.error });
  }

  if (variant.portalUrlOverride && variant.portalUrlOverride.trim()) {
    const pvUrl = validateEmailUrl(variant.portalUrlOverride, {
      fieldName: "Template Portal URL override",
    });
    if (!pvUrl.valid && pvUrl.error) {
      issues.push({ path: "portalUrlOverride", message: pvUrl.error });
    }
  }

  // Branding checks
  const b = variant.branding;
  if (!b) {
    issues.push({ path: "branding", message: "Branding settings are required." });
  } else {
    if (!isValidHexColor(b.accentBarColor)) {
      issues.push({ path: "branding.accentBarColor", message: "Accent bar color must be a valid hex color." });
    }
    if (!isValidHexColor(b.primaryColor)) {
      issues.push({ path: "branding.primaryColor", message: "Primary brand color must be a valid hex color." });
    }
    if (!isValidHexColor(b.secondaryColor)) {
      issues.push({ path: "branding.secondaryColor", message: "Secondary color must be a valid hex color." });
    }
    if (!isValidHexColor(b.buttonColor)) {
      issues.push({ path: "branding.buttonColor", message: "Button color must be a valid hex color." });
    }
    if (!isValidWebSafeFont(b.fontFamily)) {
      issues.push({ path: "branding.fontFamily", message: "Font must be selected from the web-safe font list." });
    }
    if (b.eyebrowText) {
      const ev = validateTemplateVariables(b.eyebrowText, "Eyebrow text");
      if (!ev.valid && ev.error) issues.push({ path: "branding.eyebrowText", message: ev.error });
    }
    if (b.showLogo && b.logoUrl && b.logoUrl.trim()) {
      const lv = validateEmailUrl(b.logoUrl, { fieldName: "Logo URL" });
      if (!lv.valid && lv.error) issues.push({ path: "branding.logoUrl", message: lv.error });
    }
  }

  if (!Array.isArray(variant.blocks) || variant.blocks.length === 0) {
    issues.push({ path: "blocks", message: "Template must include at least one content block." });
    return issues;
  }

  if (variant.blocks.length > 40) {
    issues.push({ path: "blocks", message: "Templates cannot exceed 40 blocks." });
  }

  const allowedBlockTypes = new Set([
    "heading",
    "paragraph",
    "image",
    "button",
    "divider",
    "spacer",
    "booking_details_table",
    "two_column_text",
    "social_links",
    "footer",
  ]);

  variant.blocks.forEach((block: EmailBlock, idx: number) => {
    const prefix = `blocks[${idx}]`;
    if (!block || !allowedBlockTypes.has(block.type)) {
      issues.push({
        path: prefix,
        message: `Block #${idx + 1} uses an unsupported block type. Only text, image, button, table, divider, spacer, social, and footer blocks are permitted.`,
      });
      return;
    }

    switch (block.type) {
      case "heading": {
        const v = validateTemplateVariables(block.text, `Heading block #${idx + 1}`);
        if (!v.valid && v.error) issues.push({ path: `${prefix}.text`, message: v.error });
        if (block.color && !isValidHexColor(block.color)) {
          issues.push({ path: `${prefix}.color`, message: `Heading block #${idx + 1} color must be a valid hex color.` });
        }
        break;
      }
      case "paragraph": {
        const v = validateTemplateVariables(block.text, `Paragraph block #${idx + 1}`);
        if (!v.valid && v.error) issues.push({ path: `${prefix}.text`, message: v.error });
        break;
      }
      case "image": {
        const urlCheck = validateEmailUrl(block.src, { fieldName: `Image block #${idx + 1} URL` });
        if (!urlCheck.valid && urlCheck.error) {
          issues.push({ path: `${prefix}.src`, message: urlCheck.error });
        }
        if (!block.alt || !block.alt.trim()) {
          issues.push({
            path: `${prefix}.alt`,
            message: `Image block #${idx + 1} requires alt text for accessibility and email clients.`,
          });
        } else {
          const av = validateTemplateVariables(block.alt, `Image block #${idx + 1} alt text`);
          if (!av.valid && av.error) issues.push({ path: `${prefix}.alt`, message: av.error });
        }
        if (block.linkUrl && block.linkUrl.trim()) {
          const lc = validateEmailUrl(block.linkUrl, {
            allowVariableToken: true,
            fieldName: `Image block #${idx + 1} link URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.linkUrl`, message: lc.error });
        }
        break;
      }
      case "button": {
        if (!block.label || !block.label.trim()) {
          issues.push({
            path: `${prefix}.label`,
            message: `Link/Button block #${idx + 1} requires label text.`,
          });
        } else {
          const lv = validateTemplateVariables(block.label, `Link/Button block #${idx + 1} label`);
          if (!lv.valid && lv.error) issues.push({ path: `${prefix}.label`, message: lv.error });
        }
        if (block.prefixText) {
          const pv = validateTemplateVariables(block.prefixText, `Link/Button block #${idx + 1} surrounding text`);
          if (!pv.valid && pv.error) issues.push({ path: `${prefix}.prefixText`, message: pv.error });
        }
        const uc = validateEmailUrl(block.url, {
          allowVariableToken: true,
          fieldName: `Link/Button block #${idx + 1} URL`,
        });
        if (!uc.valid && uc.error) issues.push({ path: `${prefix}.url`, message: uc.error });
        break;
      }
      case "booking_details_table": {
        if (block.title) {
          const tv = validateTemplateVariables(block.title, `Details table #${idx + 1} title`);
          if (!tv.valid && tv.error) issues.push({ path: `${prefix}.title`, message: tv.error });
        }
        (block.rows || []).forEach((row, rIdx) => {
          const rl = validateTemplateVariables(row.label, `Table row #${rIdx + 1} label`);
          if (!rl.valid && rl.error) issues.push({ path: `${prefix}.rows[${rIdx}].label`, message: rl.error });
          const rv = validateTemplateVariables(row.valueTemplate, `Table row #${rIdx + 1} value`);
          if (!rv.valid && rv.error) issues.push({ path: `${prefix}.rows[${rIdx}].valueTemplate`, message: rv.error });
        });
        break;
      }
      case "two_column_text": {
        for (const [k, label] of [
          ["leftTitle", "Left column title"],
          ["leftText", "Left column text"],
          ["rightTitle", "Right column title"],
          ["rightText", "Right column text"],
        ] as const) {
          const val = (block as any)[k];
          if (val) {
            const tv = validateTemplateVariables(val, `${label} (block #${idx + 1})`);
            if (!tv.valid && tv.error) issues.push({ path: `${prefix}.${k}`, message: tv.error });
          }
        }
        break;
      }
      case "social_links": {
        if (block.title) {
          const tv = validateTemplateVariables(block.title, `Social links block #${idx + 1} title`);
          if (!tv.valid && tv.error) issues.push({ path: `${prefix}.title`, message: tv.error });
        }
        (block.links || []).forEach((item, lIdx) => {
          if (!item.label || !item.label.trim()) {
            issues.push({
              path: `${prefix}.links[${lIdx}].label`,
              message: `Social link #${lIdx + 1} requires label text.`,
            });
          }
          const lc = validateEmailUrl(item.url, {
            allowVariableToken: true,
            fieldName: `Social link "${item.label || lIdx + 1}" URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.links[${lIdx}].url`, message: lc.error });
        });
        break;
      }
      case "footer": {
        if (block.contactTitle) {
          const cv = validateTemplateVariables(block.contactTitle, "Contact block title");
          if (!cv.valid && cv.error) issues.push({ path: `${prefix}.contactTitle`, message: cv.error });
        }
        (block.fields || []).forEach((f, fIdx) => {
          const fl = validateTemplateVariables(f.label, `Contact field #${fIdx + 1} label`);
          if (!fl.valid && fl.error) issues.push({ path: `${prefix}.fields[${fIdx}].label`, message: fl.error });
          const fv = validateTemplateVariables(f.valueTemplate, `Contact field #${fIdx + 1} value`);
          if (!fv.valid && fv.error) issues.push({ path: `${prefix}.fields[${fIdx}].valueTemplate`, message: fv.error });
        });
        if (block.legalImprintText) {
          const iv = validateTemplateVariables(block.legalImprintText, "Legal/Imprint text");
          if (!iv.valid && iv.error) issues.push({ path: `${prefix}.legalImprintText`, message: iv.error });
        }
        if (block.footerNote) {
          const fnv = validateTemplateVariables(block.footerNote, "Footer note");
          if (!fnv.valid && fnv.error) issues.push({ path: `${prefix}.footerNote`, message: fnv.error });
        }
        break;
      }
      default:
        break;
    }
  });

  return issues;
}

export function validateHotelEmailSettings(settings: Partial<HotelEmailSettings>): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (settings.portalUrl && settings.portalUrl.trim()) {
    const check = validateEmailUrl(settings.portalUrl, { fieldName: "Hotel Portal URL" });
    if (!check.valid && check.error) issues.push({ path: "portalUrl", message: check.error });
  }

  if (settings.bookingUrl && settings.bookingUrl.trim()) {
    const check = validateEmailUrl(settings.bookingUrl, { fieldName: "Booking Page URL" });
    if (!check.valid && check.error) issues.push({ path: "bookingUrl", message: check.error });
  }

  if (settings.replyToEmail && settings.replyToEmail.trim() && !isValidEmail(settings.replyToEmail)) {
    issues.push({
      path: "replyToEmail",
      message: "Reply-To email must be a valid email address.",
    });
  }

  if (settings.senderDisplayName && settings.senderDisplayName.trim().length > 80) {
    issues.push({
      path: "senderDisplayName",
      message: "Sender display name must be 80 characters or fewer.",
    });
  }

  if (settings.contactOverrides?.email && settings.contactOverrides.email.trim()) {
    if (!isValidEmail(settings.contactOverrides.email)) {
      issues.push({
        path: "contactOverrides.email",
        message: "Contact override email must be a valid email address.",
      });
    }
  }

  if (settings.contactOverrides?.website && settings.contactOverrides.website.trim()) {
    const check = validateEmailUrl(settings.contactOverrides.website, {
      fieldName: "Contact website URL",
    });
    if (!check.valid && check.error) {
      issues.push({ path: "contactOverrides.website", message: check.error });
    }
  }

  if (settings.timeZone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: settings.timeZone }).format(new Date());
    } catch {
      issues.push({
        path: "timeZone",
        message: `Time zone "${settings.timeZone}" is not a valid IANA time zone (e.g. Europe/Berlin, Africa/Lagos, UTC).`,
      });
    }
  }

  if (
    settings.preArrivalDaysBefore !== undefined &&
    (!Number.isInteger(settings.preArrivalDaysBefore) ||
      settings.preArrivalDaysBefore < 1 ||
      settings.preArrivalDaysBefore > 14)
  ) {
    issues.push({
      path: "preArrivalDaysBefore",
      message: "Pre-arrival reminder offset must be between 1 and 14 days.",
    });
  }

  if (
    settings.postStayDaysAfter !== undefined &&
    (!Number.isInteger(settings.postStayDaysAfter) ||
      settings.postStayDaysAfter < 1 ||
      settings.postStayDaysAfter > 14)
  ) {
    issues.push({
      path: "postStayDaysAfter",
      message: "Post-stay feedback offset must be between 1 and 14 days.",
    });
  }

  return issues;
}

/**
 * Pure display-only date formatter (never alters stored data).
 */
export function formatEmailDate(
  rawDate: string | undefined,
  dateFormat: DateFormatPreset = "iso",
  timeZone = "UTC",
  language: "en" | "de" = "en"
): string {
  if (!rawDate || !String(rawDate).trim()) return "";
  const trimmed = String(rawDate).trim();
  const ymdMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);

  let year: number;
  let month: number;
  let day: number;

  if (ymdMatch) {
    year = Number(ymdMatch[1]);
    month = Number(ymdMatch[2]);
    day = Number(ymdMatch[3]);
  } else {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return trimmed;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).formatToParts(parsed);
      year = Number(parts.find((p) => p.type === "year")?.value || parsed.getUTCFullYear());
      month = Number(parts.find((p) => p.type === "month")?.value || parsed.getUTCMonth() + 1);
      day = Number(parts.find((p) => p.type === "day")?.value || parsed.getUTCDate());
    } catch {
      year = parsed.getUTCFullYear();
      month = parsed.getUTCMonth() + 1;
      day = parsed.getUTCDate();
    }
  }

  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  const yyyy = String(year);

  switch (dateFormat) {
    case "iso":
      return `${yyyy}-${mm}-${dd}`;
    case "dd_dot_mm_dot_yyyy":
      return `${dd}.${mm}.${yyyy}`;
    case "mm_slash_dd_slash_yyyy":
      return `${mm}/${dd}/${yyyy}`;
    case "dd_slash_mm_slash_yyyy":
      return `${dd}/${mm}/${yyyy}`;
    case "dd_mmm_yyyy": {
      const monthsEn = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
      const monthsDe = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
      const list = language === "de" ? monthsDe : monthsEn;
      return `${dd} ${list[Math.max(0, Math.min(11, month - 1))]} ${yyyy}`;
    }
    default:
      return `${yyyy}-${mm}-${dd}`;
  }
}

/**
 * Pure display-only time formatter (12h vs 24h).
 */
export function formatEmailTime(
  rawTime: string | undefined,
  timeFormat: "12h" | "24h" = "24h"
): string {
  if (!rawTime || !String(rawTime).trim()) return "";
  const trimmed = String(rawTime).trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})/);
  if (!match) return trimmed;

  const h = Number(match[1]);
  const m = match[2];
  if (!Number.isFinite(h) || h < 0 || h > 23) return trimmed;

  if (timeFormat === "24h") {
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  const period = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${period}`;
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  NGN: "₦",
  USD: "$",
  EUR: "€",
  GBP: "£",
  CAD: "CA$",
  AUD: "A$",
  ZAR: "R",
  KES: "KSh",
  GHS: "₵",
};

/**
 * Pure display-only currency formatter (never modifies stored billing amounts).
 */
export function formatEmailCurrency(
  amount: number | undefined | null,
  currencyCode: string,
  display: CurrencyDisplaySettings = DEFAULT_HOTEL_EMAIL_SETTINGS.currencyDisplay
): string {
  if (amount === undefined || amount === null || !Number.isFinite(Number(amount))) return "";
  const num = Number(amount);
  const decimals = display.decimals === 0 ? 0 : 2;
  const fixed = Math.abs(num).toFixed(decimals);
  const [intPart, decPart] = fixed.split(".");
  const sep = display.thousandsSeparator ?? ",";
  const groupedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
  const decimalSep = sep === "." ? "," : ".";
  const formattedNum = decPart !== undefined ? `${groupedInt}${decimalSep}${decPart}` : groupedInt;
  const sign = num < 0 ? "-" : "";
  const code = (currencyCode || "NGN").trim().toUpperCase();

  if (display.mode === "symbol") {
    const sym = CURRENCY_SYMBOLS[code] || `${code} `;
    return `${sign}${sym}${formattedNum}`;
  }
  return `${sign}${code} ${formattedNum}`;
}

/**
 * Builds the complete allow-listed variable map + boolean condition flags from context and settings.
 * Missing values become "" (never "undefined").
 */
export function buildTemplateVariablesMap(
  ctx: EmailRenderContext,
  settings: HotelEmailSettings = DEFAULT_HOTEL_EMAIL_SETTINGS,
  portalUrlOverride?: string,
  language: "en" | "de" = "en"
): {
  variables: Record<AllowedTemplateVariable, string>;
  conditions: {
    has_loyalty: boolean;
    has_balance_due: boolean;
    has_deposit: boolean;
  };
} {
  const cleanAppUrl = String(ctx.appUrl || "").trim().replace(/\/+$/, "");

  const resolveSafeLink = (candidate?: string): string => {
    if (!candidate || !candidate.trim()) return "";
    const res = validateEmailUrl(candidate.trim());
    return res.valid && res.normalized ? res.normalized : "";
  };

  const portalLink =
    resolveSafeLink(portalUrlOverride) ||
    resolveSafeLink(settings.portalUrl) ||
    cleanAppUrl;

  const hotelWebsite =
    resolveSafeLink(settings.contactOverrides?.website) ||
    resolveSafeLink(ctx.hotelWebsite) ||
    portalLink;

  const bookingLink =
    resolveSafeLink(settings.bookingUrl) ||
    portalLink;

  const guestName = String(ctx.guestName || "").trim();
  const guestFirstName = guestName ? guestName.split(/\s+/)[0] : "";

  const hotelPhone = String(settings.contactOverrides?.phone || ctx.hotelPhone || "").trim();
  const hotelAddress = String(settings.contactOverrides?.address || ctx.hotelAddress || "").trim();
  const hotelEmail = String(settings.contactOverrides?.email || ctx.hotelEmail || "").trim();

  const checkInDate = formatEmailDate(ctx.checkInDate, settings.dateFormat, settings.timeZone, language);
  const checkInTime = formatEmailTime(ctx.checkInTime, settings.timeFormat);
  const checkOutDate = formatEmailDate(ctx.checkOutDate, settings.dateFormat, settings.timeZone, language);
  const checkOutTime = formatEmailTime(ctx.checkOutTime, settings.timeFormat);

  const totalAmount =
    ctx.totalAmount !== undefined && ctx.totalAmount !== null && Number(ctx.totalAmount) > 0
      ? formatEmailCurrency(ctx.totalAmount, ctx.currencyCode, settings.currencyDisplay)
      : "";
  const depositAmount =
    ctx.depositAmount !== undefined && ctx.depositAmount !== null && Number(ctx.depositAmount) > 0
      ? formatEmailCurrency(ctx.depositAmount, ctx.currencyCode, settings.currencyDisplay)
      : "";
  const balanceDue =
    ctx.balanceDue !== undefined && ctx.balanceDue !== null && Number.isFinite(Number(ctx.balanceDue))
      ? formatEmailCurrency(Math.max(0, Number(ctx.balanceDue)), ctx.currencyCode, settings.currencyDisplay)
      : "";

  // Loyalty: ONLY populate if actual loyalty data exists; NEVER invent or compute points
  const hasEarned =
    ctx.loyaltyPointsEarned !== undefined &&
    ctx.loyaltyPointsEarned !== null &&
    Number.isFinite(Number(ctx.loyaltyPointsEarned));
  const hasBalance =
    ctx.loyaltyPointsBalance !== undefined &&
    ctx.loyaltyPointsBalance !== null &&
    Number.isFinite(Number(ctx.loyaltyPointsBalance));
  const hasTier =
    typeof ctx.loyaltyTier === "string" && ctx.loyaltyTier.trim().length > 0;
  const hasLoyalty = hasEarned || hasBalance || hasTier;

  const variables: Record<AllowedTemplateVariable, string> = {
    guest_name: guestName,
    guest_first_name: guestFirstName,
    hotel_name: String(ctx.hotelName || "Hotel Property").trim(),
    hotel_phone: hotelPhone,
    hotel_address: hotelAddress,
    hotel_email: hotelEmail,
    hotel_website: hotelWebsite,
    room_name: String(ctx.roomName || "").trim(),
    room_type: String(ctx.roomType || "").trim(),
    check_in_date: checkInDate,
    check_in_time: checkInTime,
    check_out_date: checkOutDate,
    check_out_time: checkOutTime,
    nights: ctx.nights !== undefined && ctx.nights !== null && Number(ctx.nights) > 0 ? String(ctx.nights) : "",
    booking_reference: String(ctx.bookingReference || "").trim(),
    total_amount: totalAmount,
    deposit_amount: depositAmount,
    balance_due: balanceDue,
    loyalty_points_earned: hasEarned ? String(ctx.loyaltyPointsEarned) : "",
    loyalty_points_balance: hasBalance ? String(ctx.loyaltyPointsBalance) : "",
    loyalty_tier: hasTier ? String(ctx.loyaltyTier).trim() : "",
    booking_link: bookingLink,
    portal_link: portalLink,
    app_url: cleanAppUrl,
  };

  return {
    variables,
    conditions: {
      has_loyalty: hasLoyalty,
      has_balance_due: Number(ctx.balanceDue || 0) > 0,
      has_deposit: Number(ctx.depositAmount || 0) > 0,
    },
  };
}
