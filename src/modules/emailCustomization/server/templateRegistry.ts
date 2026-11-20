import {
  ALLOWED_TEMPLATE_VARIABLES,
  CUSTOMIZABLE_EMAIL_EVENTS,
  EMAIL_MODULE_BASE_CONFIG,
  SYSTEM_FIXED_EMAIL_EVENTS,
  type AllowedTemplateVariable,
  type CustomizableEmailEventType,
  type EventCatalogEntry,
  type HotelEmailEventType,
} from "../shared/types.ts";
import { EMAIL_EVENT_CATALOG } from "../shared/defaultTemplates.ts";
import {
  callerBelongsToHotel,
  isSuperAdminCaller,
  type VerifiedCaller,
} from "../../../utils/serverSecurity.ts";

export {
  ALLOWED_TEMPLATE_VARIABLES,
  CUSTOMIZABLE_EMAIL_EVENTS,
  EMAIL_EVENT_CATALOG,
  EMAIL_MODULE_BASE_CONFIG,
  SYSTEM_FIXED_EMAIL_EVENTS,
};

const EVENT_ALIASES: Record<string, HotelEmailEventType> = {
  confirmation: "booking_confirmation",
  booking_confirmation: "booking_confirmation",
  "reservation.confirmed": "booking_confirmation",
  cancelled: "booking_cancellation",
  booking_cancellation: "booking_cancellation",
  "reservation.cancelled": "booking_cancellation",
  checked_in: "checked_in",
  "reservation.checked_in": "checked_in",
  checked_out: "checked_out",
  "reservation.checked_out": "checked_out",
  booking_modified: "booking_modified",
  modified: "booking_modified",
  "reservation.modified": "booking_modified",
  pre_arrival_reminder: "pre_arrival_reminder",
  "reservation.pre_arrival_reminder": "pre_arrival_reminder",
  payment_receipt: "payment_receipt",
  deposit_received: "payment_receipt",
  "payment.received": "payment_receipt",
  no_show: "no_show",
  "reservation.no_show": "no_show",
  post_stay_feedback_request: "post_stay_feedback_request",
  "reservation.post_stay_feedback": "post_stay_feedback_request",
  tracking_code_request_alert: "tracking_code_request_alert",
  "tracking_code.request_submitted": "tracking_code_request_alert",
};

export function normalizeHotelEmailEvent(raw: string): HotelEmailEventType | null {
  const key = String(raw || "").trim().toLowerCase();
  return EVENT_ALIASES[key] || null;
}

export function isCustomizableEvent(eventType: string): eventType is CustomizableEmailEventType {
  return Object.prototype.hasOwnProperty.call(EMAIL_EVENT_CATALOG, eventType);
}

export function getEventCatalogEntry(eventType: CustomizableEmailEventType): EventCatalogEntry {
  return EMAIL_EVENT_CATALOG[eventType];
}

export function getAllowedVariablesForEvent(
  eventType: CustomizableEmailEventType
): AllowedTemplateVariable[] {
  return EMAIL_EVENT_CATALOG[eventType]?.allowedVariables || [...ALLOWED_TEMPLATE_VARIABLES];
}

/**
 * Feature flag gate (`EMAIL_CUSTOMIZATION_ENABLED` env var + optional hotel-level override).
 * Defaults to enabled unless explicitly set to "false" / "0" so Hostinger deploys work out of the box
 * while providing an instant global or per-hotel kill-switch back to default templates.
 */
export function isEmailCustomizationEnabled(hotelDoc?: Record<string, any> | null): boolean {
  const envFlag =
    typeof process !== "undefined" && typeof process.env?.EMAIL_CUSTOMIZATION_ENABLED === "string"
      ? process.env.EMAIL_CUSTOMIZATION_ENABLED.trim().toLowerCase()
      : "";
  if (envFlag === "false" || envFlag === "0" || envFlag === "off" || envFlag === "no") {
    return false;
  }
  if (hotelDoc && hotelDoc.emailCustomizationEnabled === false) {
    return false;
  }
  return true;
}

/**
 * Strict Hotel Admin authorization check for Email Customization management.
 * Non-admin staff (receptionist, housekeeper, frontDesk, kitchen, maintenance, accountant, etc.)
 * are ALWAYS rejected. Hotel Admins can ONLY manage their own hotel derived from their verified profile.
 */
export function callerIsStrictHotelAdmin(
  caller: VerifiedCaller | null,
  targetHotelId?: string
): { allowed: boolean; resolvedHotelId: string; reason?: string } {
  if (!caller) {
    return { allowed: false, resolvedHotelId: "", reason: "Authentication required." };
  }

  if (isSuperAdminCaller(caller)) {
    const chosen =
      (targetHotelId && targetHotelId.trim()) ||
      String(caller.profile?.hotelId || caller.profile?.hotel_id || "").trim();
    if (!chosen) {
      return {
        allowed: false,
        resolvedHotelId: "",
        reason: "A target hotelId is required for SuperAdmin management.",
      };
    }
    return { allowed: true, resolvedHotelId: chosen };
  }

  const profile = caller.profile;
  if (!profile) {
    return { allowed: false, resolvedHotelId: "", reason: "User profile not found." };
  }

  const ownHotelId = String(profile.hotelId || profile.hotel_id || "").trim();
  if (!ownHotelId || ownHotelId === "system") {
    return { allowed: false, resolvedHotelId: "", reason: "No hotel associated with this account." };
  }

  if (!callerBelongsToHotel(caller, ownHotelId)) {
    return { allowed: false, resolvedHotelId: "", reason: "Account is inactive or suspended." };
  }

  // Strictly reject cross-hotel attempts even if client passed another hotelId
  if (targetHotelId && targetHotelId.trim() && targetHotelId.trim() !== ownHotelId) {
    return {
      allowed: false,
      resolvedHotelId: "",
      reason: "Forbidden: You may only manage email templates and settings for your own hotel.",
    };
  }

  const role = String(profile.role || "").trim();
  const staffRole = String(profile.staffRole || "").trim();
  const isAdminRole =
    role === "hotelAdmin" ||
    role === "admin" ||
    role === "hotel_admin" ||
    staffRole === "admin";

  if (!isAdminRole) {
    return {
      allowed: false,
      resolvedHotelId: "",
      reason: "Forbidden: Only Hotel Administrators can view or edit email templates, settings, and images.",
    };
  }

  // Always return token/profile-derived hotelId, never client input
  return { allowed: true, resolvedHotelId: ownHotelId };
}

