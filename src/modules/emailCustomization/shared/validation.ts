import {
  ALLOWED_CONTACT_URL_VARIABLES,
  ALLOWED_DEFAULT_FOOTER_BLOCK_TYPES,
  ALLOWED_TEMPLATE_VARIABLES,
  ALLOWED_URL_VARIABLES,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  EMAIL_ICON_NAMES,
  EMAIL_ICON_TONES,
  IMAGE_LIMITS,
  WEB_SAFE_FONTS,
  type AllowedTemplateVariable,
  type BlockStyleConfig,
  type CurrencyDisplaySettings,
  type DateFormatPreset,
  type EmailBlock,
  type EmailIconName,
  type EmailIconTone,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type FooterNavLinkItem,
  type HotelDefaultLinks,
  type HotelEmailSettings,
  type InlineTextLink,
  type LocalizedLinkValue,
  type SupportedEmailLanguage,
  type TemplateLinkOverviewItem,
  type WebSafeFontId,
} from "./types.ts";

const ALLOWED_VAR_SET = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
const ALLOWED_DEFAULT_FOOTER_TYPE_SET = new Set<string>(ALLOWED_DEFAULT_FOOTER_BLOCK_TYPES);
const WEB_SAFE_FONT_SET = new Set<string>(WEB_SAFE_FONTS.map((f) => f.id));
const EMAIL_ICON_SET = new Set<string>(EMAIL_ICON_NAMES);
const EMAIL_ICON_TONE_SET = new Set<string>(EMAIL_ICON_TONES);
const BUTTON_STYLE_SET = new Set<string>(["filled", "outlined", "dark"]);
const BUTTON_CORNER_SET = new Set<string>(["square", "rounded", "pill"]);
const ALIGN_SET = new Set<string>(["left", "center", "right"]);
const TEXT_ALIGN_SET = new Set<string>(["left", "center", "right", "justify"]);
const VERTICAL_ALIGN_SET = new Set<string>(["top", "middle", "bottom"]);
const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const STRICT_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
const MAX_URL_LENGTH = 2048;

export function isValidEmailIconName(name: unknown): name is EmailIconName {
  return typeof name === "string" && EMAIL_ICON_SET.has(name);
}

export function isValidEmailIconTone(tone: unknown): tone is EmailIconTone {
  return typeof tone === "string" && EMAIL_ICON_TONE_SET.has(tone);
}

export function measureEmailHtmlBytes(html: string): {
  bytes: number;
  kb: number;
  status: "ok" | "warning" | "over";
} {
  const bytes = new TextEncoder().encode(String(html || "")).length;
  const kb = Math.round((bytes / 1024) * 10) / 10;
  const status =
    bytes > IMAGE_LIMITS.htmlMaxBytes
      ? "over"
      : bytes > IMAGE_LIMITS.htmlWarnBytes
        ? "warning"
        : "ok";
  return { bytes, kb, status };
}

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

function isLocalhostOrIpHost(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  // IPv4 literal
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(host)) return true;
  // Numeric / hex / octal single-label or IPv6 literal
  if (/^\d+$/.test(host) || host.startsWith("[") || host.includes(":")) return true;
  return false;
}

/**
 * Strict URL validation used on BOTH save and render:
 * - Allows https:// URLs only (plus mailto: and tel: when `allowContactSchemes` is true)
 * - Allows exact allow-listed link variables (`{{portal_link}}`, `{{hotel_website}}`, etc.) when `allowVariableToken` is true
 * - Allows `mailto:{{hotel_email}}` and `tel:{{hotel_phone}}` when both `allowVariableToken` and `allowContactSchemes` are true
 * - Rejects http:, javascript:, data:, vbscript:, file:, localhost, IP literals, credentials (user:pass@), mailto query injection (?cc=/?bcc=/?body=), and overly long or malformed URLs
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

  if (/[\x00-\x1f\x7f]/.test(trimmed)) {
    return {
      valid: false,
      error: `${field} must not contain control characters.`,
    };
  }

  if (options.allowVariableToken && ALLOWED_URL_VARIABLES.has(trimmed)) {
    return { valid: true, normalized: trimmed };
  }

  if (
    options.allowVariableToken &&
    options.allowContactSchemes &&
    ALLOWED_CONTACT_URL_VARIABLES.has(trimmed)
  ) {
    return { valid: true, normalized: trimmed };
  }

  const lower = trimmed.toLowerCase();
  if (
    lower.startsWith("javascript:") ||
    lower.startsWith("data:") ||
    lower.startsWith("vbscript:") ||
    lower.startsWith("file:")
  ) {
    return {
      valid: false,
      error: `${field} cannot use javascript:, data:, vbscript:, or file: URLs.`,
    };
  }

  if (lower.startsWith("mailto:")) {
    if (!options.allowContactSchemes) {
      return { valid: false, error: `${field} must start with https://.` };
    }
    if (/\s/.test(trimmed)) {
      return { valid: false, error: `${field} must not contain spaces.` };
    }
    if (trimmed.includes("?")) {
      return {
        valid: false,
        error: `${field} must be a plain mailto:email@domain address without ?query parameters.`,
      };
    }
    const addr = trimmed.slice(7).trim();
    if (!isValidEmail(addr)) {
      return { valid: false, error: `${field} contains an invalid mailto: email address.` };
    }
    return { valid: true, normalized: `mailto:${addr}` };
  }

  if (lower.startsWith("tel:")) {
    if (!options.allowContactSchemes) {
      return { valid: false, error: `${field} must start with https://.` };
    }
    if (/[?;#]/.test(trimmed)) {
      return {
        valid: false,
        error: `${field} contains unsupported characters in tel: phone number.`,
      };
    }
    const phone = trimmed.slice(4).trim();
    const digitsCount = (phone.match(/\d/g) || []).length;
    if (!/^\+?[0-9()\-.\s]{5,30}$/.test(phone) || digitsCount < 5) {
      return { valid: false, error: `${field} contains an invalid tel: phone number.` };
    }
    return { valid: true, normalized: `tel:${phone.replace(/\s+/g, "")}` };
  }

  if (/\s/.test(trimmed)) {
    return {
      valid: false,
      error: `${field} must not contain spaces or control characters.`,
    };
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

  if (!parsed.hostname || !parsed.hostname.includes(".") || isLocalhostOrIpHost(parsed.hostname)) {
    return {
      valid: false,
      error: `${field} must include a valid public domain name (localhost and raw IP addresses are not allowed).`,
    };
  }

  const normalized =
    parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.origin
      : parsed.toString();

  return { valid: true, normalized };
}

export interface AbsoluteUrlValidationResult {
  valid: boolean;
  isAbsolute: boolean;
  protocol?: "https:" | "http:" | "mailto:" | "tel:" | "variable";
  normalized?: string;
  suggestedHttpsUrl?: string;
  error?: string;
}

/**
 * URL format validation utility for the link editor.
 * Ensures user-defined links are absolute URLs with valid protocols (http/https,
 * plus optional mailto:/tel: and allow-listed dynamic variables), while flagging
 * relative paths, missing protocols, invalid hostnames, and unsafe schemes.
 */
