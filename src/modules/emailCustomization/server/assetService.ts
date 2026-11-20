import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type { NextFunction, Request, Response } from "express";
import sharp from "sharp";
import {
  EMAIL_ICON_NAMES,
  EMAIL_ICON_TONE_HEX,
  EMAIL_ICON_TONES,
  type EmailIconName,
  type EmailIconTone,
} from "../shared/types.ts";
import {
  EMAIL_PLACEHOLDER_IMAGES,
  normalizeAssetBaseUrl,
  type PlaceholderImageName,
} from "../shared/presets.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const BUNDLED_ASSETS_DIR = path.resolve(__dirname, "..", "assets");
export const BUNDLED_ICONS_DIR = path.join(BUNDLED_ASSETS_DIR, "icons");
export const BUNDLED_PLACEHOLDERS_DIR = path.join(BUNDLED_ASSETS_DIR, "placeholders");
export const BUNDLED_SAMPLES_DIR = path.join(BUNDLED_ASSETS_DIR, "samples");

const ICON_SET = new Set<string>(EMAIL_ICON_NAMES);
const TONE_SET = new Set<string>(EMAIL_ICON_TONES);
const PLACEHOLDER_SET = new Set<string>(EMAIL_PLACEHOLDER_IMAGES);

/**
 * Clean geometric stroke paths used ONLY to pre-render crisp 48x48 PNG files into
 * `src/modules/emailCustomization/assets/icons/{tone}/{icon}.png`.
 * Email HTML strictly references HTTPS PNG URLs — zero SVG or inline data URIs
 * ever appear in email HTML.
 */
const ICON_SVG_INNER: Record<EmailIconName, string> = {
  location_pin: `<path d="M12 21s-6-5.6-6-10.2A6 6 0 1 1 18 10.8C18 15.4 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.2"/>`,
  phone: `<path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 3.1 5.2 2 2 0 0 1 5.1 3h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.4 2.1L9.1 11a16 16 0 0 0 3.9 3.9l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.9.6 2.9.7A2 2 0 0 1 22 16.9Z"/>`,
  calendar: `<rect x="3" y="4.5" width="18" height="16.5" rx="2"/><line x1="16" y1="2.5" x2="16" y2="6.5"/><line x1="8" y1="2.5" x2="8" y2="6.5"/><line x1="3" y1="9.5" x2="21" y2="9.5"/>`,
  key: `<circle cx="8" cy="15" r="4.2"/><path d="M11.2 12 20.5 3.5"/><path d="M17.5 6.5 20 9"/><path d="M14.8 9.2 17 11.4"/>`,
  map: `<polygon points="3 6 9 3.5 15 6 21 3.5 21 18 15 20.5 9 18 3 20.5 3 6"/><line x1="9" y1="3.5" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="20.5"/>`,
  dining: `<path d="M6 3v7a3 3 0 0 0 6 0V3"/><line x1="9" y1="3" x2="9" y2="21"/><path d="M18 3v18"/><path d="M18 3c2 1.5 2.5 5 2 8h-2"/>`,
  activities: `<circle cx="12" cy="12" r="9"/><polygon points="15.5 8.5 13.5 13.5 8.5 15.5 10.5 10.5 15.5 8.5"/>`,
  spa: `<path d="M12 3c2.5 3.2 3.8 6 3.8 8.8A3.8 3.8 0 0 1 12 15.6a3.8 3.8 0 0 1-3.8-3.8C8.2 9 9.5 6.2 12 3Z"/><path d="M5 12.5c2.2 0 4.5 1.8 5.2 4.5-2.8.5-5.2-1.5-5.2-4.5Z"/><path d="M19 12.5c-2.2 0-4.5 1.8-5.2 4.5 2.8.5 5.2-1.5 5.2-4.5Z"/><line x1="6" y1="20" x2="18" y2="20"/>`,
  wifi: `<path d="M3 9a13 13 0 0 1 18 0"/><path d="M6.5 12.8a8.2 8.2 0 0 1 11 0"/><path d="M10 16.5a3.2 3.2 0 0 1 4 0"/><circle cx="12" cy="19.5" r="1"/>`,
  parking: `<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M9.5 16.5V7.5h3.5a2.8 2.8 0 0 1 0 5.6H9.5"/>`,
  chat: `<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5 8.4 8.4 0 0 1-3.9-.9L3 20.5l1.4-4.8A8.5 8.5 0 1 1 21 11.5Z"/>`,
  check: `<polyline points="4.5 12.5 9.8 17.8 19.5 6.8"/>`,
  arrow: `<line x1="5" y1="12" x2="19" y2="12"/><polyline points="13 6 19 12 13 18"/>`,
  star: `<polygon points="12 3 14.9 8.9 21.4 9.8 16.7 14.4 17.8 20.9 12 17.8 6.2 20.9 7.3 14.4 2.6 9.8 9.1 8.9 12 3"/>`,
  gift: `<rect x="3.5" y="8.5" width="17" height="4" rx="1"/><path d="M5 12.5V20h14v-7.5"/><line x1="12" y1="8.5" x2="12" y2="20"/><path d="M12 8.5H8.5a2 2 0 1 1 0-4C11 4.5 12 8.5 12 8.5Z"/><path d="M12 8.5h3.5a2 2 0 1 0 0-4C13 4.5 12 8.5 12 8.5Z"/>`,
};

