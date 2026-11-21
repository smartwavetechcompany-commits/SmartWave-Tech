import {
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  MODERN_EMAIL_BLOCK_TYPES,
  type AllowedTemplateVariable,
  type BlockCondition,
  type BlockStyleConfig,
  type ButtonCornerStyle,
  type EmailBlock,
  type EmailIconName,
  type EmailIconTone,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type HotelEmailSettings,
  type InlineTextLink,
  type ModernButtonStyle,
  type RenderedEmailOutput,
  type SupportedEmailLanguage,
} from "./types.ts";
import {
  buildEmailIconUrl,
  normalizeAssetBaseUrl,
} from "./presets.ts";
import {
  buildTemplateVariablesMap,
  escapeHtml,
  isValidEmail,
  isValidEmailIconName,
  isValidEmailIconTone,
  resolveWebSafeFontCss,
  sanitizeHeaderText,
  sanitizeHexColor,
  stripDangerousMarkup,
  validateEmailUrl,
  validateLinkLabelAgainstUrl,
} from "./validation.ts";

const MODERN_BLOCK_SET = new Set<string>(MODERN_EMAIL_BLOCK_TYPES);

/**
 * Determines whether a variant uses the modern v2/v3/v4 responsive shell or must stay
 * byte-for-byte identical to the v1 classic email template renderer.
 */
export function isModernV2Variant(variant: EmailTemplateVariant): boolean {
  if (
    variant.schemaVersion === 2 ||
    variant.schemaVersion === 3 ||
    variant.schemaVersion === 4
  ) {
    return true;
  }
  return (variant.blocks || []).some((b) => b && MODERN_BLOCK_SET.has(b.type));
}

/**
 * Simple allow-list variable substitution with ZERO code execution or template logic.
 * Unknown or missing variables resolve to empty string, never "undefined".
 */
function substituteVariablesRaw(
  template: string,
  variables: Record<AllowedTemplateVariable, string>
): string {
  if (!template) return "";
  const cleaned = stripDangerousMarkup(template);
  const replaced = cleaned.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/g, (_match, key: string) => {
    const val = (variables as Record<string, string | undefined>)[key];
    return typeof val === "string" ? val : "";
  });
  // Clean up dangling empty parentheses like "2026-11-19 ()" when check_in_time is absent
  return replaced.replace(/\s*\(\s*\)/g, "").trim();
}

function shouldRenderCondition(
  condition: BlockCondition | undefined,
  conditions: { has_loyalty: boolean; has_balance_due: boolean; has_deposit: boolean }
): boolean {
  if (!condition || condition === "always") return true;
  if (condition === "has_loyalty") return conditions.has_loyalty;
  if (condition === "has_balance_due") return conditions.has_balance_due;
  if (condition === "has_deposit") return conditions.has_deposit;
  return true;
}

function isContactSchemeUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return lower.startsWith("mailto:") || lower.startsWith("tel:");
}

function buildLinkTargetAttrs(url: string, openInNewTab?: boolean): string {
  if (isContactSchemeUrl(url)) return "";
  if (openInNewTab === false) return "";
  return ' target="_blank" rel="noopener noreferrer"';
}

function resolveSafeUrlOnRender(
  rawUrl: string,
  variables: Record<AllowedTemplateVariable, string>,
  allowContactSchemes = false,
  visibleLabelForPhishingCheck?: string
): string {
  const substituted = substituteVariablesRaw(rawUrl, variables);
  if (!substituted) return "";
  const check = validateEmailUrl(substituted, { allowContactSchemes });
  if (!check.valid || !check.normalized) return "";
  if (visibleLabelForPhishingCheck) {
    const phish = validateLinkLabelAgainstUrl(visibleLabelForPhishingCheck, check.normalized);
    if (!phish.valid) return "";
  }
  return check.normalized;
}

function renderMultilineEscaped(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br />");
}

/**
 * Safely renders text containing structured inline link placeholders (`[[link:<id>]]`).
 * - Fast path when no inlineLinks exist guarantees exact byte-for-byte v1/v2/v3 output.
 * - Escapes ALL plain text and link labels (zero raw HTML).
 * - Omits hidden links or links whose variable resolves empty / unsafe (never empty `<a>` or "undefined").
 * - Plain text formats active inline links as "label (URL)".
 */
function renderTextWithInlineLinks(
  rawTemplate: string,
  inlineLinks: InlineTextLink[] | undefined,
  variables: Record<AllowedTemplateVariable, string>,
  defaultLinkColor: string
): { html: string; text: string } {
  if (!rawTemplate) return { html: "", text: "" };
  if (!inlineLinks || inlineLinks.length === 0) {
    const plain = substituteVariablesRaw(rawTemplate, variables);
    return { html: renderMultilineEscaped(plain), text: plain };
  }

  const linkMap = new Map<string, InlineTextLink>();
  for (const l of inlineLinks) {
    if (l && l.id) linkMap.set(l.id, l);
  }

  const tokenRe = /\[\[link:([a-zA-Z0-9_-]+)\]\]/g;
  const htmlChunks: string[] = [];
  const textChunks: string[] = [];
  let lastIdx = 0;
  let match: RegExpExecArray | null;

  const pushPlain = (segment: string) => {
    if (!segment) return;
    const cleaned = stripDangerousMarkup(segment).replace(
      /\{\{\s*([a-z0-9_]+)\s*\}\}/g,
      (_m, key: string) => {
        const val = (variables as Record<string, string | undefined>)[key];
        return typeof val === "string" ? val : "";
      }
    );
    htmlChunks.push(renderMultilineEscaped(cleaned));
    textChunks.push(cleaned);
  };

  while ((match = tokenRe.exec(rawTemplate)) !== null) {
    if (match.index > lastIdx) {
      pushPlain(rawTemplate.slice(lastIdx, match.index));
    }
    const id = match[1];
    const link = linkMap.get(id);
    if (link && link.hidden !== true) {
      const label = substituteVariablesRaw(link.label || "", variables);
      const safeUrl = label
        ? resolveSafeUrlOnRender(link.url || "", variables, true, label)
        : "";
      if (label && safeUrl) {
        const col = sanitizeHexColor(link.color, defaultLinkColor);
        const deco = link.underline === false ? "none" : "underline";
        const targetAttrs = buildLinkTargetAttrs(safeUrl, link.openInNewTab);
        htmlChunks.push(
          `<a href="${escapeHtml(safeUrl)}"${targetAttrs} style="color:${escapeHtml(col)};text-decoration:${deco};">${escapeHtml(label)}</a>`
        );
        textChunks.push(`${label} (${safeUrl})`);
      }
    }
    lastIdx = match.index + match[0].length;
  }

  if (lastIdx < rawTemplate.length) {
    pushPlain(rawTemplate.slice(lastIdx));
  }

  const html = htmlChunks.join("").replace(/  +/g, " ").trim();
  const text = textChunks
    .join("")
    .replace(/\s*\(\s*\)/g, "")
    .replace(/  +/g, " ")
    .trim();
  return { html, text };
}

