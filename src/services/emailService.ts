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
  error?: string;
}

const DEFAULT_FROM_EMAIL = "onboarding@resend.dev";
const DEFAULT_FROM_NAME = "Tidé Hotels & Resorts";
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

export function isEmailServiceConfigured(): boolean {
  return readResendApiKey().length > 0;
}

/**
 * Safely resolves the sender address from process.env.RESEND_FROM_EMAIL.
 * Supports plain addresses ("no-reply@tidehotels.de") and named addresses
 * ("Tidé Hotels <no-reply@tidehotels.de>"), falling back to Resend's default
 * sender if unset or malformed.
 */
export function getConfiguredFromAddress(overrideName?: string): {
  email: string;
  displayName: string;
  formatted: string;
} {
  const envFrom = readResendFromEnv();
  const parsed = parseMailboxString(envFrom);
  const email = parsed.email || DEFAULT_FROM_EMAIL;
  const displayName = sanitizeEmailHeaderValue(
    overrideName || parsed.displayName || DEFAULT_FROM_NAME,
    DEFAULT_FROM_NAME
  );

  return {
    email,
    displayName,
    formatted: `"${displayName}" <${email}>`,
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
 * Safely accesses process.env.RESEND_API_KEY and process.env.RESEND_FROM_EMAIL
 * and returns structured results without throwing unhandled exceptions.
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
  const fromIdentity = getConfiguredFromAddress(params.fromName);

  const payload: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text?: string;
    replyTo?: string;
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

  try {
    const sendOptions =
      typeof params.idempotencyKey === "string" && params.idempotencyKey.trim()
        ? { idempotencyKey: params.idempotencyKey.trim().slice(0, 128) }
        : undefined;

    const response = await client.emails.send(payload, sendOptions);

    if (response.error) {
      const safeErr = redactSecrets(
        response.error.message || "Resend API rejected the email dispatch request."
      );
      console.error("[EMAIL SERVICE] Resend API error:", safeErr);
      return {
        success: false,
        deliveryState: "failed",
        provider: "resend",
        statusCode: 502,
        error: safeErr,
      };
    }

    const messageId = response.data?.id;
    if (!messageId) {
      return {
        success: false,
        deliveryState: "failed",
        provider: "resend",
        statusCode: 502,
        error: "Resend returned an empty response without a message ID.",
      };
    }

    console.log(
      `[EMAIL SERVICE] Dispatched via Resend | To: ${recipientCheck.recipients.join(", ")} | From: ${fromIdentity.email} | MessageId: ${messageId}`
    );

    return {
      success: true,
      messageId,
      deliveryState: "accepted_by_provider",
      provider: "resend",
      statusCode: 200,
    };
  } catch (err: any) {
    const safeErr = redactSecrets(err?.message || "Unexpected error while sending email via Resend.");
    console.error("[EMAIL SERVICE] Exception during Resend dispatch:", safeErr);
    return {
      success: false,
      deliveryState: "failed",
      provider: "resend",
      statusCode: 502,
      error: safeErr,
    };
  }
}
