import crypto from "crypto";
import sharp from "sharp";
import { IMAGE_LIMITS, type EmailImageAsset } from "../shared/types.ts";
import { stripDangerousMarkup } from "../shared/validation.ts";
import {
  fsDeleteDoc,
  fsListCollection,
  fsReadDoc,
  fsSetDoc,
  getFirebaseAppletConfig,
} from "./firestoreRest.ts";
import { findImageReferencesAcrossTemplates } from "./resolver.ts";
import { EMAIL_EVENT_CATALOG } from "./defaultTemplates.ts";

export type AllowedImageMime = "image/png" | "image/jpeg" | "image/webp";

export interface ProcessedImageResult {
  buffer: Buffer;
  mimeType: AllowedImageMime;
  ext: ".png" | ".jpg" | ".webp";
  width: number;
  height: number;
  sizeBytes: number;
  randomFilename: string;
}

/**
 * Verifies real binary magic bytes — strictly allows PNG, JPEG, and WebP only.
 * Rejects SVG, GIF, PDF, MP4, AVIF, HTML, scripts, and renamed extensions.
 */
export function detectAllowedImageMagicBytes(
  buf: Buffer
): { mimeType: AllowedImageMime; ext: ".png" | ".jpg" | ".webp" } | null {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  // Reject any text/XML/SVG/HTML header immediately
  const headAscii = buf.subarray(0, Math.min(64, buf.length)).toString("utf8").trimStart().toLowerCase();
  if (
    headAscii.startsWith("<svg") ||
    headAscii.startsWith("<?xml") ||
    headAscii.startsWith("<!doctype") ||
    headAscii.startsWith("<html") ||
    headAscii.startsWith("<script") ||
    headAscii.startsWith("%pdf") ||
    headAscii.startsWith("gif8")
  ) {
    return null;
  }

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return { mimeType: "image/png", ext: ".png" };
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { mimeType: "image/jpeg", ext: ".jpg" };
  }

  // WebP: RIFF....WEBP
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 &&
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50
  ) {
    return { mimeType: "image/webp", ext: ".webp" };
  }

  return null;
}