const PLACEHOLDER_SPECS: Record<
  PlaceholderImageName,
  { width: number; height: number; c1: string; c2: string; accent: string; shape: string }
> = {
  resort_hero: {
    width: 640,
    height: 360,
    c1: "#0f2942",
    c2: "#1e5b73",
    accent: "#d97706",
    shape: `<circle cx="500" cy="105" r="56" fill="#fef3c7" opacity="0.22"/><path d="M0 265 Q160 220 340 265 T640 250 L640 360 L0 360 Z" fill="#0b1f33" opacity="0.55"/><path d="M0 295 Q200 260 400 295 T640 285 L640 360 L0 360 Z" fill="#134e4a" opacity="0.45"/>`,
  },
  coastal_card: {
    width: 560,
    height: 400,
    c1: "#0c4a6e",
    c2: "#0284c7",
    accent: "#38bdf8",
    shape: `<circle cx="430" cy="100" r="68" fill="#e0f2fe" opacity="0.2"/><path d="M0 270 Q150 225 310 265 T560 245 L560 400 L0 400 Z" fill="#082f49" opacity="0.55"/><path d="M0 315 Q190 285 380 320 T560 305 L560 400 L0 400 Z" fill="#0369a1" opacity="0.5"/>`,
  },
  spa_card: {
    width: 560,
    height: 400,
    c1: "#d6d3d1",
    c2: "#f5f5f4",
    accent: "#a8a29e",
    shape: `<circle cx="280" cy="200" r="135" fill="#e7e5e4" opacity="0.8"/><circle cx="280" cy="200" r="90" fill="#d6d3d1" opacity="0.55"/><circle cx="280" cy="200" r="46" fill="#a8a29e" opacity="0.35"/><path d="M0 325 Q280 280 560 325 L560 400 L0 400 Z" fill="#a8a29e" opacity="0.25"/>`,
  },
  dining_card: {
    width: 560,
    height: 400,
    c1: "#451a03",
    c2: "#92400e",
    accent: "#fbbf24",
    shape: `<circle cx="140" cy="115" r="76" fill="#fef3c7" opacity="0.16"/><rect x="70" y="255" width="420" height="8" rx="4" fill="#fde68a" opacity="0.35"/><rect x="130" y="280" width="300" height="6" rx="3" fill="#fde68a" opacity="0.22"/><path d="M0 320 L560 280 L560 400 L0 400 Z" fill="#291002" opacity="0.45"/>`,
  },
  business_banner: {
    width: 192,
    height: 192,
    c1: "#1e293b",
    c2: "#334155",
    accent: "#10b981",
    shape: `<rect x="36" y="42" width="120" height="108" rx="14" fill="none" stroke="#94a3b8" stroke-width="5" opacity="0.6"/><line x1="60" y1="80" x2="132" y2="80" stroke="#e2e8f0" stroke-width="6" stroke-linecap="round"/><line x1="60" y1="104" x2="112" y2="104" stroke="#94a3b8" stroke-width="6" stroke-linecap="round"/><circle cx="132" cy="120" r="10" fill="#10b981"/>`,
  },
  suite_card: {
    width: 560,
    height: 400,
    c1: "#1c1917",
    c2: "#44403c",
    accent: "#d6d3d1",
    shape: `<rect x="52" y="68" width="456" height="264" rx="18" fill="none" stroke="#e7e5e4" stroke-width="3" opacity="0.28"/><rect x="112" y="180" width="336" height="96" rx="12" fill="#fafaf9" opacity="0.14"/><rect x="150" y="148" width="110" height="44" rx="10" fill="#fafaf9" opacity="0.22"/><rect x="300" y="148" width="110" height="44" rx="10" fill="#fafaf9" opacity="0.22"/>`,
  },
};

