import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import type { NextFunction, Request, Response } from "express";
import sharp from "sharp";
import { getAppUrl } from "../../../services/emailService.ts";
import { IMAGE_LIMITS, type EmailImageAsset } from "../shared/types.ts";
import { stripDangerousMarkup } from "../shared/validation.ts";
import {
  fsDeleteDoc,
  fsListCollection,
  fsReadDoc,
  fsSetDoc,
} from "./firestoreRest.ts";
import { findImageReferencesAcrossTemplates } from "./resolver.ts";
import { EMAIL_EVENT_CATALOG } from "./defaultTemplates.ts";

export type AllowedImageMime = "image/png" | "image/jpeg" | "image/webp" | "image/gif";
export type ImageStorageProviderName = "local" | "cloudinary";

export interface ProcessedImageResult {
  buffer: Buffer;
  mimeType: AllowedImageMime;
  ext: ".png" | ".jpg" | ".webp" | ".gif";
  width: number;
  height: number;
  sizeBytes: number;
  randomFilename: string;
  isAnimated?: boolean;
  frameCount?: number;
  durationMs?: number;
}

export interface StoredImageUploadInput {
  hotelId: string;
  randomFilename: string;
  buffer: Buffer;
  mimeType: AllowedImageMime;
}

export interface StoredImageUploadResult {
  url: string;
  storagePath: string;
  provider: ImageStorageProviderName;
}

export interface StoredImageDeleteInput {
  hotelId: string;
  storagePath: string;
}

export interface ImageStorageProvider {
  readonly name: ImageStorageProviderName;
  upload(input: StoredImageUploadInput): Promise<StoredImageUploadResult>;
  delete(input: StoredImageDeleteInput): Promise<{ deleted: boolean }>;
}

const SAFE_HOTEL_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;
const SAFE_RANDOM_FILENAME_RE = /^[0-9a-f]{32}\.(png|jpg|webp|gif)$/;

const EXT_TO_MIME: Record<string, AllowedImageMime> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * Verifies real binary magic bytes — strictly allows PNG, JPEG, WebP, and GIF (GIF87a / GIF89a) only.
 * Rejects SVG, PDF, MP4, WebM, AVIF, HTML, scripts, and renamed extensions.
 */
