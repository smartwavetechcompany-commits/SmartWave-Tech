import crypto from "crypto";
import express, { type Express, type Request, type Response } from "express";
import {
  BoundedRateLimiter,
  isSafeIdentifier,
  sanitizeErrorForClient,
  type VerifiedCaller,
} from "../../../utils/serverSecurity.ts";
import {
  getAppUrl,
  getConfiguredFromAddress,
  sendEmail,
} from "../../../services/emailService.ts";
import {
  ALLOWED_TEMPLATE_VARIABLES,
  SUPPORTED_EMAIL_LANGUAGES,
  VARIABLE_DESCRIPTIONS,
  WEB_SAFE_FONTS,
  type CustomizableEmailEventType,
  type EmailTemplateVariant,
} from "../shared/types.ts";
import {
  EMAIL_EVENT_CATALOG,
  OPTIONAL_SECTION_PRESETS,
  buildSamplePreviewContext,
} from "./defaultTemplates.ts";
import { fsReadDoc } from "./firestoreRest.ts";
import {
  createLocalEmailImageMiddleware,
  deleteHotelImage,
  listHotelImages,
  renameHotelImage,
  uploadHotelImage,
} from "./imageService.ts";
import { renderHotelEmailServerSide } from "./renderer.ts";
import {
  getEmailTemplateDocument,
  getHotelEmailSettings,
  listEmailTemplatesOverview,
  normalizeLanguageCode,
  resetTemplateToDefault,
  restoreTemplateVersion,
  saveHotelEmailSettings,
  saveTemplateVariant,
  toggleTemplateEnabled,
} from "./resolver.ts";
import {
  callerHasEmailModuleAccess,
  isCustomizableEvent,
  isEmailCustomizationEnabled,
  type EmailModuleAccessLevel,
} from "./templateRegistry.ts";
import { runScheduledHotelEmails } from "./dispatcher.ts";
import { isValidEmail, validateTemplateVariant } from "../shared/validation.ts";

export interface EmailCustomizationRouteDeps {
  requireAuth: (req: Request, res: Response) => Promise<VerifiedCaller | null>;
  extractBearerToken: (req: Request) => string | null;
}

const saveLimiter = new BoundedRateLimiter(2000);
const previewLimiter = new BoundedRateLimiter(2000);
const uploadLimiter = new BoundedRateLimiter(2000);
const testSendLimiter = new BoundedRateLimiter(2000);

function getRequestedHotelId(req: Request): string | undefined {
  const q = typeof req.query?.hotelId === "string" ? req.query.hotelId.trim() : "";
  const b = typeof req.body?.hotelId === "string" ? req.body.hotelId.trim() : "";
  const candidate = q || b || "";
  if (!candidate) return undefined;
  return isSafeIdentifier(candidate) ? candidate : "__invalid__";
}

function resolveAppUrlSafe(): string {
  try {
    return getAppUrl();
  } catch {
    return "https://tidehotels.de";
  }
}

function getMaskedSenderInfo(): { verifiedFromAddress: string; configured: boolean } {
  try {
    const info = getConfiguredFromAddress();
    return { verifiedFromAddress: info.email, configured: true };
  } catch {
    return { verifiedFromAddress: "", configured: false };
  }
}