function clampInt(val: unknown, fallback: number, min: number, max: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function safeAlign(val: unknown, fallback: "left" | "center" | "right" = "left"): "left" | "center" | "right" {
  return val === "left" || val === "center" || val === "right" ? val : fallback;
}

function safeTone(val: unknown, fallback: EmailIconTone = "dark"): EmailIconTone {
  return isValidEmailIconTone(val) ? val : fallback;
}

function safeIcon(val: unknown, fallback: EmailIconName = "star"): EmailIconName {
  return isValidEmailIconName(val) ? val : fallback;
}

function renderDecorativeIconImg(
  appUrl: string,
  tone: EmailIconTone,
  icon: EmailIconName,
  sizePx: number,
  extraStyle = ""
): string {
  const src = buildEmailIconUrl(appUrl, tone, icon);
  return `<img src="${escapeHtml(src)}" alt="" width="${sizePx}" height="${sizePx}" style="display:inline-block;width:${sizePx}px;height:${sizePx}px;border:0;vertical-align:middle;${extraStyle}" />`;
}

/**
 * Bulletproof email CTA button with Outlook VML fallback and inline-styled table cell.
 * Supports filled (brand color), outlined, and dark button styles + square, rounded, and pill corners.
 */
function renderModernButton(options: {
  label: string;
  url: string;
  style?: ModernButtonStyle;
  corner?: ButtonCornerStyle;
  bgColor?: string;
  textColor?: string;
  borderColor?: string;
  openInNewTab?: boolean;
  defaultBrandColor: string;
  fontCss: string;
  align?: "left" | "center" | "right";
  compact?: boolean;
  fullWidthOnMobile?: boolean;
}): string {
  const {
    label,
    url,
    style = "filled",
    corner = "rounded",
    defaultBrandColor,
    fontCss,
    align = "left",
    compact = false,
  } = options;

  if (!label || !url) return "";

  const radiusPx = corner === "pill" ? 999 : corner === "square" ? 0 : 6;
  const arcsize = corner === "pill" ? "50%" : corner === "square" ? "0%" : "14%";
  const padV = compact ? 8 : 12;
  const padH = compact ? 18 : 26;
  const fontSize = compact ? 12 : 14;
  const approxHeight = compact ? 34 : 44;
  const approxWidth = Math.max(compact ? 110 : 156, Math.min(320, label.length * 9 + padH * 2));

  let fillBg: string;
  let borderColor: string;
  let fgColor: string;

  if (style === "outlined") {
    const stroke = sanitizeHexColor(options.borderColor || options.bgColor, "#18181b");
    fillBg = "transparent";
    borderColor = stroke;
    fgColor = sanitizeHexColor(options.textColor, stroke);
  } else if (style === "dark") {
    fillBg = sanitizeHexColor(options.bgColor, "#18181b");
    borderColor = sanitizeHexColor(options.borderColor, fillBg);
    fgColor = sanitizeHexColor(options.textColor, "#ffffff");
  } else {
    fillBg = sanitizeHexColor(options.bgColor, defaultBrandColor);
    borderColor = sanitizeHexColor(options.borderColor, fillBg);
    fgColor = sanitizeHexColor(options.textColor, "#ffffff");
  }

  const vmlFill =
    style === "outlined"
      ? `<v:fill opacity="0%" />`
      : `<v:fill color="${escapeHtml(fillBg)}" />`;

  const tableAlignAttr = align === "center" ? 'align="center"' : align === "right" ? 'align="right"' : 'align="left"';
  const marginCss = align === "center" ? "margin:0 auto;" : align === "right" ? "margin:0 0 0 auto;" : "margin:0;";
  const tdBgStyle = style === "outlined" ? "background-color:transparent;" : `background-color:${escapeHtml(fillBg)};`;
  const targetAttrs = buildLinkTargetAttrs(url, options.openInNewTab);

  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ${tableAlignAttr} style="border-collapse:separate;${marginCss}">
  <tr>
    <td align="center" valign="middle" style="${tdBgStyle}border:1px solid ${escapeHtml(borderColor)};border-radius:${radiusPx}px;mso-padding-alt:0;">
      <!--[if mso]>
      <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(url)}" style="height:${approxHeight}px;v-text-anchor:middle;width:${approxWidth}px;" arcsize="${arcsize}" strokecolor="${escapeHtml(borderColor)}" strokeweight="1px">
        ${vmlFill}
        <w:anchorlock/>
        <center style="color:${escapeHtml(fgColor)};font-family:${fontCss};font-size:${fontSize}px;font-weight:700;">${escapeHtml(label)}</center>
      </v:roundrect>
      <![endif]-->
      <!--[if !mso]><!-- -->
      <a href="${escapeHtml(url)}"${targetAttrs} style="display:inline-block;padding:${padV}px ${padH}px;font-family:${fontCss};font-size:${fontSize}px;line-height:1.25;font-weight:700;color:${escapeHtml(fgColor)};text-decoration:none;border-radius:${radiusPx}px;mso-hide:all;">${escapeHtml(label)}</a>
      <!--<![endif]-->
    </td>
  </tr>
</table>`;
}

/**
 * Pure, isomorphic email block renderer shared identically by both the server dispatcher
 * and the Hotel Admin live preview.
 *
 * - For legacy v1 / untouched default templates (`!isModernV2Variant(variant)`), emits the
 *   EXACT byte-for-byte v1 HTML & plain text so existing snapshots and default emails never change.
 * - For v2 templates (starter presets or any template using any of the 13 new visual blocks),
 *   emits a modern 620px responsive table-based layout with mobile stacking CSS, VML buttons,
 *   dark-mode safety, and full plain-text fallback.
 */
export function renderEmailTemplate(options: {
  variant: EmailTemplateVariant;
  context: EmailRenderContext;
  settings?: HotelEmailSettings;
  language?: SupportedEmailLanguage;
  usedDefaultLayout?: boolean;
}): RenderedEmailOutput {
  const settings = options.settings || DEFAULT_HOTEL_EMAIL_SETTINGS;
  const language: SupportedEmailLanguage = options.language || settings.defaultLanguage || "en";
  const { variant, context } = options;

  const { variables, conditions } = buildTemplateVariablesMap(
    context,
    settings,
    variant.portalUrlOverride,
    language
  );

  const branding = variant.branding;
  const primaryColor = sanitizeHexColor(
    branding.primaryColor || context.hotelPrimaryColor,
    "#059669"
  );
  const secondaryColor = sanitizeHexColor(
    branding.secondaryColor || context.hotelSecondaryColor,
    "#18181b"
  );
  const accentBarColor = sanitizeHexColor(branding.accentBarColor || primaryColor, primaryColor);
  const accentThickness = Math.max(1, Math.min(16, Number(branding.accentBarThicknessPx) || 5));
  const buttonColor = sanitizeHexColor(branding.buttonColor || primaryColor, primaryColor);
  const buttonTextColor = sanitizeHexColor(branding.buttonTextColor, "#ffffff");
  const fontCss = resolveWebSafeFontCss(branding.fontFamily);

  const subjectText = sanitizeHeaderText(
    substituteVariablesRaw(variant.subject, variables),
    `${variables.hotel_name} Notification`
  );
  const preheaderText = substituteVariablesRaw(variant.preheader || "", variables);

  const fromName = sanitizeHeaderText(
    settings.senderDisplayName || variables.hotel_name,
    "Hotel Notifications"
  );

  const replyToCandidate =
    (settings.replyToEmail && isValidEmail(settings.replyToEmail) ? settings.replyToEmail.trim() : "") ||
    (variables.hotel_email && isValidEmail(variables.hotel_email) ? variables.hotel_email : "");
  const replyTo = replyToCandidate || undefined;

  // Resolve header logo (strict https only)
  const rawLogoCandidate = branding.showLogo
    ? branding.logoUrl?.trim() || context.hotelLogoUrl?.trim() || ""
    : "";
  const safeLogoUrl = rawLogoCandidate
    ? resolveSafeUrlOnRender(rawLogoCandidate, variables, false)
    : "";
  const safeLogoLinkUrl = branding.logoLinkUrl
    ? resolveSafeUrlOnRender(branding.logoLinkUrl, variables, false)
    : "";
  const logoAlt =
    substituteVariablesRaw(branding.logoAlt || "{{hotel_name}}", variables) || variables.hotel_name;
  const logoWidth = Math.max(40, Math.min(260, Number(branding.logoWidthPx) || 160));

  const eyebrowText = branding.showEyebrow
    ? substituteVariablesRaw(branding.eyebrowText || "{{hotel_name}}", variables)
    : "";

  const modernMode = isModernV2Variant(variant);
  const assetBaseUrl = normalizeAssetBaseUrl(context.appUrl);

  // --- LEGACY V1 BYTE-FOR-BYTE PATH ---
  if (!modernMode) {
    const htmlParts: string[] = [];
    const textParts: string[] = [];

    if (eyebrowText) {
      textParts.push(eyebrowText);
    }

    for (const block of variant.blocks) {
      if (!block || block.hidden === true || !shouldRenderCondition(block.condition, conditions)) {
        continue;
      }

      const rendered = renderSingleBlock(block, {
        variables,
        primaryColor,
        secondaryColor,
        buttonColor,
        buttonTextColor,
        fontCss,
        appUrl: assetBaseUrl,
        hotelLogoUrl: context.hotelLogoUrl,
        hotelFooterNotes: context.hotelFooterNotes,
        settingsLegalImprint: settings.legalImprint,
        isPureV3: false,
        modernMode: false,
      });

      if (rendered.html) htmlParts.push(rendered.html);
      if (rendered.text) textParts.push(rendered.text);
    }

    const preheaderHtml = preheaderText
      ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheaderText)}</div>`
      : "";

    const accentRowHtml = branding.accentBarEnabled
      ? `<tr><td style="height:${accentThickness}px;line-height:${accentThickness}px;font-size:1px;background-color:${escapeHtml(accentBarColor)};">&nbsp;</td></tr>`
      : "";

    const logoImgTag = safeLogoUrl
      ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(logoAlt)}" style="display:block;width:auto;height:auto;max-width:${logoWidth}px;max-height:${logoWidth}px;object-fit:contain;border:0;background-color:transparent;" />`
      : "";
    const logoHtml = safeLogoUrl
      ? `<div style="margin:0 0 14px 0;">${
          safeLogoLinkUrl
            ? `<a href="${escapeHtml(safeLogoLinkUrl)}"${buildLinkTargetAttrs(safeLogoLinkUrl, branding.logoLinkOpenInNewTab)} style="text-decoration:none;border:0;">${logoImgTag}</a>`
            : logoImgTag
        }</div>`
      : "";

    const eyebrowHtml = eyebrowText
      ? `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.05em;color:${escapeHtml(primaryColor)};margin:0 0 6px 0;font-family:${fontCss};">${escapeHtml(eyebrowText)}</div>`
      : "";

    const html = `<!DOCTYPE html>
<html lang="${escapeHtml(language)}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(subjectText)}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${fontCss};color:#18181b;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;">
${preheaderHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;width:100%;margin:0;padding:24px 12px;">
  <tr>
    <td align="center" valign="top">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:8px;overflow:hidden;border-collapse:separate;">
        ${accentRowHtml}
        <tr>
          <td style="padding:28px;font-family:${fontCss};color:#18181b;">
            ${logoHtml}
            ${eyebrowHtml}
            ${htmlParts.join("\n            ")}
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;

    const text = textParts
      .map((p) => p.trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();

    return {
      subject: subjectText,
      preheader: preheaderText,
      html,
      text,
      fromName,
      replyTo,
      usedDefaultLayout: Boolean(options.usedDefaultLayout),
    };
  }

  // --- MODERN V2 / V3 / V4 RESPONSIVE LAYOUT PATH ---
  const isPureV3 = variant.schemaVersion === 3 || variant.schemaVersion === 4;
  const hasBrandHeader = variant.blocks.some(
    (b) =>
      b &&
      b.hidden !== true &&
      b.type === "brand_header" &&
      shouldRenderCondition(b.condition, conditions)
  );

  const rowParts: string[] = [];
  const textParts: string[] = [];

  if (!hasBrandHeader && (safeLogoUrl || eyebrowText)) {
    const legacyLogoImg = safeLogoUrl
      ? `<img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(logoAlt)}" style="display:block;width:auto;height:auto;max-width:${logoWidth}px;max-height:${logoWidth}px;object-fit:contain;border:0;background-color:transparent;" />`
      : "";
    const legacyLogoHtml = safeLogoUrl
      ? `<div style="margin:0 0 10px 0;">${
          safeLogoLinkUrl
            ? `<a href="${escapeHtml(safeLogoLinkUrl)}"${buildLinkTargetAttrs(safeLogoLinkUrl, branding.logoLinkOpenInNewTab)} style="text-decoration:none;border:0;">${legacyLogoImg}</a>`
            : legacyLogoImg
        }</div>`
      : "";
    const legacyEyebrowHtml = eyebrowText
      ? `<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;color:${escapeHtml(primaryColor)};font-family:${fontCss};">${escapeHtml(eyebrowText)}</div>`
      : "";
    rowParts.push(
      `<tr><td class="ec-pad-sm" style="padding:20px 28px 8px 28px;background-color:#ffffff;">${legacyLogoHtml}${legacyEyebrowHtml}</td></tr>`
    );
    if (eyebrowText) textParts.push(eyebrowText);
  }

  for (const block of variant.blocks) {
    if (!block || block.hidden === true || !shouldRenderCondition(block.condition, conditions)) {
      continue;
    }

    const rendered = renderSingleBlock(block, {
      variables,
      primaryColor,
      secondaryColor,
      buttonColor,
      buttonTextColor,
      fontCss,
      appUrl: assetBaseUrl,
      hotelLogoUrl: context.hotelLogoUrl,
      hotelFooterNotes: isPureV3 ? undefined : context.hotelFooterNotes,
      settingsLegalImprint: isPureV3 ? undefined : settings.legalImprint,
      isPureV3,
      modernMode: true,
    });

    if (rendered.html) {
      if (MODERN_BLOCK_SET.has(block.type)) {
        rowParts.push(rendered.html);
      } else {
        // Legacy blocks inside a v2/v3/v4 template get comfortable section padding
        rowParts.push(
          `<tr><td class="ec-pad-sm" style="padding:8px 28px;background-color:#ffffff;font-family:${fontCss};color:#18181b;">${rendered.html}</td></tr>`
        );
      }
    }
    if (rendered.text) textParts.push(rendered.text);
  }

  const preheaderHtml = preheaderText
    ? `<div style="display:none;font-size:1px;line-height:1px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;mso-hide:all;">${escapeHtml(preheaderText)}</div>`
    : "";

  const accentRowHtml = branding.accentBarEnabled
    ? `<tr><td style="height:${accentThickness}px;line-height:${accentThickness}px;font-size:1px;background-color:${escapeHtml(accentBarColor)};">&nbsp;</td></tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${escapeHtml(language)}" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light dark" />
<meta name="supported-color-schemes" content="light dark" />
<title>${escapeHtml(subjectText)}</title>
<!--[if mso]>
<noscript>
<xml>
<o:OfficeDocumentSettings>
  <o:AllowPNG/>
  <o:PixelsPerInch>96</o:PixelsPerInch>
</o:OfficeDocumentSettings>
</xml>
</noscript>
<![endif]-->
<style type="text/css">
  body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
  table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
  img { -ms-interpolation-mode: bicubic; border: 0; height: auto; line-height: 100%; outline: none; text-decoration: none; }
  @media only screen and (max-width: 600px) {
    .ec-container { width: 100% !important; max-width: 100% !important; }
    .ec-stack { display: block !important; width: 100% !important; max-width: 100% !important; box-sizing: border-box !important; }
    .ec-stack-img { width: auto !important; max-width: 100% !important; height: auto !important; }
    .ec-fluid-img { max-width: 100% !important; height: auto !important; }
    .ec-hide-sm { display: none !important; width: 0 !important; height: 0 !important; overflow: hidden !important; }
    .ec-center-sm { text-align: center !important; }
    .ec-pad-sm { padding-left: 18px !important; padding-right: 18px !important; }
    .ec-grid-cell { display: inline-block !important; width: 48% !important; padding-bottom: 14px !important; vertical-align: top !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:${fontCss};color:#18181b;">
${preheaderHtml}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f4f4f5;width:100%;margin:0;padding:18px 10px;">
  <tr>
    <td align="center" valign="top">
      <!--[if mso]>
      <table role="presentation" width="620" cellpadding="0" cellspacing="0" border="0" align="center"><tr><td>
      <![endif]-->
      <table role="presentation" class="ec-container" width="620" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:620px;background-color:#ffffff;border:1px solid #e4e4e7;border-collapse:collapse;">
        ${accentRowHtml}
        ${rowParts.join("\n        ")}
      </table>
      <!--[if mso]>
      </td></tr></table>
      <![endif]-->
    </td>
  </tr>
</table>
</body>
</html>`;

  const text = textParts
    .map((p) => p.trim())
    .filter(Boolean)
    .join("\n\n")
    .trim();

  return {
    subject: subjectText,
    preheader: preheaderText,
    html,
    text,
    fromName,
    replyTo,
    usedDefaultLayout: Boolean(options.usedDefaultLayout),
  };
}