export function detectAllowedImageMagicBytes(
  buf: Buffer
): { mimeType: AllowedImageMime; ext: ".png" | ".jpg" | ".webp" | ".gif" } | null {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null;

  // Reject any text/XML/SVG/HTML/PDF header immediately
  const headAscii = buf.subarray(0, Math.min(64, buf.length)).toString("utf8").trimStart().toLowerCase();
  if (
    headAscii.startsWith("<svg") ||
    headAscii.startsWith("<?xml") ||
    headAscii.startsWith("<!doctype") ||
    headAscii.startsWith("<html") ||
    headAscii.startsWith("<script") ||
    headAscii.startsWith("%pdf")
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

  // GIF: GIF87a (47 49 46 38 37 61) or GIF89a (47 49 46 38 39 61)
  if (
    buf[0] === 0x47 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x38 &&
    (buf[4] === 0x37 || buf[4] === 0x39) &&
    buf[5] === 0x61
  ) {
    return { mimeType: "image/gif", ext: ".gif" };
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
 * Validates magic bytes, decodes and re-encodes via Sharp (stripping EXIF/GPS/comments metadata),
 * resizes PNG/JPEG/WebP down to max 2000px wide and GIFs down to max 640px wide while preserving
 * GIF animation (<= 100 frames, <= 15s duration, <= 2 MB), and generates a random filename.
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
      error:
        "Unsupported file format. Only PNG, JPEG, WebP, and GIF images are allowed (SVG, PDF, AVIF, and video files are not supported).",
    };
  }

  // Dedicated animated-safe GIF pipeline
  if (detected.mimeType === "image/gif") {
    if (rawBuffer.length > IMAGE_LIMITS.maxFileSizeBytes) {
      return {
        ok: false,
        error:
          "GIF exceeds the 2 MB upload limit. Tip: reduce width to 600px, use fewer colors (128 colors), or trim frames before uploading.",
      };
    }

    try {
      const gifInput = sharp(rawBuffer, {
        animated: true,
        failOn: "error",
        limitInputPixels: 40_000_000,
      });
      const meta = await gifInput.metadata();

      if (meta.format !== "gif") {
        return { ok: false, error: "File contents do not match a valid GIF image." };
      }

      const frameCount = Math.max(1, Number(meta.pages || 1));
      if (frameCount > IMAGE_LIMITS.maxGifFrames) {
        return {
          ok: false,
          error: `GIF has ${frameCount} frames, exceeding the ${IMAGE_LIMITS.maxGifFrames}-frame limit. Tip: lower frame rate to 8–12 fps or trim the loop length.`,
        };
      }

      const rawDelays = Array.isArray(meta.delay) ? meta.delay : [];
      const normalizedDelays =
        frameCount > 1
          ? Array.from({ length: frameCount }, (_, i) => {
              const d = Number(rawDelays[i]);
              return Number.isFinite(d) && d > 0 ? d : 100;
            })
          : undefined;
      const durationMs =
        frameCount > 1 && normalizedDelays
          ? normalizedDelays.reduce((sum, d) => sum + d, 0)
          : 0;

      if (durationMs > IMAGE_LIMITS.maxGifDurationMs) {
        const secs = (durationMs / 1000).toFixed(1);
        return {
          ok: false,
          error: `GIF duration is ${secs}s, exceeding the ${IMAGE_LIMITS.maxGifDurationMs / 1000}s maximum. Tip: shorten the animation loop to under 10 seconds for fast email loading.`,
        };
      }

      // Re-encode WITHOUT .withMetadata() to strip comments/EXIF/hidden payloads while preserving animation
      const needsResize = Boolean(meta.width && meta.width > IMAGE_LIMITS.maxGifWidthPx);
      let pipeline = sharp(rawBuffer, {
        animated: true,
        failOn: "error",
        limitInputPixels: 40_000_000,
      });
      if (needsResize) {
        pipeline = pipeline.resize({
          width: IMAGE_LIMITS.maxGifWidthPx,
          withoutEnlargement: true,
          fit: "inside",
        });
      }

      const outBuf = await pipeline
        .gif({
          delay: normalizedDelays,
          loop: typeof meta.loop === "number" ? meta.loop : 0,
          effort: 7,
        })
        .toBuffer();

      if (outBuf.length > IMAGE_LIMITS.maxFileSizeBytes) {
        return {
          ok: false,
          error:
            "Optimized GIF still exceeds the 2 MB size limit. Tip: reduce width to 600px, lower frame count, or compress with fewer colors.",
        };
      }

      const finalMeta = await sharp(outBuf, { animated: true }).metadata();
      const finalPages = Math.max(1, Number(finalMeta.pages || frameCount));
      const finalFrameHeight =
        finalMeta.pageHeight ||
        (finalMeta.height && finalPages > 1
          ? Math.round(finalMeta.height / finalPages)
          : finalMeta.height) ||
        meta.pageHeight ||
        meta.height ||
        0;
      const randomFilename = `${crypto.randomBytes(16).toString("hex")}.gif`;

      return {
        ok: true,
        result: {
          buffer: outBuf,
          mimeType: "image/gif",
          ext: ".gif",
          width: finalMeta.width || meta.width || 0,
          height: finalFrameHeight,
          sizeBytes: outBuf.length,
          randomFilename,
          isAnimated: finalPages > 1,
          frameCount: finalPages,
          durationMs,
        },
      };
    } catch {
      return {
        ok: false,
        error: "GIF could not be decoded. Please upload a valid, uncorrupted GIF image.",
      };
    }
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
        error: "File contents do not match a valid PNG, JPEG, WebP, or GIF image.",
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
      error: "Image could not be decoded. Please upload a valid, uncorrupted PNG, JPEG, WebP, or GIF image.",
    };
  }
}

/**
 * Resolves the persistent root directory for local email image storage.
 * Uses IMAGE_UPLOAD_DIR when configured; otherwise defaults to a persistent
 * directory outside the build/deploy folder (~/pms-uploads) so redeploys do not wipe uploads.
 */
