import { Resend } from "resend";
import {
  escapeHtml,
  isValidEmailAddress,
  sanitizeEmailHeaderValue,
} from "../utils/serverSecurity.ts";
import {
  htmlToPlainText,
  parseMailboxString,
} from "./resendEmailService.ts";

export interface SendEmailParams {
  recipient?: string | string[];
  to?: string | string[];
  subject: string;
  body?: string;
  html?: string;
  text?: string;
  fromName?: string;
  replyTo?: string;
  idempotencyKey?: string;
  tags?: { name: string; value: string }[];
  maxRetries?: number;
}

export type EmailDeliveryState =
  | "accepted_by_provider"
  | "unconfigured"
  | "failed";

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  deliveryState: EmailDeliveryState;
  provider: "resend";
  statusCode: number;
  attempts?: number;
  error?: string;
}

const MAX_RECIPIENTS = 10;
const MAX_SUBJECT_LENGTH = 200;
const MAX_BODY_BYTES = 100 * 1024; // 100 KB

let cachedResendClient: Resend | null = null;
let cachedApiKey: string | null = null;

function readResendApiKey(): string {
  return typeof process !== "undefined" && typeof process.env?.RESEND_API_KEY === "string"
    ? process.env.RESEND_API_KEY.trim()
    : "";
}

function readResendFromEnv(): string {
  return typeof process !== "undefined" && typeof process.env?.RESEND_FROM_EMAIL === "string"
    ? process.env.RESEND_FROM_EMAIL.trim()
    : "";
}

function readAppUrlEnv(): string {
  return typeof process !== "undefined" && typeof process.env?.APP_URL === "string"
    ? process.env.APP_URL.trim().replace(/\/+$/, "")
    : "";
}

export interface EmailConfigValidation {
  ok: boolean;
  missing: string[];
  error?: string;
}

/**
 * Validates required server-side email environment variables without exposing any secret values.
 * Requires RESEND_API_KEY, RESEND_FROM_EMAIL (valid mailbox), and APP_URL (valid http/https URL).
 */
export function validateEmailConfig(): EmailConfigValidation {
  const missing: string[] = [];

  const apiKey = readResendApiKey();
  if (!apiKey) {
    missing.push("RESEND_API_KEY");
  }

  const rawFrom = readResendFromEnv();
  const parsedFrom = parseMailboxString(rawFrom);
  if (!rawFrom || !parsedFrom.email) {
    missing.push("RESEND_FROM_EMAIL");
  }

  const rawAppUrl = readAppUrlEnv();
  let validAppUrl = false;
  if (rawAppUrl) {
    try {
      const parsed = new URL(rawAppUrl);
      validAppUrl = parsed.protocol === "https:" || parsed.protocol === "http:";
    } catch {
      validAppUrl = false;
    }
  }
  if (!validAppUrl) {
    missing.push("APP_URL");
  }

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      error: `Email service is not configured. Missing or invalid server environment variable(s): ${missing.join(", ")}.`,
    };
  }

  return { ok: true, missing: [] };
}

/**
 * Returns APP_URL with any trailing slashes stripped.
 * Throws a clear, non-secret error if APP_URL is missing or invalid.
 */
export function getAppUrl(): string {
  const rawAppUrl = readAppUrlEnv();
  if (!rawAppUrl) {
    throw new Error("Email service configuration error: APP_URL is missing in server environment.");
  }
  let parsed: URL;
  try {
    parsed = new URL(rawAppUrl);
  } catch {
    throw new Error("Email service configuration error: APP_URL must be a valid http(s) URL.");
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new Error("Email service configuration error: APP_URL must use http or https.");
  }
  return rawAppUrl.replace(/\/+$/, "");
}

export function isEmailServiceConfigured(): boolean {
  return validateEmailConfig().ok;
}

/**
 * Resolves the verified sender address strictly from process.env.RESEND_FROM_EMAIL.
 * Never falls back to onboarding@resend.dev; throws a clear non-secret error if unset or invalid.
 */