interface CachedAsset {
  buffer: Buffer;
  etag: string;
}

const assetCache = new Map<string, CachedAsset>();

function wrapCachedAsset(buffer: Buffer): CachedAsset {
  const hash = crypto.createHash("sha256").update(buffer).digest("hex").slice(0, 20);
  return { buffer, etag: `"${hash}"` };
}

/**
 * Resolves a safe disk path strictly inside `src/modules/emailCustomization/assets/icons/{tone}/{icon}.png`.
 */
export function resolveSafeBundledIconPath(tone: string, icon: string): string | null {
  if (!TONE_SET.has(tone) || !ICON_SET.has(icon)) return null;
  const target = path.resolve(BUNDLED_ICONS_DIR, tone, `${icon}.png`);
  const rel = path.relative(BUNDLED_ICONS_DIR, target);
  if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return target;
}

/**
 * Builds the canonical HTTPS URL for any static asset served by this module.
 */
export function buildStaticEmailAssetHttpsUrl(
  appUrl: string | undefined,
  category: "icons" | "placeholders" | "samples",
  ...segments: string[]
): string {
  const base = normalizeAssetBaseUrl(appUrl);
  const clean = segments.map((s) => encodeURIComponent(s)).join("/");
  return `${base}/uploads/email-assets/${category}/${clean}`;
}

/**
 * Generates a crisp 48x48 transparent PNG icon.
 * For dark-mode email compatibility, darker tones include a subtle white outer halo
 * (invisible on light backgrounds, legible when email clients force dark surfaces).
 */
async function rasterizeBuiltInIconPng(
  tone: EmailIconTone,
  icon: EmailIconName
): Promise<Buffer> {
  const strokeColor = EMAIL_ICON_TONE_HEX[tone]?.hex || "#18181b";
  const inner = ICON_SVG_INNER[icon];
  const needsDarkModeHalo =
    tone === "dark" || tone === "navy" || tone === "burgundy" || tone === "emerald";
  const haloLayer = needsDarkModeHalo
    ? `<g stroke="#ffffff" stroke-opacity="0.34" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`
    : "";

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none">${haloLayer}<g stroke="${strokeColor}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${inner}</g></svg>`;

  return sharp(Buffer.from(svg))
    .resize(48, 48)
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function renderBuiltInIconPng(
  tone: EmailIconTone,
  icon: EmailIconName
): Promise<Buffer> {
  const entry = await loadBuiltInIconAsset(tone, icon);
  return entry.buffer;
}

async function loadBuiltInIconAsset(
  tone: EmailIconTone,
  icon: EmailIconName
): Promise<CachedAsset> {
  const key = `icon:${tone}:${icon}`;
  const cached = assetCache.get(key);
  if (cached) return cached;

  const diskPath = resolveSafeBundledIconPath(tone, icon);
  if (diskPath && fs.existsSync(diskPath)) {
    const buf = await fs.promises.readFile(diskPath);
    const wrapped = wrapCachedAsset(buf);
    assetCache.set(key, wrapped);
    return wrapped;
  }

  const pngBuf = await rasterizeBuiltInIconPng(tone, icon);
  const wrapped = wrapCachedAsset(pngBuf);
  assetCache.set(key, wrapped);
  return wrapped;
}

async function rasterizePlaceholderImagePng(name: PlaceholderImageName): Promise<Buffer> {
  const spec = PLACEHOLDER_SPECS[name];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${spec.width}" height="${spec.height}" viewBox="0 0 ${spec.width} ${spec.height}">
  <defs>
    <linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${spec.c1}"/>
      <stop offset="100%" stop-color="${spec.c2}"/>
    </linearGradient>
  </defs>
  <rect width="${spec.width}" height="${spec.height}" fill="url(#g)"/>
  ${spec.shape}
</svg>`;

  return sharp(Buffer.from(svg))
    .png({ compressionLevel: 9 })
    .toBuffer();
}