export function validateAbsoluteLinkUrl(
  rawUrl: unknown,
  options: {
    allowHttp?: boolean;
    allowEmpty?: boolean;
    allowContactSchemes?: boolean;
    allowVariableToken?: boolean;
    fieldName?: string;
  } = {}
): AbsoluteUrlValidationResult {
  const field = options.fieldName || "Link URL";
  const allowHttp = options.allowHttp ?? false;

  if (rawUrl === undefined || rawUrl === null || String(rawUrl).trim() === "") {
    if (options.allowEmpty) {
      return { valid: true, isAbsolute: false, normalized: "" };
    }
    return { valid: false, isAbsolute: false, error: `${field} is required.` };
  }

  const trimmed = String(rawUrl).trim();
  if (trimmed.length > MAX_URL_LENGTH) {
    return {
      valid: false,
      isAbsolute: false,
      error: `${field} exceeds the maximum length of ${MAX_URL_LENGTH} characters.`,
    };
  }

  if (/[\x00-\x1f\x7f]/.test(trimmed) || /\s/.test(trimmed)) {
    return {
      valid: false,
      isAbsolute: false,
      error: `${field} must not contain spaces or control characters.`,
    };
  }

  if (options.allowVariableToken && ALLOWED_URL_VARIABLES.has(trimmed)) {
    return { valid: true, isAbsolute: true, protocol: "variable", normalized: trimmed };
  }
  if (
    options.allowVariableToken &&
    options.allowContactSchemes &&
    ALLOWED_CONTACT_URL_VARIABLES.has(trimmed)
  ) {
    return { valid: true, isAbsolute: true, protocol: "variable", normalized: trimmed };
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("mailto:") || lower.startsWith("tel:")) {
    const emailRes = validateEmailUrl(trimmed, {
      allowEmpty: options.allowEmpty,
      allowContactSchemes: options.allowContactSchemes,
      allowVariableToken: options.allowVariableToken,
      fieldName: field,
    });
    return {
      valid: emailRes.valid,
      isAbsolute: true,
      protocol: lower.startsWith("mailto:") ? "mailto:" : "tel:",
      normalized: emailRes.normalized,
      error: emailRes.error,
    };
  }

  // Catch relative URLs (e.g. "/book", "./rooms", "#section", "hotel.com/book")
  if (trimmed.startsWith("/") || trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("#")) {
    return {
      valid: false,
      isAbsolute: false,
      error: `${field} must be an absolute URL starting with https:// (relative paths like "${trimmed.slice(0, 24)}" cannot work in emails).`,
    };
  }

  if (!/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    const looksLikeDomain = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:[/:?#].*)?$/i.test(trimmed);
    return {
      valid: false,
      isAbsolute: false,
      ...(looksLikeDomain ? { suggestedHttpsUrl: `https://${trimmed}` } : {}),
      error: `${field} must be an absolute URL including protocol (for example, https://${looksLikeDomain ? trimmed : "yourhotel.com"}).`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return {
      valid: false,
      isAbsolute: false,
      error: `${field} is not a valid absolute URL.`,
    };
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return {
      valid: false,
      isAbsolute: true,
      error: `${field} uses unsupported protocol "${parsed.protocol}". Use an absolute https:// URL.`,
    };
  }

  if (parsed.username || parsed.password) {
    return {
      valid: false,
      isAbsolute: true,
      protocol: parsed.protocol,
      error: `${field} must not include embedded credentials (username:password@).`,
    };
  }

  if (!parsed.hostname || !parsed.hostname.includes(".") || isLocalhostOrIpHost(parsed.hostname)) {
    return {
      valid: false,
      isAbsolute: true,
      protocol: parsed.protocol,
      error: `${field} must include a valid public domain name (localhost and raw IP addresses are not allowed).`,
    };
  }

  const normalized =
    parsed.pathname === "/" && !parsed.search && !parsed.hash
      ? parsed.origin
      : parsed.toString();

  if (parsed.protocol === "http:" && !allowHttp) {
    return {
      valid: false,
      isAbsolute: true,
      protocol: "http:",
      suggestedHttpsUrl: normalized.replace(/^http:\/\//i, "https://"),
      error: `${field} uses http:// — upgrade to https:// for secure email links.`,
    };
  }

  return {
    valid: true,
    isAbsolute: true,
    protocol: parsed.protocol,
    normalized,
  };
}

function normalizeHostForCompare(host: string): string {
  return host.trim().toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

function extractVisibleHostsFromText(text: string): string[] {
  const cleaned = String(text || "").replace(/\{\{[^}]*\}\}/g, " ");
  const hosts = new Set<string>();

  // 1. Explicit http:// or https:// URLs in visible label text
  const urlRe = /https?:\/\/([^\s/?#]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = urlRe.exec(cleaned)) !== null) {
    const rawHost = m[1].split(":")[0].replace(/[),.;!?]+$/, "");
    if (rawHost && rawHost.includes(".")) {
      hosts.add(normalizeHostForCompare(rawHost));
    }
  }

  // 2. Explicit www.domain.tld in visible label text
  const wwwRe = /\bwww\.([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi;
  while ((m = wwwRe.exec(cleaned)) !== null) {
    hosts.add(normalizeHostForCompare(m[1]));
  }

  // 3. Bare domain-like strings (excluding email addresses preceded by @)
  const bareDomainRe =
    /(^|[\s([{"'])([a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|de|eu|io|co|uk|ch|at|fr|es|it|nl|app|dev|hotel|hotels|example|biz|info|gov|edu|bank))(?=\/|\s|$|[)\]}"',;!?])/gi;
  while ((m = bareDomainRe.exec(cleaned)) !== null) {
    const matchStart = m.index + (m[1] ? m[1].length : 0);
    if (matchStart > 0 && cleaned[matchStart - 1] === "@") continue;
    hosts.add(normalizeHostForCompare(m[2]));
  }

  return Array.from(hosts).filter(Boolean);
}

/**
 * Phishing protection: warns/blocks when visible link text looks like a URL or domain
 * (e.g. "https://bank.com" or "www.trusted.com") whose domain does not match the real destination URL.
 */
export function validateLinkLabelAgainstUrl(
  label: string | undefined,
  destinationUrl: string | undefined,
  fieldName = "Link"
): { valid: boolean; error?: string } {
  if (!label || !destinationUrl) return { valid: true };
  const dest = destinationUrl.trim();
  if (
    !dest ||
    ALLOWED_URL_VARIABLES.has(dest) ||
    ALLOWED_CONTACT_URL_VARIABLES.has(dest) ||
    dest.toLowerCase().startsWith("mailto:") ||
    dest.toLowerCase().startsWith("tel:")
  ) {
    return { valid: true };
  }

  let destHost = "";
  try {
    const parsed = new URL(dest);
    if (parsed.protocol !== "https:") return { valid: true };
    destHost = normalizeHostForCompare(parsed.hostname);
  } catch {
    return { valid: true };
  }

  if (!destHost) return { valid: true };

  const visibleHosts = extractVisibleHostsFromText(label);
  for (const visHost of visibleHosts) {
    if (visHost !== destHost) {
      return {
        valid: false,
        error: `${fieldName} text displays "${visHost}", which does not match destination "${destHost}". Use matching domains or descriptive button text.`,
      };
    }
  }

  return { valid: true };
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

function validateBlockStyleConfig(
  style: BlockStyleConfig | undefined,
  prefix: string,
  blockNumber: number,
  issues: ValidationIssue[]
): void {
  if (!style) return;
  const colorFields: Array<keyof BlockStyleConfig> = [
    "backgroundColor",
    "textColor",
    "borderColor",
    "accentColor",
  ];
  for (const key of colorFields) {
    const val = style[key];
    if (val !== undefined && val !== "" && !isValidHexColor(val)) {
      issues.push({
        path: `${prefix}.style.${key}`,
        message: `Block #${blockNumber} ${key} must be a valid hex color (e.g. #18181b).`,
      });
    }
  }
  if (style.align !== undefined && !ALIGN_SET.has(style.align)) {
    issues.push({
      path: `${prefix}.style.align`,
      message: `Block #${blockNumber} alignment must be left, center, or right.`,
    });
  }
  if (style.verticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(style.verticalAlign)) {
    issues.push({
      path: `${prefix}.style.verticalAlign`,
      message: `Block #${blockNumber} vertical alignment must be top, middle, or bottom.`,
    });
  }
  if (
    style.paddingY !== undefined &&
    (!Number.isFinite(style.paddingY) || style.paddingY < 0 || style.paddingY > 40)
  ) {
    issues.push({
      path: `${prefix}.style.paddingY`,
      message: `Block #${blockNumber} vertical padding must be between 0 and 40 px.`,
    });
  }
  if (
    style.paddingX !== undefined &&
    (!Number.isFinite(style.paddingX) || style.paddingX < 0 || style.paddingX > 40)
  ) {
    issues.push({
      path: `${prefix}.style.paddingX`,
      message: `Block #${blockNumber} horizontal padding must be between 0 and 40 px.`,
    });
  }
  if (
    style.borderRadius !== undefined &&
    (!Number.isFinite(style.borderRadius) || style.borderRadius < 0 || style.borderRadius > 16)
  ) {
    issues.push({
      path: `${prefix}.style.borderRadius`,
      message: `Block #${blockNumber} border radius must be between 0 and 16 px.`,
    });
  }
  if (style.fontFamily !== undefined && !isValidWebSafeFont(style.fontFamily)) {
    issues.push({
      path: `${prefix}.style.fontFamily`,
      message: `Block #${blockNumber} font must be selected from the web-safe font list.`,
    });
  }
  if (
    style.fontSizePx !== undefined &&
    (!Number.isFinite(style.fontSizePx) || style.fontSizePx < 10 || style.fontSizePx > 24)
  ) {
    issues.push({
      path: `${prefix}.style.fontSizePx`,
      message: `Block #${blockNumber} font size must be between 10 and 24 px.`,
    });
  }
}

function validateInlineLinksList(
  inlineLinks: InlineTextLink[] | undefined,
  prefix: string,
  blockNumber: number,
  issues: ValidationIssue[]
): void {
  if (!inlineLinks || inlineLinks.length === 0) return;
  if (!Array.isArray(inlineLinks)) {
    issues.push({
      path: `${prefix}.inlineLinks`,
      message: `Block #${blockNumber} inline links must be a list.`,
    });
    return;
  }
  if (inlineLinks.length > 20) {
    issues.push({
      path: `${prefix}.inlineLinks`,
      message: `Block #${blockNumber} cannot have more than 20 inline links.`,
    });
  }
  inlineLinks.forEach((link, idx) => {
    const lp = `${prefix}.inlineLinks[${idx}]`;
    const labelName = `Block #${blockNumber} inline link #${idx + 1}`;
    if (!link || !link.id || typeof link.id !== "string") {
      issues.push({ path: `${lp}.id`, message: `${labelName} is missing an ID.` });
      return;
    }
    if (!link.label || !link.label.trim()) {
      issues.push({ path: `${lp}.label`, message: `${labelName} requires visible link text.` });
    } else {
      const lv = validateTemplateVariables(link.label, `${labelName} text`);
      if (!lv.valid && lv.error) issues.push({ path: `${lp}.label`, message: lv.error });
    }
    if (!link.hidden) {
      const uc = validateEmailUrl(link.url, {
        allowVariableToken: true,
        allowContactSchemes: true,
        fieldName: `${labelName} URL`,
      });
      if (!uc.valid && uc.error) issues.push({ path: `${lp}.url`, message: uc.error });
      if (uc.valid && uc.normalized && link.label) {
        const phish = validateLinkLabelAgainstUrl(link.label, uc.normalized, labelName);
        if (!phish.valid && phish.error) issues.push({ path: `${lp}.label`, message: phish.error });
      }
    } else if (link.url && link.url.trim()) {
      const uc = validateEmailUrl(link.url, {
        allowEmpty: true,
        allowVariableToken: true,
        allowContactSchemes: true,
        fieldName: `${labelName} URL`,
      });
      if (!uc.valid && uc.error) issues.push({ path: `${lp}.url`, message: uc.error });
    }
    if (link.color && !isValidHexColor(link.color)) {
      issues.push({ path: `${lp}.color`, message: `${labelName} color must be a valid hex color.` });
    }
  });
}

function validateModernButtonProps(
  block: {
    buttonLabel?: string;
    buttonUrl?: string;
    buttonStyle?: string;
    buttonCorner?: string;
    buttonBgColor?: string;
    buttonTextColor?: string;
    buttonBorderColor?: string;
    buttonHidden?: boolean;
  },
  prefix: string,
  blockNumber: number,
  required: boolean,
  issues: ValidationIssue[]
): void {
  const isHidden = block.buttonHidden === true;
  const hasLabel = Boolean(block.buttonLabel && block.buttonLabel.trim());
  const hasUrl = Boolean(block.buttonUrl && block.buttonUrl.trim());

  if (required && !isHidden && !hasLabel) {
    issues.push({
      path: `${prefix}.buttonLabel`,
      message: `Block #${blockNumber} requires button label text.`,
    });
  } else if (hasLabel) {
    const lv = validateTemplateVariables(block.buttonLabel!, `Block #${blockNumber} button label`);
    if (!lv.valid && lv.error) issues.push({ path: `${prefix}.buttonLabel`, message: lv.error });
  }

  if (!isHidden && (required || hasLabel || hasUrl)) {
    const uc = validateEmailUrl(block.buttonUrl, {
      allowEmpty: !required && !hasLabel,
      allowVariableToken: true,
      allowContactSchemes: true,
      fieldName: `Block #${blockNumber} button URL`,
    });
    if (!uc.valid && uc.error) issues.push({ path: `${prefix}.buttonUrl`, message: uc.error });
    if (uc.valid && uc.normalized && hasLabel) {
      const phish = validateLinkLabelAgainstUrl(
        block.buttonLabel,
        uc.normalized,
        `Block #${blockNumber} button`
      );
      if (!phish.valid && phish.error) {
        issues.push({ path: `${prefix}.buttonLabel`, message: phish.error });
      }
    }
  } else if (hasUrl) {
    const uc = validateEmailUrl(block.buttonUrl, {
      allowEmpty: true,
      allowVariableToken: true,
      allowContactSchemes: true,
      fieldName: `Block #${blockNumber} button URL`,
    });
    if (!uc.valid && uc.error) issues.push({ path: `${prefix}.buttonUrl`, message: uc.error });
  }

  if (block.buttonStyle && !BUTTON_STYLE_SET.has(block.buttonStyle)) {
    issues.push({
      path: `${prefix}.buttonStyle`,
      message: `Block #${blockNumber} button style must be filled, outlined, or dark.`,
    });
  }
  if (block.buttonCorner && !BUTTON_CORNER_SET.has(block.buttonCorner)) {
    issues.push({
      path: `${prefix}.buttonCorner`,
      message: `Block #${blockNumber} button corner style must be square, rounded, or pill.`,
    });
  }
  if (block.buttonBgColor && !isValidHexColor(block.buttonBgColor)) {
    issues.push({
      path: `${prefix}.buttonBgColor`,
      message: `Block #${blockNumber} button color must be a valid hex color.`,
    });
  }
  if (block.buttonTextColor && !isValidHexColor(block.buttonTextColor)) {
    issues.push({
      path: `${prefix}.buttonTextColor`,
      message: `Block #${blockNumber} button text color must be a valid hex color.`,
    });
  }
  if (block.buttonBorderColor && !isValidHexColor(block.buttonBorderColor)) {
    issues.push({
      path: `${prefix}.buttonBorderColor`,
      message: `Block #${blockNumber} button border color must be a valid hex color.`,
    });
  }
}

export function validateTemplateVariant(variant: EmailTemplateVariant): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!variant || typeof variant !== "object") {
    return [{ path: "variant", message: "Template data is missing." }];
  }

  if (
    variant.schemaVersion !== undefined &&
    variant.schemaVersion !== 1 &&
    variant.schemaVersion !== 2 &&
    variant.schemaVersion !== 3 &&
    variant.schemaVersion !== 4
  ) {
    issues.push({ path: "schemaVersion", message: "Unsupported template schema version." });
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
    if (b.logoLinkUrl && b.logoLinkUrl.trim()) {
      const llv = validateEmailUrl(b.logoLinkUrl, {
        allowVariableToken: true,
        fieldName: "Logo Link URL",
      });
      if (!llv.valid && llv.error) issues.push({ path: "branding.logoLinkUrl", message: llv.error });
    }
    if (b.logoAlign !== undefined && !ALIGN_SET.has(b.logoAlign)) {
      issues.push({ path: "branding.logoAlign", message: "Header logo alignment must be left, center, or right." });
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
    "brand_header",
    "promo_banner",
    "membership_strip",
    "icon_divider",
    "hero_text",
    "confirmation_number",
    "stay_dates",
    "feature_card",
    "benefits_list",
    "icon_link_grid",
    "image_with_list",
    "footer_nav",
    "legal_section",
    "footer_contact",
    "footer_authenticity",
    "footer_copyright",
    "footer_legal",
    "footer_powered_by",
  ]);

  variant.blocks.forEach((block: EmailBlock, idx: number) => {
    validateEmailBlock(block, idx, `blocks[${idx}]`, allowedBlockTypes, issues);
  });

  return issues;
}

export function validateEmailBlock(
  block: EmailBlock,
  idx: number,
  prefix: string,
  allowedBlockTypes: Set<string>,
  issues: ValidationIssue[]
): void {
  const num = idx + 1;
  const checkVar = (text: string | undefined, path: string, label: string) => {
    if (!text) return;
    const res = validateTemplateVariables(text, label);
    if (!res.valid && res.error) issues.push({ path, message: res.error });
  };

  if (!block || !allowedBlockTypes.has(block.type)) {
    issues.push({
      path: prefix,
      message: `Block #${num} uses an unsupported block type.`,
    });
    return;
  }

  if (block.hidden !== undefined && typeof block.hidden !== "boolean") {
    issues.push({
      path: `${prefix}.hidden`,
      message: `Block #${num} visibility flag must be a boolean.`,
    });
  }

    switch (block.type) {
      case "heading": {
        checkVar(block.text, `${prefix}.text`, `Heading block #${num}`);
        if (block.color && !isValidHexColor(block.color)) {
          issues.push({ path: `${prefix}.color`, message: `Heading block #${num} color must be a valid hex color.` });
        }
        if (block.align !== undefined && !ALIGN_SET.has(block.align)) {
          issues.push({ path: `${prefix}.align`, message: `Heading block #${num} alignment must be left, center, or right.` });
        }
        if (block.verticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.verticalAlign)) {
          issues.push({ path: `${prefix}.verticalAlign`, message: `Heading block #${num} vertical alignment must be top, middle, or bottom.` });
        }
        break;
      }
      case "paragraph": {
        checkVar(block.text, `${prefix}.text`, `Paragraph block #${num}`);
        if (block.align !== undefined && !TEXT_ALIGN_SET.has(block.align)) {
          issues.push({ path: `${prefix}.align`, message: `Paragraph block #${num} alignment must be left, center, right, or justify.` });
        }
        if (block.verticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.verticalAlign)) {
          issues.push({ path: `${prefix}.verticalAlign`, message: `Paragraph block #${num} vertical alignment must be top, middle, or bottom.` });
        }
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        break;
      }
      case "image": {
        const urlCheck = validateEmailUrl(block.src, { fieldName: `Image block #${num} URL` });
        if (!urlCheck.valid && urlCheck.error) {
          issues.push({ path: `${prefix}.src`, message: urlCheck.error });
        }
        if (!block.alt || !block.alt.trim()) {
          issues.push({
            path: `${prefix}.alt`,
            message: `Image block #${num} requires alt text for accessibility and email clients.`,
          });
        } else {
          checkVar(block.alt, `${prefix}.alt`, `Image block #${num} alt text`);
        }
        if (block.align !== undefined && !ALIGN_SET.has(block.align)) {
          issues.push({ path: `${prefix}.align`, message: `Image block #${num} alignment must be left, center, or right.` });
        }
        if (block.verticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.verticalAlign)) {
          issues.push({ path: `${prefix}.verticalAlign`, message: `Image block #${num} vertical alignment must be top, middle, or bottom.` });
        }
        if (block.linkUrl && block.linkUrl.trim()) {
          const lc = validateEmailUrl(block.linkUrl, {
            allowVariableToken: true,
            fieldName: `Image block #${num} link URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.linkUrl`, message: lc.error });
        }
        break;
      }
      case "button": {
        if (!block.label || !block.label.trim()) {
          issues.push({
            path: `${prefix}.label`,
            message: `Link/Button block #${num} requires label text.`,
          });
        } else {
          checkVar(block.label, `${prefix}.label`, `Link/Button block #${num} label`);
        }
        checkVar(block.prefixText, `${prefix}.prefixText`, `Link/Button block #${num} surrounding text`);
        const uc = validateEmailUrl(block.url, {
          allowVariableToken: true,
          allowContactSchemes: true,
          fieldName: `Link/Button block #${num} URL`,
        });
        if (!uc.valid && uc.error) issues.push({ path: `${prefix}.url`, message: uc.error });
        if (uc.valid && uc.normalized && block.label) {
          const phish = validateLinkLabelAgainstUrl(
            block.label,
            uc.normalized,
            `Link/Button block #${num}`
          );
          if (!phish.valid && phish.error) {
            issues.push({ path: `${prefix}.label`, message: phish.error });
          }
        }
        if (block.bgColor && !isValidHexColor(block.bgColor)) {
          issues.push({ path: `${prefix}.bgColor`, message: `Link/Button block #${num} color must be a valid hex color.` });
        }
        if (block.textColor && !isValidHexColor(block.textColor)) {
          issues.push({ path: `${prefix}.textColor`, message: `Link/Button block #${num} text color must be a valid hex color.` });
        }
        if (block.borderColor && !isValidHexColor(block.borderColor)) {
          issues.push({ path: `${prefix}.borderColor`, message: `Link/Button block #${num} border color must be a valid hex color.` });
        }
        if (
          block.borderRadiusPx !== undefined &&
          (!Number.isFinite(block.borderRadiusPx) || block.borderRadiusPx < 0 || block.borderRadiusPx > 999)
        ) {
          issues.push({ path: `${prefix}.borderRadiusPx`, message: `Link/Button block #${num} corner radius must be between 0 and 999.` });
        }
        break;
      }
      case "booking_details_table": {
        checkVar(block.title, `${prefix}.title`, `Details table #${num} title`);
        (block.rows || []).forEach((row, rIdx) => {
          checkVar(row.label, `${prefix}.rows[${rIdx}].label`, `Table row #${rIdx + 1} label`);
          checkVar(row.valueTemplate, `${prefix}.rows[${rIdx}].valueTemplate`, `Table row #${rIdx + 1} value`);
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
          checkVar((block as any)[k], `${prefix}.${k}`, `${label} (block #${num})`);
        }
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        break;
      }
      case "social_links": {
        checkVar(block.title, `${prefix}.title`, `Social links block #${num} title`);
        (block.links || []).forEach((item, lIdx) => {
          if (!item.label || !item.label.trim()) {
            issues.push({
              path: `${prefix}.links[${lIdx}].label`,
              message: `Social link #${lIdx + 1} requires label text.`,
            });
          } else {
            checkVar(item.label, `${prefix}.links[${lIdx}].label`, `Social link #${lIdx + 1} label`);
          }
          const lc = validateEmailUrl(item.url, {
            allowEmpty: item.hidden === true,
            allowVariableToken: true,
            fieldName: `Social link "${item.label || lIdx + 1}" URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.links[${lIdx}].url`, message: lc.error });
          if (lc.valid && lc.normalized && item.label) {
            const phish = validateLinkLabelAgainstUrl(item.label, lc.normalized, `Social link "${item.label}"`);
            if (!phish.valid && phish.error) issues.push({ path: `${prefix}.links[${lIdx}].label`, message: phish.error });
          }
          if (item.color && !isValidHexColor(item.color)) {
            issues.push({ path: `${prefix}.links[${lIdx}].color`, message: `Social link #${lIdx + 1} color must be a valid hex color.` });
          }
        });
        break;
      }
      case "footer": {
        checkVar(block.contactTitle, `${prefix}.contactTitle`, "Contact block title");
        (block.fields || []).forEach((f, fIdx) => {
          checkVar(f.label, `${prefix}.fields[${fIdx}].label`, `Contact field #${fIdx + 1} label`);
          checkVar(f.valueTemplate, `${prefix}.fields[${fIdx}].valueTemplate`, `Contact field #${fIdx + 1} value`);
          if (f.linkColor && !isValidHexColor(f.linkColor)) {
            issues.push({ path: `${prefix}.fields[${fIdx}].linkColor`, message: `Contact field #${fIdx + 1} link color must be a valid hex color.` });
          }
        });
        checkVar(block.legalImprintText, `${prefix}.legalImprintText`, "Legal/Imprint text");
        checkVar(block.footerNote, `${prefix}.footerNote`, "Footer note");
        break;
      }

      // --- 13 New Modern Additive Block Validations ---
      case "brand_header": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (block.logoAlign !== undefined && !ALIGN_SET.has(block.logoAlign)) {
          issues.push({ path: `${prefix}.logoAlign`, message: `Header block #${num} logo alignment must be left, center, or right.` });
        }
        if (block.logoVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.logoVerticalAlign)) {
          issues.push({ path: `${prefix}.logoVerticalAlign`, message: `Header block #${num} logo vertical alignment must be top, middle, or bottom.` });
        }
        if (block.contactAlign !== undefined && !ALIGN_SET.has(block.contactAlign)) {
          issues.push({ path: `${prefix}.contactAlign`, message: `Header block #${num} contact alignment must be left, center, or right.` });
        }
        if (block.contactVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.contactVerticalAlign)) {
          issues.push({ path: `${prefix}.contactVerticalAlign`, message: `Header block #${num} contact vertical alignment must be top, middle, or bottom.` });
        }
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Header block #${num} icon color is not allowed.` });
        }
        if (block.logoUrl && block.logoUrl.trim()) {
          const lc = validateEmailUrl(block.logoUrl, { fieldName: `Header block #${num} logo URL` });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.logoUrl`, message: lc.error });
          if (!block.logoAlt || !block.logoAlt.trim()) {
            issues.push({
              path: `${prefix}.logoAlt`,
              message: `Header block #${num} requires alt text when a logo image is set.`,
            });
          } else {
            checkVar(block.logoAlt, `${prefix}.logoAlt`, `Header block #${num} logo alt text`);
          }
        }
        if (block.logoLinkUrl && block.logoLinkUrl.trim()) {
          const llc = validateEmailUrl(block.logoLinkUrl, {
            allowVariableToken: true,
            fieldName: `Header block #${num} logo link URL`,
          });
          if (!llc.valid && llc.error) issues.push({ path: `${prefix}.logoLinkUrl`, message: llc.error });
        }
        if (block.emailOverride && block.emailOverride.trim()) {
          const eo = block.emailOverride.trim();
          if (eo !== "{{hotel_email}}" && !isValidEmail(eo)) {
            issues.push({ path: `${prefix}.emailOverride`, message: `Header block #${num} email override must be a valid email address.` });
          }
        }
        if (block.phoneOverride && block.phoneOverride.trim()) {
          const po = block.phoneOverride.trim();
          if (po !== "{{hotel_phone}}") {
            const tc = validateEmailUrl(`tel:${po}`, {
              allowContactSchemes: true,
              fieldName: `Header block #${num} phone override`,
            });
            if (!tc.valid && tc.error) issues.push({ path: `${prefix}.phoneOverride`, message: tc.error });
          }
        }
        break;
      }

      case "promo_banner": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (block.imageAlign !== undefined && !ALIGN_SET.has(block.imageAlign)) {
          issues.push({ path: `${prefix}.imageAlign`, message: `Promo banner #${num} image alignment must be left, center, or right.` });
        }
        if (block.imageVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.imageVerticalAlign)) {
          issues.push({ path: `${prefix}.imageVerticalAlign`, message: `Promo banner #${num} image vertical alignment must be top, middle, or bottom.` });
        }
        if (block.textAlign !== undefined && !ALIGN_SET.has(block.textAlign)) {
          issues.push({ path: `${prefix}.textAlign`, message: `Promo banner #${num} text alignment must be left, center, or right.` });
        }
        if (block.textVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.textVerticalAlign)) {
          issues.push({ path: `${prefix}.textVerticalAlign`, message: `Promo banner #${num} text vertical alignment must be top, middle, or bottom.` });
        }
        if (!block.text || !block.text.trim()) {
          issues.push({ path: `${prefix}.text`, message: `Promo banner #${num} requires text.` });
        } else {
          checkVar(block.text, `${prefix}.text`, `Promo banner #${num} text`);
        }
        if (block.imageUrl && block.imageUrl.trim()) {
          const ic = validateEmailUrl(block.imageUrl, { fieldName: `Promo banner #${num} image URL` });
          if (!ic.valid && ic.error) issues.push({ path: `${prefix}.imageUrl`, message: ic.error });
          if (!block.imageAlt || !block.imageAlt.trim()) {
            issues.push({
              path: `${prefix}.imageAlt`,
              message: `Promo banner #${num} requires alt text for its image.`,
            });
          } else {
            checkVar(block.imageAlt, `${prefix}.imageAlt`, `Promo banner #${num} image alt text`);
          }
        }
        if (block.imageLinkUrl && block.imageLinkUrl.trim()) {
          const ilc = validateEmailUrl(block.imageLinkUrl, {
            allowVariableToken: true,
            fieldName: `Promo banner #${num} image link URL`,
          });
          if (!ilc.valid && ilc.error) issues.push({ path: `${prefix}.imageLinkUrl`, message: ilc.error });
        }
        validateModernButtonProps(block, prefix, num, true, issues);
        break;
      }

      case "membership_strip": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.tierTemplate, `${prefix}.tierTemplate`, `Membership strip #${num} tier`);
        checkVar(block.pointsTemplate, `${prefix}.pointsTemplate`, `Membership strip #${num} points`);
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Membership strip #${num} icon color is not allowed.` });
        }
        if (block.linkUrl && block.linkUrl.trim()) {
          const lc = validateEmailUrl(block.linkUrl, {
            allowVariableToken: true,
            fieldName: `Membership strip #${num} link URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.linkUrl`, message: lc.error });
        }
        break;
      }

      case "icon_divider": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (!isValidEmailIconName(block.icon)) {
          issues.push({ path: `${prefix}.icon`, message: `Icon divider #${num} uses an unsupported icon.` });
        }
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Icon divider #${num} icon color is not allowed.` });
        }
        if (block.lineColor && !isValidHexColor(block.lineColor)) {
          issues.push({ path: `${prefix}.lineColor`, message: `Icon divider #${num} line color must be a valid hex color.` });
        }
        break;
      }

      case "hero_text": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (!block.headline || !block.headline.trim()) {
          issues.push({ path: `${prefix}.headline`, message: `Hero text block #${num} requires a headline.` });
        } else {
          checkVar(block.headline, `${prefix}.headline`, `Hero text #${num} headline`);
        }
        checkVar(block.body, `${prefix}.body`, `Hero text #${num} body`);
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        validateModernButtonProps(block, prefix, num, false, issues);
        break;
      }

      case "confirmation_number": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.label, `${prefix}.label`, `Confirmation number #${num} label`);
        if (!block.valueTemplate || !block.valueTemplate.trim()) {
          issues.push({ path: `${prefix}.valueTemplate`, message: `Confirmation number #${num} requires a value or variable.` });
        } else {
          checkVar(block.valueTemplate, `${prefix}.valueTemplate`, `Confirmation number #${num} value`);
        }
        break;
      }

      case "stay_dates": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.checkInLabel, `${prefix}.checkInLabel`, `Stay dates #${num} check-in label`);
        checkVar(block.checkInDateTemplate, `${prefix}.checkInDateTemplate`, `Stay dates #${num} check-in date`);
        checkVar(block.checkInTimeTemplate, `${prefix}.checkInTimeTemplate`, `Stay dates #${num} check-in time`);
        checkVar(block.checkOutLabel, `${prefix}.checkOutLabel`, `Stay dates #${num} check-out label`);
        checkVar(block.checkOutDateTemplate, `${prefix}.checkOutDateTemplate`, `Stay dates #${num} check-out date`);
        checkVar(block.checkOutTimeTemplate, `${prefix}.checkOutTimeTemplate`, `Stay dates #${num} check-out time`);
        validateModernButtonProps(block, prefix, num, false, issues);
        break;
      }

      case "feature_card": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (block.imagePosition !== "left" && block.imagePosition !== "right") {
          issues.push({ path: `${prefix}.imagePosition`, message: `Feature card #${num} image position must be left or right.` });
        }
        if (block.imageAlign !== undefined && !ALIGN_SET.has(block.imageAlign)) {
          issues.push({ path: `${prefix}.imageAlign`, message: `Feature card #${num} image alignment must be left, center, or right.` });
        }
        if (block.imageVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.imageVerticalAlign)) {
          issues.push({ path: `${prefix}.imageVerticalAlign`, message: `Feature card #${num} image vertical alignment must be top, middle, or bottom.` });
        }
        if (block.textAlign !== undefined && !ALIGN_SET.has(block.textAlign)) {
          issues.push({ path: `${prefix}.textAlign`, message: `Feature card #${num} text alignment must be left, center, or right.` });
        }
        if (block.textVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.textVerticalAlign)) {
          issues.push({ path: `${prefix}.textVerticalAlign`, message: `Feature card #${num} text vertical alignment must be top, middle, or bottom.` });
        }
        const ic = validateEmailUrl(block.imageUrl, { fieldName: `Feature card #${num} image URL` });
        if (!ic.valid && ic.error) issues.push({ path: `${prefix}.imageUrl`, message: ic.error });
        if (!block.imageAlt || !block.imageAlt.trim()) {
          issues.push({ path: `${prefix}.imageAlt`, message: `Feature card #${num} requires image alt text.` });
        } else {
          checkVar(block.imageAlt, `${prefix}.imageAlt`, `Feature card #${num} image alt text`);
        }
        if (block.imageLinkUrl && block.imageLinkUrl.trim()) {
          const ilc = validateEmailUrl(block.imageLinkUrl, {
            allowVariableToken: true,
            fieldName: `Feature card #${num} image link URL`,
          });
          if (!ilc.valid && ilc.error) issues.push({ path: `${prefix}.imageLinkUrl`, message: ilc.error });
        }
        if (!block.title || !block.title.trim()) {
          issues.push({ path: `${prefix}.title`, message: `Feature card #${num} requires a title.` });
        } else {
          checkVar(block.title, `${prefix}.title`, `Feature card #${num} title`);
        }
        checkVar(block.body, `${prefix}.body`, `Feature card #${num} body`);
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        validateModernButtonProps(block, prefix, num, false, issues);
        break;
      }

      case "benefits_list": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.badgeText, `${prefix}.badgeText`, `Benefits list #${num} badge text`);
        if (block.badgeImageUrl && block.badgeImageUrl.trim()) {
          const bc = validateEmailUrl(block.badgeImageUrl, { fieldName: `Benefits list #${num} badge image URL` });
          if (!bc.valid && bc.error) issues.push({ path: `${prefix}.badgeImageUrl`, message: bc.error });
          if (!block.badgeImageAlt || !block.badgeImageAlt.trim()) {
            issues.push({ path: `${prefix}.badgeImageAlt`, message: `Benefits list #${num} requires alt text for its badge image.` });
          } else {
            checkVar(block.badgeImageAlt, `${prefix}.badgeImageAlt`, `Benefits list #${num} badge alt`);
          }
        }
        if (block.badgeImageLinkUrl && block.badgeImageLinkUrl.trim()) {
          const blc = validateEmailUrl(block.badgeImageLinkUrl, {
            allowVariableToken: true,
            fieldName: `Benefits list #${num} badge image link URL`,
          });
          if (!blc.valid && blc.error) issues.push({ path: `${prefix}.badgeImageLinkUrl`, message: blc.error });
        }
        if (!block.heading || !block.heading.trim()) {
          issues.push({ path: `${prefix}.heading`, message: `Benefits list #${num} requires a heading.` });
        } else {
          checkVar(block.heading, `${prefix}.heading`, `Benefits list #${num} heading`);
        }
        if (block.listStyle !== "bullet" && block.listStyle !== "icon") {
          issues.push({ path: `${prefix}.listStyle`, message: `Benefits list #${num} style must be bullet or icon.` });
        }
        if (block.itemIcon && !isValidEmailIconName(block.itemIcon)) {
          issues.push({ path: `${prefix}.itemIcon`, message: `Benefits list #${num} uses an unsupported icon.` });
        }
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Benefits list #${num} icon color is not allowed.` });
        }
        if (!Array.isArray(block.items) || block.items.length === 0) {
          issues.push({ path: `${prefix}.items`, message: `Benefits list #${num} must contain at least one item.` });
        } else {
          block.items.forEach((it, iIdx) => {
            checkVar(it.text, `${prefix}.items[${iIdx}].text`, `Benefits list #${num} item #${iIdx + 1}`);
          });
        }
        checkVar(block.footnote, `${prefix}.footnote`, `Benefits list #${num} footnote`);
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        validateModernButtonProps(block, prefix, num, false, issues);
        break;
      }

      case "icon_link_grid": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.heading, `${prefix}.heading`, `Icon link grid #${num} heading`);
        checkVar(block.subheading, `${prefix}.subheading`, `Icon link grid #${num} subheading`);
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Icon link grid #${num} icon color is not allowed.` });
        }
        if (!Array.isArray(block.items) || block.items.length < 2 || block.items.length > 4) {
          issues.push({
            path: `${prefix}.items`,
            message: `Icon link grid #${num} must have between 2 and 4 items.`,
          });
        } else {
          block.items.forEach((it, iIdx) => {
            if (!isValidEmailIconName(it.icon)) {
              issues.push({ path: `${prefix}.items[${iIdx}].icon`, message: `Icon link #${iIdx + 1} uses an unsupported icon.` });
            }
            if (!it.label || !it.label.trim()) {
              issues.push({ path: `${prefix}.items[${iIdx}].label`, message: `Icon link #${iIdx + 1} requires a label.` });
            } else {
              checkVar(it.label, `${prefix}.items[${iIdx}].label`, `Icon link #${iIdx + 1} label`);
            }
            const uc = validateEmailUrl(it.url, {
              allowEmpty: it.hidden === true,
              allowVariableToken: true,
              allowContactSchemes: true,
              fieldName: `Icon link "${it.label || iIdx + 1}" URL`,
            });
            if (!uc.valid && uc.error) issues.push({ path: `${prefix}.items[${iIdx}].url`, message: uc.error });
            if (uc.valid && uc.normalized && it.label) {
              const phish = validateLinkLabelAgainstUrl(it.label, uc.normalized, `Icon link "${it.label}"`);
              if (!phish.valid && phish.error) issues.push({ path: `${prefix}.items[${iIdx}].label`, message: phish.error });
            }
          });
        }
        break;
      }

      case "image_with_list": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (block.imageAlign !== undefined && !ALIGN_SET.has(block.imageAlign)) {
          issues.push({ path: `${prefix}.imageAlign`, message: `Image + List #${num} image alignment must be left, center, or right.` });
        }
        if (block.imageVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.imageVerticalAlign)) {
          issues.push({ path: `${prefix}.imageVerticalAlign`, message: `Image + List #${num} image vertical alignment must be top, middle, or bottom.` });
        }
        if (block.textAlign !== undefined && !ALIGN_SET.has(block.textAlign)) {
          issues.push({ path: `${prefix}.textAlign`, message: `Image + List #${num} text alignment must be left, center, or right.` });
        }
        if (block.textVerticalAlign !== undefined && !VERTICAL_ALIGN_SET.has(block.textVerticalAlign)) {
          issues.push({ path: `${prefix}.textVerticalAlign`, message: `Image + List #${num} text vertical alignment must be top, middle, or bottom.` });
        }
        const ic = validateEmailUrl(block.imageUrl, { fieldName: `Image + List #${num} image URL` });
        if (!ic.valid && ic.error) issues.push({ path: `${prefix}.imageUrl`, message: ic.error });
        if (!block.imageAlt || !block.imageAlt.trim()) {
          issues.push({ path: `${prefix}.imageAlt`, message: `Image + List #${num} requires image alt text.` });
        } else {
          checkVar(block.imageAlt, `${prefix}.imageAlt`, `Image + List #${num} image alt text`);
        }
        if (block.imageLinkUrl && block.imageLinkUrl.trim()) {
          const ilc = validateEmailUrl(block.imageLinkUrl, {
            allowVariableToken: true,
            fieldName: `Image + List #${num} image link URL`,
          });
          if (!ilc.valid && ilc.error) issues.push({ path: `${prefix}.imageLinkUrl`, message: ilc.error });
        }
        if (!block.heading || !block.heading.trim()) {
          issues.push({ path: `${prefix}.heading`, message: `Image + List #${num} requires a heading.` });
        } else {
          checkVar(block.heading, `${prefix}.heading`, `Image + List #${num} heading`);
        }
        if (block.iconTone && !isValidEmailIconTone(block.iconTone)) {
          issues.push({ path: `${prefix}.iconTone`, message: `Image + List #${num} icon color is not allowed.` });
        }
        (block.items || []).forEach((it, iIdx) => {
          if (!isValidEmailIconName(it.icon)) {
            issues.push({ path: `${prefix}.items[${iIdx}].icon`, message: `Feature item #${iIdx + 1} uses an unsupported icon.` });
          }
          checkVar(it.text, `${prefix}.items[${iIdx}].text`, `Feature item #${iIdx + 1} text`);
        });
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        validateModernButtonProps(block, prefix, num, false, issues);
        break;
      }

      case "footer_nav": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        if (!Array.isArray(block.links) || block.links.length === 0) {
          issues.push({ path: `${prefix}.links`, message: `Footer navigation #${num} must include at least one link.` });
        } else {
          block.links.forEach((l, lIdx) => {
            if (!l.label || !l.label.trim()) {
              issues.push({ path: `${prefix}.links[${lIdx}].label`, message: `Footer link #${lIdx + 1} requires a label.` });
            } else {
              checkVar(l.label, `${prefix}.links[${lIdx}].label`, `Footer link #${lIdx + 1} label`);
            }
            const uc = validateEmailUrl(l.url, {
              allowEmpty: l.hidden === true,
              allowVariableToken: true,
              allowContactSchemes: true,
              fieldName: `Footer link "${l.label || lIdx + 1}" URL`,
            });
            if (!uc.valid && uc.error) issues.push({ path: `${prefix}.links[${lIdx}].url`, message: uc.error });
            if (uc.valid && uc.normalized && l.label) {
              const phish = validateLinkLabelAgainstUrl(l.label, uc.normalized, `Footer link "${l.label}"`);
              if (!phish.valid && phish.error) issues.push({ path: `${prefix}.links[${lIdx}].label`, message: phish.error });
            }
            if (l.color && !isValidHexColor(l.color)) {
              issues.push({ path: `${prefix}.links[${lIdx}].color`, message: `Footer link #${lIdx + 1} color must be a valid hex color.` });
            }
          });
        }
        checkVar(block.secondaryText, `${prefix}.secondaryText`, `Footer navigation #${num} secondary text`);
        if (block.secondaryLinkUrl && block.secondaryLinkUrl.trim()) {
          const sc = validateEmailUrl(block.secondaryLinkUrl, {
            allowVariableToken: true,
            allowContactSchemes: true,
            fieldName: `Footer navigation #${num} secondary URL`,
          });
          if (!sc.valid && sc.error) issues.push({ path: `${prefix}.secondaryLinkUrl`, message: sc.error });
          if (sc.valid && sc.normalized && block.secondaryText) {
            const phish = validateLinkLabelAgainstUrl(
              block.secondaryText,
              sc.normalized,
              `Footer navigation #${num} secondary link`
            );
            if (!phish.valid && phish.error) {
              issues.push({ path: `${prefix}.secondaryText`, message: phish.error });
            }
          }
        }
        break;
      }

      case "legal_section": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        (block.sections || []).forEach((sec, sIdx) => {
          checkVar(sec.heading, `${prefix}.sections[${sIdx}].heading`, `Legal section #${sIdx + 1} heading`);
          checkVar(sec.body, `${prefix}.sections[${sIdx}].body`, `Legal section #${sIdx + 1} body`);
        });
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        checkVar(block.copyrightText, `${prefix}.copyrightText`, `Legal section #${num} copyright`);
        if (block.showFooterLogo && block.footerLogoUrl && block.footerLogoUrl.trim()) {
          const fl = validateEmailUrl(block.footerLogoUrl, { fieldName: `Legal section #${num} footer logo URL` });
          if (!fl.valid && fl.error) issues.push({ path: `${prefix}.footerLogoUrl`, message: fl.error });
          if (!block.footerLogoAlt || !block.footerLogoAlt.trim()) {
            issues.push({ path: `${prefix}.footerLogoAlt`, message: `Legal section #${num} requires alt text for its footer logo.` });
          } else {
            checkVar(block.footerLogoAlt, `${prefix}.footerLogoAlt`, `Legal section #${num} footer logo alt`);
          }
        }
        if (block.footerLogoLinkUrl && block.footerLogoLinkUrl.trim()) {
          const fll = validateEmailUrl(block.footerLogoLinkUrl, {
            allowVariableToken: true,
            fieldName: `Legal section #${num} footer logo link URL`,
          });
          if (!fll.valid && fll.error) issues.push({ path: `${prefix}.footerLogoLinkUrl`, message: fll.error });
        }
        break;
      }

      case "footer_contact":
      case "footer_authenticity":
      case "footer_legal": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        const label =
          block.type === "footer_contact"
            ? `Contact Us block #${num}`
            : block.type === "footer_authenticity"
              ? `Confirmation Authenticity block #${num}`
              : `Legal / Imprint block #${num}`;
        checkVar(block.heading, `${prefix}.heading`, `${label} heading`);
        checkVar(block.text, `${prefix}.text`, `${label} text`);
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        if (block.type === "footer_contact") {
          if (block.emailOverride && block.emailOverride.trim()) {
            const eo = block.emailOverride.trim();
            if (eo !== "{{hotel_email}}" && !isValidEmail(eo)) {
              issues.push({ path: `${prefix}.emailOverride`, message: `${label} email override must be a valid email address.` });
            }
          }
          if (block.phoneOverride && block.phoneOverride.trim()) {
            const po = block.phoneOverride.trim();
            if (po !== "{{hotel_phone}}") {
              const tc = validateEmailUrl(`tel:${po}`, {
                allowContactSchemes: true,
                fieldName: `${label} phone override`,
              });
              if (!tc.valid && tc.error) issues.push({ path: `${prefix}.phoneOverride`, message: tc.error });
            }
          }
          if (block.linkColor && !isValidHexColor(block.linkColor)) {
            issues.push({ path: `${prefix}.linkColor`, message: `${label} link color must be a valid hex color.` });
          }
        }
        break;
      }

      case "footer_copyright": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.text, `${prefix}.text`, `Copyright block #${num} text`);
        validateInlineLinksList(block.inlineLinks, prefix, num, issues);
        if (block.footerLogoUrl && block.footerLogoUrl.trim()) {
          const fl = validateEmailUrl(block.footerLogoUrl, {
            fieldName: `Copyright block #${num} footer logo URL`,
          });
          if (!fl.valid && fl.error) issues.push({ path: `${prefix}.footerLogoUrl`, message: fl.error });
        }
        if (block.showFooterLogo && block.footerLogoUrl && block.footerLogoUrl.trim()) {
          if (!block.footerLogoAlt || !block.footerLogoAlt.trim()) {
            issues.push({
              path: `${prefix}.footerLogoAlt`,
              message: `Copyright block #${num} requires alt text for its footer logo.`,
            });
          } else {
            checkVar(block.footerLogoAlt, `${prefix}.footerLogoAlt`, `Copyright block #${num} footer logo alt`);
          }
        }
        if (block.footerLogoLinkUrl && block.footerLogoLinkUrl.trim()) {
          const fll = validateEmailUrl(block.footerLogoLinkUrl, {
            allowVariableToken: true,
            fieldName: `Copyright block #${num} footer logo link URL`,
          });
          if (!fll.valid && fll.error) issues.push({ path: `${prefix}.footerLogoLinkUrl`, message: fll.error });
        }
        break;
      }

      case "footer_powered_by": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        checkVar(block.text, `${prefix}.text`, `Powered by block #${num} text`);
        checkVar(block.linkLabel, `${prefix}.linkLabel`, `Powered by block #${num} link label`);
        if (block.linkUrl && block.linkUrl.trim()) {
          const lc = validateEmailUrl(block.linkUrl, {
            allowVariableToken: true,
            fieldName: `Powered by block #${num} link URL`,
          });
          if (!lc.valid && lc.error) issues.push({ path: `${prefix}.linkUrl`, message: lc.error });
          if (lc.valid && lc.normalized && block.linkLabel) {
            const phish = validateLinkLabelAgainstUrl(
              block.linkLabel,
              lc.normalized,
              `Powered by block #${num} link`
            );
            if (!phish.valid && phish.error) {
              issues.push({ path: `${prefix}.linkLabel`, message: phish.error });
            }
          }
        }
        if (block.linkColor && !isValidHexColor(block.linkColor)) {
          issues.push({ path: `${prefix}.linkColor`, message: `Powered by block #${num} link color must be a valid hex color.` });
        }
        break;
      }

      default:
        break;
    }
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

  if (settings.defaultFooterBlocks && typeof settings.defaultFooterBlocks === "object") {
    for (const lang of ["en", "de"] as const) {
      const blocks = settings.defaultFooterBlocks[lang];
      if (blocks === undefined) continue;
      if (!Array.isArray(blocks)) {
        issues.push({
          path: `defaultFooterBlocks.${lang}`,
          message: `Default footer (${lang.toUpperCase()}) must be a list of blocks.`,
        });
        continue;
      }
      if (blocks.length > 12) {
        issues.push({
          path: `defaultFooterBlocks.${lang}`,
          message: `Default footer (${lang.toUpperCase()}) cannot exceed 12 blocks.`,
        });
      }
      blocks.forEach((blk, idx) => {
        validateEmailBlock(
          blk,
          idx,
          `defaultFooterBlocks.${lang}[${idx}]`,
          ALLOWED_DEFAULT_FOOTER_TYPE_SET,
          issues
        );
      });
    }
  }

  if (settings.defaultLinks && typeof settings.defaultLinks === "object") {
    const linkLabels: Record<keyof HotelDefaultLinks, string> = {
      website: "Hotel Website URL",
      booking: "Booking Page URL",
      portal: "Hotel Portal URL",
      review: "Guest Review Page URL",
      directions: "Directions URL",
      wifiGuide: "Wi-Fi / Guest Guide URL",
      socialInstagram: "Instagram URL",
      socialFacebook: "Facebook URL",
      socialX: "X (Twitter) URL",
      socialLinkedin: "LinkedIn URL",
    };
    for (const [key, label] of Object.entries(linkLabels) as Array<[keyof HotelDefaultLinks, string]>) {
      const entry = settings.defaultLinks[key];
      if (!entry || typeof entry !== "object") continue;
      if (entry.defaultUrl && entry.defaultUrl.trim()) {
        const res = validateEmailUrl(entry.defaultUrl, { allowEmpty: true, fieldName: label });
        if (!res.valid && res.error) {
          issues.push({ path: `defaultLinks.${key}.defaultUrl`, message: res.error });
        }
      }
      if (entry.byLanguage && typeof entry.byLanguage === "object") {
        for (const lang of ["en", "de"] as const) {
          const langUrl = entry.byLanguage[lang];
          if (langUrl && langUrl.trim()) {
            const res = validateEmailUrl(langUrl, {
              allowEmpty: true,
              fieldName: `${label} (${lang.toUpperCase()})`,
            });
            if (!res.valid && res.error) {
              issues.push({ path: `defaultLinks.${key}.byLanguage.${lang}`, message: res.error });
            }
          }
        }
      }
    }
  }

  if (settings.defaultFooterNavLinks && typeof settings.defaultFooterNavLinks === "object") {
    for (const lang of ["en", "de"] as const) {
      const links = settings.defaultFooterNavLinks[lang];
      if (links === undefined) continue;
      if (!Array.isArray(links)) {
        issues.push({
          path: `defaultFooterNavLinks.${lang}`,
          message: `Default footer links (${lang.toUpperCase()}) must be a list.`,
        });
        continue;
      }
      if (links.length > 12) {
        issues.push({
          path: `defaultFooterNavLinks.${lang}`,
          message: `Default footer links (${lang.toUpperCase()}) cannot exceed 12 items.`,
        });
      }
      links.forEach((item: FooterNavLinkItem, idx: number) => {
        const lp = `defaultFooterNavLinks.${lang}[${idx}]`;
        if (!item?.label || !item.label.trim()) {
          issues.push({ path: `${lp}.label`, message: `Default footer link #${idx + 1} requires a label.` });
        } else {
          const lv = validateTemplateVariables(item.label, `Default footer link #${idx + 1} label`);
          if (!lv.valid && lv.error) issues.push({ path: `${lp}.label`, message: lv.error });
        }
        const uc = validateEmailUrl(item?.url, {
          allowEmpty: item?.hidden === true,
          allowVariableToken: true,
          allowContactSchemes: true,
          fieldName: `Default footer link "${item?.label || idx + 1}" URL`,
        });
        if (!uc.valid && uc.error) issues.push({ path: `${lp}.url`, message: uc.error });
        if (uc.valid && uc.normalized && item?.label) {
          const phish = validateLinkLabelAgainstUrl(
            item.label,
            uc.normalized,
            `Default footer link "${item.label}"`
          );
          if (!phish.valid && phish.error) issues.push({ path: `${lp}.label`, message: phish.error });
        }
      });
    }
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

export function resolveLocalizedLink(
  linkVal: LocalizedLinkValue | undefined,
  guestLang: SupportedEmailLanguage = "en",
  hotelDefaultLang: SupportedEmailLanguage = "en"
): string {
  if (!linkVal || typeof linkVal !== "object") return "";
  const candidates = [
    linkVal.byLanguage?.[guestLang],
    linkVal.defaultUrl,
    linkVal.byLanguage?.[hotelDefaultLang],
  ];
  for (const cand of candidates) {
    if (cand && cand.trim()) {
      const res = validateEmailUrl(cand.trim());
      if (res.valid && res.normalized) return res.normalized;
    }
  }
  return "";
}

/**
 * Builds the complete allow-listed variable map + boolean condition flags from context and settings.
 * Missing values become "" (never "undefined").
 */
export function buildTemplateVariablesMap(
  ctx: EmailRenderContext,
  settings: HotelEmailSettings = DEFAULT_HOTEL_EMAIL_SETTINGS,
  portalUrlOverride?: string,
  language: SupportedEmailLanguage = "en"
): {
  variables: Record<AllowedTemplateVariable, string>;
  conditions: {
    has_loyalty: boolean;
    has_balance_due: boolean;
    has_deposit: boolean;
  };
} {
  const cleanAppUrl = String(ctx.appUrl || "").trim().replace(/\/+$/, "");
  const hotelDefaultLang: SupportedEmailLanguage = settings.defaultLanguage || "en";

  const resolveSafeLink = (candidate?: string): string => {
    if (!candidate || !candidate.trim()) return "";
    const res = validateEmailUrl(candidate.trim());
    return res.valid && res.normalized ? res.normalized : "";
  };

  const isSameOriginAsPmsApp = (url: string): boolean => {
    if (!url || !cleanAppUrl) return false;
    try {
      return new URL(url).origin.toLowerCase() === new URL(cleanAppUrl).origin.toLowerCase();
    } catch {
      return url.replace(/\/+$/, "").toLowerCase() === cleanAppUrl.toLowerCase();
    }
  };

  const dl = settings.defaultLinks;

  // NEVER auto-fallback guest links (portal_link, hotel_website, booking_link) to the PMS application URL.
  // Links only appear when explicitly configured by the hotel (and not pointing to the internal PMS origin).
  const rawPortalCandidate =
    resolveSafeLink(portalUrlOverride) ||
    resolveLocalizedLink(dl?.portal, language, hotelDefaultLang) ||
    resolveSafeLink(settings.portalUrl);
  const portalLink =
    rawPortalCandidate && (!isSameOriginAsPmsApp(rawPortalCandidate) || Boolean(portalUrlOverride))
      ? rawPortalCandidate
      : "";

  const rawWebsiteCandidate =
    resolveLocalizedLink(dl?.website, language, hotelDefaultLang) ||
    resolveSafeLink(settings.contactOverrides?.website) ||
    resolveSafeLink(ctx.hotelWebsite);
  const hotelWebsite =
    rawWebsiteCandidate && !isSameOriginAsPmsApp(rawWebsiteCandidate) ? rawWebsiteCandidate : "";

  const rawBookingCandidate =
    resolveLocalizedLink(dl?.booking, language, hotelDefaultLang) ||
    resolveSafeLink(settings.bookingUrl);
  const bookingLink =
    rawBookingCandidate && !isSameOriginAsPmsApp(rawBookingCandidate) ? rawBookingCandidate : "";

  // Legitimate security action link (e.g., password reset / staff activation) — allowed even on PMS origin
  const actionLink = resolveSafeLink(ctx.actionLink);

  // Optional hotel links: resolve to "" when not configured (never fall back to portal_link or "undefined")
  const reviewLink = resolveLocalizedLink(dl?.review, language, hotelDefaultLang);
  const directionsLink = resolveLocalizedLink(dl?.directions, language, hotelDefaultLang);
  const wifiGuideLink = resolveLocalizedLink(dl?.wifiGuide, language, hotelDefaultLang);
  const socialInstagram = resolveLocalizedLink(dl?.socialInstagram, language, hotelDefaultLang);
  const socialFacebook = resolveLocalizedLink(dl?.socialFacebook, language, hotelDefaultLang);
  const socialX = resolveLocalizedLink(dl?.socialX, language, hotelDefaultLang);
  const socialLinkedin = resolveLocalizedLink(dl?.socialLinkedin, language, hotelDefaultLang);

  const guestName = String(ctx.guestName || "").trim();
  const guestFirstName = guestName ? guestName.split(/\s+/)[0] : "";

  const hotelPhone = String(settings.contactOverrides?.phone || ctx.hotelPhone || "").trim();
  const hotelAddress = String(settings.contactOverrides?.address || ctx.hotelAddress || "").trim();
  const hotelEmail = String(settings.contactOverrides?.email || ctx.hotelEmail || "").trim();

  const checkInDate = formatEmailDate(ctx.checkInDate, settings.dateFormat, settings.timeZone, language);
  const checkInTime = formatEmailTime(ctx.checkInTime, settings.timeFormat);
  const checkOutDate = formatEmailDate(ctx.checkOutDate, settings.dateFormat, settings.timeZone, language);
  const checkOutTime = formatEmailTime(ctx.checkOutTime, settings.timeFormat);
  const transactionDate = formatEmailDate(
    ctx.transactionDate,
    settings.dateFormat,
    settings.timeZone,
    language
  );
  const expiryDate = formatEmailDate(
    ctx.expiryDate || undefined,
    settings.dateFormat,
    settings.timeZone,
    language
  );

  const fmtMoney = (val: number | undefined | null, allowZero = false): string => {
    if (val === undefined || val === null || !Number.isFinite(Number(val))) return "";
    const n = Number(val);
    if (!allowZero && n <= 0) return "";
    return formatEmailCurrency(Math.max(0, n), ctx.currencyCode, settings.currencyDisplay);
  };

  const originalAmountVal =
    ctx.originalAmount !== undefined && ctx.originalAmount !== null
      ? ctx.originalAmount
      : ctx.totalAmount;
  const totalAmount = fmtMoney(ctx.totalAmount);
  const originalAmount = fmtMoney(originalAmountVal);
  const discountAmount = fmtMoney(ctx.discountAmount);
  const amountPaidVal =
    ctx.amountPaid !== undefined && ctx.amountPaid !== null ? ctx.amountPaid : ctx.depositAmount;
  const amountPaid = fmtMoney(amountPaidVal, ctx.amountPaid === 0);
  const depositAmount = fmtMoney(ctx.depositAmount);
  const depositBalance = fmtMoney(ctx.depositBalance, true);
  const refundAmount = fmtMoney(ctx.refundAmount);
  const balanceDue = fmtMoney(ctx.balanceDue, true);

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
  const hasFormattedPts =
    typeof ctx.loyaltyPointsFormatted === "string" && ctx.loyaltyPointsFormatted.trim().length > 0;
  const hasLoyalty = hasEarned || hasBalance || hasTier || hasFormattedPts;

  const legalImprint = stripDangerousMarkup(settings.legalImprint || "").trim();
  const bookingRef = String(ctx.bookingReference || "").trim();
  const roomNameStr = String(ctx.roomName || "").trim();
  const roomNumberStr =
    String(ctx.roomNumber || "").trim() || roomNameStr.replace(/^Room\s+/i, "").trim();

  const variables: Record<AllowedTemplateVariable, string> = {
    guest_name: guestName,
    guest_first_name: guestFirstName,
    hotel_name: String(ctx.hotelName || "Hotel Property").trim(),
    hotel_phone: hotelPhone,
    hotel_address: hotelAddress,
    hotel_email: hotelEmail,
    hotel_website: hotelWebsite,
    legal_imprint: legalImprint,
    room_name: roomNameStr,
    room_number: roomNumberStr,
    room_type: String(ctx.roomType || "").trim(),
    check_in_date: checkInDate,
    check_in_time: checkInTime,
    check_out_date: checkOutDate,
    check_out_time: checkOutTime,
    nights: ctx.nights !== undefined && ctx.nights !== null && Number(ctx.nights) > 0 ? String(ctx.nights) : "",
    booking_reference: bookingRef,
    reservation_number: bookingRef,
    total_amount: totalAmount,
    original_amount: originalAmount,
    discount_amount: discountAmount,
    amount_paid: amountPaid,
    deposit_amount: depositAmount,
    deposit_balance: depositBalance,
    refund_amount: refundAmount,
    balance_due: balanceDue,
    remaining_balance: balanceDue,
    payment_status: String(ctx.paymentStatus || "").trim(),
    payment_method: String(ctx.paymentMethod || "").trim(),
    transaction_reference: String(ctx.transactionReference || "").trim(),
    transaction_date: transactionDate,
    loyalty_points: hasFormattedPts
      ? String(ctx.loyaltyPointsFormatted).trim()
      : hasEarned
        ? String(ctx.loyaltyPointsEarned)
        : "",
    loyalty_points_earned: hasEarned ? String(ctx.loyaltyPointsEarned) : "",
    loyalty_points_balance: hasBalance ? String(ctx.loyaltyPointsBalance) : "",
    points_balance: hasBalance ? `${Number(ctx.loyaltyPointsBalance).toLocaleString("en-US")} pts` : "",
    loyalty_tier: hasTier ? String(ctx.loyaltyTier).trim() : "",
    previous_tier: typeof ctx.previousTier === "string" ? ctx.previousTier.trim() : "",
    redemption_value:
      typeof ctx.redemptionValueFormatted === "string" ? ctx.redemptionValueFormatted.trim() : "",
    expiry_date: expiryDate,
    reason: String(ctx.reason || "").trim(),
    staff_name: String(ctx.staffName || "").trim(),
    staff_status: String(ctx.staffStatus || "").trim(),
    corporate_name: String(ctx.corporateName || "").trim(),
    outlet_name: String(ctx.outletName || "").trim(),
    bill_number: String(ctx.billNumber || "").trim(),
    issue_summary: String(ctx.issueSummary || "").trim(),
    priority: String(ctx.priority || "").trim(),
    action_link: actionLink,
    booking_link: bookingLink,
    portal_link: portalLink,
    app_url: cleanAppUrl,
    review_link: reviewLink,
    directions_link: directionsLink,
    wifi_guide_link: wifiGuideLink,
    social_instagram: socialInstagram,
    social_facebook: socialFacebook,
    social_x: socialX,
    social_linkedin: socialLinkedin,
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

/**
 * Pure helper that extracts EVERY link from a template variant (branding + all blocks)
 * with its resolved final URL and validation status for the editor's Links Overview panel.
 */
export function extractTemplateLinksOverview(
  variant: EmailTemplateVariant,
  context: EmailRenderContext,
  settings: HotelEmailSettings = DEFAULT_HOTEL_EMAIL_SETTINGS,
  language: SupportedEmailLanguage = "en"
): TemplateLinkOverviewItem[] {
  const { variables } = buildTemplateVariablesMap(
    context,
    settings,
    variant.portalUrlOverride,
    language
  );

  const sub = (t?: string) =>
    String(t || "").replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_m, key: string) => {
      const v = (variables as Record<string, string | undefined>)[key];
      return typeof v === "string" ? v : "";
    });

  const items: TemplateLinkOverviewItem[] = [];
  let seq = 0;

  const pushLink = (params: {
    blockId: string;
    blockIndex: number;
    blockLabel: string;
    location: string;
    text: string;
    rawUrl: string;
    hidden: boolean;
    allowContactSchemes: boolean;
  }) => {
    seq += 1;
    const raw = (params.rawUrl || "").trim();
    const text = sub(params.text).trim() || params.location;
    const isVarToken =
      ALLOWED_URL_VARIABLES.has(raw) ||
      (params.allowContactSchemes && ALLOWED_CONTACT_URL_VARIABLES.has(raw));
    const resolvedRaw = sub(raw).trim();

    let status: "valid" | "empty_variable" | "invalid" = "valid";
    let resolvedUrl = "";
    let error: string | undefined;

    if (!raw) {
      status = "invalid";
      error = "No destination URL set.";
    } else if (isVarToken && (!resolvedRaw || resolvedRaw === "mailto:" || resolvedRaw === "tel:")) {
      status = "empty_variable";
      error = "Variable has no value in Email Settings (link will be hidden).";
    } else {
      const urlCheck = validateEmailUrl(resolvedRaw, {
        allowContactSchemes: params.allowContactSchemes,
      });
      if (!urlCheck.valid || !urlCheck.normalized) {
        status = "invalid";
        error = urlCheck.error || "Invalid link URL.";
      } else {
        resolvedUrl = urlCheck.normalized;
        const phish = validateLinkLabelAgainstUrl(text, resolvedUrl, params.location);
        if (!phish.valid) {
          status = "invalid";
          error = phish.error;
        }
      }
    }

    items.push({
      id: `lnk_${seq}`,
      blockId: params.blockId,
      blockIndex: params.blockIndex,
      blockLabel: params.blockLabel,
      location: params.location,
      text,
      rawUrl: raw,
      resolvedUrl,
      hidden: params.hidden,
      status,
      error,
    });
  };

  if (variant.branding?.showLogo && variant.branding?.logoLinkUrl?.trim()) {
    pushLink({
      blockId: "__branding__",
      blockIndex: -1,
      blockLabel: "Header Branding",
      location: "Header Logo Link",
      text: variant.branding.logoAlt || "Header Logo",
      rawUrl: variant.branding.logoLinkUrl,
      hidden: false,
      allowContactSchemes: false,
    });
  }

  const pushInline = (
    block: EmailBlock,
    idx: number,
    blockLabel: string,
    inlineLinks?: InlineTextLink[]
  ) => {
    (inlineLinks || []).forEach((il, i) => {
      pushLink({
        blockId: block.id,
        blockIndex: idx,
        blockLabel,
        location: `Inline link #${i + 1}`,
        text: il.label,
        rawUrl: il.url,
        hidden: Boolean(block.hidden || il.hidden),
        allowContactSchemes: true,
      });
    });
  };

  (variant.blocks || []).forEach((block, idx) => {
    if (!block) return;
    const bHidden = block.hidden === true;
    switch (block.type) {
      case "paragraph":
        pushInline(block, idx, "Paragraph", block.inlineLinks);
        break;
      case "two_column_text":
        pushInline(block, idx, "Two-Column Text", block.inlineLinks);
        break;
      case "image":
        if (block.linkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Image",
            location: "Image Click Link",
            text: block.alt || "Image",
            rawUrl: block.linkUrl,
            hidden: Boolean(bHidden || block.linkHidden),
            allowContactSchemes: false,
          });
        }
        break;
      case "button":
        pushLink({
          blockId: block.id,
          blockIndex: idx,
          blockLabel: block.displayStyle === "text_link" ? "Text Link" : "Button",
          location: block.displayStyle === "text_link" ? "Portal / Text Link" : "CTA Button",
          text: block.label,
          rawUrl: block.url,
          hidden: bHidden,
          allowContactSchemes: true,
        });
        break;
      case "social_links":
        (block.links || []).forEach((l, i) => {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Social Links",
            location: `Social #${i + 1}`,
            text: l.label,
            rawUrl: l.url,
            hidden: Boolean(bHidden || l.hidden),
            allowContactSchemes: false,
          });
        });
        break;
      case "footer":
        if (block.showContactBlock) {
          (block.fields || []).forEach((f) => {
            if (!f.visible || f.linkEnabled === false) return;
            const val = sub(f.valueTemplate).trim();
            if (f.key === "email" && val) {
              pushLink({
                blockId: block.id,
                blockIndex: idx,
                blockLabel: "Classic Footer",
                location: `Contact: ${f.label}`,
                text: val,
                rawUrl: `mailto:${val}`,
                hidden: bHidden,
                allowContactSchemes: true,
              });
            } else if (f.key === "phone" && val) {
              pushLink({
                blockId: block.id,
                blockIndex: idx,
                blockLabel: "Classic Footer",
                location: `Contact: ${f.label}`,
                text: val,
                rawUrl: `tel:${val}`,
                hidden: bHidden,
                allowContactSchemes: true,
              });
            } else if (f.key === "website" && f.valueTemplate.trim()) {
              pushLink({
                blockId: block.id,
                blockIndex: idx,
                blockLabel: "Classic Footer",
                location: `Contact: ${f.label}`,
                text: val || f.label,
                rawUrl: f.valueTemplate,
                hidden: bHidden,
                allowContactSchemes: false,
              });
            }
          });
        }
        break;
      case "brand_header":
        if (block.logoLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Brand Header",
            location: "Header Logo Link",
            text: block.logoAlt || "{{hotel_name}}",
            rawUrl: block.logoLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        if (block.showPhone && block.phoneLinkEnabled !== false) {
          const phoneVal = sub(block.phoneOverride || "{{hotel_phone}}").trim();
          if (phoneVal) {
            pushLink({
              blockId: block.id,
              blockIndex: idx,
              blockLabel: "Brand Header",
              location: "Header Phone (tel:)",
              text: phoneVal,
              rawUrl: `tel:${phoneVal}`,
              hidden: bHidden,
              allowContactSchemes: true,
            });
          }
        }
        if (block.showEmail && block.emailLinkEnabled !== false) {
          const emailVal = sub(block.emailOverride || "{{hotel_email}}").trim();
          if (emailVal) {
            pushLink({
              blockId: block.id,
              blockIndex: idx,
              blockLabel: "Brand Header",
              location: "Header Email (mailto:)",
              text: emailVal,
              rawUrl: `mailto:${emailVal}`,
              hidden: bHidden,
              allowContactSchemes: true,
            });
          }
        }
        break;
      case "promo_banner":
        if (block.imageLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Promo Banner",
            location: "Banner Image Link",
            text: block.imageAlt || "Banner Image",
            rawUrl: block.imageLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Promo Banner",
            location: "Banner Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "membership_strip":
        if (block.linkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Membership Strip",
            location: "Strip Link",
            text: `${block.tierTemplate || ""} ${block.pointsTemplate || ""}`.trim() || "Membership",
            rawUrl: block.linkUrl,
            hidden: Boolean(bHidden || block.linkHidden),
            allowContactSchemes: false,
          });
        }
        break;
      case "hero_text":
        pushInline(block, idx, "Hero Text", block.inlineLinks);
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Hero Text",
            location: "Hero Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "stay_dates":
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Stay Dates",
            location: "Manage Stay Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "feature_card":
        if (block.imageLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Feature Card",
            location: "Card Image Link",
            text: block.imageAlt || block.title,
            rawUrl: block.imageLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        pushInline(block, idx, "Feature Card", block.inlineLinks);
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Feature Card",
            location: "Card Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "benefits_list":
        if (block.badgeImageLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Benefits List",
            location: "Badge Image Link",
            text: block.badgeImageAlt || "Badge",
            rawUrl: block.badgeImageLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        pushInline(block, idx, "Benefits List", block.inlineLinks);
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Benefits List",
            location: "Benefits Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "icon_link_grid":
        (block.items || []).forEach((it, i) => {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Icon Link Grid",
            location: `Icon Item #${i + 1}`,
            text: it.label,
            rawUrl: it.url,
            hidden: Boolean(bHidden || it.hidden),
            allowContactSchemes: true,
          });
        });
        break;
      case "image_with_list":
        if (block.imageLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Image + List",
            location: "Section Image Link",
            text: block.imageAlt || block.heading,
            rawUrl: block.imageLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        pushInline(block, idx, "Image + List", block.inlineLinks);
        if (block.buttonLabel?.trim() || block.buttonUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Image + List",
            location: "Section Button",
            text: block.buttonLabel || "Button",
            rawUrl: block.buttonUrl || "",
            hidden: Boolean(bHidden || block.buttonHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "footer_nav":
        (block.links || []).forEach((l, i) => {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Footer Navigation",
            location: `Nav Link #${i + 1}`,
            text: l.label,
            rawUrl: l.url,
            hidden: Boolean(bHidden || l.hidden),
            allowContactSchemes: true,
          });
        });
        if (block.secondaryLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Footer Navigation",
            location: "Secondary Link",
            text: block.secondaryText || "Secondary Link",
            rawUrl: block.secondaryLinkUrl,
            hidden: Boolean(bHidden || block.secondaryLinkHidden),
            allowContactSchemes: true,
          });
        }
        break;
      case "legal_section":
        pushInline(block, idx, "Legal Section", block.inlineLinks);
        if (block.footerLogoLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Legal Section",
            location: "Footer Logo Link",
            text: block.footerLogoAlt || "Footer Logo",
            rawUrl: block.footerLogoLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        break;
      case "footer_contact": {
        pushInline(block, idx, "Footer: Contact Us", block.inlineLinks);
        if (block.emailLinkEnabled === true) {
          const em = sub(block.emailOverride || "{{hotel_email}}").trim();
          if (em) {
            pushLink({
              blockId: block.id,
              blockIndex: idx,
              blockLabel: "Footer: Contact Us",
              location: "Contact Email (mailto:)",
              text: em,
              rawUrl: `mailto:${em}`,
              hidden: bHidden,
              allowContactSchemes: true,
            });
          }
        }
        if (block.phoneLinkEnabled === true) {
          const ph = sub(block.phoneOverride || "{{hotel_phone}}").trim();
          if (ph) {
            pushLink({
              blockId: block.id,
              blockIndex: idx,
              blockLabel: "Footer: Contact Us",
              location: "Contact Phone (tel:)",
              text: ph,
              rawUrl: `tel:${ph}`,
              hidden: bHidden,
              allowContactSchemes: true,
            });
          }
        }
        break;
      }
      case "footer_authenticity":
        pushInline(block, idx, "Footer: Authenticity", block.inlineLinks);
        break;
      case "footer_legal":
        pushInline(block, idx, "Footer: Legal / Notice", block.inlineLinks);
        break;
      case "footer_copyright":
        pushInline(block, idx, "Footer: Copyright", block.inlineLinks);
        if (block.footerLogoLinkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Footer: Copyright",
            location: "Footer Logo Link",
            text: block.footerLogoAlt || "Footer Logo",
            rawUrl: block.footerLogoLinkUrl,
            hidden: bHidden,
            allowContactSchemes: false,
          });
        }
        break;
      case "footer_powered_by":
        if (block.linkUrl?.trim()) {
          pushLink({
            blockId: block.id,
            blockIndex: idx,
            blockLabel: "Footer: Credit",
            location: "Credit Link",
            text: block.linkLabel || block.text || "Credit Link",
            rawUrl: block.linkUrl,
            hidden: Boolean(bHidden || block.linkHidden),
            allowContactSchemes: false,
          });
        }
        break;
      default:
        break;
    }
  });

  return items;
}