interface BlockRenderCtx {
  variables: Record<AllowedTemplateVariable, string>;
  primaryColor: string;
  secondaryColor: string;
  buttonColor: string;
  buttonTextColor: string;
  fontCss: string;
  appUrl: string;
  hotelLogoUrl?: string;
  hotelFooterNotes?: string;
  settingsLegalImprint?: string;
  isPureV3?: boolean;
  modernMode?: boolean;
}

function getSectionPadding(style: BlockStyleConfig | undefined, defY: number, defX: number): string {
  const py = clampInt(style?.paddingY, defY, 0, 40);
  const px = clampInt(style?.paddingX, defX, 0, 40);
  return `${py}px ${px}px`;
}

function getBlockFontCss(style: BlockStyleConfig | undefined, defaultFontCss: string): string {
  return style?.fontFamily ? resolveWebSafeFontCss(style.fontFamily) : defaultFontCss;
}

function renderSingleBlock(
  block: EmailBlock,
  ctx: BlockRenderCtx
): { html: string; text: string } {
  const { variables, primaryColor, secondaryColor, buttonColor, buttonTextColor, fontCss, appUrl } = ctx;

  switch (block.type) {
    // --- 10 LEGACY BLOCKS (BYTE-FOR-BYTE PRESERVED) ---
    case "heading": {
      const content = substituteVariablesRaw(block.text, variables);
      if (!content) return { html: "", text: "" };
      const size = block.level === 1 ? "24px" : block.level === 3 ? "16px" : "20px";
      const color = sanitizeHexColor(block.color || secondaryColor, secondaryColor);
      const align = block.align || "left";
      const tag = block.level === 1 ? "h1" : block.level === 3 ? "h3" : "h2";
      return {
        html: `<${tag} style="margin:0 0 16px 0;font-size:${size};line-height:1.3;font-weight:700;color:${escapeHtml(color)};text-align:${align};font-family:${fontCss};">${escapeHtml(content)}</${tag}>`,
        text: content,
      };
    }

    case "paragraph": {
      const rendered = renderTextWithInlineLinks(
        block.text,
        block.inlineLinks,
        variables,
        primaryColor
      );
      if (!rendered.text && !rendered.html) return { html: "", text: "" };
      const align = block.align || "left";
      const color =
        block.tone === "muted"
          ? "#52525b"
          : block.tone === "accent"
            ? primaryColor
            : "#27272a";
      const fontSize = block.tone === "muted" ? "13px" : "14px";
      return {
        html: `<p style="margin:0 0 14px 0;font-size:${fontSize};line-height:1.6;color:${escapeHtml(color)};text-align:${align};font-family:${fontCss};">${rendered.html}</p>`,
        text: rendered.text,
      };
    }

    case "image": {
      const safeSrc = resolveSafeUrlOnRender(block.src, variables, false);
      if (!safeSrc) return { html: "", text: "" };
      const altText = substituteVariablesRaw(block.alt || "", variables) || variables.hotel_name;
      const width = Math.max(80, Math.min(544, Number(block.widthPx) || 544));
      const align = block.align || "center";
      const safeLink =
        block.linkUrl && block.linkHidden !== true
          ? resolveSafeUrlOnRender(block.linkUrl, variables, false)
          : "";
      const imgTag = `<img class="ec-fluid-img" src="${escapeHtml(safeSrc)}" alt="${escapeHtml(altText)}" style="display:block;width:auto;max-width:${width}px;height:auto;object-fit:contain;border:0;border-radius:6px;background-color:transparent;" />`;
      const wrapped = safeLink
        ? `<a href="${escapeHtml(safeLink)}"${buildLinkTargetAttrs(safeLink, block.linkOpenInNewTab)} style="text-decoration:none;border:0;">${imgTag}</a>`
        : imgTag;
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr><td align="${align}">${wrapped}</td></tr></table>`,
        text: safeLink ? `[Image: ${altText}] (${safeLink})` : `[Image: ${altText}]`,
      };
    }

    case "button": {
      const label = substituteVariablesRaw(block.label, variables);
      const safeUrl = label
        ? resolveSafeUrlOnRender(block.url, variables, true, label)
        : "";
      const prefix = substituteVariablesRaw(block.prefixText || "", variables);
      if (!safeUrl || !label) return { html: "", text: "" };
      const align = block.align || "left";
      const bg = sanitizeHexColor(block.bgColor || buttonColor, buttonColor);
      const fg = sanitizeHexColor(block.textColor || buttonTextColor, buttonTextColor);
      const borderCol = sanitizeHexColor(block.borderColor || bg, bg);
      const radiusPx =
        block.borderRadiusPx !== undefined
          ? clampInt(block.borderRadiusPx, 6, 0, 999)
          : 6;
      const targetAttrs = buildLinkTargetAttrs(safeUrl, block.openInNewTab);

      if (block.displayStyle === "text_link") {
        const prefixHtml = prefix ? `${escapeHtml(prefix)}: ` : "";
        const linkColor = block.textColor
          ? sanitizeHexColor(block.textColor, primaryColor)
          : primaryColor;
        const textDeco = block.underline === false ? "none" : "underline";
        const isUntouchedLegacy =
          !ctx.modernMode &&
          !block.textColor &&
          block.underline === undefined &&
          block.openInNewTab === undefined;
        return {
          html: `<p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;text-align:${align};font-family:${fontCss};color:#18181b;">${prefixHtml}<a href="${escapeHtml(safeUrl)}"${targetAttrs} style="color:${escapeHtml(linkColor)};text-decoration:${textDeco};word-break:break-all;">${escapeHtml(label)}</a></p>`,
          text: isUntouchedLegacy
            ? prefix
              ? `${prefix}: ${safeUrl}`
              : `${label}: ${safeUrl}`
            : prefix
              ? `${prefix}: ${label} (${safeUrl})`
              : `${label} (${safeUrl})`,
        };
      }

      const isOutline = block.displayStyle === "outline";
      const btnStyle = isOutline
        ? `display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:${escapeHtml(block.textColor ? fg : bg)};background-color:#ffffff;border:1px solid ${escapeHtml(borderCol)};border-radius:${radiusPx}px;text-decoration:none;font-family:${fontCss};`
        : `display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:${escapeHtml(fg)};background-color:${escapeHtml(bg)};border:1px solid ${escapeHtml(borderCol)};border-radius:${radiusPx}px;text-decoration:none;font-family:${fontCss};`;

      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0;"><tr><td align="${align}">${
          prefix
            ? `<div style="margin:0 0 8px 0;font-size:13px;color:#52525b;font-family:${fontCss};">${escapeHtml(prefix)}</div>`
            : ""
        }<a href="${escapeHtml(safeUrl)}"${targetAttrs} style="${btnStyle}">${escapeHtml(label)}</a></td></tr></table>`,
        text: ctx.modernMode
          ? prefix
            ? `${prefix}\n${label} (${safeUrl})`
            : `${label} (${safeUrl})`
          : prefix
            ? `${prefix}\n${label}: ${safeUrl}`
            : `${label}: ${safeUrl}`,
      };
    }

    case "divider": {
      const color = sanitizeHexColor(block.color, "#e4e4e7");
      const thickness = Math.max(1, Math.min(4, Number(block.thicknessPx) || 1));
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:18px 0;"><tr><td style="border-top:${thickness}px solid ${escapeHtml(color)};font-size:1px;line-height:1px;">&nbsp;</td></tr></table>`,
        text: "---",
      };
    }

    case "spacer": {
      const height = Math.max(4, Math.min(64, Number(block.heightPx) || 16));
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td style="height:${height}px;line-height:${height}px;font-size:1px;">&nbsp;</td></tr></table>`,
        text: "",
      };
    }

    case "booking_details_table": {
      const resolvedRows = (block.rows || [])
        .filter((r) => r && r.visible !== false)
        .map((r) => ({
          label: substituteVariablesRaw(r.label, variables),
          value: substituteVariablesRaw(r.valueTemplate, variables),
        }))
        .filter((r) => r.label.length > 0 && r.value.length > 0);

      if (resolvedRows.length === 0) return { html: "", text: "" };

      const title = substituteVariablesRaw(block.title || "", variables);
      const titleHtml = title
        ? `<div style="margin:16px 0 8px 0;font-size:13px;font-weight:700;color:${escapeHtml(secondaryColor)};font-family:${fontCss};">${escapeHtml(title)}</div>`
        : "";

      const trs = resolvedRows
        .map(
          (row, idx) =>
            `<tr><td style="padding:10px 12px;color:#71717a;width:40%;vertical-align:top;font-size:14px;font-family:${fontCss};${
              idx < resolvedRows.length - 1 ? "border-bottom:1px solid #e4e4e7;" : ""
            }">${escapeHtml(row.label)}</td><td style="padding:10px 12px;color:#18181b;font-weight:600;vertical-align:top;font-size:14px;font-family:${fontCss};${
              idx < resolvedRows.length - 1 ? "border-bottom:1px solid #e4e4e7;" : ""
            }">${escapeHtml(row.value)}</td></tr>`
        )
        .join("");

      const tableHtml = `${titleHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border-spacing:0;border:1px solid #e4e4e7;border-radius:6px;margin:14px 0 18px 0;">${trs}</table>`;
      const textLines = [
        ...(title ? [title] : []),
        ...resolvedRows.map((r) => `${r.label}: ${r.value}`),
      ];
      return { html: tableHtml, text: textLines.join("\n") };
    }

    case "two_column_text": {
      const leftTitle = substituteVariablesRaw(block.leftTitle || "", variables);
      const leftRendered = renderTextWithInlineLinks(
        block.leftText || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      const rightTitle = substituteVariablesRaw(block.rightTitle || "", variables);
      const rightRendered = renderTextWithInlineLinks(
        block.rightText || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      if (!leftRendered.text && !rightRendered.text && !leftTitle && !rightTitle) {
        return { html: "", text: "" };
      }

      const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border:1px solid #e4e4e7;border-radius:6px;background-color:#fafafa;">
        <tr>
          <td width="50%" valign="top" style="padding:14px;font-family:${fontCss};border-right:1px solid #e4e4e7;">
            ${leftTitle ? `<div style="font-size:12px;font-weight:700;color:${escapeHtml(secondaryColor)};margin:0 0 6px 0;">${escapeHtml(leftTitle)}</div>` : ""}
            <div style="font-size:13px;line-height:1.5;color:#27272a;">${leftRendered.html}</div>
          </td>
          <td width="50%" valign="top" style="padding:14px;font-family:${fontCss};">
            ${rightTitle ? `<div style="font-size:12px;font-weight:700;color:${escapeHtml(secondaryColor)};margin:0 0 6px 0;">${escapeHtml(rightTitle)}</div>` : ""}
            <div style="font-size:13px;line-height:1.5;color:#27272a;">${rightRendered.html}</div>
          </td>
        </tr>
      </table>`;
      const text = [
        [leftTitle, leftRendered.text].filter(Boolean).join(": "),
        [rightTitle, rightRendered.text].filter(Boolean).join(": "),
      ]
        .filter(Boolean)
        .join("\n");
      return { html, text };
    }

    case "social_links": {
      const safeLinks = (block.links || [])
        .filter((item) => item && item.hidden !== true)
        .map((item) => {
          const label = substituteVariablesRaw(item.label, variables);
          const url = label ? resolveSafeUrlOnRender(item.url, variables, false, label) : "";
          return {
            label,
            url,
            color: item.color ? sanitizeHexColor(item.color, primaryColor) : primaryColor,
            underline: item.underline === false ? "none" : "underline",
            openInNewTab: item.openInNewTab,
          };
        })
        .filter((item) => item.label && item.url);
      if (safeLinks.length === 0) return { html: "", text: "" };
      const align = block.align || "left";
      const title = substituteVariablesRaw(block.title || "", variables);
      const linksHtml = safeLinks
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}"${buildLinkTargetAttrs(l.url, l.openInNewTab)} style="color:${escapeHtml(l.color)};text-decoration:${l.underline};font-size:13px;font-weight:600;margin-right:14px;font-family:${fontCss};">${escapeHtml(l.label)}</a>`
        )
        .join("");
      return {
        html: `<div style="margin:18px 0 0 0;text-align:${align};font-family:${fontCss};">${
          title
            ? `<div style="font-size:12px;font-weight:700;color:#52525b;margin:0 0 6px 0;">${escapeHtml(title)}</div>`
            : ""
        }${linksHtml}</div>`,
        text: [
          ...(title ? [title] : []),
          ...safeLinks.map((l) => (ctx.modernMode ? `${l.label} (${l.url})` : `${l.label}: ${l.url}`)),
        ].join("\n"),
      };
    }

    case "footer": {
      const contactTitle = substituteVariablesRaw(block.contactTitle || "{{hotel_name}} Contact", variables);
      const visibleFields = (block.fields || [])
        .filter((f) => f && f.visible !== false)
        .map((f) => ({
          key: f.key,
          label: substituteVariablesRaw(f.label, variables),
          value: substituteVariablesRaw(f.valueTemplate, variables),
          linkEnabled: f.linkEnabled,
          linkColor: f.linkColor,
          underline: f.underline,
        }))
        .filter((f) => f.label && f.value);

      const contactLinesHtml: string[] = [];
      const contactLinesText: string[] = [];

      if (block.showContactBlock && visibleFields.length > 0) {
        for (const field of visibleFields) {
          let valueHtml = escapeHtml(field.value);
          let valueText = field.value;
          const allowLink = field.linkEnabled !== false;
          if (allowLink && field.key === "email" && isValidEmail(field.value)) {
            const col = field.linkColor ? sanitizeHexColor(field.linkColor, "#52525b") : "#52525b";
            const deco = field.underline === true ? "underline" : "none";
            valueHtml = `<a href="mailto:${escapeHtml(field.value)}" style="color:${escapeHtml(col)};text-decoration:${deco};">${escapeHtml(field.value)}</a>`;
            if (field.linkEnabled === true) {
              valueText = `${field.value} (mailto:${field.value})`;
            }
          } else if (allowLink && field.key === "phone") {
            // Preserve exact v1 snapshot parity when untouched (!modernMode && linkEnabled === undefined)
            const legacyV1Untouched = !ctx.modernMode && field.linkEnabled === undefined;
            if (!legacyV1Untouched || !/\s/.test(field.value)) {
              const telCheck = validateEmailUrl(`tel:${field.value}`, { allowContactSchemes: true });
              if (telCheck.valid && telCheck.normalized) {
                const col = field.linkColor ? sanitizeHexColor(field.linkColor, "#52525b") : "#52525b";
                const deco = field.underline === true ? "underline" : "none";
                valueHtml = `<a href="${escapeHtml(telCheck.normalized)}" style="color:${escapeHtml(col)};text-decoration:${deco};">${escapeHtml(field.value)}</a>`;
                if (field.linkEnabled === true) {
                  valueText = `${field.value} (${telCheck.normalized})`;
                }
              }
            }
          } else if (allowLink && field.key === "website") {
            const urlCheck = validateEmailUrl(field.value);
            if (urlCheck.valid && urlCheck.normalized) {
              const col = field.linkColor ? sanitizeHexColor(field.linkColor, primaryColor) : primaryColor;
              const deco = field.underline === false ? "none" : "underline";
              valueHtml = `<a href="${escapeHtml(urlCheck.normalized)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(col)};text-decoration:${deco};">${escapeHtml(field.value)}</a>`;
            }
          }
          contactLinesHtml.push(
            `<div style="margin:2px 0;">${escapeHtml(field.label)}: ${valueHtml}</div>`
          );
          contactLinesText.push(`${field.label}: ${valueText}`);
        }
      }

      const imprintText = substituteVariablesRaw(
        block.legalImprintText || ctx.settingsLegalImprint || "",
        variables
      );
      const footerNote = substituteVariablesRaw(
        block.footerNote || ctx.hotelFooterNotes || "",
        variables
      );

      if (contactLinesHtml.length === 0 && !imprintText && !footerNote) {
        return { html: "", text: "" };
      }

      const contactHtml =
        contactLinesHtml.length > 0
          ? `<div style="margin:22px 0 0 0;padding:16px 0 0 0;border-top:1px solid #e4e4e7;font-size:13px;color:#52525b;line-height:1.5;font-family:${fontCss};"><strong style="color:#18181b;display:block;margin-bottom:4px;">${escapeHtml(contactTitle)}</strong>${contactLinesHtml.join("")}</div>`
          : "";
      const footerNoteHtml = footerNote
        ? `<p style="margin:12px 0 0 0;font-size:12px;color:#71717a;line-height:1.5;font-family:${fontCss};">${renderMultilineEscaped(footerNote)}</p>`
        : "";
      const imprintHtml = imprintText
        ? `<p style="margin:10px 0 0 0;font-size:11px;color:#71717a;line-height:1.5;font-family:${fontCss};">${renderMultilineEscaped(imprintText)}</p>`
        : "";

      const textSections: string[] = [];
      if (contactLinesText.length > 0) {
        textSections.push([`${contactTitle}:`, ...contactLinesText].join("\n"));
      }
      if (footerNote) textSections.push(footerNote);
      if (imprintText) textSections.push(imprintText);

      return {
        html: `${contactHtml}${footerNoteHtml}${imprintHtml}`,
        text: textSections.join("\n\n"),
      };
    }

    // --- 13 NEW MODERN ADDITIVE BLOCKS ---
    case "brand_header": {
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const textCol = sanitizeHexColor(block.style?.textColor, "#18181b");
      const borderCol = sanitizeHexColor(block.style?.borderColor, "#e4e4e7");
      const pad = getSectionPadding(block.style, 18, 28);
      const tone = safeTone(block.iconTone, "dark");

      const logoCandidate = (block.logoUrl || ctx.hotelLogoUrl || "").trim();
      const safeLogo = logoCandidate ? resolveSafeUrlOnRender(logoCandidate, variables, false) : "";
      const safeLogoLink = block.logoLinkUrl
        ? resolveSafeUrlOnRender(block.logoLinkUrl, variables, false)
        : "";
      const logoW = clampInt(block.logoWidthPx, 130, 48, 220);
      const logoAlt =
        substituteVariablesRaw(block.logoAlt || "{{hotel_name}}", variables) || variables.hotel_name;

      const leftInner = safeLogo
        ? `<img src="${escapeHtml(safeLogo)}" alt="${escapeHtml(logoAlt)}" style="display:block;width:auto;height:auto;max-width:${logoW}px;max-height:${logoW}px;object-fit:contain;border:0;background-color:transparent;" />`
        : `<div style="font-size:18px;font-weight:700;letter-spacing:-0.01em;color:${escapeHtml(textCol)};font-family:${fontCss};">${escapeHtml(variables.hotel_name)}</div>`;
      const leftHtml = safeLogoLink
        ? `<a href="${escapeHtml(safeLogoLink)}"${buildLinkTargetAttrs(safeLogoLink, block.logoLinkOpenInNewTab)} style="text-decoration:none;border:0;color:inherit;">${leftInner}</a>`
        : leftInner;

      const rightRows: string[] = [];
      const textLines: string[] = [];
      if (block.showHotelName && safeLogo) {
        rightRows.push(
          `<div style="font-size:13px;font-weight:700;color:${escapeHtml(textCol)};margin:0 0 3px 0;font-family:${fontCss};">${escapeHtml(variables.hotel_name)}</div>`
        );
      }
      textLines.push(safeLogoLink ? `${variables.hotel_name} (${safeLogoLink})` : variables.hotel_name);

      if (block.showAddress && variables.hotel_address) {
        const pinImg = renderDecorativeIconImg(appUrl, tone, "location_pin", 13, "margin-right:5px;");
        rightRows.push(
          `<div style="font-size:11px;line-height:1.45;color:#52525b;margin:0 0 2px 0;font-family:${fontCss};">${pinImg}<span style="vertical-align:middle;">${escapeHtml(variables.hotel_address)}</span></div>`
        );
        textLines.push(variables.hotel_address);
      }

      const resolvedPhone = block.phoneOverride
        ? substituteVariablesRaw(block.phoneOverride, variables)
        : variables.hotel_phone;
      if (block.showPhone && resolvedPhone) {
        const phoneImg = renderDecorativeIconImg(appUrl, tone, "phone", 13, "margin-right:5px;");
        const phoneLinkEnabled = block.phoneLinkEnabled !== false;
        const telCheck = phoneLinkEnabled
          ? validateEmailUrl(`tel:${resolvedPhone}`, { allowContactSchemes: true })
          : { valid: false, normalized: "" };
        const phoneInner =
          telCheck.valid && telCheck.normalized
            ? `<a href="${escapeHtml(telCheck.normalized)}" style="color:#52525b;text-decoration:none;">${escapeHtml(resolvedPhone)}</a>`
            : escapeHtml(resolvedPhone);
        rightRows.push(
          `<div style="font-size:11px;line-height:1.45;color:#52525b;margin:0 0 2px 0;font-family:${fontCss};">${phoneImg}<span style="vertical-align:middle;">${phoneInner}</span></div>`
        );
        textLines.push(
          telCheck.valid && telCheck.normalized
            ? `${resolvedPhone} (${telCheck.normalized})`
            : resolvedPhone
        );
      }

      const resolvedEmail = block.emailOverride
        ? substituteVariablesRaw(block.emailOverride, variables)
        : variables.hotel_email;
      if (block.showEmail && resolvedEmail) {
        const emailLinkEnabled = block.emailLinkEnabled !== false;
        const mailCheck = emailLinkEnabled
          ? validateEmailUrl(`mailto:${resolvedEmail}`, { allowContactSchemes: true })
          : { valid: false, normalized: "" };
        const emailInner =
          mailCheck.valid && mailCheck.normalized
            ? `<a href="${escapeHtml(mailCheck.normalized)}" style="color:#52525b;text-decoration:none;">${escapeHtml(resolvedEmail)}</a>`
            : escapeHtml(resolvedEmail);
        rightRows.push(
          `<div style="font-size:11px;line-height:1.45;color:#52525b;margin:0;font-family:${fontCss};">${emailInner}</div>`
        );
        textLines.push(
          mailCheck.valid && mailCheck.normalized
            ? `${resolvedEmail} (${mailCheck.normalized})`
            : resolvedEmail
        );
      }

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};border-bottom:1px solid ${escapeHtml(borderCol)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="ec-stack ec-center-sm" width="42%" valign="middle" align="left" style="padding:4px 8px 4px 0;">
          ${leftHtml}
        </td>
        <td class="ec-stack ec-center-sm" width="58%" valign="middle" align="right" style="padding:4px 0 4px 8px;">
          ${rightRows.join("")}
        </td>
      </tr>
    </table>
  </td>
</tr>`;
      return { html, text: textLines.filter(Boolean).join(" | ") };
    }

    case "promo_banner": {
      const text = substituteVariablesRaw(block.text, variables);
      const btnLabel = block.buttonHidden ? "" : substituteVariablesRaw(block.buttonLabel, variables);
      const btnUrl =
        btnLabel && !block.buttonHidden
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      if (!text && !btnLabel) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#18181b");
      const fg = sanitizeHexColor(block.style?.textColor, "#ffffff");
      const pad = getSectionPadding(block.style, 14, 24);
      const safeImg = block.imageUrl ? resolveSafeUrlOnRender(block.imageUrl, variables, false) : "";
      const safeImgLink = block.imageLinkUrl
        ? resolveSafeUrlOnRender(block.imageLinkUrl, variables, false)
        : "";
      const imgAlt = substituteVariablesRaw(block.imageAlt || "", variables) || variables.hotel_name;

      const imgTag = safeImg
        ? `<img src="${escapeHtml(safeImg)}" alt="${escapeHtml(imgAlt)}" style="display:block;width:auto;height:auto;max-width:64px;max-height:64px;object-fit:contain;border-radius:6px;border:0;background-color:transparent;" />`
        : "";
      const imgCell = safeImg
        ? `<td class="ec-hide-sm" width="56" valign="middle" style="padding-right:14px;">
            ${
              safeImgLink
                ? `<a href="${escapeHtml(safeImgLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">${imgTag}</a>`
                : imgTag
            }
          </td>`
        : "";

      const btnHtml =
        btnLabel && btnUrl
          ? renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "outlined",
              corner: block.buttonCorner || "pill",
              bgColor: block.buttonBgColor || "#ffffff",
              textColor: block.buttonTextColor || "#ffffff",
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align: "right",
              compact: true,
            })
          : "";

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};color:${escapeHtml(fg)};font-family:${fontCss};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${imgCell}
        <td class="ec-stack ec-center-sm" valign="middle" style="font-size:12px;line-height:1.45;color:${escapeHtml(fg)};font-family:${fontCss};padding:4px 12px 4px 0;">
          ${renderMultilineEscaped(text)}
        </td>
        ${
          btnHtml
            ? `<td class="ec-stack ec-center-sm" width="140" valign="middle" align="right" style="padding:6px 0 4px 0;">${btnHtml}</td>`
            : ""
        }
      </tr>
    </table>
  </td>
</tr>`;
      return {
        html,
        text: btnLabel && btnUrl ? `${text} - ${btnLabel} (${btnUrl})` : text,
      };
    }

    case "membership_strip": {
      const tier = substituteVariablesRaw(block.tierTemplate, variables);
      const points = substituteVariablesRaw(block.pointsTemplate, variables);
      if (!tier && !points) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#f8fafc");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const borderCol = sanitizeHexColor(block.style?.borderColor, "#e4e4e7");
      const pad = getSectionPadding(block.style, 12, 24);
      const tone = safeTone(block.iconTone, "dark");
      const safeLink =
        block.linkUrl && block.linkHidden !== true
          ? resolveSafeUrlOnRender(block.linkUrl, variables, false)
          : "";
      const arrowImg =
        block.showArrow !== false && (safeLink || !block.linkHidden)
          ? ` ${renderDecorativeIconImg(appUrl, tone, "arrow", 12, "margin-left:4px;")}`
          : "";

      const pieces: string[] = [];
      if (tier) {
        pieces.push(`<strong style="font-weight:700;color:${escapeHtml(fg)};">${escapeHtml(tier)}</strong>`);
      }
      if (tier && points) {
        pieces.push(`<span style="color:#a1a1aa;padding:0 10px;">|</span>`);
      }
      if (points) {
        pieces.push(`<span style="color:${escapeHtml(fg)};">${escapeHtml(points)}</span>`);
      }

      const inner = `${pieces.join("")}${arrowImg}`;
      const wrapped = safeLink
        ? `<a href="${escapeHtml(safeLink)}"${buildLinkTargetAttrs(safeLink, block.linkOpenInNewTab)} style="color:${escapeHtml(fg)};text-decoration:none;font-family:${fontCss};">${inner}</a>`
        : inner;

      const html = `<tr>
  <td class="ec-pad-sm" align="center" style="padding:${pad};background-color:${escapeHtml(bg)};border-bottom:1px solid ${escapeHtml(borderCol)};font-size:13px;line-height:1.4;color:${escapeHtml(fg)};font-family:${fontCss};">
    ${wrapped}
  </td>
</tr>`;
      const plain = [tier, points].filter(Boolean).join(" | ");
      return { html, text: safeLink ? `${plain} (${safeLink})` : plain };
    }

    case "icon_divider": {
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const lineCol = sanitizeHexColor(block.lineColor || block.style?.borderColor, "#d4d4d8");
      const pad = getSectionPadding(block.style, 12, 28);
      const icon = safeIcon(block.icon, "map");
      const tone = safeTone(block.iconTone, "muted");
      const iconImg = renderDecorativeIconImg(appUrl, tone, icon, 20);

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td width="44%" valign="middle" style="border-bottom:1px solid ${escapeHtml(lineCol)};font-size:1px;line-height:1px;">&nbsp;</td>
        <td width="12%" align="center" valign="middle" style="padding:0 10px;">${iconImg}</td>
        <td width="44%" valign="middle" style="border-bottom:1px solid ${escapeHtml(lineCol)};font-size:1px;line-height:1px;">&nbsp;</td>
      </tr>
    </table>
  </td>
</tr>`;
      return { html, text: "---" };
    }

    case "hero_text": {
      const headline = substituteVariablesRaw(block.headline, variables);
      const bodyRendered = renderTextWithInlineLinks(
        block.body || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      const btnLabel = block.buttonHidden
        ? ""
        : substituteVariablesRaw(block.buttonLabel || "", variables);
      const btnUrl =
        btnLabel && !block.buttonHidden && block.buttonUrl
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      if (!headline && !bodyRendered.text) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const align = safeAlign(block.style?.align, "center");
      const pad = getSectionPadding(block.style, 24, 32);

      const btnHtml =
        btnLabel && btnUrl
          ? `<div style="margin-top:18px;">${renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "filled",
              corner: block.buttonCorner || "rounded",
              bgColor: block.buttonBgColor,
              textColor: block.buttonTextColor,
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align,
            })}</div>`
          : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="${align}" style="padding:${pad};background-color:${escapeHtml(bg)};text-align:${align};font-family:${fontCss};">
    ${
      headline
        ? `<h1 style="margin:0 0 ${bodyRendered.html ? "12px" : "0"} 0;font-size:28px;line-height:1.22;font-weight:700;letter-spacing:-0.02em;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(headline)}</h1>`
        : ""
    }
    ${
      bodyRendered.html
        ? `<p style="margin:0;font-size:15px;line-height:1.6;color:#52525b;font-family:${fontCss};">${bodyRendered.html}</p>`
        : ""
    }
    ${btnHtml}
  </td>