export async function renderPlaceholderImagePng(name: PlaceholderImageName): Promise<Buffer> {
  const entry = await loadPlaceholderAsset(name);
  return entry.buffer;
}

async function loadPlaceholderAsset(name: PlaceholderImageName): Promise<CachedAsset> {
  const key = `placeholder:${name}`;
  const cached = assetCache.get(key);
  if (cached) return cached;

  const diskPath = path.join(BUNDLED_PLACEHOLDERS_DIR, `${name}.png`);
  if (fs.existsSync(diskPath)) {
    const buf = await fs.promises.readFile(diskPath);
    const wrapped = wrapCachedAsset(buf);
    assetCache.set(key, wrapped);
    return wrapped;
  }

  const pngBuf = await rasterizePlaceholderImagePng(name);
  const wrapped = wrapCachedAsset(pngBuf);
  assetCache.set(key, wrapped);
  return wrapped;
}

/**
 * Generates a lightweight 3-frame neutral welcome animation GIF (~2 KB) for sample tests
 * and starter email GIF demonstrations. Frame 1 carries the primary clean visual for Outlook.
 */
async function rasterizeSampleAnimatedGif(): Promise<Buffer> {
  const width = 480;
  const height = 140;
  const palettes: Array<[number, number, number]> = [
    [15, 118, 110], // teal
    [20, 83, 45], // deep emerald
    [30, 58, 95], // navy
  ];

  const frameSize = width * height * 4;
  const combined = Buffer.alloc(frameSize * palettes.length);

  for (let f = 0; f < palettes.length; f++) {
    const [r, g, b] = palettes[f];
    const offset = f * frameSize;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = offset + (y * width + x) * 4;
        const border = x < 4 || x >= width - 4 || y < 4 || y >= height - 4;
        const bar = y >= 62 && y <= 78 && x >= 40 + f * 30 && x <= 260 + f * 30;
        combined[idx] = border ? 255 : bar ? 245 : r;
        combined[idx + 1] = border ? 255 : bar ? 245 : g;
        combined[idx + 2] = border ? 255 : bar ? 245 : b;
        combined[idx + 3] = 255;
      }
    }
  }

  return sharp(combined, {
    raw: { width, height: height * palettes.length, channels: 4, pageHeight: height },
  })
    .gif({ delay: [700, 700, 700], loop: 0 })
    .toBuffer();
}

export async function renderSampleAnimatedGif(): Promise<Buffer> {
  const entry = await loadSampleGifAsset();
  return entry.buffer;
}

async function loadSampleGifAsset(): Promise<CachedAsset> {
  const key = "sample:welcome.gif";
  const cached = assetCache.get(key);
  if (cached) return cached;

  const diskPath = path.join(BUNDLED_SAMPLES_DIR, "welcome.gif");
  if (fs.existsSync(diskPath)) {
    const buf = await fs.promises.readFile(diskPath);
    const wrapped = wrapCachedAsset(buf);
    assetCache.set(key, wrapped);
    return wrapped;
  }

  const gifBuf = await rasterizeSampleAnimatedGif();
  const wrapped = wrapCachedAsset(gifBuf);
  assetCache.set(key, wrapped);
  return wrapped;
}

/**
 * Populates `src/modules/emailCustomization/assets/icons/{tone}/{icon}.png`,
 * `assets/placeholders/{name}.png`, and `assets/samples/welcome.gif` on disk.
 */
