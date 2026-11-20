import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  STANDALONE_FOOTER_BLOCK_TYPES,
  type CustomizableEmailEventType,
  type EmailBlock,
  type EmailTemplateDocument,
  type EmailTemplateVariant,
  type EmailTemplateVersionSnapshot,
  type FooterNavBlock,
  type FooterNavLinkItem,
  type HotelDefaultLinks,
  type HotelEmailSettings,
  type InlineTextLink,
  type LocalizedLinkValue,
  type SupportedEmailLanguage,
} from "../shared/types.ts";
import {
  EMAIL_EVENT_CATALOG,
  buildDefaultTemplateForHotel,
} from "./defaultTemplates.ts";
import { replaceFooterBlocksInList } from "../shared/presets.ts";
import {
  stripDangerousMarkup,
  validateEmailUrl,
  validateHotelEmailSettings,
  validateTemplateVariant,
  type ValidationIssue,
} from "../shared/validation.ts";
import { extractReferencedImages } from "./renderer.ts";
import { fsListCollection, fsReadDoc, fsSetDoc } from "./firestoreRest.ts";
import { isEmailCustomizationEnabled } from "./templateRegistry.ts";

const MAX_VERSION_HISTORY = 10;

export function normalizeLanguageCode(raw?: string | null): SupportedEmailLanguage {
  const lower = String(raw || "").trim().toLowerCase();
  if (lower === "de" || lower.startsWith("de-") || lower.startsWith("de_")) {
    return "de";
  }
  return "en";
}

function cleanUrlOrEmpty(u?: string, allowVar = false, allowContact = false): string {
  if (!u || !u.trim()) return "";
  const res = validateEmailUrl(u.trim(), {
    allowEmpty: true,
    allowVariableToken: allowVar,
    allowContactSchemes: allowContact,
  });
  return res.valid && res.normalized ? res.normalized : "";
}

function sanitizeInlineLinks(links?: InlineTextLink[]): InlineTextLink[] | undefined {
  if (!Array.isArray(links) || links.length === 0) return undefined;
  return links.map((l) => ({
    ...l,
    id: String(l.id || "").trim(),
    label: stripDangerousMarkup(l.label || "").trim(),
    url: cleanUrlOrEmpty(l.url, true, true),
  }));
}

