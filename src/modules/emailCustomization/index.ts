export {
  sendHotelEmail,
  runScheduledHotelEmails,
  type SendHotelEmailContext,
  type SendHotelEmailResult,
} from "./server/dispatcher.ts";

export {
  resolveEffectiveTemplate,
  getHotelEmailSettings,
  saveHotelEmailSettings,
  getEmailTemplateDocument,
  listEmailTemplatesOverview,
  saveTemplateVariant,
  toggleTemplateEnabled,
  resetTemplateToDefault,
  restoreTemplateVersion,
  findImageReferencesAcrossTemplates,
  type EmailTemplateOverviewItem,
  type ResolvedTemplateResult,
} from "./server/resolver.ts";

export { mountEmailCustomizationRoutes } from "./server/routes.ts";

export {
  EMAIL_EVENT_CATALOG,
  buildDefaultTemplateForHotel,
  buildSamplePreviewContext,
} from "./server/defaultTemplates.ts";

export {
  callerIsStrictHotelAdmin,
  callerHasEmailModuleAccess,
  isCustomizableEvent,
  isEmailCustomizationEnabled,
  normalizeHotelEmailEvent,
  type EmailModuleAccessLevel,
} from "./server/templateRegistry.ts";

export * from "./shared/types.ts";