</tr>`;
      const textParts = [
        headline,
        bodyRendered.text,
        btnLabel && btnUrl ? `${btnLabel} (${btnUrl})` : "",
      ].filter(Boolean);
      return { html, text: textParts.join("\n") };
    }

    case "confirmation_number": {
      const label = substituteVariablesRaw(block.label, variables);
      const value = substituteVariablesRaw(block.valueTemplate, variables);
      if (!value) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const pad = getSectionPadding(block.style, 14, 28);
      const radius = clampInt(block.style?.borderRadius, 0, 0, 16);

      const innerStyle =
        radius > 0
          ? `background-color:${escapeHtml(bg)};border-radius:${radius}px;padding:14px 20px;`
          : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="center" style="padding:${pad};background-color:${radius > 0 ? "#ffffff" : escapeHtml(bg)};text-align:center;font-family:${fontCss};">
    <div style="${innerStyle}">
      ${
        label
          ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#71717a;margin:0 0 6px 0;font-family:${fontCss};">${escapeHtml(label)}</div>`
          : ""
      }
      <div style="font-size:24px;font-weight:700;letter-spacing:0.04em;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(value)}</div>
    </div>
  </td>
</tr>`;
      return { html, text: label ? `${label}: ${value}` : value };
    }

    case "stay_dates": {
      const ciLabel = substituteVariablesRaw(block.checkInLabel || "CHECK-IN", variables);
      const ciDate = substituteVariablesRaw(block.checkInDateTemplate, variables);
      const ciTime = substituteVariablesRaw(block.checkInTimeTemplate, variables);
      const coLabel = substituteVariablesRaw(block.checkOutLabel || "CHECK-OUT", variables);
      const coDate = substituteVariablesRaw(block.checkOutDateTemplate, variables);
      const coTime = substituteVariablesRaw(block.checkOutTimeTemplate, variables);
      if (!ciDate && !coDate) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const borderCol = sanitizeHexColor(block.style?.borderColor, "#d4d4d8");
      const pad = getSectionPadding(block.style, 16, 28);

      const btnLabel = block.buttonHidden
        ? ""
        : substituteVariablesRaw(block.buttonLabel || "", variables);
      const btnUrl =
        btnLabel && !block.buttonHidden && block.buttonUrl
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      const btnHtml =
        btnLabel && btnUrl
          ? `<div style="margin-top:22px;">${renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "outlined",
              corner: block.buttonCorner || "square",
              bgColor: block.buttonBgColor || "#18181b",
              textColor: block.buttonTextColor || "#18181b",
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align: "center",
            })}</div>`
          : "";

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};font-family:${fontCss};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td class="ec-stack" width="42%" align="center" valign="top" style="padding:8px 6px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;margin:0 0 6px 0;font-family:${fontCss};">${escapeHtml(ciLabel)}</div>
          <div style="font-size:18px;font-weight:700;color:${escapeHtml(fg)};margin:0 0 4px 0;font-family:${fontCss};">${escapeHtml(ciDate)}</div>
          ${ciTime ? `<div style="font-size:15px;color:#3f3f46;font-family:${fontCss};">${escapeHtml(ciTime)}</div>` : ""}
        </td>
        <td class="ec-hide-sm" width="16%" align="center" valign="middle" style="padding:0 6px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr><td style="border-bottom:1px solid ${escapeHtml(borderCol)};font-size:1px;line-height:1px;">&nbsp;</td></tr>
          </table>
        </td>
        <td class="ec-stack" width="42%" align="center" valign="top" style="padding:8px 6px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:#71717a;margin:0 0 6px 0;font-family:${fontCss};">${escapeHtml(coLabel)}</div>
          <div style="font-size:18px;font-weight:700;color:${escapeHtml(fg)};margin:0 0 4px 0;font-family:${fontCss};">${escapeHtml(coDate)}</div>
          ${coTime ? `<div style="font-size:15px;color:#3f3f46;font-family:${fontCss};">${escapeHtml(coTime)}</div>` : ""}
        </td>
      </tr>
    </table>
    ${btnHtml}
  </td>
</tr>`;
      const textLines = [
        `${ciLabel}: ${[ciDate, ciTime].filter(Boolean).join(" ")}`,
        `${coLabel}: ${[coDate, coTime].filter(Boolean).join(" ")}`,
        ...(btnLabel && btnUrl ? [`${btnLabel} (${btnUrl})`] : []),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "feature_card": {
      const safeImg = resolveSafeUrlOnRender(block.imageUrl, variables, false);
      const safeImgLink = block.imageLinkUrl
        ? resolveSafeUrlOnRender(block.imageLinkUrl, variables, false)
        : "";
      const title = substituteVariablesRaw(block.title, variables);
      const bodyRendered = renderTextWithInlineLinks(
        block.body || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      if (!safeImg || !title) return { html: "", text: "" };

      const imgAlt = substituteVariablesRaw(block.imageAlt || "", variables) || title;
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const borderCol = sanitizeHexColor(block.style?.borderColor, "#e4e4e7");
      const radius = clampInt(block.style?.borderRadius, 12, 0, 16);
      const pad = getSectionPadding(block.style, 10, 24);
      const isImageRight = block.imagePosition === "right";

      const btnLabel = block.buttonHidden
        ? ""
        : substituteVariablesRaw(block.buttonLabel || "", variables);
      const btnUrl =
        btnLabel && !block.buttonHidden && block.buttonUrl
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      const btnHtml =
        btnLabel && btnUrl
          ? `<div style="margin-top:16px;">${renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "filled",
              corner: block.buttonCorner || "rounded",
              bgColor: block.buttonBgColor,
              textColor: block.buttonTextColor,
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align: "left",
            })}</div>`
          : "";

      const imgTag = `<img class="ec-stack-img" src="${escapeHtml(safeImg)}" alt="${escapeHtml(imgAlt)}" style="display:block;width:auto;max-width:100%;height:auto;object-fit:contain;border:0;" />`;
      // Use dir="rtl" on the row when imagePosition === "right" so DOM order puts image first -> mobile ALWAYS stacks image on top!
      const imgTd = `<td class="ec-stack" dir="ltr" width="48%" valign="top" style="padding:0;line-height:0;font-size:0;">
          ${
            safeImgLink
              ? `<a href="${escapeHtml(safeImgLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;display:block;">${imgTag}</a>`
              : imgTag
          }
        </td>`;
      const textTd = `<td class="ec-stack" dir="ltr" width="52%" valign="middle" style="padding:22px 24px;text-align:left;font-family:${fontCss};">
          <h3 style="margin:0 0 8px 0;font-size:18px;line-height:1.3;font-weight:700;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(title)}</h3>
          ${bodyRendered.html ? `<p style="margin:0;font-size:13px;line-height:1.55;color:#52525b;font-family:${fontCss};">${bodyRendered.html}</p>` : ""}
          ${btnHtml}
        </td>`;

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:#ffffff;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${isImageRight ? "rtl" : "ltr"}" style="width:100%;background-color:${escapeHtml(bg)};border:1px solid ${escapeHtml(borderCol)};border-radius:${radius}px;overflow:hidden;border-collapse:separate;">
      <tr>
        ${imgTd}
        ${textTd}
      </tr>
    </table>
  </td>
</tr>`;
      const textLines = [
        title,
        bodyRendered.text,
        btnLabel && btnUrl ? `${btnLabel} (${btnUrl})` : "",
      ].filter(Boolean);
      return { html, text: textLines.join("\n") };
    }

    case "benefits_list": {
      const heading = substituteVariablesRaw(block.heading, variables);
      const renderedItems = (block.items || [])
        .map((it) =>
          renderTextWithInlineLinks(it.text, block.inlineLinks, variables, primaryColor)
        )
        .filter((r) => r.text || r.html);
      if (!heading && renderedItems.length === 0) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const pad = getSectionPadding(block.style, 22, 28);
      const badgeText = substituteVariablesRaw(block.badgeText || "", variables);
      const badgeImgUrl = block.badgeImageUrl
        ? resolveSafeUrlOnRender(block.badgeImageUrl, variables, false)
        : "";
      const badgeImgLink = block.badgeImageLinkUrl
        ? resolveSafeUrlOnRender(block.badgeImageLinkUrl, variables, false)
        : "";
      const badgeImgAlt =
        substituteVariablesRaw(block.badgeImageAlt || "", variables) || variables.hotel_name;
      const footnoteRendered = renderTextWithInlineLinks(
        block.footnote || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      const tone = safeTone(block.iconTone, "dark");
      const iconName = safeIcon(block.itemIcon, "check");

      const badgeImgTag = badgeImgUrl
        ? `<img src="${escapeHtml(badgeImgUrl)}" alt="${escapeHtml(badgeImgAlt)}" style="display:block;width:auto;height:auto;max-width:140px;max-height:80px;object-fit:contain;border:0;background-color:transparent;" />`
        : "";
      const badgeHtml = badgeImgUrl
        ? `<div style="margin:0 0 10px 0;">${
            badgeImgLink
              ? `<a href="${escapeHtml(badgeImgLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">${badgeImgTag}</a>`
              : badgeImgTag
          }</div>`
        : badgeText
          ? `<div style="font-size:11px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${escapeHtml(primaryColor)};margin:0 0 8px 0;font-family:${fontCss};">${escapeHtml(badgeText)}</div>`
          : "";

      const rowsHtml = renderedItems
        .map((item) => {
          const marker =
            block.listStyle === "icon"
              ? renderDecorativeIconImg(appUrl, tone, iconName, 16)
              : `<span style="color:${escapeHtml(fg)};font-size:14px;line-height:1;">&#8226;</span>`;
          return `<tr>
            <td width="22" valign="top" style="padding:4px 8px 4px 0;line-height:1.5;">${marker}</td>
            <td valign="top" style="padding:4px 0;font-size:14px;line-height:1.55;color:#27272a;font-family:${fontCss};">${item.html}</td>
          </tr>`;
        })
        .join("");

      const btnLabel = block.buttonHidden
        ? ""
        : substituteVariablesRaw(block.buttonLabel || "", variables);
      const btnUrl =
        btnLabel && !block.buttonHidden && block.buttonUrl
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      const btnHtml =
        btnLabel && btnUrl
          ? `<div style="margin-top:18px;">${renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "outlined",
              corner: block.buttonCorner || "square",
              bgColor: block.buttonBgColor || "#18181b",
              textColor: block.buttonTextColor || "#18181b",
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align: "left",
            })}</div>`
          : "";

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};font-family:${fontCss};">
    ${badgeHtml}
    ${
      heading
        ? `<h2 style="margin:0 0 14px 0;font-size:22px;line-height:1.25;font-weight:700;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(heading)}</h2>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      ${rowsHtml}
    </table>
    ${
      footnoteRendered.html
        ? `<p style="margin:14px 0 0 0;font-size:11px;line-height:1.5;color:#71717a;font-family:${fontCss};">${footnoteRendered.html}</p>`
        : ""
    }
    ${btnHtml}
  </td>
</tr>`;

      const textLines = [
        ...(badgeText ? [badgeText] : []),
        ...(heading ? [heading] : []),
        ...renderedItems.map((i) => `- ${i.text}`),
        ...(footnoteRendered.text ? [footnoteRendered.text] : []),
        ...(btnLabel && btnUrl ? [`${btnLabel} (${btnUrl})`] : []),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "icon_link_grid": {
      const safeItems = (block.items || [])
        .filter((it) => it && it.hidden !== true)
        .map((it) => {
          const label = substituteVariablesRaw(it.label, variables);
          const url = label ? resolveSafeUrlOnRender(it.url, variables, true, label) : "";
          return {
            icon: safeIcon(it.icon, "star"),
            label,
            url,
            openInNewTab: it.openInNewTab,
          };
        })
        .filter((it) => it.label && it.url);
      if (safeItems.length === 0) return { html: "", text: "" };

      const heading = substituteVariablesRaw(block.heading || "", variables);
      const subheading = substituteVariablesRaw(block.subheading || "", variables);
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const pad = getSectionPadding(block.style, 20, 28);
      const tone = safeTone(block.iconTone, "dark");
      const colPct = Math.floor(100 / safeItems.length);
      const arrowImg =
        block.showArrows !== false
          ? ` ${renderDecorativeIconImg(appUrl, tone, "arrow", 12, "margin-left:3px;")}`
          : "";

      const cellsHtml = safeItems
        .map((item) => {
          const iconImg = renderDecorativeIconImg(appUrl, tone, item.icon, 28);
          return `<td class="ec-grid-cell" width="${colPct}%" align="center" valign="top" style="padding:10px 8px;">
            <a href="${escapeHtml(item.url)}"${buildLinkTargetAttrs(item.url, item.openInNewTab)} style="text-decoration:none;color:${escapeHtml(fg)};font-family:${fontCss};display:inline-block;">
              <div style="margin:0 0 8px 0;">${iconImg}</div>
              <div style="font-size:13px;font-weight:600;color:${escapeHtml(fg)};line-height:1.35;font-family:${fontCss};">
                <span style="vertical-align:middle;">${escapeHtml(item.label)}</span>${arrowImg}
              </div>
            </a>
          </td>`;
        })
        .join("");

      const html = `<tr>
  <td class="ec-pad-sm" align="center" style="padding:${pad};background-color:${escapeHtml(bg)};text-align:center;font-family:${fontCss};">
    ${
      heading
        ? `<h2 style="margin:0 0 ${subheading ? "6px" : "16px"} 0;font-size:24px;line-height:1.25;font-weight:700;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(heading)}</h2>`
        : ""
    }
    ${
      subheading
        ? `<p style="margin:0 0 18px 0;font-size:13px;line-height:1.5;color:#52525b;font-family:${fontCss};">${renderMultilineEscaped(subheading)}</p>`
        : ""
    }
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        ${cellsHtml}
      </tr>
    </table>
  </td>
</tr>`;
      const textLines = [
        ...(heading ? [heading] : []),
        ...(subheading ? [subheading] : []),
        ...safeItems.map((it) => `${it.label} (${it.url})`),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "image_with_list": {
      const safeImg = resolveSafeUrlOnRender(block.imageUrl, variables, false);
      const safeImgLink = block.imageLinkUrl
        ? resolveSafeUrlOnRender(block.imageLinkUrl, variables, false)
        : "";
      const heading = substituteVariablesRaw(block.heading, variables);
      if (!safeImg && !heading) return { html: "", text: "" };

      const imgAlt = substituteVariablesRaw(block.imageAlt || "", variables) || heading || variables.hotel_name;
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const radius = clampInt(block.style?.borderRadius, 12, 0, 16);
      const pad = getSectionPadding(block.style, 22, 28);
      const tone = safeTone(block.iconTone, "dark");
      const isRight = block.imagePosition === "right";

      const items = (block.items || [])
        .map((it) => {
          const rendered = renderTextWithInlineLinks(
            it.text,
            block.inlineLinks,
            variables,
            primaryColor
          );
          return {
            icon: safeIcon(it.icon, "check"),
            html: rendered.html,
            text: rendered.text,
          };
        })
        .filter((it) => it.text || it.html);

      const listHtml = items
        .map(
          (it) => `<tr>
            <td width="26" valign="middle" style="padding:6px 10px 6px 0;">${renderDecorativeIconImg(appUrl, tone, it.icon, 18)}</td>
            <td valign="middle" style="padding:6px 0;font-size:14px;line-height:1.45;color:#27272a;font-family:${fontCss};">${it.html}</td>
          </tr>`
        )
        .join("");

      const btnLabel = block.buttonHidden
        ? ""
        : substituteVariablesRaw(block.buttonLabel || "", variables);
      const btnUrl =
        btnLabel && !block.buttonHidden && block.buttonUrl
          ? resolveSafeUrlOnRender(block.buttonUrl, variables, true, btnLabel)
          : "";
      const btnHtml =
        btnLabel && btnUrl
          ? `<div style="margin-top:18px;">${renderModernButton({
              label: btnLabel,
              url: btnUrl,
              style: block.buttonStyle || "dark",
              corner: block.buttonCorner || "square",
              bgColor: block.buttonBgColor || "#18181b",
              textColor: block.buttonTextColor || "#ffffff",
              borderColor: block.buttonBorderColor,
              openInNewTab: block.buttonOpenInNewTab,
              defaultBrandColor: buttonColor,
              fontCss,
              align: "left",
            })}</div>`
          : "";

      const imgTag = safeImg
        ? `<img class="ec-stack-img" src="${escapeHtml(safeImg)}" alt="${escapeHtml(imgAlt)}" style="display:block;width:auto;max-width:100%;height:auto;object-fit:contain;border:0;border-radius:${radius}px;" />`
        : "";
      const imgTd = safeImg
        ? `<td class="ec-stack" dir="ltr" width="46%" valign="middle" style="padding:0 0 12px 0;">
            ${
              safeImgLink
                ? `<a href="${escapeHtml(safeImgLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;display:block;">${imgTag}</a>`
                : imgTag
            }
          </td>`
        : "";
      const listTd = `<td class="ec-stack" dir="ltr" width="${safeImg ? "54%" : "100%"}" valign="middle" style="padding:${safeImg ? (isRight ? "0 20px 0 0" : "0 0 0 22px") : "0"};text-align:left;font-family:${fontCss};">
          ${
            heading
              ? `<h2 style="margin:0 0 14px 0;font-size:22px;line-height:1.25;font-weight:700;color:${escapeHtml(fg)};font-family:${fontCss};">${escapeHtml(heading)}</h2>`
              : ""
          }
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            ${listHtml}
          </table>
          ${btnHtml}
        </td>`;

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" dir="${isRight ? "rtl" : "ltr"}">
      <tr>
        ${imgTd}
        ${listTd}
      </tr>
    </table>
  </td>
</tr>`;
      const textLines = [
        ...(heading ? [heading] : []),
        ...items.map((it) => `- ${it.text}`),
        ...(btnLabel && btnUrl ? [`${btnLabel} (${btnUrl})`] : []),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "footer_nav": {
      const bg = sanitizeHexColor(block.style?.backgroundColor, "#ffffff");
      const fg = sanitizeHexColor(block.style?.textColor, "#18181b");
      const borderCol = sanitizeHexColor(block.style?.borderColor, "#e4e4e7");
      const pad = getSectionPadding(block.style, 20, 24);

      const safeLinks = (block.links || [])
        .filter((l) => l && l.hidden !== true)
        .map((l) => {
          const label = substituteVariablesRaw(l.label, variables);
          const url = label ? resolveSafeUrlOnRender(l.url, variables, true, label) : "";
          return {
            label,
            url,
            color: l.color ? sanitizeHexColor(l.color, fg) : fg,
            underline: l.underline === true ? "underline" : "none",
            openInNewTab: l.openInNewTab,
          };
        })
        .filter((l) => l.label && l.url);

      const secondaryText = block.secondaryLinkHidden
        ? ""
        : substituteVariablesRaw(block.secondaryText || "", variables);
      const secondaryUrl =
        secondaryText && !block.secondaryLinkHidden && block.secondaryLinkUrl
          ? resolveSafeUrlOnRender(block.secondaryLinkUrl, variables, true, secondaryText)
          : "";

      if (safeLinks.length === 0 && !secondaryText) return { html: "", text: "" };

      const linksHtml = safeLinks
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}"${buildLinkTargetAttrs(l.url, l.openInNewTab)} style="display:inline-block;padding:4px 10px;font-size:12px;font-weight:600;color:${escapeHtml(l.color)};text-decoration:${l.underline};font-family:${fontCss};">${escapeHtml(l.label)}</a>`
        )
        .join("");

      const secondaryHtml = secondaryText
        ? `<div style="margin-top:14px;font-size:12px;color:#52525b;font-family:${fontCss};">${
            secondaryUrl
              ? `<a href="${escapeHtml(secondaryUrl)}"${buildLinkTargetAttrs(secondaryUrl, block.secondaryLinkOpenInNewTab)} style="color:${escapeHtml(fg)};text-decoration:underline;">${escapeHtml(secondaryText)}</a>`
              : escapeHtml(secondaryText)
          }</div>`
        : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="center" style="padding:${pad};background-color:${escapeHtml(bg)};border-top:1px solid ${escapeHtml(borderCol)};text-align:center;font-family:${fontCss};">
    <div>${linksHtml}</div>
    ${secondaryHtml}
  </td>
</tr>`;
      const textLines = [
        ...safeLinks.map((l) => `${l.label} (${l.url})`),
        ...(secondaryText ? [secondaryUrl ? `${secondaryText} (${secondaryUrl})` : secondaryText] : []),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "legal_section": {
      const sections = (block.sections || [])
        .map((s) => {
          const heading = substituteVariablesRaw(s.heading, variables);
          const bodyRendered = renderTextWithInlineLinks(
            s.body,
            block.inlineLinks,
            variables,
            primaryColor
          );
          return {
            heading,
            bodyHtml: bodyRendered.html,
            bodyText: bodyRendered.text,
          };
        })
        .filter((s) => s.heading || s.bodyText);

      const copyright = substituteVariablesRaw(block.copyrightText || "", variables);
      const settingsImprint = substituteVariablesRaw(ctx.settingsLegalImprint || "", variables);
      const logoCandidate = block.showFooterLogo
        ? (block.footerLogoUrl || ctx.hotelLogoUrl || "").trim()
        : "";
      const safeFooterLogo = logoCandidate
        ? resolveSafeUrlOnRender(logoCandidate, variables, false)
        : "";
      const safeFooterLogoLink = block.footerLogoLinkUrl
        ? resolveSafeUrlOnRender(block.footerLogoLinkUrl, variables, false)
        : "";
      const footerLogoAlt =
        substituteVariablesRaw(block.footerLogoAlt || "{{hotel_name}}", variables) || variables.hotel_name;
      const footerLogoW = clampInt(block.footerLogoWidthPx, 110, 40, 200);

      if (sections.length === 0 && !copyright && !settingsImprint && !safeFooterLogo) {
        return { html: "", text: "" };
      }

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#fafafa");
      const fg = sanitizeHexColor(block.style?.textColor, "#52525b");
      const pad = getSectionPadding(block.style, 22, 28);

      const secHtml = sections
        .map(
          (s) => `<div style="margin:0 0 12px 0;">
            ${s.heading ? `<div style="font-size:12px;font-weight:700;color:#27272a;margin:0 0 3px 0;font-family:${fontCss};">${escapeHtml(s.heading)}</div>` : ""}
            ${s.bodyHtml ? `<div style="font-size:11px;line-height:1.55;color:${escapeHtml(fg)};font-family:${fontCss};">${s.bodyHtml}</div>` : ""}
          </div>`
        )
        .join("");

      const imprintHtml = settingsImprint
        ? `<div style="margin:8px 0 0 0;font-size:11px;line-height:1.5;color:#71717a;font-family:${fontCss};">${renderMultilineEscaped(settingsImprint)}</div>`
        : "";

      const copyHtml = copyright
        ? `<div style="margin:12px 0 0 0;font-size:11px;font-weight:600;color:#52525b;font-family:${fontCss};">${escapeHtml(copyright)}</div>`
        : "";

      const footerLogoImg = safeFooterLogo
        ? `<img src="${escapeHtml(safeFooterLogo)}" alt="${escapeHtml(footerLogoAlt)}" style="display:inline-block;width:auto;height:auto;max-width:${footerLogoW}px;max-height:${footerLogoW}px;object-fit:contain;border:0;background-color:transparent;" />`
        : "";
      const logoHtml = safeFooterLogo
        ? `<div style="margin:18px 0 0 0;text-align:center;">${
            safeFooterLogoLink
              ? `<a href="${escapeHtml(safeFooterLogoLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">${footerLogoImg}</a>`
              : footerLogoImg
          }</div>`
        : "";

      const html = `<tr>
  <td class="ec-pad-sm" style="padding:${pad};background-color:${escapeHtml(bg)};border-top:1px solid #e4e4e7;text-align:left;font-family:${fontCss};">
    ${secHtml}
    ${imprintHtml}
    ${copyHtml}
    ${logoHtml}
  </td>
</tr>`;

      const textLines: string[] = [];
      for (const s of sections) {
        if (s.heading) textLines.push(s.heading);
        if (s.bodyText) textLines.push(s.bodyText);
      }
      if (settingsImprint) textLines.push(settingsImprint);
      if (copyright) textLines.push(copyright);
      return { html, text: textLines.join("\n") };
    }

    // --- 5 STANDALONE EDITABLE FOOTER BLOCKS (PURE RENDERING — ZERO SILENT SETTINGS INJECTION) ---
    case "footer_contact":
    case "footer_authenticity":
    case "footer_legal": {
      const localVars =
        block.type === "footer_contact" && (block.emailOverride || block.phoneOverride)
          ? {
              ...variables,
              ...(block.emailOverride && block.emailOverride.trim()
                ? { hotel_email: substituteVariablesRaw(block.emailOverride, variables) }
                : {}),
              ...(block.phoneOverride && block.phoneOverride.trim()
                ? { hotel_phone: substituteVariablesRaw(block.phoneOverride, variables) }
                : {}),
            }
          : variables;

      const heading = substituteVariablesRaw(block.heading || "", localVars);
      const linkColor =
        block.type === "footer_contact" && block.linkColor
          ? sanitizeHexColor(block.linkColor, primaryColor)
          : primaryColor;
      const bodyRendered = renderTextWithInlineLinks(
        block.text || "",
        block.inlineLinks,
        localVars,
        linkColor
      );
      if (!heading && !bodyRendered.text) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#fafafa");
      const fg = sanitizeHexColor(block.style?.textColor, "#52525b");
      const headingCol = sanitizeHexColor(block.style?.accentColor, "#18181b");
      const borderCol = block.style?.borderColor
        ? sanitizeHexColor(block.style.borderColor, "#e4e4e7")
        : "";
      const align = safeAlign(block.style?.align, "left");
      const pad = getSectionPadding(block.style, 14, 28);
      const blockFont = getBlockFontCss(block.style, fontCss);
      const bodySize = clampInt(block.style?.fontSizePx, 12, 10, 24);
      const headingSize = Math.min(24, bodySize + 1);
      const borderTopCss = borderCol ? `border-top:1px solid ${escapeHtml(borderCol)};` : "";

      let bodyHtmlContent = bodyRendered.html;
      let bodyTextContent = bodyRendered.text;

      // For footer_contact: when admin explicitly enables clickable email/phone links, linkify resolved hotel email & phone safely
      if (block.type === "footer_contact") {
        const contactLinkColor = block.linkColor
          ? sanitizeHexColor(block.linkColor, fg)
          : primaryColor;
        const contactDeco = block.underline === false ? "none" : "underline";

        if (block.emailLinkEnabled === true && localVars.hotel_email && isValidEmail(localVars.hotel_email)) {
          const escapedEmail = escapeHtml(localVars.hotel_email);
          const mailAnchor = `<a href="mailto:${escapedEmail}" style="color:${escapeHtml(contactLinkColor)};text-decoration:${contactDeco};">${escapedEmail}</a>`;
          if (bodyHtmlContent.includes(escapedEmail) && !bodyHtmlContent.includes(`mailto:${escapedEmail}`)) {
            bodyHtmlContent = bodyHtmlContent.replace(escapedEmail, mailAnchor);
            bodyTextContent = bodyTextContent.replace(
              localVars.hotel_email,
              `${localVars.hotel_email} (mailto:${localVars.hotel_email})`
            );
          }
        }
        if (block.phoneLinkEnabled === true && localVars.hotel_phone) {
          const telCheck = validateEmailUrl(`tel:${localVars.hotel_phone}`, {
            allowContactSchemes: true,
          });
          if (telCheck.valid && telCheck.normalized) {
            const escapedPhone = escapeHtml(localVars.hotel_phone);
            const telAnchor = `<a href="${escapeHtml(telCheck.normalized)}" style="color:${escapeHtml(contactLinkColor)};text-decoration:${contactDeco};">${escapedPhone}</a>`;
            if (bodyHtmlContent.includes(escapedPhone) && !bodyHtmlContent.includes(telCheck.normalized)) {
              bodyHtmlContent = bodyHtmlContent.replace(escapedPhone, telAnchor);
              bodyTextContent = bodyTextContent.replace(
                localVars.hotel_phone,
                `${localVars.hotel_phone} (${telCheck.normalized})`
              );
            }
          }
        }
      }

      const headingHtml = heading
        ? `<div style="font-size:${headingSize}px;line-height:1.4;font-weight:700;color:${escapeHtml(headingCol)};margin:0 0 4px 0;font-family:${blockFont};">${escapeHtml(heading)}</div>`
        : "";
      const bodyHtml = bodyHtmlContent
        ? `<div style="font-size:${bodySize}px;line-height:1.55;color:${escapeHtml(fg)};font-family:${blockFont};">${bodyHtmlContent}</div>`
        : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="${align}" style="padding:${pad};background-color:${escapeHtml(bg)};${borderTopCss}text-align:${align};font-family:${blockFont};">
    ${headingHtml}
    ${bodyHtml}
  </td>
</tr>`;

      const textLines = [
        ...(heading ? [heading] : []),
        ...(bodyTextContent ? [bodyTextContent] : []),
      ];
      return { html, text: textLines.join("\n") };
    }

    case "footer_copyright": {
      const copyRendered = renderTextWithInlineLinks(
        block.text || "",
        block.inlineLinks,
        variables,
        primaryColor
      );
      const logoCandidate = block.showFooterLogo
        ? (block.footerLogoUrl || ctx.hotelLogoUrl || "").trim()
        : "";
      const safeFooterLogo = logoCandidate
        ? resolveSafeUrlOnRender(logoCandidate, variables, false)
        : "";
      const safeFooterLogoLink = block.footerLogoLinkUrl
        ? resolveSafeUrlOnRender(block.footerLogoLinkUrl, variables, false)
        : "";
      const footerLogoAlt =
        substituteVariablesRaw(block.footerLogoAlt || "{{hotel_name}}", variables) ||
        variables.hotel_name;
      const footerLogoW = clampInt(block.footerLogoWidthPx, 110, 40, 200);

      if (!copyRendered.text && !safeFooterLogo) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#fafafa");
      const fg = sanitizeHexColor(block.style?.textColor, "#52525b");
      const borderCol = block.style?.borderColor
        ? sanitizeHexColor(block.style.borderColor, "#e4e4e7")
        : "";
      const align = safeAlign(block.style?.align, "left");
      const pad = getSectionPadding(block.style, 14, 28);
      const blockFont = getBlockFontCss(block.style, fontCss);
      const fontSize = clampInt(block.style?.fontSizePx, 11, 10, 24);
      const borderTopCss = borderCol ? `border-top:1px solid ${escapeHtml(borderCol)};` : "";

      const copyHtml = copyRendered.html
        ? `<div style="font-size:${fontSize}px;line-height:1.5;font-weight:600;color:${escapeHtml(fg)};font-family:${blockFont};">${copyRendered.html}</div>`
        : "";
      const footerLogoImg = safeFooterLogo
        ? `<img src="${escapeHtml(safeFooterLogo)}" alt="${escapeHtml(footerLogoAlt)}" style="display:inline-block;width:auto;height:auto;max-width:${footerLogoW}px;max-height:${footerLogoW}px;object-fit:contain;border:0;background-color:transparent;" />`
        : "";
      const logoHtml = safeFooterLogo
        ? `<div style="margin:${copyRendered.text ? "14px" : "0"} 0 0 0;text-align:${align};">${
            safeFooterLogoLink
              ? `<a href="${escapeHtml(safeFooterLogoLink)}"${buildLinkTargetAttrs(safeFooterLogoLink, block.footerLogoLinkOpenInNewTab)} style="text-decoration:none;border:0;">${footerLogoImg}</a>`
              : footerLogoImg
          }</div>`
        : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="${align}" style="padding:${pad};background-color:${escapeHtml(bg)};${borderTopCss}text-align:${align};font-family:${blockFont};">
    ${copyHtml}
    ${logoHtml}
  </td>
</tr>`;

      return { html, text: copyRendered.text };
    }

    case "footer_powered_by": {
      const creditText = substituteVariablesRaw(block.text || "", variables);
      const linkLabel = block.linkHidden
        ? ""
        : substituteVariablesRaw(block.linkLabel || "", variables);
      const safeLinkUrl =
        linkLabel && !block.linkHidden && block.linkUrl
          ? resolveSafeUrlOnRender(block.linkUrl, variables, false, linkLabel)
          : "";
      if (!creditText && !linkLabel) return { html: "", text: "" };

      const bg = sanitizeHexColor(block.style?.backgroundColor, "#fafafa");
      const fg = sanitizeHexColor(block.style?.textColor, "#71717a");
      const linkCol = block.linkColor ? sanitizeHexColor(block.linkColor, fg) : fg;
      const deco = block.underline === false ? "none" : "underline";
      const align = safeAlign(block.style?.align, "center");
      const pad = getSectionPadding(block.style, 10, 24);
      const blockFont = getBlockFontCss(block.style, fontCss);
      const fontSize = clampInt(block.style?.fontSizePx, 11, 10, 20);

      const linkHtml =
        linkLabel && safeLinkUrl
          ? ` <a href="${escapeHtml(safeLinkUrl)}"${buildLinkTargetAttrs(safeLinkUrl, block.openInNewTab)} style="color:${escapeHtml(linkCol)};text-decoration:${deco};font-weight:600;">${escapeHtml(linkLabel)}</a>`
          : linkLabel
            ? ` ${escapeHtml(linkLabel)}`
            : "";

      const html = `<tr>
  <td class="ec-pad-sm" align="${align}" style="padding:${pad};background-color:${escapeHtml(bg)};text-align:${align};font-size:${fontSize}px;line-height:1.45;color:${escapeHtml(fg)};font-family:${blockFont};">
    ${escapeHtml(creditText)}${linkHtml}
  </td>
</tr>`;

      const textLine = [
        creditText,
        linkLabel && safeLinkUrl ? `${linkLabel} (${safeLinkUrl})` : linkLabel,
      ]
        .filter(Boolean)
        .join(" ");
      return { html, text: textLine };
    }

    default:
      return { html: "", text: "" };
  }
}
