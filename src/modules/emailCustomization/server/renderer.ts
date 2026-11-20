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

  if (variant.branding?.logoImageId) imageIds.add(variant.branding.logoImageId);
  if (variant.branding?.logoUrl) urls.add(variant.branding.logoUrl.trim());

  for (const block of variant.blocks || []) {
    if (block?.type === "image") {
      if (block.imageId) imageIds.add(block.imageId);
      if (block.src) urls.add(block.src.trim());
    }
  }
  return { imageIds, urls };
}
