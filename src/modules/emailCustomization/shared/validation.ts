import {
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
  type HotelEmailSettings,
  type WebSafeFontId,
} from "./types.ts";

const ALLOWED_VAR_SET = new Set<string>(ALLOWED_TEMPLATE_VARIABLES);
const WEB_SAFE_FONT_SET = new Set<string>(WEB_SAFE_FONTS.map((f) => f.id));
const EMAIL_ICON_SET = new Set<string>(EMAIL_ICON_NAMES);
const EMAIL_ICON_TONE_SET = new Set<string>(EMAIL_ICON_TONES);
const BUTTON_STYLE_SET = new Set<string>(["filled", "outlined", "dark"]);
const BUTTON_CORNER_SET = new Set<string>(["square", "rounded", "pill"]);
const ALIGN_SET = new Set<string>(["left", "center", "right"]);
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
}

function validateModernButtonProps(
  block: {
    buttonLabel?: string;
    buttonUrl?: string;
    buttonStyle?: string;
    buttonCorner?: string;
    buttonBgColor?: string;
    buttonTextColor?: string;
  },
  prefix: string,
  blockNumber: number,
  required: boolean,
  issues: ValidationIssue[]
): void {
  const hasLabel = Boolean(block.buttonLabel && block.buttonLabel.trim());
  const hasUrl = Boolean(block.buttonUrl && block.buttonUrl.trim());

  if (required && !hasLabel) {
    issues.push({
      path: `${prefix}.buttonLabel`,
      message: `Block #${blockNumber} requires button label text.`,
    });
  } else if (hasLabel) {
    const lv = validateTemplateVariables(block.buttonLabel!, `Block #${blockNumber} button label`);
    if (!lv.valid && lv.error) issues.push({ path: `${prefix}.buttonLabel`, message: lv.error });
  }

  if (required || hasLabel || hasUrl) {
    const uc = validateEmailUrl(block.buttonUrl, {
      allowEmpty: !required && !hasLabel,
      allowVariableToken: true,
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
}

export function validateTemplateVariant(variant: EmailTemplateVariant): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!variant || typeof variant !== "object") {
    return [{ path: "variant", message: "Template data is missing." }];
  }

  if (variant.schemaVersion !== undefined && variant.schemaVersion !== 1 && variant.schemaVersion !== 2) {
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
  ]);

  const checkVar = (text: string | undefined, path: string, label: string) => {
    if (!text) return;
    const res = validateTemplateVariables(text, label);
    if (!res.valid && res.error) issues.push({ path, message: res.error });
  };

  variant.blocks.forEach((block: EmailBlock, idx: number) => {
    const prefix = `blocks[${idx}]`;
    const num = idx + 1;
    if (!block || !allowedBlockTypes.has(block.type)) {
      issues.push({
        path: prefix,
        message: `Block #${num} uses an unsupported block type.`,
      });
      return;
    }

    switch (block.type) {
      case "heading": {
        checkVar(block.text, `${prefix}.text`, `Heading block #${num}`);
        if (block.color && !isValidHexColor(block.color)) {
          issues.push({ path: `${prefix}.color`, message: `Heading block #${num} color must be a valid hex color.` });
        }
        break;
      }
      case "paragraph": {
        checkVar(block.text, `${prefix}.text`, `Paragraph block #${num}`);
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
          fieldName: `Link/Button block #${num} URL`,
        });
        if (!uc.valid && uc.error) issues.push({ path: `${prefix}.url`, message: uc.error });
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
        checkVar(block.contactTitle, `${prefix}.contactTitle`, "Contact block title");
        (block.fields || []).forEach((f, fIdx) => {
          checkVar(f.label, `${prefix}.fields[${fIdx}].label`, `Contact field #${fIdx + 1} label`);
          checkVar(f.valueTemplate, `${prefix}.fields[${fIdx}].valueTemplate`, `Contact field #${fIdx + 1} value`);
        });
        checkVar(block.legalImprintText, `${prefix}.legalImprintText`, "Legal/Imprint text");
        checkVar(block.footerNote, `${prefix}.footerNote`, "Footer note");
        break;
      }

      // --- 13 New Modern Additive Block Validations ---
      case "brand_header": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
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
        break;
      }

      case "promo_banner": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
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
        const ic = validateEmailUrl(block.imageUrl, { fieldName: `Feature card #${num} image URL` });
        if (!ic.valid && ic.error) issues.push({ path: `${prefix}.imageUrl`, message: ic.error });
        if (!block.imageAlt || !block.imageAlt.trim()) {
          issues.push({ path: `${prefix}.imageAlt`, message: `Feature card #${num} requires image alt text.` });
        } else {
          checkVar(block.imageAlt, `${prefix}.imageAlt`, `Feature card #${num} image alt text`);
        }
        if (!block.title || !block.title.trim()) {
          issues.push({ path: `${prefix}.title`, message: `Feature card #${num} requires a title.` });
        } else {
          checkVar(block.title, `${prefix}.title`, `Feature card #${num} title`);
        }
        checkVar(block.body, `${prefix}.body`, `Feature card #${num} body`);
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
              allowVariableToken: true,
              fieldName: `Icon link "${it.label || iIdx + 1}" URL`,
            });
            if (!uc.valid && uc.error) issues.push({ path: `${prefix}.items[${iIdx}].url`, message: uc.error });
          });
        }
        break;
      }

      case "image_with_list": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        const ic = validateEmailUrl(block.imageUrl, { fieldName: `Image + List #${num} image URL` });
        if (!ic.valid && ic.error) issues.push({ path: `${prefix}.imageUrl`, message: ic.error });
        if (!block.imageAlt || !block.imageAlt.trim()) {
          issues.push({ path: `${prefix}.imageAlt`, message: `Image + List #${num} requires image alt text.` });
        } else {
          checkVar(block.imageAlt, `${prefix}.imageAlt`, `Image + List #${num} image alt text`);
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
              allowVariableToken: true,
              fieldName: `Footer link "${l.label || lIdx + 1}" URL`,
            });
            if (!uc.valid && uc.error) issues.push({ path: `${prefix}.links[${lIdx}].url`, message: uc.error });
          });
        }
        checkVar(block.secondaryText, `${prefix}.secondaryText`, `Footer navigation #${num} secondary text`);
        if (block.secondaryLinkUrl && block.secondaryLinkUrl.trim()) {
          const sc = validateEmailUrl(block.secondaryLinkUrl, {
            allowVariableToken: true,
            fieldName: `Footer navigation #${num} secondary URL`,
          });
          if (!sc.valid && sc.error) issues.push({ path: `${prefix}.secondaryLinkUrl`, message: sc.error });
        }
        break;
      }

      case "legal_section": {
        validateBlockStyleConfig(block.style, prefix, num, issues);
        (block.sections || []).forEach((sec, sIdx) => {
          checkVar(sec.heading, `${prefix}.sections[${sIdx}].heading`, `Legal section #${sIdx + 1} heading`);
          checkVar(sec.body, `${prefix}.sections[${sIdx}].body`, `Legal section #${sIdx + 1} body`);
        });
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