export function getConfiguredFromAddress(overrideName?: string): {
  email: string;
  displayName: string;
  formatted: string;
} {
  const envFrom = readResendFromEnv();
  const parsed = parseMailboxString(envFrom);
  if (!parsed.email) {
    throw new Error(
      "Email service configuration error: RESEND_FROM_EMAIL is missing or not a valid email address."
    );
  }

  const displayName = overrideName
    ? sanitizeEmailHeaderValue(overrideName, parsed.displayName || "Hotel Notifications")
    : parsed.displayName
      ? sanitizeEmailHeaderValue(parsed.displayName, "Hotel Notifications")
      : "";

  return {
    email: parsed.email,
    displayName,
    formatted: displayName ? `${displayName} <${parsed.email}>` : parsed.email,
  };
}

function redactSecrets(message: unknown): string {
  return String(message || "Email dispatch failed.")
    .replace(/\bre_[A-Za-z0-9_\-]{8,}\b/g, "[REDACTED_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, "Bearer [REDACTED]")
    .slice(0, 240);
}

function getResendClient(): Resend | null {
  const apiKey = readResendApiKey();
  if (!apiKey) return null;

  if (!cachedResendClient || cachedApiKey !== apiKey) {
    cachedResendClient = new Resend(apiKey);
    cachedApiKey = apiKey;
  }
  return cachedResendClient;
}

function normalizeRecipients(input?: string | string[]): {
  recipients: string[];
  error?: string;
} {
  const rawList = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? [input]
      : [];

  if (rawList.length === 0) {
    return { recipients: [], error: "Recipient email address is required." };
  }

  if (rawList.length > MAX_RECIPIENTS) {
    return {
      recipients: [],
      error: `Too many recipients. Maximum ${MAX_RECIPIENTS} recipients allowed per request.`,
    };
  }

  const valid: string[] = [];
  for (const item of rawList) {
    const trimmed = typeof item === "string" ? item.trim() : "";
    if (!isValidEmailAddress(trimmed)) {
      return {
        recipients: [],
        error: "One or more recipient email addresses are invalid.",
      };
    }
    valid.push(trimmed);
  }

  return { recipients: valid };
}

function buildEmailContent(params: SendEmailParams): {
  html: string;
  text: string;
  error?: string;
} {
  const rawHtml = typeof params.html === "string" ? params.html.trim() : "";
  const rawText = typeof params.text === "string" ? params.text.trim() : "";
  const rawBody = typeof params.body === "string" ? params.body.trim() : "";

  if (!rawHtml && !rawText && !rawBody) {
    return { html: "", text: "", error: "Email body content is required." };
  }

  const totalBytes =
    Buffer.byteLength(rawHtml, "utf8") +
    Buffer.byteLength(rawText, "utf8") +
    Buffer.byteLength(rawBody, "utf8");

  if (totalBytes > MAX_BODY_BYTES) {
    return {
      html: "",
      text: "",
      error: "Email body content exceeds the maximum allowed size (100 KB).",
    };
  }

  let html = rawHtml;
  let text = rawText;

  if (!html && rawBody) {
    const looksLikeHtml = /<[a-z][\s\S]*>/i.test(rawBody);
    if (looksLikeHtml) {
      html = rawBody;
      if (!text) text = htmlToPlainText(rawBody);
    } else {
      const escapedLines = escapeHtml(rawBody).replace(/\r?\n/g, "<br />");
      html = `<div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #18181b;">${escapedLines}</div>`;
      if (!text) text = rawBody;
    }
  } else if (!html && rawText) {
    const escapedLines = escapeHtml(rawText).replace(/\r?\n/g, "<br />");
    html = `<div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #18181b;">${escapedLines}</div>`;
  }

  if (!text && html) {
    text = htmlToPlainText(html);
  }

  return { html, text };
}

/**
 * Server-side email dispatch function powered by the official Resend SDK.
 * Strictly requires RESEND_API_KEY, RESEND_FROM_EMAIL, and APP_URL in server env
 * and returns structured results without exposing secrets.
 */
export async function sendEmail(
  params: SendEmailParams
): Promise<SendEmailResult> {
  const recipientCheck = normalizeRecipients(params.to ?? params.recipient);
  if (recipientCheck.error) {
    return {
      success: false,
      deliveryState: "failed",
      provider: "resend",
      statusCode: 400,
      error: recipientCheck.error,
    };
  }

  const rawSubject = typeof params.subject === "string" ? params.subject.trim() : "";
  if (!rawSubject) {
    return {
      success: false,
      deliveryState: "failed",
      provider: "resend",
      statusCode: 400,
      error: "Email subject is required.",
    };
  }
  if (rawSubject.length > MAX_SUBJECT_LENGTH) {
    return {
      success: false,
      deliveryState: "failed",
      provider: "resend",
      statusCode: 400,
      error: `Email subject exceeds maximum length (${MAX_SUBJECT_LENGTH} characters).`,
    };
  }

  const content = buildEmailContent(params);
  if (content.error) {
    return {
      success: false,
      deliveryState: "failed",
      provider: "resend",
      statusCode: 400,
      error: content.error,
    };
  }

  if (params.replyTo !== undefined && params.replyTo !== "") {
    if (typeof params.replyTo !== "string" || !isValidEmailAddress(params.replyTo.trim())) {
      return {
        success: false,
        deliveryState: "failed",
        provider: "resend",
        statusCode: 400,
        error: "Invalid replyTo email address.",
      };
    }
  }

  const configCheck = validateEmailConfig();
  if (!configCheck.ok) {
    return {
      success: false,
      deliveryState: "unconfigured",
      provider: "resend",
      statusCode: 503,
      error: configCheck.error,
    };
  }

  const client = getResendClient();
  if (!client) {
    return {
      success: false,
      deliveryState: "unconfigured",
      provider: "resend",
      statusCode: 503,
      error: "Email service is not configured. Missing RESEND_API_KEY in server environment.",
    };
  }

  const safeSubject = sanitizeEmailHeaderValue(rawSubject, "Notification");
  let fromIdentity: { email: string; displayName: string; formatted: string };
  try {
    fromIdentity = getConfiguredFromAddress(params.fromName);
  } catch (cfgErr: any) {
    return {
      success: false,
      deliveryState: "unconfigured",
      provider: "resend",
      statusCode: 503,
      error: redactSecrets(cfgErr?.message),
    };
  }

  const payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
    tags?: { name: string; value: string }[];
  } = {
    from: fromIdentity.formatted,
    to: recipientCheck.recipients,
    subject: safeSubject,
    html: content.html,
  };

  if (content.text) {
    payload.text = content.text;
  }

  if (typeof params.replyTo === "string" && params.replyTo.trim()) {
    payload.replyTo = params.replyTo.trim();
  }

  if (Array.isArray(params.tags) && params.tags.length > 0) {
    const cleanTags = params.tags
      .filter((t) => t && typeof t.name === "string" && typeof t.value === "string")
      .map((t) => ({
        name: t.name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64),
        value: t.value.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 128),
      }))
      .filter((t) => t.name.length > 0 && t.value.length > 0)
      .slice(0, 10);
    if (cleanTags.length > 0) {
      payload.tags = cleanTags;
    }
  }

  const maxRetries =
    typeof params.maxRetries === "number" && Number.isFinite(params.maxRetries)
      ? Math.max(0, Math.min(3, Math.floor(params.maxRetries)))
      : 2;

  const isTransientResendError = (errObj: any, message: string): boolean => {
    const status = Number(errObj?.statusCode || errObj?.status || 0);
    if (status === 429 || status >= 500) return true;
    if (status >= 400 && status < 500) return false;
    const lower = message.toLowerCase();
    return (
      lower.includes("timeout") ||
      lower.includes("timed out") ||
      lower.includes("rate limit") ||
      lower.includes("too many requests") ||
      lower.includes("temporarily unavailable") ||
      lower.includes("econnreset") ||
      lower.includes("enotfound") ||
      lower.includes("fetch failed") ||
      lower.includes("network")
    );
  };

  const sendOptions =
    typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
      ? { idempotencyKey: params.idempotencyKey.trim().slice(0, 128) }
      : undefined;

  let lastError = "Unexpected error while sending email via Resend.";
  let attempts = 0;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    attempts = attempt + 1;
    try {
      const response = await client.emails.send(payload, sendOptions);

      if (response.error) {
        const rawErrMsg =
          response.error.message || "Resend API rejected the email dispatch request.";
        const safeErr = redactSecrets(rawErrMsg);
        lastError = safeErr;

        if (attempt < maxRetries && isTransientResendError(response.error, rawErrMsg)) {
          const delayMs = 250 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }

        console.error(`[EMAIL SERVICE] Resend API error (attempt ${attempts}):`, safeErr);
        return {
          success: false,
          deliveryState: "failed",
          provider: "resend",
          statusCode: 502,
          attempts,
          error: safeErr,
        };
      }

      const messageId = response.data?.id;
      if (!messageId) {
        lastError = "Resend returned an empty response without a message ID.";
        if (attempt < maxRetries) {
          const delayMs = 250 * Math.pow(2, attempt);
          await new Promise((resolve) => setTimeout(resolve, delayMs));
          continue;
        }
        return {
          success: false,
          deliveryState: "failed",
          provider: "resend",
          statusCode: 502,
          attempts,
          error: lastError,
        };
      }

      console.log(
        `[EMAIL SERVICE] Dispatched via Resend | From: ${fromIdentity.email} | MessageId: ${messageId} | Attempts: ${attempts}`
      );

      return {
        success: true,
        messageId,
        deliveryState: "accepted_by_provider",
        provider: "resend",
        statusCode: 200,
        attempts,
      };
    } catch (err: any) {
      const rawMsg = err?.message || "Unexpected error while sending email via Resend.";
      const safeErr = redactSecrets(rawMsg);
      lastError = safeErr;

      if (attempt < maxRetries && isTransientResendError(err, rawMsg)) {
        const delayMs = 250 * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      console.error(`[EMAIL SERVICE] Exception during Resend dispatch (attempt ${attempts}):`, safeErr);
      return {
        success: false,
        deliveryState: "failed",
        provider: "resend",
        statusCode: 502,
        attempts,
        error: safeErr,
      };
    }
  }

  return {
    success: false,
    deliveryState: "failed",
    provider: "resend",
    statusCode: 502,
    attempts,
    error: lastError,
  };
}

