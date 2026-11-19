import crypto from "crypto";
import { Resend } from "resend";
import {
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "../utils/serverSecurity.ts";

export interface ResendAttachment {
  filename: string;
  content: string | Buffer;
  contentType?: string;
}

export interface ResendEmailParams {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  fromName?: string;
  fromEmail?: string;
  replyTo?: string;
  attachments?: ResendAttachment[];
  tags?: { name: string; value: string }[];
  idempotencyKey?: string;
}

export type ResendDeliveryState =
  | "accepted_by_provider"
  | "deduplicated"
  | "unconfigured"
  | "failed";

export interface ResendSendResult {
  emailDispatched: boolean;
  method: "resend" | "unconfigured" | "failed";
  deliveryState: ResendDeliveryState;
  previewUrl: false;
  messageId?: string;
  deduplicated?: boolean;
  error?: string;
}

const DEFAULT_RESEND_FROM_EMAIL = "onboarding@resend.dev";
const DEFAULT_RESEND_FROM_NAME = "Hotel Notifications";
const MAX_TOTAL_ATTACHMENT_BYTES = 5 * 1024 * 1024; // 5 MB safety limit
const MAX_DEDUP_ENTRIES = 2000;
const EXPLICIT_KEY_TTL_MS = 5 * 60 * 1000; // 5 minutes for explicit idempotency keys
const CONTENT_DEDUP_TTL_MS = 60 * 1000; // 60 seconds for identical content retries

let cachedClient: Resend | null = null;
let cachedKeyFingerprint: string | null = null;

interface DedupRecord {
  messageId: string;
  expiresAt: number;
}

const recentSentEmails = new Map<string, DedupRecord>();

function getResendApiKey(): string {
  return (process.env.RESEND_API_KEY || "").trim();
}

export function isResendConfigured(): boolean {
  return getResendApiKey().length > 0;
}

/**
 * Parses either a plain email ("notifications@mail.example.com") or a named mailbox
 * ("Hotel Notifications <notifications@mail.example.com>").
 */
export function parseMailboxString(raw?: string): {
  email: string | null;
  displayName: string | null;
} {
  if (typeof raw !== "string") return { email: null, displayName: null };
  const trimmed = raw.trim();
  if (!trimmed) return { email: null, displayName: null };

  const angleMatch = trimmed.match(/^(.*?)<([^<>]+)>$/);
  if (angleMatch) {
    const rawName = angleMatch[1].trim().replace(/^["']+|["']+$/g, "").trim();
    const emailPart = angleMatch[2].trim();
    if (isValidEmailAddress(emailPart)) {
      return {
        email: emailPart,
        displayName: rawName || null,
      };
    }
    return { email: null, displayName: null };
  }

  if (isValidEmailAddress(trimmed)) {
    return { email: trimmed, displayName: null };
  }

  return { email: null, displayName: null };
}

export function getResendFromIdentity(
  overrideEmail?: string,
  overrideName?: string
): { email: string; displayName: string; formatted: string; isCustomDomain: boolean } {
  const candidates = [
    overrideEmail,
    process.env.RESEND_FROM_EMAIL,
    process.env.SMTP_FROM,
    DEFAULT_RESEND_FROM_EMAIL,
  ];

  let resolvedEmail = DEFAULT_RESEND_FROM_EMAIL;
  let parsedName: string | null = null;

  for (const candidate of candidates) {
    const parsed = parseMailboxString(candidate);
    if (parsed.email) {
      resolvedEmail = parsed.email;
      parsedName = parsed.displayName;
      break;
    }
  }

  const chosenName = sanitizeEmailHeaderValue(
    overrideName || parsedName || DEFAULT_RESEND_FROM_NAME,
    DEFAULT_RESEND_FROM_NAME
  );

  return {
    email: resolvedEmail,
    displayName: chosenName,
    formatted: `"${chosenName}" <${resolvedEmail}>`,
    isCustomDomain: resolvedEmail.toLowerCase() !== DEFAULT_RESEND_FROM_EMAIL,
  };
}

export function getResendFromAddress(overrideEmail?: string): string {
  return getResendFromIdentity(overrideEmail).email;
}

/**
 * Generates a clean plain-text fallback from HTML email content so every email
 * includes both HTML and plain-text parts for deliverability and accessibility.
 */
export function htmlToPlainText(html: string): string {
  if (typeof html !== "string" || !html.trim()) return "";
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_m, href, label) => {
      const cleanLabel = String(label || "").replace(/<[^>]+>/g, "").trim();
      return cleanLabel && cleanLabel !== href ? `${cleanLabel} (${href})` : href;
    })
    .replace(/<(?:br|\/p|\/div|\/tr|\/li|\/h[1-6])\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&bull;/gi, "•")
    .replace(/&rarr;/gi, "->")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function sanitizeProviderError(raw: unknown): string {
  const text = String(raw || "Email provider request failed.");
  // Never leak any Resend API key token or bearer secret in logs or error summaries
  return text
    .replace(/\bre_[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .slice(0, 240);
}

function validateAttachments(
  attachments?: ResendAttachment[]
): { valid: ResendAttachment[] } | { error: string } {
  if (!attachments || attachments.length === 0) {
    return { valid: [] };
  }
  if (attachments.length > 5) {
    return { error: "Too many attachments (maximum 5 allowed)." };
  }

  let totalBytes = 0;
  const sanitized: ResendAttachment[] = [];

  for (const att of attachments) {
    const cleanName = pathSafeFilename(att?.filename);
    if (!cleanName) {
      return { error: "Invalid attachment filename." };
    }
    const content = att.content;
    if (typeof content !== "string" && !Buffer.isBuffer(content)) {
      return { error: "Invalid attachment content." };
    }
    const byteLength = Buffer.isBuffer(content)
      ? content.length
      : Buffer.byteLength(content, "utf8");
    totalBytes += byteLength;
    if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
      return { error: "Total attachment size exceeds 5 MB limit." };
    }
    sanitized.push({
      filename: cleanName,
      content,
      ...(att.contentType ? { contentType: sanitizeEmailHeaderValue(att.contentType, "application/octet-stream") } : {}),
    });
  }

  return { valid: sanitized };
}

function pathSafeFilename(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 180) return null;
  if (trimmed.includes("/") || trimmed.includes("\\") || trimmed.includes("..")) {
    return null;
  }
  return trimmed.replace(/[\r\n\0\x00-\x1f\x7f]/g, "");
}

function computeDedupKey(
  recipients: string[],
  subject: string,
  html: string,
  explicitKey?: string
): { key: string; ttlMs: number } {
  if (typeof explicitKey === "string" && explicitKey.trim()) {
    return {
      key: `idemp:${explicitKey.trim().slice(0, 128)}`,
      ttlMs: EXPLICIT_KEY_TTL_MS,
    };
  }
  const hash = crypto
    .createHash("sha256")
    .update(`${recipients.join(",")}|${subject}|${html}`)
    .digest("hex")
    .slice(0, 32);
  return {
    key: `hash:${hash}`,
    ttlMs: CONTENT_DEDUP_TTL_MS,
  };
}

function recordDedupEntry(key: string, messageId: string, ttlMs: number): void {
  const now = Date.now();
  if (recentSentEmails.size >= MAX_DEDUP_ENTRIES) {
    for (const [k, v] of recentSentEmails.entries()) {
      if (now > v.expiresAt) {
        recentSentEmails.delete(k);
      }
    }
    while (recentSentEmails.size >= MAX_DEDUP_ENTRIES) {
      const oldest = recentSentEmails.keys().next().value;
      if (!oldest) break;
      recentSentEmails.delete(oldest);
    }
  }
  recentSentEmails.set(key, { messageId, expiresAt: now + ttlMs });
}

export function clearResendDedupCacheForTest(): void {
  recentSentEmails.clear();
}

function getResendClient(): Resend | null {
  const apiKey = getResendApiKey();
  if (!apiKey) return null;

  if (!cachedClient || cachedKeyFingerprint !== apiKey) {
    cachedClient = new Resend(apiKey);
    cachedKeyFingerprint = apiKey;
  }
  return cachedClient;
}

/**
 * Isolated server-side Resend email dispatch helper.
 * - Reads RESEND_API_KEY and RESEND_FROM_EMAIL exclusively from server environment variables.
 * - Supports plain and named sender formats (e.g. "Hotel Notifications <notifications@mail.example.com>").
 * - Auto-generates plain-text fallback when not supplied.
 * - Prevents duplicate email dispatches on retried requests via bounded idempotency cache + Resend Idempotency-Key.
 * - Clearly distinguishes provider acceptance ('accepted_by_provider') from recipient inbox delivery.
 */
export async function sendEmailWithResend(
  params: ResendEmailParams
): Promise<ResendSendResult> {
  const client = getResendClient();
  if (!client) {
    return {
      emailDispatched: false,
      method: "unconfigured",
      deliveryState: "unconfigured",
      previewUrl: false,
      error: "Email service is not configured: RESEND_API_KEY is missing in server environment.",
    };
  }

  const recipients = (Array.isArray(params.to) ? params.to : [params.to])
    .map((addr) => String(addr || "").trim())
    .filter((addr) => isValidEmailAddress(addr));

  if (recipients.length === 0) {
    return {
      emailDispatched: false,
      method: "failed",
      deliveryState: "failed",
      previewUrl: false,
      error: "No valid recipient email address provided.",
    };
  }

  const safeSubject = sanitizeEmailHeaderValue(
    params.subject,
    "Hotel Platform Notification"
  );
  const fromIdentity = getResendFromIdentity(params.fromEmail, params.fromName);

  const attachmentCheck = validateAttachments(params.attachments);
  if ("error" in attachmentCheck) {
    return {
      emailDispatched: false,
      method: "failed",
      deliveryState: "failed",
      previewUrl: false,
      error: attachmentCheck.error,
    };
  }

  const dedup = computeDedupKey(
    recipients,
    safeSubject,
    params.html,
    params.idempotencyKey
  );
  const existing = recentSentEmails.get(dedup.key);
  if (existing && Date.now() < existing.expiresAt) {
    console.log(
      `[RESEND DEDUP] Prevented duplicate email dispatch to ${recipients.join(", ")} | Original MessageId: ${existing.messageId}`
    );
    return {
      emailDispatched: true,
      method: "resend",
      deliveryState: "deduplicated",
      previewUrl: false,
      messageId: existing.messageId,
      deduplicated: true,
    };
  }

  const plainTextFallback =
    typeof params.text === "string" && params.text.trim()
      ? params.text.trim()
      : htmlToPlainText(params.html);

  const payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    attachments?: ResendAttachment[];
    tags?: { name: string; value: string }[];
  } = {
    from: fromIdentity.formatted,
    to: recipients,
    subject: safeSubject,
    html: params.html,
  };

  if (plainTextFallback) {
    payload.text = plainTextFallback;
  }

  if (params.replyTo && isValidEmailAddress(params.replyTo.trim())) {
    payload.replyTo = params.replyTo.trim();
  }

  if (attachmentCheck.valid.length > 0) {
    payload.attachments = attachmentCheck.valid;
  }

  if (Array.isArray(params.tags) && params.tags.length > 0) {
    payload.tags = params.tags;
  }

  try {
    const sendOptions = params.idempotencyKey
      ? { idempotencyKey: params.idempotencyKey.trim().slice(0, 256) }
      : undefined;

    const response = await client.emails.send(payload, sendOptions);
    if (response.error) {
      const errMsg = sanitizeProviderError(
        response.error.message || "Resend API rejected the email request."
      );
      console.error("[RESEND ERROR] Failed to dispatch email:", errMsg);
      return {
        emailDispatched: false,
        method: "failed",
        deliveryState: "failed",
        previewUrl: false,
        error: errMsg,
      };
    }

    const messageId = response.data?.id;
    if (messageId) {
      recordDedupEntry(dedup.key, messageId, dedup.ttlMs);
      console.log(
        `[EMAIL ACCEPTED BY RESEND] To: ${recipients.join(", ")} | From: ${fromIdentity.email} | MessageId: ${messageId}`
      );
      return {
        emailDispatched: true,
        method: "resend",
        deliveryState: "accepted_by_provider",
        previewUrl: false,
        messageId,
      };
    }

    return {
      emailDispatched: false,
      method: "failed",
      deliveryState: "failed",
      previewUrl: false,
      error: "Resend returned an unexpected empty response.",
    };
  } catch (err: any) {
    const errMsg = sanitizeProviderError(
      err?.message || "Unexpected Resend transport error."
    );
    console.error("[RESEND EXCEPTION] Failed to dispatch email:", errMsg);
    return {
      emailDispatched: false,
      method: "failed",
      deliveryState: "failed",
      previewUrl: false,
      error: errMsg,
    };
  }
}