export function mountEmailCustomizationRoutes(
  app: Express,
  deps: EmailCustomizationRouteDeps
): void {
  const { requireAuth, extractBearerToken } = deps;

  // Read-only static serving strictly for local email images under IMAGE_UPLOAD_DIR/email-images
  app.use("/uploads/email-images", createLocalEmailImageMiddleware());

  async function requireEmailModuleAccess(
    req: Request,
    res: Response,
    level: EmailModuleAccessLevel = "manage"
  ): Promise<{ caller: VerifiedCaller; hotelId: string; bearerToken: string; canManage: boolean } | null> {
    const caller = await requireAuth(req, res);
    if (!caller) return null;

    const requestedHotelId = getRequestedHotelId(req);
    if (requestedHotelId === "__invalid__") {
      res.status(400).json({ error: "Invalid hotelId format." });
      return null;
    }

    const bearerToken = extractBearerToken(req) || "";

    // Load caller's live custom role document if assigned so role updates apply immediately server-side
    let customRoleDoc: Record<string, any> | null = null;
    const ownHotelId = String(caller.profile?.hotelId || caller.profile?.hotel_id || "").trim();
    const customRoleId =
      typeof caller.profile?.customRoleId === "string" ? caller.profile.customRoleId.trim() : "";
    if (ownHotelId && customRoleId && isSafeIdentifier(ownHotelId) && isSafeIdentifier(customRoleId)) {
      customRoleDoc = await fsReadDoc(
        `hotels/${ownHotelId}/customRoles/${customRoleId}`,
        bearerToken
      ).catch(() => null);
    }

    const check = callerHasEmailModuleAccess(caller, requestedHotelId, level, customRoleDoc);
    if (!check.allowed) {
      res.status(403).json({ error: check.reason || "Forbidden." });
      return null;
    }

    return {
      caller,
      hotelId: check.resolvedHotelId,
      bearerToken,
      canManage: check.canManage,
    };
  }

  // 1. Module metadata, feature flag status, variable catalog, and presets
  app.get("/api/email-customization/config", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const senderInfo = getMaskedSenderInfo();

      return res.json({
        enabled: isEmailCustomizationEnabled(hotelDoc),
        canManage: ctx.canManage,
        hotelId: ctx.hotelId,
        hotelName:
          hotelDoc?.branding?.organizationName || hotelDoc?.name || "Hotel Property",
        appUrl: resolveAppUrlSafe(),
        verifiedFromAddress: senderInfo.verifiedFromAddress,
        emailServiceConfigured: senderInfo.configured,
        callerEmail: ctx.caller.email || "",
        languages: SUPPORTED_EMAIL_LANGUAGES,
        fonts: WEB_SAFE_FONTS,
        allowedVariables: ALLOWED_TEMPLATE_VARIABLES,
        variableDescriptions: VARIABLE_DESCRIPTIONS,
        eventCatalog: EMAIL_EVENT_CATALOG,
        optionalSectionPresets: OPTIONAL_SECTION_PRESETS.map((p) => ({
          id: p.id,
          label: p.label,
          description: p.description,
        })),
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to load email customization config.") });
    }
  });

  // 2. Templates overview list
  app.get("/api/email-customization/overview", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const [templates, settings] = await Promise.all([
        listEmailTemplatesOverview(ctx.hotelId, ctx.bearerToken),
        getHotelEmailSettings(ctx.hotelId, ctx.bearerToken),
      ]);

      return res.json({
        enabled: isEmailCustomizationEnabled(hotelDoc),
        hotelId: ctx.hotelId,
        templates,
        settings,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to load email templates overview.") });
    }
  });

  // 3. Get single event template document (draft + published + version history + sample context)
  app.get("/api/email-customization/templates/:eventType", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const [template, settings] = await Promise.all([
        getEmailTemplateDocument(ctx.hotelId, eventType, hotelDoc, ctx.bearerToken),
        getHotelEmailSettings(ctx.hotelId, ctx.bearerToken),
      ]);

      const sampleContext = buildSamplePreviewContext(
        ctx.hotelId,
        hotelDoc,
        resolveAppUrlSafe(),
        { includeLoyaltySample: false }
      );

      return res.json({
        template,
        settings,
        sampleContext,
        meta: EMAIL_EVENT_CATALOG[eventType],
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to load email template.") });
    }
  });

  // 4. Save draft or publish template
  app.put("/api/email-customization/templates/:eventType", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const rate = saveLimiter.check(`save:${ctx.caller.uid}`, 30, 60_000);
      if (!rate.allowed) {
        return res.status(429).json({ error: "Too many save requests. Please wait a moment." });
      }

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const language = normalizeLanguageCode(req.body?.language);
      const variant = req.body?.variant as EmailTemplateVariant;
      const publish = req.body?.publish === true;
      const note = typeof req.body?.note === "string" ? req.body.note : undefined;
      const enabled = typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined;

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const actor = ctx.caller.email || ctx.caller.uid;

      const result = await saveTemplateVariant(
        ctx.hotelId,
        eventType,
        { language, variant, publish, note, enabled },
        hotelDoc,
        actor,
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(400).json({ error: result.error, issues: result.issues || [] });
      }

      return res.json({ ok: true, template: result.doc });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to save email template.") });
    }
  });

  // 5. Toggle event on/off
  app.patch("/api/email-customization/templates/:eventType/toggle", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      if (typeof req.body?.enabled !== "boolean") {
        return res.status(400).json({ error: "enabled boolean is required." });
      }

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const actor = ctx.caller.email || ctx.caller.uid;

      const result = await toggleTemplateEnabled(
        ctx.hotelId,
        eventType,
        req.body.enabled,
        hotelDoc,
        actor,
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(500).json({ error: result.error });
      }
      return res.json({ ok: true, template: result.doc });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to update template status.") });
    }
  });

  // 6. Reset event template to default
  app.post("/api/email-customization/templates/:eventType/reset", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const actor = ctx.caller.email || ctx.caller.uid;

      const result = await resetTemplateToDefault(
        ctx.hotelId,
        eventType,
        hotelDoc,
        actor,
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(500).json({ error: result.error });
      }
      return res.json({ ok: true, template: result.doc });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to reset email template.") });
    }
  });

  // 7. Restore prior published version
  app.post("/api/email-customization/templates/:eventType/restore", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const version = Number(req.body?.version);
      if (!Number.isInteger(version) || version < 1) {
        return res.status(400).json({ error: "A valid positive version number is required." });
      }

      const hotelDoc = await fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null);
      const actor = ctx.caller.email || ctx.caller.uid;

      const result = await restoreTemplateVersion(
        ctx.hotelId,
        eventType,
        version,
        hotelDoc,
        actor,
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(400).json({ error: result.error });
      }
      return res.json({ ok: true, template: result.doc });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to restore template version.") });
    }
  });

  // 8. Server-side preview render with sample data
  app.post("/api/email-customization/templates/:eventType/preview", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const rate = previewLimiter.check(`preview:${ctx.caller.uid}`, 60, 60_000);
      if (!rate.allowed) {
        return res.status(429).json({ error: "Too many preview requests." });
      }

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const variant = req.body?.variant as EmailTemplateVariant;
      const language = normalizeLanguageCode(req.body?.language);
      const includeLoyaltySample = req.body?.includeLoyaltySample === true;

      const issues = validateTemplateVariant(variant);
      if (issues.length > 0) {
        return res.status(400).json({ error: issues[0].message, issues });
      }

      const [hotelDoc, settings] = await Promise.all([
        fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null),
        getHotelEmailSettings(ctx.hotelId, ctx.bearerToken),
      ]);

      const sampleCtx = buildSamplePreviewContext(
        ctx.hotelId,
        hotelDoc,
        resolveAppUrlSafe(),
        { includeLoyaltySample }
      );

      const rendered = renderHotelEmailServerSide({
        variant,
        context: sampleCtx,
        settings,
        language,
        usedDefaultLayout: false,
      });

      return res.json({ ok: true, rendered });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to render email preview.") });
    }
  });

  // 9. Send Test Email — STRICTLY to the logged-in admin's verified email only (capped per hour)
  app.post("/api/email-customization/templates/:eventType/test-send", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const adminEmail = (ctx.caller.email || "").trim();
      if (!isValidEmail(adminEmail)) {
        return res.status(400).json({
          error: "Your administrator account does not have a valid verified email address.",
        });
      }

      // Strict hourly cap (10 test sends / hour / admin)
      const rate = testSendLimiter.check(`test-send:${ctx.caller.uid}`, 10, 60 * 60_000);
      if (!rate.allowed) {
        return res.status(429).json({
          error: "Hourly test email limit reached (10 per hour). Please wait before sending more test emails.",
        });
      }

      const eventType = String(req.params.eventType || "").trim();
      if (!isCustomizableEvent(eventType)) {
        return res.status(400).json({ error: "Unknown email template event type." });
      }

      const language = normalizeLanguageCode(req.body?.language);
      const includeLoyaltySample = req.body?.includeLoyaltySample === true;
      const [hotelDoc, settings] = await Promise.all([
        fsReadDoc(`hotels/${ctx.hotelId}`, ctx.bearerToken).catch(() => null),
        getHotelEmailSettings(ctx.hotelId, ctx.bearerToken),
      ]);

      let variant = req.body?.variant as EmailTemplateVariant | undefined;
      if (variant) {
        const issues = validateTemplateVariant(variant);
        if (issues.length > 0) {
          return res.status(400).json({ error: issues[0].message, issues });
        }
      } else {
        const doc = await getEmailTemplateDocument(ctx.hotelId, eventType, hotelDoc, ctx.bearerToken);
        variant = doc.draft[language] || doc.published[language] || doc.published.en;
      }

      if (!variant) {
        return res.status(400).json({ error: "No template available to test-send." });
      }

      const sampleCtx = buildSamplePreviewContext(
        ctx.hotelId,
        hotelDoc,
        resolveAppUrlSafe(),
        { includeLoyaltySample }
      );

      const rendered = renderHotelEmailServerSide({
        variant,
        context: sampleCtx,
        settings,
        language,
        usedDefaultLayout: false,
      });

      const sendRes = await sendEmail({
        // NEVER trust any recipient from request body — strictly send to logged-in admin only
        to: adminEmail,
        subject: `[TEST] ${rendered.subject}`.slice(0, 195),
        html: rendered.html,
        text: rendered.text,
        fromName: rendered.fromName,
        replyTo: rendered.replyTo,
        tags: [
          { name: "hotel_id", value: ctx.hotelId },
          { name: "event", value: `test_${eventType}` },
        ],
      });

      if (!sendRes.success) {
        return res.status(sendRes.statusCode || 502).json({
          ok: false,
          error: sendRes.error || "Test email could not be sent.",
        });
      }

      return res.json({
        ok: true,
        sentTo: adminEmail,
        messageId: sendRes.messageId,
        remainingThisHour: rate.remaining,
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to send test email.") });
    }
  });

  // 10. Hotel Email Settings GET / PUT
  app.get("/api/email-customization/settings", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const settings = await getHotelEmailSettings(ctx.hotelId, ctx.bearerToken);
      return res.json({ ok: true, settings, appUrl: resolveAppUrlSafe() });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to load email settings.") });
    }
  });

  app.put("/api/email-customization/settings", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const rate = saveLimiter.check(`settings:${ctx.caller.uid}`, 30, 60_000);
      if (!rate.allowed) {
        return res.status(429).json({ error: "Too many save requests. Please wait a moment." });
      }

      const actor = ctx.caller.email || ctx.caller.uid;
      const result = await saveHotelEmailSettings(
        ctx.hotelId,
        req.body?.settings || req.body || {},
        actor,
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(400).json({ error: result.error, issues: result.issues || [] });
      }
      return res.json({ ok: true, settings: result.settings });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to save email settings.") });
    }
  });

  // 11. Hotel Email Image Library (GET, POST upload, PATCH rename, DELETE with reference guard)
  app.get("/api/email-customization/images", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "view");
      if (!ctx) return;

      const data = await listHotelImages(ctx.hotelId, ctx.bearerToken);
      return res.json({ ok: true, ...data });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to list email images.") });
    }
  });

  app.post(
    "/api/email-customization/images",
    express.json({ limit: "6mb" }),
    async (req, res) => {
      try {
        const ctx = await requireEmailModuleAccess(req, res, "manage");
        if (!ctx) return;

        const rate = uploadLimiter.check(`upload:${ctx.caller.uid}`, 20, 15 * 60_000);
        if (!rate.allowed) {
          return res
            .status(429)
            .json({ error: "Upload rate limit reached. Please wait a few minutes." });
        }

        const actor = ctx.caller.email || ctx.caller.uid;
        const result = await uploadHotelImage(
          ctx.hotelId,
          {
            base64Data: req.body?.base64Data || "",
            label: req.body?.label,
          },
          actor,
          ctx.bearerToken
        );

        if (!result.ok) {
          return res.status(result.statusCode || 400).json({ error: result.error });
        }
        return res.status(201).json({ ok: true, image: result.image });
      } catch (err) {
        return res
          .status(500)
          .json({ error: sanitizeErrorForClient(err, "Failed to upload image.") });
      }
    }
  );

  app.patch("/api/email-customization/images/:imageId", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const imageId = String(req.params.imageId || "").trim();
      if (!isSafeIdentifier(imageId)) {
        return res.status(400).json({ error: "Invalid imageId." });
      }

      const result = await renameHotelImage(
        ctx.hotelId,
        imageId,
        String(req.body?.label || ""),
        ctx.bearerToken
      );

      if (!result.ok) {
        return res.status(result.statusCode || 400).json({ error: result.error });
      }
      return res.json({ ok: true, image: result.image });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to rename image.") });
    }
  });

  app.delete("/api/email-customization/images/:imageId", async (req, res) => {
    try {
      const ctx = await requireEmailModuleAccess(req, res, "manage");
      if (!ctx) return;

      const imageId = String(req.params.imageId || "").trim();
      if (!isSafeIdentifier(imageId)) {
        return res.status(400).json({ error: "Invalid imageId." });
      }

      const result = await deleteHotelImage(ctx.hotelId, imageId, ctx.bearerToken);
      if (!result.ok) {
        return res.status(result.statusCode || 400).json({
          error: result.error,
          referencedByPublished: result.referencedByPublished,
        });
      }

      return res.json({
        ok: true,
        referencedByDraft: result.referencedByDraft || [],
      });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Failed to delete image.") });
    }
  });

  // 12. Secured Cron Trigger for Pre-Arrival Reminder & Post-Stay Feedback Request
  app.post("/api/email-customization/cron/run", async (req, res) => {
    try {
      const configuredSecret =
        typeof process.env.CRON_SECRET === "string" ? process.env.CRON_SECRET.trim() : "";
      if (!configuredSecret) {
        return res.status(503).json({
          error: "Scheduled email runner is not enabled (CRON_SECRET is not configured).",
        });
      }

      const authHeader = String(req.headers.authorization || "");
      const provided = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
      const a = Buffer.from(configuredSecret);
      const b = Buffer.from(provided);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ error: "Unauthorized cron request." });
      }

      const dryRun = req.body?.dryRun === true;
      const hotelIds = Array.isArray(req.body?.hotelIds)
        ? req.body.hotelIds.filter((id: any) => typeof id === "string" && isSafeIdentifier(id))
        : undefined;

      const summary = await runScheduledHotelEmails({ dryRun, hotelIds });
      return res.json({ ok: true, ...summary });
    } catch (err) {
      return res
        .status(500)
        .json({ error: sanitizeErrorForClient(err, "Scheduled email run failed.") });
    }
  });
}