export interface BookingEmailTemplateData {
  hotelName: string;
  guestName: string;
  roomLabel: string;
  checkIn: string;
  checkOut: string;
  bookingRef: string;
  hotelEmail?: string;
  hotelPhone?: string;
  hotelAddress?: string;
  appUrl: string;
}

export interface TrackingCodeRequestAlertData {
  hotelName: string;
  requesterEmail: string;
  requesterPhone?: string;
  plan?: string;
  requestType?: string;
  message?: string;
  requestId: string;
  requestedAt?: string;
  appUrl: string;
}

function buildHotelContactBlock(data: BookingEmailTemplateData): { html: string; text: string } {
  const htmlParts: string[] = [];
  const textParts: string[] = [];

  if (data.hotelAddress) {
    htmlParts.push(`<div>Address: ${escapeHtml(data.hotelAddress)}</div>`);
    textParts.push(`Address: ${data.hotelAddress}`);
  }
  if (data.hotelPhone) {
    htmlParts.push(`<div>Phone: ${escapeHtml(data.hotelPhone)}</div>`);
    textParts.push(`Phone: ${data.hotelPhone}`);
  }
  if (data.hotelEmail) {
    htmlParts.push(`<div>Email: ${escapeHtml(data.hotelEmail)}</div>`);
    textParts.push(`Email: ${data.hotelEmail}`);
  }

  return {
    html: htmlParts.length > 0
      ? `<div style="margin-top: 20px; padding-top: 16px; border-top: 1px solid #e4e4e7; font-size: 13px; color: #52525b;"><strong>Hotel Contact</strong>${htmlParts.join("")}</div>`
      : "",
    text: textParts.length > 0 ? `\nHotel Contact:\n${textParts.join("\n")}` : "",
  };
}