export type EmailModuleAccessLevel = "view" | "manage";

function permissionsGrantEmailLevel(
  perms: unknown,
  level: EmailModuleAccessLevel
): boolean {
  if (!perms) return false;
  const required =
    level === "manage"
      ? ["manage_email_templates", "all"]
      : ["view_email_templates", "manage_email_templates", "all"];

  if (Array.isArray(perms)) {
    return required.some((key) => perms.includes(key));
  }

  if (typeof perms === "object" && perms !== null) {
    const obj = perms as Record<string, any>;
    for (const key of required) {
      if (obj[key] === true) return true;
    }
    const mod = obj.email_templates || obj.emailTemplates;
    if (mod && typeof mod === "object") {
      if (level === "manage") {
        return Boolean(mod.manage || mod.edit || mod.publish || mod.manageEmailTemplates);
      }
      return Boolean(
        mod.view ||
          mod.read ||
          mod.viewEmailTemplates ||
          mod.manage ||
          mod.edit ||
          mod.publish ||
          mod.manageEmailTemplates
      );
    }
  }
  return false;
}

/**
 * RBAC-aware authorization check for the Email Customization module:
 * - SuperAdmin, Hotel Admin, and Admin accounts always have full view + manage access for their hotel.
 * - Staff members WITHOUT explicit assignment are ALWAYS denied (cannot view or manage).
 * - Staff members explicitly assigned `view_email_templates` via RBAC/custom role by a Hotel Admin
 *   may view templates/settings/previews (read-only), and ONLY `manage_email_templates` grants edit/publish/toggle rights.
 * - Cross-hotel and suspended/inactive requests are ALWAYS rejected.
 */
export function callerHasEmailModuleAccess(
  caller: VerifiedCaller | null,
  targetHotelId?: string,
  level: EmailModuleAccessLevel = "manage",
  customRoleDoc?: Record<string, any> | null
): { allowed: boolean; resolvedHotelId: string; canManage: boolean; reason?: string } {
  const strict = callerIsStrictHotelAdmin(caller, targetHotelId);
  if (strict.allowed) {
    return { allowed: true, resolvedHotelId: strict.resolvedHotelId, canManage: true };
  }

  if (!caller) {
    return { allowed: false, resolvedHotelId: "", canManage: false, reason: "Authentication required." };
  }

  const profile = caller.profile;
  if (!profile) {
    return { allowed: false, resolvedHotelId: "", canManage: false, reason: "User profile not found." };
  }

  const ownHotelId = String(profile.hotelId || profile.hotel_id || "").trim();
  if (!ownHotelId || ownHotelId === "system") {
    return {
      allowed: false,
      resolvedHotelId: "",
      canManage: false,
      reason: "No hotel associated with this account.",
    };
  }

  if (!callerBelongsToHotel(caller, ownHotelId)) {
    return {
      allowed: false,
      resolvedHotelId: "",
      canManage: false,
      reason: "Account is inactive or suspended.",
    };
  }

  if (targetHotelId && targetHotelId.trim() && targetHotelId.trim() !== ownHotelId) {
    return {
      allowed: false,
      resolvedHotelId: "",
      canManage: false,
      reason: "Forbidden: You may only access email templates and settings for your own hotel.",
    };
  }

  // Evaluate authoritative RBAC source: active custom role takes priority over profile.permissions snapshot
  let effectivePerms: unknown = profile.permissions;
  if (profile.customRoleId) {
    if (customRoleDoc) {
      const roleStatus = String(customRoleDoc.status || "active").toLowerCase();
      if (roleStatus === "disabled" || roleStatus === "archived") {
        return {
          allowed: false,
          resolvedHotelId: "",
          canManage: false,
          reason: "Forbidden: Assigned custom role is inactive.",
        };
      }
      effectivePerms = customRoleDoc.permissions || [];
    }
  }

  const canManage = permissionsGrantEmailLevel(effectivePerms, "manage");
  const canView = canManage || permissionsGrantEmailLevel(effectivePerms, "view");

  if (level === "manage" && !canManage) {
    return {
      allowed: false,
      resolvedHotelId: "",
      canManage: false,
      reason:
        "Forbidden: Only Hotel Administrators or explicitly assigned administrators can edit email templates, settings, or images.",
    };
  }

  if (level === "view" && !canView) {
    return {
      allowed: false,
      resolvedHotelId: "",
      canManage: false,
      reason:
        "Forbidden: Email Templates module access has not been assigned to your role.",
    };
  }

  return { allowed: true, resolvedHotelId: ownHotelId, canManage };
}