export function sanitizeImageLabel(raw: unknown, fallback = "Hotel Image"): string {
  const cleaned = stripDangerousMarkup(String(raw ?? ""))
    .replace(/[/\\:*?"<>|]/g, " ")
    .replace(/\.\./g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
  return cleaned || fallback;
}

/**
 * Validates magic bytes, decodes and re-encodes via Sharp (stripping EXIF/GPS metadata),
 * resizes down to max 2000px wide, enforces <= 2 MB output size, and generates a random filename.
 */
export async function validateAndProcessImageBuffer(
  rawBuffer: Buffer
): Promise<{ ok: true; result: ProcessedImageResult } | { ok: false; error: string }> {
  if (!Buffer.isBuffer(rawBuffer) || rawBuffer.length === 0) {
    return { ok: false, error: "Image file is empty." };
  }

  // Hard raw ceiling before decoding to prevent decompression bombs
  if (rawBuffer.length > 6 * 1024 * 1024) {
    return { ok: false, error: "Uploaded file is too large. Maximum allowed image size is 2 MB." };
  }

  const detected = detectAllowedImageMagicBytes(rawBuffer);
  if (!detected) {
    return {
      ok: false,
      error: "Unsupported file format. Only PNG, JPEG, and WebP images are allowed (SVG, GIF, PDF, and video files are not supported).",
    };
  }

  try {
    const image = sharp(rawBuffer, { failOn: "error", limitInputPixels: 40_000_000 });
    const meta = await image.metadata();

    // Confirm sharp's decoded format matches magic bytes
    const expectedSharpFormat =
      detected.mimeType === "image/png"
        ? "png"
        : detected.mimeType === "image/jpeg"
          ? "jpeg"
          : "webp";
    if (meta.format !== expectedSharpFormat) {
      return {
        ok: false,
        error: "File contents do not match a valid PNG, JPEG, or WebP image.",
      };
    }

    // Auto-rotate from EXIF orientation, resize <= 2000px wide, and re-encode WITHOUT .withMetadata()
    // so all EXIF, GPS, camera tags, and embedded profiles are stripped cleanly.
    const basePipeline = () =>
      sharp(rawBuffer, { failOn: "error", limitInputPixels: 40_000_000 })
        .rotate()
        .resize({
          width: IMAGE_LIMITS.maxWidthPx,
          withoutEnlargement: true,
          fit: "inside",
        });

    let outBuf: Buffer;
    if (detected.mimeType === "image/png") {
      outBuf = await basePipeline().png({ compressionLevel: 9, palette: false }).toBuffer();
    } else if (detected.mimeType === "image/jpeg") {
      outBuf = await basePipeline().jpeg({ quality: 86, mozjpeg: true }).toBuffer();
      if (outBuf.length > IMAGE_LIMITS.maxFileSizeBytes) {
        outBuf = await basePipeline().jpeg({ quality: 74, mozjpeg: true }).toBuffer();
      }
    } else {
      outBuf = await basePipeline().webp({ quality: 84 }).toBuffer();
      if (outBuf.length > IMAGE_LIMITS.maxFileSizeBytes) {
        outBuf = await basePipeline().webp({ quality: 72 }).toBuffer();
      }
    }

    if (outBuf.length > IMAGE_LIMITS.maxFileSizeBytes) {
      return {
        ok: false,
        error: "Image exceeds the 2 MB size limit even after optimization. Please upload a smaller image.",
      };
    }

    const finalMeta = await sharp(outBuf).metadata();
    const randomFilename = `${crypto.randomBytes(16).toString("hex")}${detected.ext}`;

    return {
      ok: true,
      result: {
        buffer: outBuf,
        mimeType: detected.mimeType,
        ext: detected.ext,
        width: finalMeta.width || meta.width || 0,
        height: finalMeta.height || meta.height || 0,
        sizeBytes: outBuf.length,
        randomFilename,
      },
    };
  } catch {
    return {
      ok: false,
      error: "Image could not be decoded. Please upload a valid, uncorrupted PNG, JPEG, or WebP image.",
    };
  }
}

function getStorageBucketName(): string {
  const bucket = getFirebaseAppletConfig().storageBucket;
  if (!bucket) {
    throw new Error("Firebase Storage bucket is not configured.");
  }
  return bucket;
}

export async function listHotelImages(
  hotelId: string,
  bearerToken?: string
): Promise<{
  images: EmailImageAsset[];
  usage: {
    count: number;
    maxCount: number;
    totalBytes: number;
    maxTotalBytes: number;
  };
}> {
  let docs: Array<Record<string, any> & { id: string }> = [];
  try {
    docs = await fsListCollection(`hotels/${hotelId}/emailImages`, bearerToken);
  } catch {
    docs = [];
  }

  const images: EmailImageAsset[] = docs
    .map((d) => ({
      id: d.id,
      hotelId: String(d.hotelId || hotelId),
      label: String(d.label || "Hotel Image"),
      url: String(d.url || ""),
      storagePath: String(d.storagePath || ""),
      mimeType: (d.mimeType || "image/png") as AllowedImageMime,
      width: Number(d.width || 0),
      height: Number(d.height || 0),
      sizeBytes: Number(d.sizeBytes || 0),
      createdBy: String(d.createdBy || ""),
      createdAt: String(d.createdAt || ""),
    }))
    .filter((img) => img.url.startsWith("https://"))
    .sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));

  const totalBytes = images.reduce((acc, img) => acc + (img.sizeBytes || 0), 0);
  return {
    images,
    usage: {
      count: images.length,
      maxCount: IMAGE_LIMITS.maxImagesPerHotel,
      totalBytes,
      maxTotalBytes: IMAGE_LIMITS.maxTotalBytesPerHotel,
    },
  };
}

export async function uploadHotelImage(
  hotelId: string,
  payload: { base64Data: string; label?: string },
  actor: string,
  bearerToken?: string
): Promise<{ ok: boolean; image?: EmailImageAsset; error?: string; statusCode?: number }> {
  const rawStr = typeof payload.base64Data === "string" ? payload.base64Data.trim() : "";
  if (!rawStr) {
    return { ok: false, statusCode: 400, error: "Image data is required." };
  }

  // Strip optional data URL prefix if client sent it
  const stripped = rawStr.includes(",") ? rawStr.slice(rawStr.indexOf(",") + 1) : rawStr;
  let rawBuffer: Buffer;
  try {
    rawBuffer = Buffer.from(stripped, "base64");
  } catch {
    return { ok: false, statusCode: 400, error: "Invalid base64 image payload." };
  }

  const processed = await validateAndProcessImageBuffer(rawBuffer);
  if (processed.ok === false || !("result" in processed)) {
    return {
      ok: false,
      statusCode: 400,
      error: "error" in processed ? processed.error : "Invalid image upload.",
    };
  }

  // Enforce per-hotel storage quota
  const existing = await listHotelImages(hotelId, bearerToken);
  if (existing.usage.count >= IMAGE_LIMITS.maxImagesPerHotel) {
    return {
      ok: false,
      statusCode: 400,
      error: `Image library limit reached (${IMAGE_LIMITS.maxImagesPerHotel} images max per hotel). Please delete unused images first.`,
    };
  }
  if (existing.usage.totalBytes + processed.result.sizeBytes > IMAGE_LIMITS.maxTotalBytesPerHotel) {
    return {
      ok: false,
      statusCode: 400,
      error: "Hotel email image storage quota (20 MB) would be exceeded. Please delete unused images first.",
    };
  }

  const bucket = getStorageBucketName();
  const storagePath = `hotels/${hotelId}/email-images/${processed.result.randomFilename}`;
  const uploadUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(storagePath)}`;

  const headers: Record<string, string> = {
    "Content-Type": processed.result.mimeType,
  };
  if (bearerToken) {
    headers.Authorization = `Firebase ${bearerToken}`;
  }

  const uploadResp = await fetch(uploadUrl, {
    method: "POST",
    headers,
    body: new Uint8Array(processed.result.buffer),
  });

  if (!uploadResp.ok) {
    return {
      ok: false,
      statusCode: 502,
      error: `Failed to store image in Firebase Storage (${uploadResp.status}). Verify storage rules are deployed.`,
    };
  }

  const uploadJson = await uploadResp.json().catch(() => ({} as any));
  const rawTokens = typeof uploadJson?.downloadTokens === "string" ? uploadJson.downloadTokens : "";
  const firstToken = rawTokens.split(",")[0]?.trim();

  const publicUrl = firstToken
    ? `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media&token=${encodeURIComponent(firstToken)}`
    : `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}?alt=media`;

  const imageId = `img_${crypto.randomBytes(8).toString("hex")}`;
  const asset: EmailImageAsset = {
    id: imageId,
    hotelId,
    label: sanitizeImageLabel(payload.label, "Hotel Image"),
    url: publicUrl,
    storagePath,
    mimeType: processed.result.mimeType,
    width: processed.result.width,
    height: processed.result.height,
    sizeBytes: processed.result.sizeBytes,
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };

  const writeRes = await fsSetDoc(`hotels/${hotelId}/emailImages/${imageId}`, asset, bearerToken);
  if (!writeRes.ok) {
    return { ok: false, statusCode: 500, error: "Image uploaded but metadata could not be saved." };
  }

  return { ok: true, image: asset };
}

export async function renameHotelImage(
  hotelId: string,
  imageId: string,
  label: string,
  bearerToken?: string
): Promise<{ ok: boolean; image?: EmailImageAsset; error?: string; statusCode?: number }> {
  const existing = await fsReadDoc(`hotels/${hotelId}/emailImages/${imageId}`, bearerToken);
  if (!existing || (existing.hotelId && existing.hotelId !== hotelId)) {
    return { ok: false, statusCode: 404, error: "Image not found." };
  }

  const updated: EmailImageAsset = {
    ...(existing as EmailImageAsset),
    id: imageId,
    hotelId,
    label: sanitizeImageLabel(label, existing.label || "Hotel Image"),
  };

  const writeRes = await fsSetDoc(`hotels/${hotelId}/emailImages/${imageId}`, updated, bearerToken);
  if (!writeRes.ok) {
    return { ok: false, statusCode: 500, error: "Could not rename image." };
  }
  return { ok: true, image: updated };
}

export async function deleteHotelImage(
  hotelId: string,
  imageId: string,
  bearerToken?: string
): Promise<{
  ok: boolean;
  error?: string;
  statusCode?: number;
  referencedByPublished?: string[];
  referencedByDraft?: string[];
}> {
  const existing = await fsReadDoc(`hotels/${hotelId}/emailImages/${imageId}`, bearerToken);
  if (!existing || (existing.hotelId && existing.hotelId !== hotelId)) {
    return { ok: false, statusCode: 404, error: "Image not found." };
  }

  // Block deletion if image is currently referenced in ANY published template
  const refs = await findImageReferencesAcrossTemplates(
    hotelId,
    imageId,
    String(existing.url || ""),
    bearerToken
  );

  if (refs.publishedTemplates.length > 0) {
    const names = refs.publishedTemplates.map((ev) => EMAIL_EVENT_CATALOG[ev]?.name || ev);
    return {
      ok: false,
      statusCode: 409,
      referencedByPublished: names,
      error: `Cannot delete this image because it is used in published template(s): ${names.join(", ")}. Remove or replace it in those templates first.`,
    };
  }

  // Delete from Firebase Storage if storagePath belongs to this hotel
  const storagePath = String(existing.storagePath || "");
  if (storagePath.startsWith(`hotels/${hotelId}/email-images/`)) {
    try {
      const bucket = getStorageBucketName();
      const deleteUrl = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(bucket)}/o/${encodeURIComponent(storagePath)}`;
      const headers: Record<string, string> = {};
      if (bearerToken) headers.Authorization = `Firebase ${bearerToken}`;
      await fetch(deleteUrl, { method: "DELETE", headers });
    } catch {
      // Proceed with Firestore metadata removal so orphaned records do not get stuck
    }
  }

  const delRes = await fsDeleteDoc(`hotels/${hotelId}/emailImages/${imageId}`, bearerToken);
  if (!delRes.ok) {
    return { ok: false, statusCode: 500, error: "Could not delete image metadata." };
  }

  return {
    ok: true,
    referencedByDraft: refs.draftTemplates.map((ev) => EMAIL_EVENT_CATALOG[ev]?.name || ev),
  };
}
