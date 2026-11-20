import {
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  type AllowedTemplateVariable,
  type BlockCondition,
  type EmailBlock,
  type EmailRenderContext,
  type EmailTemplateVariant,
  type HotelEmailSettings,
  type RenderedEmailOutput,
  type SupportedEmailLanguage,
} from "./types.ts";
import {
  buildTemplateVariablesMap,
  escapeHtml,
  isValidEmail,
  resolveWebSafeFontCss,
  sanitizeHeaderText,
  sanitizeHexColor,
  stripDangerousMarkup,
  validateEmailUrl,
} from "./validation.ts";

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

function resolveSafeUrlOnRender(
  rawUrl: string,
  variables: Record<AllowedTemplateVariable, string>,
  allowContactSchemes = false
): string {
  const substituted = substituteVariablesRaw(rawUrl, variables);
  const check = validateEmailUrl(substituted, { allowContactSchemes });
  return check.valid && check.normalized ? check.normalized : "";
}

function renderMultilineEscaped(text: string): string {
  return escapeHtml(text).replace(/\r?\n/g, "<br />");
}

/**
 * Pure, isomorphic email block renderer shared identically by both the server dispatcher
 * and the Hotel Admin live preview.
 *
 * Output characteristics:
 * - Table-based, inline-styled HTML compatible with Gmail, Outlook, and Apple Mail
 * - Dark-mode tolerant color declarations
 * - Auto-generated plain-text fallback
 * - Strict XSS escaping on every text & variable value
 * - Links validated on render (no javascript:, data:, http:, credentials, or click tracking)
 * - Missing values never render as "undefined"
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
  const logoAlt =
    substituteVariablesRaw(branding.logoAlt || "{{hotel_name}}", variables) || variables.hotel_name;
  const logoWidth = Math.max(40, Math.min(260, Number(branding.logoWidthPx) || 160));

  const eyebrowText = branding.showEyebrow
    ? substituteVariablesRaw(branding.eyebrowText || "{{hotel_name}}", variables)
    : "";

  const htmlParts: string[] = [];
  const textParts: string[] = [];

  if (eyebrowText) {
    textParts.push(eyebrowText);
  }

  for (const block of variant.blocks) {
    if (!block || !shouldRenderCondition(block.condition, conditions)) {
      continue;
    }

    const rendered = renderSingleBlock(block, {
      variables,
      primaryColor,
      secondaryColor,
      buttonColor,
      buttonTextColor,
      fontCss,
      hotelFooterNotes: context.hotelFooterNotes,
      settingsLegalImprint: settings.legalImprint,
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

  const logoHtml = safeLogoUrl
    ? `<div style="margin:0 0 14px 0;"><img src="${escapeHtml(safeLogoUrl)}" alt="${escapeHtml(logoAlt)}" width="${logoWidth}" style="display:block;max-width:${logoWidth}px;max-height:56px;height:auto;border:0;background-color:#f4f4f5;" /></div>`
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

function renderSingleBlock(
  block: EmailBlock,
  ctx: {
    variables: Record<AllowedTemplateVariable, string>;
    primaryColor: string;
    secondaryColor: string;
    buttonColor: string;
    buttonTextColor: string;
    fontCss: string;
    hotelFooterNotes?: string;
    settingsLegalImprint?: string;
  }
): { html: string; text: string } {
  const { variables, primaryColor, secondaryColor, buttonColor, buttonTextColor, fontCss } = ctx;

  switch (block.type) {
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
      const content = substituteVariablesRaw(block.text, variables);
      if (!content) return { html: "", text: "" };
      const align = block.align || "left";
      const color =
        block.tone === "muted"
          ? "#52525b"
          : block.tone === "accent"
            ? primaryColor
            : "#27272a";
      const fontSize = block.tone === "muted" ? "13px" : "14px";
      return {
        html: `<p style="margin:0 0 14px 0;font-size:${fontSize};line-height:1.6;color:${escapeHtml(color)};text-align:${align};font-family:${fontCss};">${renderMultilineEscaped(content)}</p>`,
        text: content,
      };
    }

    case "image": {
      const safeSrc = resolveSafeUrlOnRender(block.src, variables, false);
      if (!safeSrc) return { html: "", text: "" };
      const altText = substituteVariablesRaw(block.alt || "", variables) || variables.hotel_name;
      const width = Math.max(80, Math.min(544, Number(block.widthPx) || 544));
      const align = block.align || "center";
      const bg = sanitizeHexColor(block.fallbackBg, "#f4f4f5");
      const safeLink = block.linkUrl
        ? resolveSafeUrlOnRender(block.linkUrl, variables, false)
        : "";
      const imgTag = `<img src="${escapeHtml(safeSrc)}" alt="${escapeHtml(altText)}" width="${width}" style="display:block;width:100%;max-width:${width}px;height:auto;border:0;border-radius:6px;background-color:${escapeHtml(bg)};" />`;
      const wrapped = safeLink
        ? `<a href="${escapeHtml(safeLink)}" target="_blank" rel="noopener noreferrer" style="text-decoration:none;border:0;">${imgTag}</a>`
        : imgTag;
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0;"><tr><td align="${align}">${wrapped}</td></tr></table>`,
        text: safeLink ? `[Image: ${altText}] (${safeLink})` : `[Image: ${altText}]`,
      };
    }

    case "button": {
      const safeUrl = resolveSafeUrlOnRender(block.url, variables, false);
      const label = substituteVariablesRaw(block.label, variables);
      const prefix = substituteVariablesRaw(block.prefixText || "", variables);
      if (!safeUrl || !label) return { html: "", text: "" };
      const align = block.align || "left";
      const bg = sanitizeHexColor(block.bgColor || buttonColor, buttonColor);
      const fg = sanitizeHexColor(block.textColor || buttonTextColor, buttonTextColor);

      if (block.displayStyle === "text_link") {
        const prefixHtml = prefix ? `${escapeHtml(prefix)}: ` : "";
        return {
          html: `<p style="margin:20px 0 0 0;font-size:14px;line-height:1.6;text-align:${align};font-family:${fontCss};color:#18181b;">${prefixHtml}<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)};text-decoration:underline;word-break:break-all;">${escapeHtml(label)}</a></p>`,
          text: prefix ? `${prefix}: ${safeUrl}` : `${label}: ${safeUrl}`,
        };
      }

      const isOutline = block.displayStyle === "outline";
      const btnStyle = isOutline
        ? `display:inline-block;padding:11px 22px;font-size:14px;font-weight:600;color:${escapeHtml(bg)};background-color:#ffffff;border:1px solid ${escapeHtml(bg)};border-radius:6px;text-decoration:none;font-family:${fontCss};`
        : `display:inline-block;padding:12px 24px;font-size:14px;font-weight:600;color:${escapeHtml(fg)};background-color:${escapeHtml(bg)};border:1px solid ${escapeHtml(bg)};border-radius:6px;text-decoration:none;font-family:${fontCss};`;

      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:20px 0 4px 0;"><tr><td align="${align}">${
          prefix
            ? `<div style="margin:0 0 8px 0;font-size:13px;color:#52525b;font-family:${fontCss};">${escapeHtml(prefix)}</div>`
            : ""
        }<a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer" style="${btnStyle}">${escapeHtml(label)}</a></td></tr></table>`,
        text: prefix ? `${prefix}\n${label}: ${safeUrl}` : `${label}: ${safeUrl}`,
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
      const leftText = substituteVariablesRaw(block.leftText || "", variables);
      const rightTitle = substituteVariablesRaw(block.rightTitle || "", variables);
      const rightText = substituteVariablesRaw(block.rightText || "", variables);
      if (!leftText && !rightText && !leftTitle && !rightTitle) return { html: "", text: "" };

      const html = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:16px 0;border:1px solid #e4e4e7;border-radius:6px;background-color:#fafafa;">
        <tr>
          <td width="50%" valign="top" style="padding:14px;font-family:${fontCss};border-right:1px solid #e4e4e7;">
            ${leftTitle ? `<div style="font-size:12px;font-weight:700;color:${escapeHtml(secondaryColor)};margin:0 0 6px 0;">${escapeHtml(leftTitle)}</div>` : ""}
            <div style="font-size:13px;line-height:1.5;color:#27272a;">${renderMultilineEscaped(leftText)}</div>
          </td>
          <td width="50%" valign="top" style="padding:14px;font-family:${fontCss};">
            ${rightTitle ? `<div style="font-size:12px;font-weight:700;color:${escapeHtml(secondaryColor)};margin:0 0 6px 0;">${escapeHtml(rightTitle)}</div>` : ""}
            <div style="font-size:13px;line-height:1.5;color:#27272a;">${renderMultilineEscaped(rightText)}</div>
          </td>
        </tr>
      </table>`;
      const text = [
        [leftTitle, leftText].filter(Boolean).join(": "),
        [rightTitle, rightText].filter(Boolean).join(": "),
      ]
        .filter(Boolean)
        .join("\n");
      return { html, text };
    }

    case "social_links": {
      const safeLinks = (block.links || [])
        .map((item) => ({
          label: substituteVariablesRaw(item.label, variables),
          url: resolveSafeUrlOnRender(item.url, variables, false),
        }))
        .filter((item) => item.label && item.url);
      if (safeLinks.length === 0) return { html: "", text: "" };
      const align = block.align || "left";
      const title = substituteVariablesRaw(block.title || "", variables);
      const linksHtml = safeLinks
        .map(
          (l) =>
            `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)};text-decoration:underline;font-size:13px;font-weight:600;margin-right:14px;font-family:${fontCss};">${escapeHtml(l.label)}</a>`
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
          ...safeLinks.map((l) => `${l.label}: ${l.url}`),
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
        }))
        .filter((f) => f.label && f.value);

      const contactLinesHtml: string[] = [];
      const contactLinesText: string[] = [];

      if (block.showContactBlock && visibleFields.length > 0) {
        for (const field of visibleFields) {
          let valueHtml = escapeHtml(field.value);
          if (field.key === "email" && isValidEmail(field.value)) {
            valueHtml = `<a href="mailto:${escapeHtml(field.value)}" style="color:#52525b;text-decoration:none;">${escapeHtml(field.value)}</a>`;
          } else if (field.key === "phone") {
            const telCheck = validateEmailUrl(`tel:${field.value}`, { allowContactSchemes: true });
            if (telCheck.valid && telCheck.normalized) {
              valueHtml = `<a href="${escapeHtml(telCheck.normalized)}" style="color:#52525b;text-decoration:none;">${escapeHtml(field.value)}</a>`;
            }
          } else if (field.key === "website") {
            const urlCheck = validateEmailUrl(field.value);
            if (urlCheck.valid && urlCheck.normalized) {
              valueHtml = `<a href="${escapeHtml(urlCheck.normalized)}" target="_blank" rel="noopener noreferrer" style="color:${escapeHtml(primaryColor)};text-decoration:underline;">${escapeHtml(field.value)}</a>`;
            }
          }
          contactLinesHtml.push(
            `<div style="margin:2px 0;">${escapeHtml(field.label)}: ${valueHtml}</div>`
          );
          contactLinesText.push(`${field.label}: ${field.value}`);
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

    default:
      return { html: "", text: "" };
  }
}