function sanitizeSingleBlockDeep(block: EmailBlock): EmailBlock {
  switch (block.type) {
    case "heading":
      return { ...block, text: stripDangerousMarkup(block.text || "") };
    case "paragraph":
      return {
        ...block,
        text: stripDangerousMarkup(block.text || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
      };
    case "image":
      return {
        ...block,
        src: cleanUrlOrEmpty(block.src),
        alt: stripDangerousMarkup(block.alt || "").trim(),
        linkUrl: cleanUrlOrEmpty(block.linkUrl, true),
      };
    case "button":
      return {
        ...block,
        label: stripDangerousMarkup(block.label || "").trim(),
        prefixText: block.prefixText ? stripDangerousMarkup(block.prefixText) : undefined,
        url: cleanUrlOrEmpty(block.url, true, true),
      };
    case "booking_details_table":
      return {
        ...block,
        title: block.title ? stripDangerousMarkup(block.title) : undefined,
        rows: (block.rows || []).map((r) => ({
          ...r,
          label: stripDangerousMarkup(r.label || ""),
          valueTemplate: stripDangerousMarkup(r.valueTemplate || ""),
        })),
      };
    case "two_column_text":
      return {
        ...block,
        leftTitle: block.leftTitle ? stripDangerousMarkup(block.leftTitle) : undefined,
        leftText: stripDangerousMarkup(block.leftText || ""),
        rightTitle: block.rightTitle ? stripDangerousMarkup(block.rightTitle) : undefined,
        rightText: stripDangerousMarkup(block.rightText || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
      };
    case "social_links":
      return {
        ...block,
        title: block.title ? stripDangerousMarkup(block.title) : undefined,
        links: (block.links || []).map((l) => ({
          ...l,
          label: stripDangerousMarkup(l.label || "").trim(),
          url: cleanUrlOrEmpty(l.url, true),
        })),
      };
    case "footer":
      return {
        ...block,
        contactTitle: stripDangerousMarkup(block.contactTitle || ""),
        legalImprintText: block.legalImprintText
          ? stripDangerousMarkup(block.legalImprintText)
          : undefined,
        footerNote: block.footerNote ? stripDangerousMarkup(block.footerNote) : undefined,
        fields: (block.fields || []).map((f) => ({
          ...f,
          label: stripDangerousMarkup(f.label || ""),
          valueTemplate: stripDangerousMarkup(f.valueTemplate || ""),
        })),
      };
    case "brand_header":
      return {
        ...block,
        logoUrl: cleanUrlOrEmpty(block.logoUrl),
        logoAlt: block.logoAlt ? stripDangerousMarkup(block.logoAlt).trim() : undefined,
        logoLinkUrl: cleanUrlOrEmpty(block.logoLinkUrl, true),
        phoneOverride: block.phoneOverride ? stripDangerousMarkup(block.phoneOverride).trim() : undefined,
        emailOverride: block.emailOverride ? stripDangerousMarkup(block.emailOverride).trim() : undefined,
      };
    case "promo_banner":
      return {
        ...block,
        imageUrl: cleanUrlOrEmpty(block.imageUrl),
        imageAlt: block.imageAlt ? stripDangerousMarkup(block.imageAlt).trim() : undefined,
        imageLinkUrl: cleanUrlOrEmpty(block.imageLinkUrl, true),
        text: stripDangerousMarkup(block.text || ""),
        buttonLabel: stripDangerousMarkup(block.buttonLabel || "").trim(),
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "membership_strip":
      return {
        ...block,
        tierTemplate: stripDangerousMarkup(block.tierTemplate || "").trim(),
        pointsTemplate: stripDangerousMarkup(block.pointsTemplate || "").trim(),
        linkUrl: cleanUrlOrEmpty(block.linkUrl, true),
      };
    case "hero_text":
      return {
        ...block,
        headline: stripDangerousMarkup(block.headline || "").trim(),
        body: stripDangerousMarkup(block.body || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "confirmation_number":
      return {
        ...block,
        label: stripDangerousMarkup(block.label || "").trim(),
        valueTemplate: stripDangerousMarkup(block.valueTemplate || "").trim(),
      };
    case "stay_dates":
      return {
        ...block,
        checkInLabel: stripDangerousMarkup(block.checkInLabel || "").trim(),
        checkInDateTemplate: stripDangerousMarkup(block.checkInDateTemplate || "").trim(),
        checkInTimeTemplate: stripDangerousMarkup(block.checkInTimeTemplate || "").trim(),
        checkOutLabel: stripDangerousMarkup(block.checkOutLabel || "").trim(),
        checkOutDateTemplate: stripDangerousMarkup(block.checkOutDateTemplate || "").trim(),
        checkOutTimeTemplate: stripDangerousMarkup(block.checkOutTimeTemplate || "").trim(),
        buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "feature_card":
      return {
        ...block,
        imageUrl: cleanUrlOrEmpty(block.imageUrl),
        imageAlt: stripDangerousMarkup(block.imageAlt || "").trim(),
        imageLinkUrl: cleanUrlOrEmpty(block.imageLinkUrl, true),
        title: stripDangerousMarkup(block.title || "").trim(),
        body: stripDangerousMarkup(block.body || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "benefits_list":
      return {
        ...block,
        badgeText: block.badgeText ? stripDangerousMarkup(block.badgeText).trim() : undefined,
        badgeImageUrl: cleanUrlOrEmpty(block.badgeImageUrl),
        badgeImageAlt: block.badgeImageAlt ? stripDangerousMarkup(block.badgeImageAlt).trim() : undefined,
        badgeImageLinkUrl: cleanUrlOrEmpty(block.badgeImageLinkUrl, true),
        heading: stripDangerousMarkup(block.heading || "").trim(),
        items: (block.items || []).map((it) => ({
          ...it,
          text: stripDangerousMarkup(it.text || "").trim(),
        })),
        footnote: block.footnote ? stripDangerousMarkup(block.footnote) : undefined,
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "icon_link_grid":
      return {
        ...block,
        heading: block.heading ? stripDangerousMarkup(block.heading).trim() : undefined,
        subheading: block.subheading ? stripDangerousMarkup(block.subheading) : undefined,
        items: (block.items || []).map((it) => ({
          ...it,
          label: stripDangerousMarkup(it.label || "").trim(),
          url: cleanUrlOrEmpty(it.url, true, true),
        })),
      };
    case "image_with_list":
      return {
        ...block,
        imageUrl: cleanUrlOrEmpty(block.imageUrl),
        imageAlt: stripDangerousMarkup(block.imageAlt || "").trim(),
        imageLinkUrl: cleanUrlOrEmpty(block.imageLinkUrl, true),
        heading: stripDangerousMarkup(block.heading || "").trim(),
        items: (block.items || []).map((it) => ({
          ...it,
          text: stripDangerousMarkup(it.text || "").trim(),
        })),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
        buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true, true),
      };
    case "footer_nav":
      return {
        ...block,
        links: (block.links || []).map((l) => ({
          ...l,
          label: stripDangerousMarkup(l.label || "").trim(),
          url: cleanUrlOrEmpty(l.url, true, true),
        })),
        secondaryText: block.secondaryText ? stripDangerousMarkup(block.secondaryText).trim() : undefined,
        secondaryLinkUrl: cleanUrlOrEmpty(block.secondaryLinkUrl, true, true),
      };
    case "legal_section":
      return {
        ...block,
        sections: (block.sections || []).map((s) => ({
          ...s,
          heading: stripDangerousMarkup(s.heading || "").trim(),
          body: stripDangerousMarkup(s.body || ""),
        })),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        copyrightText: block.copyrightText ? stripDangerousMarkup(block.copyrightText).trim() : undefined,
        footerLogoUrl: cleanUrlOrEmpty(block.footerLogoUrl),
        footerLogoAlt: block.footerLogoAlt ? stripDangerousMarkup(block.footerLogoAlt).trim() : undefined,
        footerLogoLinkUrl: cleanUrlOrEmpty(block.footerLogoLinkUrl, true),
      };
    case "footer_contact":
      return {
        ...block,
        heading: stripDangerousMarkup(block.heading || "").trim(),
        text: stripDangerousMarkup(block.text || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        emailOverride: block.emailOverride ? stripDangerousMarkup(block.emailOverride).trim() : undefined,
        phoneOverride: block.phoneOverride ? stripDangerousMarkup(block.phoneOverride).trim() : undefined,
      };
    case "footer_authenticity":
    case "footer_legal":
      return {
        ...block,
        heading: stripDangerousMarkup(block.heading || "").trim(),
        text: stripDangerousMarkup(block.text || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
      };
    case "footer_copyright":
      return {
        ...block,
        text: stripDangerousMarkup(block.text || ""),
        ...(block.inlineLinks ? { inlineLinks: sanitizeInlineLinks(block.inlineLinks) } : {}),
        footerLogoUrl: cleanUrlOrEmpty(block.footerLogoUrl),
        footerLogoAlt: block.footerLogoAlt ? stripDangerousMarkup(block.footerLogoAlt).trim() : undefined,
        footerLogoLinkUrl: cleanUrlOrEmpty(block.footerLogoLinkUrl, true),
      };
    case "footer_powered_by":
      return {
        ...block,
        text: stripDangerousMarkup(block.text || "").trim(),
        linkLabel: block.linkLabel ? stripDangerousMarkup(block.linkLabel).trim() : undefined,
        linkUrl: cleanUrlOrEmpty(block.linkUrl, true, true),
      };
    default:
      return block;
  }
}

function sanitizeVariantTextDeep(variant: EmailTemplateVariant): EmailTemplateVariant {
  return {
    ...(variant.schemaVersion ? { schemaVersion: variant.schemaVersion } : {}),
    subject: stripDangerousMarkup(variant.subject || "").trim(),
    preheader: stripDangerousMarkup(variant.preheader || "").trim(),
    portalUrlOverride: cleanUrlOrEmpty(variant.portalUrlOverride),
    branding: {
      ...variant.branding,
      eyebrowText: stripDangerousMarkup(variant.branding?.eyebrowText || "").trim(),
      logoUrl: cleanUrlOrEmpty(variant.branding?.logoUrl),
      logoAlt: stripDangerousMarkup(variant.branding?.logoAlt || "").trim(),
      ...(variant.branding?.logoLinkUrl !== undefined
        ? { logoLinkUrl: cleanUrlOrEmpty(variant.branding.logoLinkUrl, true) }
        : {}),
    },
    blocks: (variant.blocks || []).map(sanitizeSingleBlockDeep),
  };
}

function sanitizeDefaultFooterBlocks(
  raw: HotelEmailSettings["defaultFooterBlocks"]
): Partial<Record<SupportedEmailLanguage, EmailBlock[]>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<SupportedEmailLanguage, EmailBlock[]>> = {};
  for (const lang of ["en", "de"] as const) {
    if (Array.isArray(raw[lang])) {
      out[lang] = raw[lang]!.map(sanitizeSingleBlockDeep);
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const DEFAULT_LINK_KEYS: Array<keyof HotelDefaultLinks> = [
  "website",
  "booking",
  "portal",
  "review",
  "directions",
  "wifiGuide",
  "socialInstagram",
  "socialFacebook",
  "socialX",
  "socialLinkedin",
];

function sanitizeLocalizedLinkValue(raw?: LocalizedLinkValue): LocalizedLinkValue | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const defaultUrl =
    typeof raw.defaultUrl === "string" ? raw.defaultUrl.trim().replace(/\/+$/, "") : "";
  const enUrl =
    typeof raw.byLanguage?.en === "string" ? raw.byLanguage.en.trim().replace(/\/+$/, "") : "";
  const deUrl =
    typeof raw.byLanguage?.de === "string" ? raw.byLanguage.de.trim().replace(/\/+$/, "") : "";
  const byLanguage: Partial<Record<SupportedEmailLanguage, string>> = {};
  if (enUrl) byLanguage.en = enUrl;
  if (deUrl) byLanguage.de = deUrl;
  if (!defaultUrl && Object.keys(byLanguage).length === 0) return undefined;
  return {
    ...(defaultUrl ? { defaultUrl } : {}),
    ...(Object.keys(byLanguage).length > 0 ? { byLanguage } : {}),
  };
}

function sanitizeDefaultLinks(raw?: HotelDefaultLinks): HotelDefaultLinks | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: HotelDefaultLinks = {};
  for (const key of DEFAULT_LINK_KEYS) {
    const cleaned = sanitizeLocalizedLinkValue(raw[key]);
    if (cleaned) out[key] = cleaned;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDefaultFooterNavLinks(
  raw?: HotelEmailSettings["defaultFooterNavLinks"]
): Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>> = {};
  for (const lang of ["en", "de"] as const) {
    if (Array.isArray(raw[lang])) {
      out[lang] = raw[lang]!.map((item, idx) => ({
        ...item,
        id: String(item.id || `nav_${lang}_${idx + 1}`).trim(),
        label: stripDangerousMarkup(item.label || "").trim(),
        url: typeof item.url === "string" ? item.url.trim() : "",
      }));
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export async function getHotelEmailSettings(
  hotelId: string,
  bearerToken?: string
): Promise<HotelEmailSettings> {
  try {
    const doc = await fsReadDoc(`hotels/${hotelId}/emailSettings/default`, bearerToken);
    if (!doc) return { ...DEFAULT_HOTEL_EMAIL_SETTINGS };
    return {
      ...DEFAULT_HOTEL_EMAIL_SETTINGS,
      ...doc,
      defaultLanguage: normalizeLanguageCode(doc.defaultLanguage),
      currencyDisplay: {
        ...DEFAULT_HOTEL_EMAIL_SETTINGS.currencyDisplay,
        ...(doc.currencyDisplay && typeof doc.currencyDisplay === "object"
          ? doc.currencyDisplay
          : {}),
      },
      contactOverrides: {
        ...(doc.contactOverrides && typeof doc.contactOverrides === "object"
          ? doc.contactOverrides
          : {}),
      },
      defaultFooterBlocks:
        doc.defaultFooterBlocks && typeof doc.defaultFooterBlocks === "object"
          ? doc.defaultFooterBlocks
          : undefined,
      defaultLinks:
        doc.defaultLinks && typeof doc.defaultLinks === "object"
          ? doc.defaultLinks
          : undefined,
      defaultFooterNavLinks:
        doc.defaultFooterNavLinks && typeof doc.defaultFooterNavLinks === "object"
          ? doc.defaultFooterNavLinks
          : undefined,
    };
  } catch {
    return { ...DEFAULT_HOTEL_EMAIL_SETTINGS };
  }
}

export async function saveHotelEmailSettings(
  hotelId: string,
  input: Partial<HotelEmailSettings>,
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; settings?: HotelEmailSettings; issues?: ValidationIssue[]; error?: string }> {
  const merged: HotelEmailSettings = {
    ...DEFAULT_HOTEL_EMAIL_SETTINGS,
    ...input,
    portalUrl: typeof input.portalUrl === "string" ? input.portalUrl.trim().replace(/\/+$/, "") : "",
    bookingUrl: typeof input.bookingUrl === "string" ? input.bookingUrl.trim().replace(/\/+$/, "") : "",
    senderDisplayName:
      typeof input.senderDisplayName === "string"
        ? stripDangerousMarkup(input.senderDisplayName).trim()
        : "",
    replyToEmail: typeof input.replyToEmail === "string" ? input.replyToEmail.trim() : "",
    defaultLanguage: normalizeLanguageCode(input.defaultLanguage),
    timeZone: typeof input.timeZone === "string" && input.timeZone.trim() ? input.timeZone.trim() : "UTC",
    dateFormat: input.dateFormat || "iso",
    timeFormat: input.timeFormat === "12h" ? "12h" : "24h",
    currencyDisplay: {
      mode: input.currencyDisplay?.mode === "symbol" ? "symbol" : "code",
      decimals: input.currencyDisplay?.decimals === 0 ? 0 : 2,
      thousandsSeparator:
        input.currencyDisplay?.thousandsSeparator === "." ||
        input.currencyDisplay?.thousandsSeparator === " "
          ? input.currencyDisplay.thousandsSeparator
          : ",",
    },
    preArrivalDaysBefore: Number.isInteger(input.preArrivalDaysBefore)
      ? Number(input.preArrivalDaysBefore)
      : 1,
    postStayDaysAfter: Number.isInteger(input.postStayDaysAfter)
      ? Number(input.postStayDaysAfter)
      : 1,
    contactOverrides: {
      address: stripDangerousMarkup(input.contactOverrides?.address || "").trim(),
      phone: stripDangerousMarkup(input.contactOverrides?.phone || "").trim(),
      email: (input.contactOverrides?.email || "").trim(),
      website: (input.contactOverrides?.website || "").trim().replace(/\/+$/, ""),
    },
    legalImprint: stripDangerousMarkup(input.legalImprint || "").trim(),
    ...(input.defaultFooterBlocks !== undefined
      ? { defaultFooterBlocks: sanitizeDefaultFooterBlocks(input.defaultFooterBlocks) }
      : {}),
    ...(input.defaultLinks !== undefined
      ? { defaultLinks: sanitizeDefaultLinks(input.defaultLinks) }
      : {}),
    ...(input.defaultFooterNavLinks !== undefined
      ? { defaultFooterNavLinks: sanitizeDefaultFooterNavLinks(input.defaultFooterNavLinks) }
      : {}),
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };

  const issues = validateHotelEmailSettings(merged);
  if (issues.length > 0) {
    return { ok: false, issues, error: issues[0].message };
  }

  const writeRes = await fsSetDoc(`hotels/${hotelId}/emailSettings/default`, merged, bearerToken);
  if (!writeRes.ok) {
    return { ok: false, error: "Could not save email settings." };
  }
  return { ok: true, settings: merged };
}

/**
 * Pure helper that applies saved reusable default footer blocks ONLY to a template document's
 * drafts (never modifying `published`, `publishedVersion`, or `isCustomized`).
 */
export function applyDefaultFooterToTemplateDoc(
  doc: EmailTemplateDocument,
  defaultFooterBlocks: Partial<Record<SupportedEmailLanguage, EmailBlock[]>>,
  actor: string,
  nowIso = new Date().toISOString()
): EmailTemplateDocument {
  const nextDraft: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>> = {
    ...doc.draft,
  };

  for (const lang of ["en", "de"] as const) {
    const footerForLang = defaultFooterBlocks[lang];
    const baseDraft = nextDraft[lang] || doc.published[lang];
    if (!footerForLang || !baseDraft) continue;

    const includesNav = footerForLang.some((b) => b.type === "footer_nav");
    const includesSocial = footerForLang.some((b) => b.type === "social_links");
    const nextBlocks = replaceFooterBlocksInList(baseDraft.blocks, footerForLang, {
      replaceNav: includesNav,
      replaceSocial: includesSocial,
    });

    nextDraft[lang] = {
      ...baseDraft,
      schemaVersion: 3,
      blocks: nextBlocks,
    };
  }

  return {
    ...doc,
    // Explicitly preserve live published version untouched
    isCustomized: doc.isCustomized,
    publishedVersion: doc.publishedVersion,
    published: doc.published,
    draft: nextDraft,
    updatedBy: actor,
    updatedAt: nowIso,
  };
}

/**
 * Copies the hotel's saved Default Footer into DRAFTS ONLY across all customizable email events.
 * Published templates are never modified automatically; admins still publish each event manually.
 */
export async function applyDefaultFooterToAllDrafts(
  hotelId: string,
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string,
  overrideFooterBlocks?: Partial<Record<SupportedEmailLanguage, EmailBlock[]>>
): Promise<{
  ok: boolean;
  updatedEvents?: CustomizableEmailEventType[];
  issues?: ValidationIssue[];
  error?: string;
}> {
  const settings = await getHotelEmailSettings(hotelId, bearerToken);
  const rawFooter = overrideFooterBlocks ?? settings.defaultFooterBlocks;
  const sanitizedFooter = sanitizeDefaultFooterBlocks(rawFooter);

  if (!sanitizedFooter || (!sanitizedFooter.en && !sanitizedFooter.de)) {
    return {
      ok: false,
      error: "Save a Default Footer first before applying it to all events.",
    };
  }

  const issues = validateHotelEmailSettings({ defaultFooterBlocks: sanitizedFooter });
  if (issues.length > 0) {
    return { ok: false, issues, error: issues[0].message };
  }

  const updatedEvents: CustomizableEmailEventType[] = [];
  const nowIso = new Date().toISOString();

  for (const eventType of CUSTOMIZABLE_EMAIL_EVENTS) {
    const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
    const nextDoc = applyDefaultFooterToTemplateDoc(current, sanitizedFooter, actor, nowIso);
    const writeRes = await fsSetDoc(
      `hotels/${hotelId}/emailTemplates/${eventType}`,
      nextDoc,
      bearerToken
    );
    if (!writeRes.ok) {
      return {
        ok: false,
        error: `Could not update draft for ${eventType}.`,
        updatedEvents,
      };
    }
    updatedEvents.push(eventType);
  }

  return { ok: true, updatedEvents };
}

/**
 * Pure helper that applies saved Hotel Default Footer Navigation Links ONLY to a template
 * document's DRAFTS (never modifying `published`, `publishedVersion`, or `isCustomized`).
 * Replaces the `links` array of any existing `footer_nav` block in each language draft,
 * or inserts a clean `footer_nav` block right before standalone footer blocks if none exists.
 */
export function applyDefaultLinksToTemplateDoc(
  doc: EmailTemplateDocument,
  defaultFooterNavLinks: Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>>,
  actor: string,
  nowIso = new Date().toISOString()
): EmailTemplateDocument {
  const nextDraft: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>> = {
    ...doc.draft,
  };
  const footerTypes = new Set<string>([...STANDALONE_FOOTER_BLOCK_TYPES, "legal_section", "footer"]);

  for (const lang of ["en", "de"] as const) {
    const navForLang = defaultFooterNavLinks[lang];
    const baseDraft = nextDraft[lang] || doc.published[lang];
    if (!navForLang || !baseDraft) continue;

    const clonedLinks: FooterNavLinkItem[] = navForLang.map((item, idx) => ({
      ...item,
      id: item.id || `nav_${lang}_${idx + 1}`,
    }));

    const existingIdx = baseDraft.blocks.findIndex((b) => b.type === "footer_nav");
    let nextBlocks: EmailBlock[];
    if (existingIdx >= 0) {
      nextBlocks = baseDraft.blocks.map((b, i) =>
        i === existingIdx && b.type === "footer_nav"
          ? { ...b, links: clonedLinks }
          : b
      );
    } else {
      const newNavBlock: FooterNavBlock = {
        id: `blk_footer_nav_${lang}`,
        type: "footer_nav",
        links: clonedLinks,
      };
      const firstFooterIdx = baseDraft.blocks.findIndex((b) => footerTypes.has(b.type));
      if (firstFooterIdx >= 0) {
        nextBlocks = [
          ...baseDraft.blocks.slice(0, firstFooterIdx),
          newNavBlock,
          ...baseDraft.blocks.slice(firstFooterIdx),
        ];
      } else {
        nextBlocks = [...baseDraft.blocks, newNavBlock];
      }
    }

    const nextSchemaVersion: 1 | 2 | 3 | 4 | undefined =
      baseDraft.schemaVersion === 4 || baseDraft.schemaVersion === 3 || baseDraft.schemaVersion === 2
        ? 4
        : baseDraft.schemaVersion;

    nextDraft[lang] = {
      ...baseDraft,
      ...(nextSchemaVersion ? { schemaVersion: nextSchemaVersion } : {}),
      blocks: nextBlocks,
    };
  }

  return {
    ...doc,
    // Explicitly preserve live published version untouched
    isCustomized: doc.isCustomized,
    publishedVersion: doc.publishedVersion,
    published: doc.published,
    draft: nextDraft,
    updatedBy: actor,
    updatedAt: nowIso,
  };
}

/**
 * Copies the hotel's saved Default Footer Navigation Links into DRAFTS ONLY across all
 * customizable email events. Published templates are never modified automatically.
 */
export async function applyDefaultLinksToAllDrafts(
  hotelId: string,
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string,
  overrideFooterNavLinks?: Partial<Record<SupportedEmailLanguage, FooterNavLinkItem[]>>
): Promise<{
  ok: boolean;
  updatedEvents?: CustomizableEmailEventType[];
  issues?: ValidationIssue[];
  error?: string;
}> {
  const settings = await getHotelEmailSettings(hotelId, bearerToken);
  const rawNav = overrideFooterNavLinks ?? settings.defaultFooterNavLinks;
  const sanitizedNav = sanitizeDefaultFooterNavLinks(rawNav);

  if (!sanitizedNav || (!sanitizedNav.en && !sanitizedNav.de)) {
    return {
      ok: false,
      error: "Add and save Default Footer Navigation Links first before applying to all events.",
    };
  }

  const issues = validateHotelEmailSettings({ defaultFooterNavLinks: sanitizedNav });
  if (issues.length > 0) {
    return { ok: false, issues, error: issues[0].message };
  }

  const updatedEvents: CustomizableEmailEventType[] = [];
  const nowIso = new Date().toISOString();

  for (const eventType of CUSTOMIZABLE_EMAIL_EVENTS) {
    const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
    const nextDoc = applyDefaultLinksToTemplateDoc(current, sanitizedNav, actor, nowIso);
    const writeRes = await fsSetDoc(
      `hotels/${hotelId}/emailTemplates/${eventType}`,
      nextDoc,
      bearerToken
    );
    if (!writeRes.ok) {
      return {
        ok: false,
        error: `Could not update draft for ${eventType}.`,
        updatedEvents,
      };
    }
    updatedEvents.push(eventType);
  }

  return { ok: true, updatedEvents };
}

export function buildEmptyTemplateDocument(
  eventType: CustomizableEmailEventType,
  hotelDoc: Record<string, any> | null | undefined,
  defaultLanguage: SupportedEmailLanguage = "en"
): EmailTemplateDocument {
  const enDefault = buildDefaultTemplateForHotel(eventType, hotelDoc, "en");
  const deDefault = buildDefaultTemplateForHotel(eventType, hotelDoc, "de");
  return {
    eventType,
    enabled: true,
    isCustomized: false,
    defaultLanguage,
    publishedVersion: 0,
    draft: { en: enDefault, de: deDefault },
    published: { en: enDefault, de: deDefault },
    versions: [],
  };
}

export async function getEmailTemplateDocument(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  hotelDoc: Record<string, any> | null | undefined,
  bearerToken?: string
): Promise<EmailTemplateDocument> {
  const settings = await getHotelEmailSettings(hotelId, bearerToken);
  const fallback = buildEmptyTemplateDocument(eventType, hotelDoc, settings.defaultLanguage);
  try {
    const stored = await fsReadDoc(`hotels/${hotelId}/emailTemplates/${eventType}`, bearerToken);
    if (!stored) return fallback;
    return {
      eventType,
      enabled: stored.enabled !== false,
      isCustomized: stored.isCustomized === true,
      defaultLanguage: normalizeLanguageCode(stored.defaultLanguage || settings.defaultLanguage),
      publishedVersion: typeof stored.publishedVersion === "number" ? stored.publishedVersion : 0,
      draft: {
        en: stored.draft?.en || fallback.draft.en,
        de: stored.draft?.de || fallback.draft.de,
      },
      published: {
        en: stored.published?.en || fallback.published.en,
        de: stored.published?.de || fallback.published.de,
      },
      versions: Array.isArray(stored.versions) ? stored.versions.slice(0, MAX_VERSION_HISTORY) : [],
      updatedBy: typeof stored.updatedBy === "string" ? stored.updatedBy : undefined,
      updatedAt: typeof stored.updatedAt === "string" ? stored.updatedAt : undefined,
    };
  } catch {
    return fallback;
  }
}

export interface EmailTemplateOverviewItem {
  eventType: CustomizableEmailEventType;
  name: string;
  description: string;
  enabled: boolean;
  isCustomized: boolean;
  publishedVersion: number;
  hasDraftChanges: boolean;
  requiresScheduler: boolean;
  languagesAvailable: SupportedEmailLanguage[];
  updatedAt?: string;
  updatedBy?: string;
}

export async function listEmailTemplatesOverview(
  hotelId: string,
  bearerToken?: string
): Promise<EmailTemplateOverviewItem[]> {
  let storedDocs: Array<Record<string, any> & { id: string }> = [];
  try {
    storedDocs = await fsListCollection(`hotels/${hotelId}/emailTemplates`, bearerToken);
  } catch {
    storedDocs = [];
  }
  const byEvent = new Map<string, Record<string, any>>();
  for (const d of storedDocs) {
    byEvent.set(d.id || d.eventType, d);
  }

  return CUSTOMIZABLE_EMAIL_EVENTS.map((eventType) => {
    const meta = EMAIL_EVENT_CATALOG[eventType];
    const stored = byEvent.get(eventType);
    const isCustomized = stored?.isCustomized === true;
    const enabled = stored ? stored.enabled !== false : true;
    const publishedVersion =
      typeof stored?.publishedVersion === "number" ? stored.publishedVersion : 0;

    let hasDraftChanges = false;
    if (stored?.draft && stored?.published) {
      try {
        hasDraftChanges = JSON.stringify(stored.draft) !== JSON.stringify(stored.published);
      } catch {
        hasDraftChanges = false;
      }
    }

    const langs: SupportedEmailLanguage[] = ["en", "de"];
    return {
      eventType,
      name: meta.name,
      description: meta.description,
      enabled,
      isCustomized,
      publishedVersion,
      hasDraftChanges,
      requiresScheduler: Boolean(meta.requiresScheduler),
      languagesAvailable: langs,
      updatedAt: typeof stored?.updatedAt === "string" ? stored.updatedAt : undefined,
      updatedBy: typeof stored?.updatedBy === "string" ? stored.updatedBy : undefined,
    };
  });
}

export interface ResolvedTemplateResult {
  enabled: boolean;
  language: SupportedEmailLanguage;
  variant: EmailTemplateVariant;
  settings: HotelEmailSettings;
  usedDefaultLayout: boolean;
  publishedVersion: number;
}

/**
 * Resolves the effective template & settings for sending a real email.
 * - If feature flag `EMAIL_CUSTOMIZATION_ENABLED` is off (globally or per hotel), always uses exact defaults.
 * - If hotel has NOT customized this event, always uses exact defaults.
 * - If hotel disabled this event, returns `{ enabled: false }` so dispatcher skips silently.
 */
export async function resolveEffectiveTemplate(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  hotelDoc: Record<string, any> | null | undefined,
  guestLanguage?: string | null,
  bearerToken?: string
): Promise<ResolvedTemplateResult> {
  if (!isEmailCustomizationEnabled(hotelDoc)) {
    return {
      enabled: true,
      language: "en",
      variant: buildDefaultTemplateForHotel(eventType, hotelDoc, "en"),
      settings: { ...DEFAULT_HOTEL_EMAIL_SETTINGS },
      usedDefaultLayout: true,
      publishedVersion: 0,
    };
  }

  const [settings, stored] = await Promise.all([
    getHotelEmailSettings(hotelId, bearerToken),
    fsReadDoc(`hotels/${hotelId}/emailTemplates/${eventType}`, bearerToken).catch(() => null),
  ]);

  const preferredLang = guestLanguage
    ? normalizeLanguageCode(guestLanguage)
    : settings.defaultLanguage || "en";

  if (stored && stored.enabled === false) {
    return {
      enabled: false,
      language: preferredLang,
      variant: buildDefaultTemplateForHotel(eventType, hotelDoc, preferredLang),
      settings,
      usedDefaultLayout: true,
      publishedVersion: typeof stored.publishedVersion === "number" ? stored.publishedVersion : 0,
    };
  }

  if (stored && stored.isCustomized === true && stored.published && typeof stored.published === "object") {
    const candidateVariant: EmailTemplateVariant | undefined =
      stored.published[preferredLang] ||
      stored.published[settings.defaultLanguage] ||
      stored.published.en ||
      stored.published.de;

    if (candidateVariant && Array.isArray(candidateVariant.blocks) && candidateVariant.blocks.length > 0) {
      return {
        enabled: true,
        language: preferredLang,
        variant: candidateVariant,
        settings,
        usedDefaultLayout: false,
        publishedVersion: typeof stored.publishedVersion === "number" ? stored.publishedVersion : 1,
      };
    }
  }

  return {
    enabled: true,
    language: preferredLang,
    variant: buildDefaultTemplateForHotel(eventType, hotelDoc, preferredLang),
    settings,
    usedDefaultLayout: true,
    publishedVersion: 0,
  };
}

export async function saveTemplateVariant(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  payload: {
    language: SupportedEmailLanguage;
    variant: EmailTemplateVariant;
    publish: boolean;
    note?: string;
    enabled?: boolean;
  },
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; doc?: EmailTemplateDocument; issues?: ValidationIssue[]; error?: string }> {
  const lang = normalizeLanguageCode(payload.language);
  const issues = validateTemplateVariant(payload.variant);
  if (issues.length > 0) {
    return { ok: false, issues, error: issues[0].message };
  }

  const sanitized = sanitizeVariantTextDeep(payload.variant);
  const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
  const now = new Date().toISOString();

  const nextDraft: Partial<Record<SupportedEmailLanguage, EmailTemplateVariant>> = {
    ...current.draft,
    [lang]: sanitized,
  };

  let nextPublished = { ...current.published };
  let nextVersion = current.publishedVersion;
  let nextIsCustomized = current.isCustomized;
  let nextVersions = [...(current.versions || [])];

  if (payload.publish) {
    nextPublished = {
      ...nextPublished,
      [lang]: sanitized,
    };
    nextVersion = current.publishedVersion + 1;
    nextIsCustomized = true;

    const snapshot: EmailTemplateVersionSnapshot = {
      version: nextVersion,
      savedAt: now,
      savedBy: actor,
      note: payload.note ? stripDangerousMarkup(payload.note).trim().slice(0, 120) : undefined,
      variants: nextPublished,
    };
    nextVersions = [snapshot, ...nextVersions].slice(0, MAX_VERSION_HISTORY);
  }

  const updatedDoc: EmailTemplateDocument = {
    eventType,
    enabled: typeof payload.enabled === "boolean" ? payload.enabled : current.enabled,
    isCustomized: nextIsCustomized,
    defaultLanguage: current.defaultLanguage,
    publishedVersion: nextVersion,
    draft: nextDraft,
    published: nextPublished,
    versions: nextVersions,
    updatedBy: actor,
    updatedAt: now,
  };

  const writeRes = await fsSetDoc(
    `hotels/${hotelId}/emailTemplates/${eventType}`,
    updatedDoc,
    bearerToken
  );
  if (!writeRes.ok) {
    return { ok: false, error: "Could not save email template." };
  }

  return { ok: true, doc: updatedDoc };
}

export async function toggleTemplateEnabled(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  enabled: boolean,
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; doc?: EmailTemplateDocument; error?: string }> {
  const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
  const updated: EmailTemplateDocument = {
    ...current,
    enabled: Boolean(enabled),
    updatedBy: actor,
    updatedAt: new Date().toISOString(),
  };
  const writeRes = await fsSetDoc(
    `hotels/${hotelId}/emailTemplates/${eventType}`,
    updated,
    bearerToken
  );
  if (!writeRes.ok) {
    return { ok: false, error: "Could not update event toggle." };
  }
  return { ok: true, doc: updated };
}

export async function resetTemplateToDefault(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; doc?: EmailTemplateDocument; error?: string }> {
  const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
  const enDefault = buildDefaultTemplateForHotel(eventType, hotelDoc, "en");
  const deDefault = buildDefaultTemplateForHotel(eventType, hotelDoc, "de");
  const now = new Date().toISOString();

  const updated: EmailTemplateDocument = {
    eventType,
    enabled: current.enabled,
    isCustomized: false,
    defaultLanguage: current.defaultLanguage,
    publishedVersion: current.publishedVersion,
    draft: { en: enDefault, de: deDefault },
    published: { en: enDefault, de: deDefault },
    versions: current.versions || [],
    updatedBy: actor,
    updatedAt: now,
  };

  const writeRes = await fsSetDoc(
    `hotels/${hotelId}/emailTemplates/${eventType}`,
    updated,
    bearerToken
  );
  if (!writeRes.ok) {
    return { ok: false, error: "Could not reset template to default." };
  }
  return { ok: true, doc: updated };
}

export async function restoreTemplateVersion(
  hotelId: string,
  eventType: CustomizableEmailEventType,
  versionNumber: number,
  hotelDoc: Record<string, any> | null | undefined,
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; doc?: EmailTemplateDocument; error?: string }> {
  const current = await getEmailTemplateDocument(hotelId, eventType, hotelDoc, bearerToken);
  const target = (current.versions || []).find((v) => v.version === versionNumber);
  if (!target || !target.variants) {
    return { ok: false, error: `Version v${versionNumber} was not found.` };
  }

  const now = new Date().toISOString();
  const nextVersion = current.publishedVersion + 1;
  const restoredSnapshot: EmailTemplateVersionSnapshot = {
    version: nextVersion,
    savedAt: now,
    savedBy: actor,
    note: `Restored from v${versionNumber}`,
    variants: target.variants,
  };

  const updated: EmailTemplateDocument = {
    eventType,
    enabled: current.enabled,
    isCustomized: true,
    defaultLanguage: current.defaultLanguage,
    publishedVersion: nextVersion,
    draft: { ...current.draft, ...target.variants },
    published: { ...current.published, ...target.variants },
    versions: [restoredSnapshot, ...(current.versions || [])].slice(0, MAX_VERSION_HISTORY),
    updatedBy: actor,
    updatedAt: now,
  };

  const writeRes = await fsSetDoc(
    `hotels/${hotelId}/emailTemplates/${eventType}`,
    updated,
    bearerToken
  );
  if (!writeRes.ok) {
    return { ok: false, error: "Could not restore template version." };
  }
  return { ok: true, doc: updated };
}

/**
 * Checks whether an image asset (by ID or URL) is referenced by any published or draft template.
 */
export async function findImageReferencesAcrossTemplates(
  hotelId: string,
  imageId: string,
  imageUrl: string,
  bearerToken?: string
): Promise<{
  publishedTemplates: CustomizableEmailEventType[];
  draftTemplates: CustomizableEmailEventType[];
}> {
  const publishedTemplates: CustomizableEmailEventType[] = [];
  const draftTemplates: CustomizableEmailEventType[] = [];

  let storedDocs: Array<Record<string, any> & { id: string }> = [];
  try {
    storedDocs = await fsListCollection(`hotels/${hotelId}/emailTemplates`, bearerToken);
  } catch {
    return { publishedTemplates, draftTemplates };
  }

  const cleanUrl = imageUrl.trim();
  const variantUsesImage = (variant?: EmailTemplateVariant): boolean => {
    if (!variant) return false;
    const refs = extractReferencedImages(variant);
    return refs.imageIds.has(imageId) || (cleanUrl.length > 0 && refs.urls.has(cleanUrl));
  };

  for (const doc of storedDocs) {
    const ev = (doc.eventType || doc.id) as CustomizableEmailEventType;
    if (!EMAIL_EVENT_CATALOG[ev]) continue;

    if (doc.isCustomized === true && doc.published) {
      const usedInPublished =
        variantUsesImage(doc.published.en) || variantUsesImage(doc.published.de);
      if (usedInPublished) publishedTemplates.push(ev);
    }

    if (doc.draft) {
      const usedInDraft = variantUsesImage(doc.draft.en) || variantUsesImage(doc.draft.de);
      if (usedInDraft) draftTemplates.push(ev);
    }
  }

  return { publishedTemplates, draftTemplates };
}