export async function populateBundledEmailAssets(): Promise<{
  iconsWritten: number;
  placeholdersWritten: number;
  samplesWritten: number;
}> {
  let iconsWritten = 0;
  for (const tone of EMAIL_ICON_TONES) {
    const toneDir = path.join(BUNDLED_ICONS_DIR, tone);
    await fs.promises.mkdir(toneDir, { recursive: true });
    for (const icon of EMAIL_ICON_NAMES) {
      const buf = await rasterizeBuiltInIconPng(tone, icon);
      await fs.promises.writeFile(path.join(toneDir, `${icon}.png`), buf);
      iconsWritten += 1;
    }
  }

  await fs.promises.mkdir(BUNDLED_PLACEHOLDERS_DIR, { recursive: true });
  let placeholdersWritten = 0;
  for (const name of EMAIL_PLACEHOLDER_IMAGES) {
    const buf = await rasterizePlaceholderImagePng(name);
    await fs.promises.writeFile(path.join(BUNDLED_PLACEHOLDERS_DIR, `${name}.png`), buf);
    placeholdersWritten += 1;
  }

  await fs.promises.mkdir(BUNDLED_SAMPLES_DIR, { recursive: true });
  const gifBuf = await rasterizeSampleAnimatedGif();
  await fs.promises.writeFile(path.join(BUNDLED_SAMPLES_DIR, "welcome.gif"), gifBuf);

  assetCache.clear();
  return { iconsWritten, placeholdersWritten, samplesWritten: 1 };
}

/**
 * Hardened read-only Express middleware serving ONLY module-bundled PNG icons,
 * neutral gradient placeholders, and sample GIF under `/uploads/email-assets`:
 *   - GET /uploads/email-assets/icons/{tone}/{icon}.png
 *   - GET /uploads/email-assets/icons/{icon}.png  (defaults to `dark` tone)
 *   - GET /uploads/email-assets/placeholders/{name}.png
 *   - GET /uploads/email-assets/samples/welcome.gif
 * Enforces strict allow-lists, traversal blocking (400), read-only methods (405),
 * Content-Type, ETag/304, X-Content-Type-Options: nosniff, CORS read-only headers,
 * and immutable long cache headers.
 */
export function createEmailAssetsMiddleware() {
  return async function serveEmailAsset(
    req: Request,
    res: Response,
    _next: NextFunction
  ): Promise<void> {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.status(405).end();
      return;
    }

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

    const cleanPath = String(req.path || "").replace(/^\/+/, "");
    const segments = cleanPath.split("/");

    try {
      let asset: CachedAsset | null = null;
      let contentType = "image/png";

      if (segments.length === 3 && segments[0] === "icons" && segments[2].endsWith(".png")) {
        const tone = segments[1];
        const iconName = segments[2].slice(0, -4);
        if (TONE_SET.has(tone) && ICON_SET.has(iconName)) {
          asset = await loadBuiltInIconAsset(tone as EmailIconTone, iconName as EmailIconName);
          contentType = "image/png";
        }
      } else if (
        segments.length === 2 &&
        segments[0] === "icons" &&
        segments[1].endsWith(".png")
      ) {
        const iconName = segments[1].slice(0, -4);
        if (ICON_SET.has(iconName)) {
          asset = await loadBuiltInIconAsset("dark", iconName as EmailIconName);
          contentType = "image/png";
        }
      } else if (
        segments.length === 2 &&
        segments[0] === "placeholders" &&
        segments[1].endsWith(".png")
      ) {
        const name = segments[1].slice(0, -4);
        if (PLACEHOLDER_SET.has(name)) {
          asset = await loadPlaceholderAsset(name as PlaceholderImageName);
          contentType = "image/png";
        }
      } else if (
        segments.length === 2 &&
        segments[0] === "samples" &&
        segments[1] === "welcome.gif"
      ) {
        asset = await loadSampleGifAsset();
        contentType = "image/gif";
      }

      if (!asset) {
        res.status(404).end();
        return;
      }

      res.setHeader("Content-Type", contentType);
      res.setHeader("ETag", asset.etag);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Vary", "Accept-Encoding");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
      res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      res.setHeader("Access-Control-Allow-Origin", "*");

      if (req.headers["if-none-match"] === asset.etag) {
        res.status(304).end();
        return;
      }

      res.setHeader("Content-Length", String(asset.buffer.length));

      if (req.method === "HEAD") {
        res.status(200).end();
        return;
      }

      res.status(200).send(asset.buffer);
    } catch {
      res.status(500).end();
    }
  };
}