export function resolveLocalUploadRoot(env: NodeJS.ProcessEnv = process.env): string {
  const configured = typeof env.IMAGE_UPLOAD_DIR === "string" ? env.IMAGE_UPLOAD_DIR.trim() : "";
  if (configured) {
    return path.resolve(configured);
  }
  return path.resolve(os.homedir(), "pms-uploads");
}

export function resolveLocalEmailImagesDir(uploadRoot?: string): string {
  const root = uploadRoot ? path.resolve(uploadRoot) : resolveLocalUploadRoot();
  return path.resolve(root, "email-images");
}

/**
 * Validates hotelId and filename strictly and returns a guaranteed containment-checked
 * absolute file path inside `<uploadRoot>/email-images`, or null on any traversal attempt.
 */
export function resolveSafeLocalEmailImagePath(
  hotelId: string,
  filename: string,
  uploadRoot?: string
): { filePath: string; baseDir: string; mimeType: AllowedImageMime } | null {
  if (!SAFE_HOTEL_ID_RE.test(hotelId) || !SAFE_RANDOM_FILENAME_RE.test(filename)) {
    return null;
  }

  const ext = path.extname(filename).toLowerCase();
  const mimeType = EXT_TO_MIME[ext];
  if (!mimeType) return null;

  const baseDir = resolveLocalEmailImagesDir(uploadRoot);
  const hotelDir = path.resolve(baseDir, hotelId);
  if (!hotelDir.startsWith(baseDir + path.sep)) {
    return null;
  }

  const filePath = path.resolve(hotelDir, filename);
  if (!filePath.startsWith(hotelDir + path.sep)) {
    return null;
  }

  return { filePath, baseDir, mimeType };
}

function resolvePublicAppBaseUrl(env: NodeJS.ProcessEnv = process.env, overrideAppUrl?: string): string {
  const raw = (overrideAppUrl || env.APP_URL || "").trim().replace(/\/+$/, "");
  const base = raw || getAppUrl();
  if (!base.startsWith("https://")) {
    throw new Error(
      "APP_URL must start with https:// so uploaded email images can load reliably in guest email clients."
    );
  }
  return base;
}

export interface LocalProviderOptions {
  uploadDir?: string;
  appUrl?: string;
  env?: NodeJS.ProcessEnv;
}

/**
 * Local persistent filesystem storage provider.
 * Stores files under `<IMAGE_UPLOAD_DIR>/email-images/<hotelId>/<randomName>.<ext>`
 * and returns `${APP_URL}/uploads/email-images/<hotelId>/<randomName>.<ext>`.
 */
export function createLocalImageStorageProvider(
  options: LocalProviderOptions = {}
): ImageStorageProvider {
  const env = options.env || process.env;
  const uploadRoot = options.uploadDir
    ? path.resolve(options.uploadDir)
    : resolveLocalUploadRoot(env);

  return {
    name: "local",
    async upload(input: StoredImageUploadInput): Promise<StoredImageUploadResult> {
      const safe = resolveSafeLocalEmailImagePath(input.hotelId, input.randomFilename, uploadRoot);
      if (!safe) {
        throw new Error("Invalid hotel identifier or image filename.");
      }

      const appBaseUrl = resolvePublicAppBaseUrl(env, options.appUrl);
      const hotelDir = path.dirname(safe.filePath);
      await fs.promises.mkdir(hotelDir, { recursive: true, mode: 0o755 });
      await fs.promises.writeFile(safe.filePath, input.buffer, { mode: 0o644 });

      const storagePath = `${input.hotelId}/${input.randomFilename}`;
      const url = `${appBaseUrl}/uploads/email-images/${encodeURIComponent(input.hotelId)}/${encodeURIComponent(input.randomFilename)}`;

      return {
        url,
        storagePath,
        provider: "local",
      };
    },

    async delete(input: StoredImageDeleteInput): Promise<{ deleted: boolean }> {
      const expectedPrefix = `${input.hotelId}/`;
      if (!input.storagePath.startsWith(expectedPrefix)) {
        return { deleted: false };
      }

      const filename = input.storagePath.slice(expectedPrefix.length);
      const safe = resolveSafeLocalEmailImagePath(input.hotelId, filename, uploadRoot);
      if (!safe) {
        return { deleted: false };
      }

      try {
        await fs.promises.unlink(safe.filePath);
        return { deleted: true };
      } catch (err: any) {
        if (err && err.code === "ENOENT") {
          return { deleted: false };
        }
        throw err;
      }
    },
  };
}

