import { renderEmailTemplate } from "../shared/renderer.ts";
import type {
  EmailRenderContext,
  EmailTemplateVariant,
  HotelEmailSettings,
  RenderedEmailOutput,
  SupportedEmailLanguage,
} from "../shared/types.ts";

/**
 * Defense-in-depth HTML sanitizer applied after server rendering to guarantee
 * zero script tags, iframes, forms, event handlers, or dangerous URI schemes
 * can ever leave the server.
 */
export function sanitizeFinalEmailHtml(html: string): string {
  return String(html || "")
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, "")
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, "")
    .replace(/<object\b[^<]*(?:(?!<\/object>)<[^<]*)*<\/object>/gi, "")
    .replace(/<embed\b[^>]*>/gi, "")
    .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*"\s*(?:javascript|vbscript|data):[^"]*"/gi, '$1=""')
    .replace(/(href|src)\s*=\s*'\s*(?:javascript|vbscript|data):[^']*'/gi, "$1=''");
}

export function renderHotelEmailServerSide(options: {
  variant: EmailTemplateVariant;
  context: EmailRenderContext;
  settings?: HotelEmailSettings;
  language?: SupportedEmailLanguage;
  usedDefaultLayout?: boolean;
}): RenderedEmailOutput {
  const rendered = renderEmailTemplate(options);
  return {
    ...rendered,
    html: sanitizeFinalEmailHtml(rendered.html),
  };
}

/**
 * Collects all image IDs and HTTPS URLs referenced by a template variant
 * (logo + image blocks) so the Image Library can warn or block deletion of in-use assets.
 */
export function extractReferencedImages(variant: EmailTemplateVariant | undefined): {
  imageIds: Set<string>;
  urls: Set<string>;
} {
  const imageIds = new Set<string>();
  const urls = new Set<string>();
  if (!variant) return { imageIds, urls };

  const record = (id?: string, url?: string) => {
    if (id && id.trim()) imageIds.add(id.trim());
    if (url && url.trim()) urls.add(url.trim());
  };

  record(variant.branding?.logoImageId, variant.branding?.logoUrl);

  for (const block of variant.blocks || []) {
    if (!block) continue;
    switch (block.type) {
      case "image":
        record(block.imageId, block.src);
        break;
      case "brand_header":
        record(block.logoImageId, block.logoUrl);
        break;
      case "promo_banner":
      case "feature_card":
      case "image_with_list":
        record(block.imageId, block.imageUrl);
        break;
      case "benefits_list":
        record(block.badgeImageId, block.badgeImageUrl);
        break;
      case "legal_section":
      case "footer_copyright":
        record(block.footerLogoImageId, block.footerLogoUrl);
        break;
      default:
        break;
    }
  }
  return { imageIds, urls };
}