export function buildBookingConfirmationEmail(data: BookingEmailTemplateData): {
  subject: string;
  html: string;
  text: string;
} {
  const cleanUrl = data.appUrl.replace(/\/+$/, "");
  const contact = buildHotelContactBlock(data);
  const subject = `Booking Confirmation - ${data.hotelName} (${data.bookingRef})`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 24px; background-color: #f4f4f5; font-family: Arial, Helvetica, sans-serif; color: #18181b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 28px;">
    <h2 style="margin: 0 0 8px; font-size: 20px; color: #18181b;">Booking Confirmation</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #52525b;">${escapeHtml(data.hotelName)}</p>
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">Hello ${escapeHtml(data.guestName)},</p>
    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6;">Your reservation at <strong>${escapeHtml(data.hotelName)}</strong> has been confirmed. Below are your booking details:</p>
    <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e4e4e7; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a; width: 40%;">Booking Reference</td><td style="font-weight: 700;">${escapeHtml(data.bookingRef)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Guest Name</td><td>${escapeHtml(data.guestName)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Room</td><td>${escapeHtml(data.roomLabel)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Check-In</td><td>${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="color: #71717a;">Check-Out</td><td>${escapeHtml(data.checkOut)}</td></tr>
    </table>
    <p style="margin: 20px 0 0; font-size: 14px;">Portal: <a href="${escapeHtml(cleanUrl)}" style="color: #059669;">${escapeHtml(cleanUrl)}</a></p>
    ${contact.html}
  </div>
</body>
</html>`;

  const text = [
    `Booking Confirmation - ${data.hotelName}`,
    ``,
    `Hello ${data.guestName},`,
    ``,
    `Your reservation at ${data.hotelName} has been confirmed.`,
    ``,
    `Booking Reference: ${data.bookingRef}`,
    `Guest Name: ${data.guestName}`,
    `Room: ${data.roomLabel}`,
    `Check-In: ${data.checkIn}`,
    `Check-Out: ${data.checkOut}`,
    ``,
    `Website: ${cleanUrl}`,
    contact.text,
  ].join("\n").trim();

  return { subject, html, text };
}

export function buildBookingCancellationEmail(data: BookingEmailTemplateData): {
  subject: string;
  html: string;
  text: string;
} {
  const cleanUrl = data.appUrl.replace(/\/+$/, "");
  const contact = buildHotelContactBlock(data);
  const subject = `Booking Cancellation - ${data.hotelName} (${data.bookingRef})`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 24px; background-color: #f4f4f5; font-family: Arial, Helvetica, sans-serif; color: #18181b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 28px;">
    <h2 style="margin: 0 0 8px; font-size: 20px; color: #18181b;">Booking Cancellation</h2>
    <p style="margin: 0 0 16px; font-size: 14px; color: #52525b;">${escapeHtml(data.hotelName)}</p>
    <p style="margin: 0 0 16px; font-size: 14px; line-height: 1.6;">Hello ${escapeHtml(data.guestName)},</p>
    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6;">Your reservation at <strong>${escapeHtml(data.hotelName)}</strong> has been cancelled. Cancelled booking details:</p>
    <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e4e4e7; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a; width: 40%;">Booking Reference</td><td style="font-weight: 700;">${escapeHtml(data.bookingRef)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Guest Name</td><td>${escapeHtml(data.guestName)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Room</td><td>${escapeHtml(data.roomLabel)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Check-In</td><td>${escapeHtml(data.checkIn)}</td></tr>
      <tr><td style="color: #71717a;">Check-Out</td><td>${escapeHtml(data.checkOut)}</td></tr>
    </table>
    <p style="margin: 20px 0 0; font-size: 14px;">If this cancellation was unexpected, please reply to this email or contact the hotel directly.</p>
    <p style="margin: 12px 0 0; font-size: 14px;">Portal: <a href="${escapeHtml(cleanUrl)}" style="color: #059669;">${escapeHtml(cleanUrl)}</a></p>
    ${contact.html}
  </div>
</body>
</html>`;

  const text = [
    `Booking Cancellation - ${data.hotelName}`,
    ``,
    `Hello ${data.guestName},`,
    ``,
    `Your reservation at ${data.hotelName} has been cancelled.`,
    ``,
    `Booking Reference: ${data.bookingRef}`,
    `Guest Name: ${data.guestName}`,
    `Room: ${data.roomLabel}`,
    `Check-In: ${data.checkIn}`,
    `Check-Out: ${data.checkOut}`,
    ``,
    `If this cancellation was unexpected, please contact the hotel directly.`,
    `Website: ${cleanUrl}`,
    contact.text,
  ].join("\n").trim();

  return { subject, html, text };
}