export interface CloudinaryProviderOptions {
  cloudName?: string;
  apiKey?: string;
  apiSecret?: string;
  env?: NodeJS.ProcessEnv;
  fetchFn?: typeof fetch;
}

export function buildCloudinarySignature(
  params: Record<string, string>,
  apiSecret: string
): string {
  const canonical = Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== "")
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join("&");
  return crypto
    .createHash("sha1")
    .update(`${canonical}${apiSecret}`)
    .digest("hex");
}

/**
 * Server-side signed Cloudinary storage provider.
 * Uses CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET
 * strictly on the server (never exposed to browser, never logged).
 */
export function createCloudinaryImageStorageProvider(
  options: CloudinaryProviderOptions = {}
): ImageStorageProvider {
  const env = options.env || process.env;
  const cloudName = (options.cloudName ?? env.CLOUDINARY_CLOUD_NAME ?? "").trim();
  const apiKey = (options.apiKey ?? env.CLOUDINARY_API_KEY ?? "").trim();
  const apiSecret = (options.apiSecret ?? env.CLOUDINARY_API_SECRET ?? "").trim();
  const fetchImpl = options.fetchFn || fetch;

  const missing: string[] = [];
  if (!cloudName) missing.push("CLOUDINARY_CLOUD_NAME");
  if (!apiKey) missing.push("CLOUDINARY_API_KEY");
  if (!apiSecret) missing.push("CLOUDINARY_API_SECRET");
  if (missing.length > 0) {
    throw new Error(
      `Cloudinary image storage is not configured. Missing server environment variable(s): ${missing.join(", ")}.`
    );
  }

  return {
    name: "cloudinary",
    async upload(input: StoredImageUploadInput): Promise<StoredImageUploadResult> {
      if (!SAFE_HOTEL_ID_RE.test(input.hotelId) || !SAFE_RANDOM_FILENAME_RE.test(input.randomFilename)) {
        throw new Error("Invalid hotel identifier or image filename.");
      }

      const folder = `pms-email-images/${input.hotelId}`;
      const publicIdBase = input.randomFilename.replace(/\.[^.]+$/, "");
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signParams = {
        folder,
        overwrite: "true",
        public_id: publicIdBase,
        timestamp,
        unique_filename: "false",
      };
      const signature = buildCloudinarySignature(signParams, apiSecret);

      const form = new FormData();
      form.append(
        "file",
        new Blob([new Uint8Array(input.buffer)], { type: input.mimeType }),
        input.randomFilename
      );
      form.append("api_key", apiKey);
      form.append("timestamp", timestamp);
      form.append("folder", folder);
      form.append("public_id", publicIdBase);
      form.append("overwrite", "true");
      form.append("unique_filename", "false");
      form.append("signature", signature);

      const uploadEndpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/upload`;
      const resp = await fetchImpl(uploadEndpoint, {
        method: "POST",
        body: form,
      });

      if (!resp.ok) {
        throw new Error(`Image upload to Cloudinary failed with HTTP ${resp.status}.`);
      }

      const data = (await resp.json().catch(() => ({}))) as Record<string, any>;
      const secureUrl = typeof data.secure_url === "string" ? data.secure_url.trim() : "";
      const returnedPublicId =
        typeof data.public_id === "string" && data.public_id.trim()
          ? data.public_id.trim()
          : `${folder}/${publicIdBase}`;

      if (!secureUrl.startsWith("https://")) {
        throw new Error("Cloudinary did not return a valid HTTPS image URL.");
      }

      return {
        url: secureUrl,
        storagePath: returnedPublicId,
        provider: "cloudinary",
      };
    },

    async delete(input: StoredImageDeleteInput): Promise<{ deleted: boolean }> {
      const expectedPrefix = `pms-email-images/${input.hotelId}/`;
      if (!input.storagePath.startsWith(expectedPrefix)) {
        return { deleted: false };
      }

      const timestamp = String(Math.floor(Date.now() / 1000));
      const signParams = {
        invalidate: "true",
        public_id: input.storagePath,
        timestamp,
      };
      const signature = buildCloudinarySignature(signParams, apiSecret);

      const body = new URLSearchParams({
        public_id: input.storagePath,
        invalidate: "true",
        timestamp,
        api_key: apiKey,
        signature,
      });

      const destroyEndpoint = `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloudName)}/image/destroy`;
      const resp = await fetchImpl(destroyEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (!resp.ok) {
        return { deleted: false };
      }
      const data = (await resp.json().catch(() => ({}))) as Record<string, any>;
      return { deleted: data?.result === "ok" };
    },
  };
}

export interface ResolveProviderOptions {
  env?: NodeJS.ProcessEnv;
  providerName?: ImageStorageProviderName;
  uploadDir?: string;
  appUrl?: string;
  fetchFn?: typeof fetch;
}

/**
 * Selects the active image storage provider from IMAGE_STORAGE_PROVIDER
 * ("local" default or "cloudinary") without code changes.
 */
export function resolveImageStorageProvider(
  options: ResolveProviderOptions = {}
): ImageStorageProvider {
  const env = options.env || process.env;
  const raw = (
    options.providerName ??
    (typeof env.IMAGE_STORAGE_PROVIDER === "string" ? env.IMAGE_STORAGE_PROVIDER : "")
  )
    .trim()
    .toLowerCase();

  const selected = raw || "local";

  if (selected === "local") {
    return createLocalImageStorageProvider({
      uploadDir: options.uploadDir,
      appUrl: options.appUrl,
      env,
    });
  }

  if (selected === "cloudinary") {
    return createCloudinaryImageStorageProvider({
      env,
      fetchFn: options.fetchFn,
    });
  }

  throw new Error(
    `Unsupported IMAGE_STORAGE_PROVIDER "${selected}". Allowed values are "local" and "cloudinary".`
  );
}

/**
 * Read-only Express middleware serving ONLY `<IMAGE_UPLOAD_DIR>/email-images/{hotelId}/{randomFilename}`
 * at `/uploads/email-images`. Enforces:
 * - GET/HEAD only
 * - No directory listing
 * - Strict path traversal & symlink protection
 * - Exact image Content-Type, X-Content-Type-Options: nosniff, and immutable long cache headers
 */
export function createLocalEmailImageMiddleware(options?: {
  uploadDir?: string;
  env?: NodeJS.ProcessEnv;
}) {
  return async function serveLocalEmailImage(
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).end();
      return;
    }

    // Inspect raw URL before Express path normalization to block encoded traversal (`%2e%2e`, backslashes, null bytes)
    const rawPathPart = String(req.originalUrl || req.url || "").split("?")[0];
    if (
      rawPathPart.includes("..") ||
      rawPathPart.includes("\\") ||
      rawPathPart.includes("\0") ||
      /%2e/i.test(rawPathPart) ||
      /%2f/i.test(rawPathPart) ||
      /%5c/i.test(rawPathPart) ||
      /%00/i.test(rawPathPart)
    ) {
      res.status(400).end();
      return;
    }

    // Strictly match exactly /<hotelId>/<filename> (blocks root / and /<hotelId>/ directory listing)
    const cleanPath = String(req.path || "");
    const segments = cleanPath.replace(/^\/+/, "").split("/");
    if (segments.length !== 2 || !segments[0] || !segments[1] || cleanPath.endsWith("/")) {
      res.status(404).end();
      return;
    }

    const [hotelId, filename] = segments;
    const uploadRoot = options?.uploadDir
      ? path.resolve(options.uploadDir)
      : resolveLocalUploadRoot(options?.env || process.env);

    const safe = resolveSafeLocalEmailImagePath(hotelId, filename, uploadRoot);
    if (!safe) {
      res.status(404).end();
      return;
    }

    try {
      const lstat = await fs.promises.lstat(safe.filePath);
      if (!lstat.isFile() || lstat.isSymbolicLink()) {
        res.status(404).end();
        return;
      }

      const [realBaseDir, realFilePath] = await Promise.all([
        fs.promises.realpath(safe.baseDir),
        fs.promises.realpath(safe.filePath),
      ]);
      if (!realFilePath.startsWith(realBaseDir + path.sep)) {
        res.status(403).end();
        return;
      }

      res.setHeader("Content-Type", safe.mimeType);
      res.setHeader("Content-Length", String(lstat.size));
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");

      if (req.method === "HEAD") {
        res.status(200).end();
        return;
      }

      const stream = fs.createReadStream(realFilePath);
      stream.on("error", () => {
        if (!res.headersSent) {
          res.status(404).end();
        } else {
          res.end();
        }
      });
      stream.pipe(res);
    } catch {
      res.status(404).end();
    }
  };
}

export interface ImageServiceOverrides {
  storageProvider?: ImageStorageProvider;
  listDocsFn?: (hotelId: string) => Promise<Array<Record<string, any> & { id: string }>>;
  readDocFn?: (hotelId: string, imageId: string) => Promise<Record<string, any> | null>;
  setDocFn?: (hotelId: string, imageId: string, asset: EmailImageAsset) => Promise<{ ok: boolean }>;
  deleteDocFn?: (hotelId: string, imageId: string) => Promise<{ ok: boolean }>;
  findRefsFn?: (
    hotelId: string,
    imageId: string,
    url: string
  ) => Promise<{ publishedTemplates: string[]; draftTemplates: string[] }>;
}

export async function listHotelImages(
  hotelId: string,
  bearerToken?: string,
  overrides?: Pick<ImageServiceOverrides, "listDocsFn">
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
    docs = overrides?.listDocsFn
      ? await overrides.listDocsFn(hotelId)
      : await fsListCollection(`hotels/${hotelId}/emailImages`, bearerToken);
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
      storageProvider:
        d.storageProvider === "local" || d.storageProvider === "cloudinary"
          ? (d.storageProvider as ImageStorageProviderName)
          : undefined,
      mimeType: (d.mimeType || "image/png") as AllowedImageMime,
      width: Number(d.width || 0),
      height: Number(d.height || 0),
      sizeBytes: Number(d.sizeBytes || 0),
      isAnimated: typeof d.isAnimated === "boolean" ? d.isAnimated : undefined,
      frameCount: typeof d.frameCount === "number" ? d.frameCount : undefined,
      durationMs: typeof d.durationMs === "number" ? d.durationMs : undefined,
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
  bearerToken?: string,
  overrides?: ImageServiceOverrides
): Promise<{ ok: boolean; image?: EmailImageAsset; error?: string; statusCode?: number }> {
  if (!SAFE_HOTEL_ID_RE.test(hotelId)) {
    return { ok: false, statusCode: 400, error: "Invalid hotel identifier." };
  }

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
  const existing = await listHotelImages(hotelId, bearerToken, overrides);
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

  let provider: ImageStorageProvider;
  try {
    provider = overrides?.storageProvider || resolveImageStorageProvider();
  } catch (err: any) {
    return {
      ok: false,
      statusCode: 500,
      error: err?.message || "Image storage provider is not configured.",
    };
  }

  let stored: StoredImageUploadResult;
  try {
    stored = await provider.upload({
      hotelId,
      randomFilename: processed.result.randomFilename,
      buffer: processed.result.buffer,
      mimeType: processed.result.mimeType,
    });
  } catch (err: any) {
    return {
      ok: false,
      statusCode: 502,
      error: err?.message || "Failed to store uploaded image.",
    };
  }

  const imageId = `img_${crypto.randomBytes(8).toString("hex")}`;
  const asset: EmailImageAsset = {
    id: imageId,
    hotelId,
    label: sanitizeImageLabel(payload.label, "Hotel Image"),
    url: stored.url,
    storagePath: stored.storagePath,
    storageProvider: stored.provider,
    mimeType: processed.result.mimeType,
    width: processed.result.width,
    height: processed.result.height,
    sizeBytes: processed.result.sizeBytes,
    ...(processed.result.isAnimated !== undefined ? { isAnimated: processed.result.isAnimated } : {}),
    ...(processed.result.frameCount !== undefined ? { frameCount: processed.result.frameCount } : {}),
    ...(processed.result.durationMs !== undefined ? { durationMs: processed.result.durationMs } : {}),
    createdBy: actor,
    createdAt: new Date().toISOString(),
  };

  const writeRes = overrides?.setDocFn
    ? await overrides.setDocFn(hotelId, imageId, asset)
    : await fsSetDoc(`hotels/${hotelId}/emailImages/${imageId}`, asset, bearerToken);

  if (!writeRes.ok) {
    // Best-effort cleanup so a failed Firestore metadata write does not leave orphaned files in storage
    try {
      await provider.delete({ hotelId, storagePath: stored.storagePath });
    } catch {
      // ignore cleanup failure
    }
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

function inferProviderForStoredAsset(
  existing: Record<string, any>,
  hotelId: string
): ImageStorageProviderName | null {
  if (existing.storageProvider === "local" || existing.storageProvider === "cloudinary") {
    return existing.storageProvider;
  }
  const storagePath = String(existing.storagePath || "");
  if (storagePath.startsWith(`pms-email-images/${hotelId}/`)) {
    return "cloudinary";
  }
  if (storagePath.startsWith(`${hotelId}/`)) {
    return "local";
  }
  return null;
}

export async function deleteHotelImage(
  hotelId: string,
  imageId: string,
  bearerToken?: string,
  overrides?: ImageServiceOverrides
): Promise<{
  ok: boolean;
  error?: string;
  statusCode?: number;
  referencedByPublished?: string[];
  referencedByDraft?: string[];
}> {
  const existing = overrides?.readDocFn
    ? await overrides.readDocFn(hotelId, imageId)
    : await fsReadDoc(`hotels/${hotelId}/emailImages/${imageId}`, bearerToken);

  if (!existing || (existing.hotelId && existing.hotelId !== hotelId)) {
    return { ok: false, statusCode: 404, error: "Image not found." };
  }

  // Block deletion if image is currently referenced in ANY published template
  const refs = overrides?.findRefsFn
    ? await overrides.findRefsFn(hotelId, imageId, String(existing.url || ""))
    : await findImageReferencesAcrossTemplates(
        hotelId,
        imageId,
        String(existing.url || ""),
        bearerToken
      );

  if (refs.publishedTemplates.length > 0) {
    const names = refs.publishedTemplates.map(
      (ev) => EMAIL_EVENT_CATALOG[ev as keyof typeof EMAIL_EVENT_CATALOG]?.name || ev
    );
    return {
      ok: false,
      statusCode: 409,
      referencedByPublished: names,
      error: `Cannot delete this image because it is used in published template(s): ${names.join(", ")}. Remove or replace it in those templates first.`,
    };
  }

  // Delete image binary from the configured storage provider (matching the asset's provider)
  const storagePath = String(existing.storagePath || "");
  if (storagePath) {
    try {
      const targetProviderName = inferProviderForStoredAsset(existing, hotelId);
      const provider =
        overrides?.storageProvider ||
        (targetProviderName
          ? resolveImageStorageProvider({ providerName: targetProviderName })
          : resolveImageStorageProvider());
      await provider.delete({ hotelId, storagePath });
    } catch {
      // Proceed with Firestore metadata removal so orphaned metadata records do not get stuck
    }
  }

  const delRes = overrides?.deleteDocFn
    ? await overrides.deleteDocFn(hotelId, imageId)
    : await fsDeleteDoc(`hotels/${hotelId}/emailImages/${imageId}`, bearerToken);

  if (!delRes.ok) {
    return { ok: false, statusCode: 500, error: "Could not delete image metadata." };
  }

  return {
    ok: true,
    referencedByDraft: refs.draftTemplates.map(
      (ev) => EMAIL_EVENT_CATALOG[ev as keyof typeof EMAIL_EVENT_CATALOG]?.name || ev
    ),
  };
}
