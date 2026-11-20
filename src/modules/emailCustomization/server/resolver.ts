import {
  CUSTOMIZABLE_EMAIL_EVENTS,
  DEFAULT_HOTEL_EMAIL_SETTINGS,
  type CustomizableEmailEventType,
  type EmailTemplateDocument,
  type EmailTemplateVariant,
  type EmailTemplateVersionSnapshot,
  type HotelEmailSettings,
  type SupportedEmailLanguage,
} from "../shared/types.ts";
import {
  EMAIL_EVENT_CATALOG,
  buildDefaultTemplateForHotel,
} from "./defaultTemplates.ts";
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

function sanitizeVariantTextDeep(variant: EmailTemplateVariant): EmailTemplateVariant {
  const cleanUrlOrEmpty = (u?: string, allowVar = false): string => {
    if (!u || !u.trim()) return "";
    const res = validateEmailUrl(u.trim(), { allowEmpty: true, allowVariableToken: allowVar });
    return res.valid && res.normalized ? res.normalized : "";
  };

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
    },
    blocks: (variant.blocks || []).map((block) => {
      switch (block.type) {
        case "heading":
          return { ...block, text: stripDangerousMarkup(block.text || "") };
        case "paragraph":
          return { ...block, text: stripDangerousMarkup(block.text || "") };
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
            url: cleanUrlOrEmpty(block.url, true),
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
          };
        case "promo_banner":
          return {
            ...block,
            imageUrl: cleanUrlOrEmpty(block.imageUrl),
            imageAlt: block.imageAlt ? stripDangerousMarkup(block.imageAlt).trim() : undefined,
            text: stripDangerousMarkup(block.text || ""),
            buttonLabel: stripDangerousMarkup(block.buttonLabel || "").trim(),
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
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
            buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
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
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
          };
        case "feature_card":
          return {
            ...block,
            imageUrl: cleanUrlOrEmpty(block.imageUrl),
            imageAlt: stripDangerousMarkup(block.imageAlt || "").trim(),
            title: stripDangerousMarkup(block.title || "").trim(),
            body: stripDangerousMarkup(block.body || ""),
            buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
          };
        case "benefits_list":
          return {
            ...block,
            badgeText: block.badgeText ? stripDangerousMarkup(block.badgeText).trim() : undefined,
            badgeImageUrl: cleanUrlOrEmpty(block.badgeImageUrl),
            badgeImageAlt: block.badgeImageAlt ? stripDangerousMarkup(block.badgeImageAlt).trim() : undefined,
            heading: stripDangerousMarkup(block.heading || "").trim(),
            items: (block.items || []).map((it) => ({
              ...it,
              text: stripDangerousMarkup(it.text || "").trim(),
            })),
            footnote: block.footnote ? stripDangerousMarkup(block.footnote) : undefined,
            buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
          };
        case "icon_link_grid":
          return {
            ...block,
            heading: block.heading ? stripDangerousMarkup(block.heading).trim() : undefined,
            subheading: block.subheading ? stripDangerousMarkup(block.subheading) : undefined,
            items: (block.items || []).map((it) => ({
              ...it,
              label: stripDangerousMarkup(it.label || "").trim(),
              url: cleanUrlOrEmpty(it.url, true),
            })),
          };
        case "image_with_list":
          return {
            ...block,
            imageUrl: cleanUrlOrEmpty(block.imageUrl),
            imageAlt: stripDangerousMarkup(block.imageAlt || "").trim(),
            heading: stripDangerousMarkup(block.heading || "").trim(),
            items: (block.items || []).map((it) => ({
              ...it,
              text: stripDangerousMarkup(it.text || "").trim(),
            })),
            buttonLabel: block.buttonLabel ? stripDangerousMarkup(block.buttonLabel).trim() : undefined,
            buttonUrl: cleanUrlOrEmpty(block.buttonUrl, true),
          };
        case "footer_nav":
          return {
            ...block,
            links: (block.links || []).map((l) => ({
              ...l,
              label: stripDangerousMarkup(l.label || "").trim(),
              url: cleanUrlOrEmpty(l.url, true),
            })),
            secondaryText: block.secondaryText ? stripDangerousMarkup(block.secondaryText).trim() : undefined,
            secondaryLinkUrl: cleanUrlOrEmpty(block.secondaryLinkUrl, true),
          };
        case "legal_section":
          return {
            ...block,
            sections: (block.sections || []).map((s) => ({
              ...s,
              heading: stripDangerousMarkup(s.heading || "").trim(),
              body: stripDangerousMarkup(s.body || ""),
            })),
            copyrightText: block.copyrightText ? stripDangerousMarkup(block.copyrightText).trim() : undefined,
            footerLogoUrl: cleanUrlOrEmpty(block.footerLogoUrl),
            footerLogoAlt: block.footerLogoAlt ? stripDangerousMarkup(block.footerLogoAlt).trim() : undefined,
          };
        default:
          return block;
      }
    }),
  };
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