export function buildTrackingCodeRequestAlertEmail(data: TrackingCodeRequestAlertData): {
  subject: string;
  html: string;
  text: string;
} {
  const cleanUrl = data.appUrl.replace(/\/+$/, "");
  const isRenewal = (data.requestType || "").toLowerCase() === "renewal";
  const label = isRenewal ? "Subscription Renewal Code Request" : "New Tracking Code Request";
  const subject = `[Admin Alert] ${label} - ${data.hotelName}`;

  const html = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 24px; background-color: #f4f4f5; font-family: Arial, Helvetica, sans-serif; color: #18181b;">
  <div style="max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e4e4e7; border-radius: 8px; padding: 28px;">
    <h2 style="margin: 0 0 12px; font-size: 20px; color: #18181b;">${escapeHtml(label)}</h2>
    <p style="margin: 0 0 18px; font-size: 14px; line-height: 1.6;">A new tracking code request has been submitted and is awaiting administrator review.</p>
    <table width="100%" cellpadding="8" cellspacing="0" style="border-collapse: collapse; border: 1px solid #e4e4e7; font-size: 14px;">
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a; width: 38%;">Request ID</td><td style="font-weight: 700;">${escapeHtml(data.requestId)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Hotel Name</td><td>${escapeHtml(data.hotelName)}</td></tr>
      <tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Email</td><td>${escapeHtml(data.requesterEmail)}</td></tr>
      ${data.requesterPhone ? `<tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Phone</td><td>${escapeHtml(data.requesterPhone)}</td></tr>` : ""}
      ${data.plan ? `<tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Plan</td><td>${escapeHtml(data.plan)}</td></tr>` : ""}
      ${data.message ? `<tr style="border-bottom: 1px solid #e4e4e7;"><td style="color: #71717a;">Notes</td><td>${escapeHtml(data.message)}</td></tr>` : ""}
      ${data.requestedAt ? `<tr><td style="color: #71717a;">Submitted At</td><td>${escapeHtml(data.requestedAt)}</td></tr>` : ""}
    </table>
    <p style="margin: 20px 0 0; font-size: 14px;">Review requests in the admin portal: <a href="${escapeHtml(cleanUrl)}" style="color: #059669;">${escapeHtml(cleanUrl)}</a></p>
  </div>
</body>
</html>`;

  const text = [
    label,
    ``,
    `A new tracking code request has been submitted and is awaiting review.`,
    ``,
    `Request ID: ${data.requestId}`,
    `Hotel Name: ${data.hotelName}`,
    `Email: ${data.requesterEmail}`,
    ...(data.requesterPhone ? [`Phone: ${data.requesterPhone}`] : []),
    ...(data.plan ? [`Plan: ${data.plan}`] : []),
    ...(data.message ? [`Notes: ${data.message}`] : []),
    ...(data.requestedAt ? [`Submitted At: ${data.requestedAt}`] : []),
    ``,
    `Admin Portal: ${cleanUrl}`,
  ].join("\n");

  return { subject, html, text };
}
