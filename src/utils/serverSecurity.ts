/**
 * Pure server-side security utilities for HTTP header hardening, CORS enforcement,
 * HTML/header sanitization, URL / open-redirect prevention, bounded rate limiting,
 * error/secret redaction, and RBAC/multi-tenant authorization.
 */

export const SUPER_ADMIN_EMAILS = ['admin@tyyltech.com', 'smartwavetechcompany@gmail.com'];

const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Escapes untrusted values before interpolating into HTML email templates.
 */
export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/`/g, '&#96;');
}

/**
 * Strips CR, LF, null bytes, control chars, and double quotes from SMTP header values
 * (prevents SMTP header injection in From display names and Subjects).
 */
export function sanitizeEmailHeaderValue(value: unknown, fallback = 'PMS Notification'): string {
  const cleaned = String(value ?? '')
    .replace(/[\r\n\0\x00-\x1f\x7f]/g, ' ')
    .replace(/["<>\\]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
  return cleaned || fallback;
}

const STRICT_EMAIL_REGEX =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

export function isValidEmailAddress(email: unknown): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (trimmed.length === 0 || trimmed.length > 254) return false;
  return STRICT_EMAIL_REGEX.test(trimmed);
}

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-\.]{1,128}$/;

/**
 * Validates Firestore document / tenant identifiers (prevents path traversal like ../ or /).
 */
export function isSafeIdentifier(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (!SAFE_ID_REGEX.test(trimmed)) return false;
  if (trimmed.includes('..') || trimmed === '.' || trimmed === '..') return false;
  return true;
}

function parseHostnameFromHostHeader(hostHeader?: string): string {
  if (!hostHeader) return '';
  const clean = hostHeader.trim().toLowerCase();
  if (!clean) return '';
  // Strip IPv6 brackets or :port cleanly via URL parser
  try {
    const parsed = new URL(`http://${clean}`);
    return parsed.hostname.toLowerCase();
  } catch {
    return clean.split(':')[0].toLowerCase();
  }
}

/**
 * Validates whether a request Origin is permitted for CORS and redirect/link generation.
 * - Allows undefined/null origin (direct same-origin navigation / CLI / server-to-server).
 * - Allows localhost/127.0.0.1/::1.
 * - Allows matching request Host header, configured APP_URL, and ALLOWED_ORIGINS list.
 * - Allows HTTPS origins on *.run.app and *.vercel.app (deployment hosts for this PMS).
 * - Rejects arbitrary third-party origins and non-http(s) protocols.
 */
export function isAllowedOrigin(
  origin: string | undefined | null,
  reqHost?: string,
  appUrl?: string,
  extraAllowedOrigins?: string
): boolean {
  if (!origin) return true;
  if (typeof origin !== 'string') return false;

  let parsed: URL;
  try {
    parsed = new URL(origin.trim());
  } catch {
    return false;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }

  const originHost = parsed.hostname.toLowerCase();
  const originNormalized = parsed.origin.toLowerCase();

  if (LOCAL_HOSTNAMES.has(originHost)) {
    return true;
  }

  const reqHostname = parseHostnameFromHostHeader(reqHost);
  if (reqHostname && originHost === reqHostname) {
    return true;
  }

  if (appUrl) {
    try {
      const appParsed = new URL(appUrl.trim());
      if (appParsed.origin.toLowerCase() === originNormalized) {
        return true;
      }
    } catch {
      // Ignore invalid APP_URL
    }
  }

  if (extraAllowedOrigins) {
    const allowedList = extraAllowedOrigins
      .split(',')
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);
    for (const entry of allowedList) {
      if (entry === originNormalized || entry === originHost) {
        return true;
      }
      try {
        const entryUrl = new URL(entry);
        if (entryUrl.origin.toLowerCase() === originNormalized) return true;
      } catch {
        // entry was hostname, already checked
      }
    }
  }

  // Known hosted runtime platforms & primary production domain for this PMS (HTTPS only)
  if (parsed.protocol === 'https:') {
    if (
      originHost === 'tidehotels.de' ||
      originHost.endsWith('.tidehotels.de') ||
      originHost.endsWith('.run.app') ||
      originHost.endsWith('.vercel.app')
    ) {
      return true;
    }
  }

  return false;
}

/**
 * Resolves a safe application base origin for generating onboarding/invitation/reset links.
 * Prevents attackers from injecting arbitrary phishing domains via req.body.baseUrl.
 */
export function resolveSafeAppOrigin(
  candidateBaseUrl: unknown,
  reqHost: string | undefined,
  reqOrigin: string | undefined,
  appUrl: string | undefined,
  port: number,
  extraAllowedOrigins?: string
): string {
  const tryOrigin = (raw: unknown): string | null => {
    if (typeof raw !== 'string' || !raw.trim()) return null;
    try {
      const parsed = new URL(raw.trim());
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
      if (!isAllowedOrigin(parsed.origin, reqHost, appUrl, extraAllowedOrigins)) return null;
      return parsed.origin;
    } catch {
      return null;
    }
  };

  const fromBody = tryOrigin(candidateBaseUrl);
  if (fromBody) return fromBody;

  const fromReqOrigin = tryOrigin(reqOrigin);
  if (fromReqOrigin) return fromReqOrigin;

  const fromAppUrl = tryOrigin(appUrl);
  if (fromAppUrl) return fromAppUrl;

  if (reqHost && /^[a-zA-Z0-9.\-:\[\]]+$/.test(reqHost.trim())) {
    const hostname = parseHostnameFromHostHeader(reqHost);
    const scheme = LOCAL_HOSTNAMES.has(hostname) ? 'http' : 'https';
    const candidate = `${scheme}://${reqHost.trim()}`;
    const validHostOrigin = tryOrigin(candidate);
    if (validHostOrigin) return validHostOrigin;
  }

  return `http://localhost:${port}`;
}

/**
 * Validates that an activation or password-reset URL supplied by an authenticated client
 * uses HTTP(S), targets an allowed app origin, and points to a safe app route.
 */
export function isSafeActionUrl(
  urlStr: unknown,
  reqHost?: string,
  appUrl?: string,
  extraAllowedOrigins?: string
): boolean {
  if (typeof urlStr !== 'string' || !urlStr.trim()) return false;
  let parsed: URL;
  try {
    parsed = new URL(urlStr.trim());
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
  if (!isAllowedOrigin(parsed.origin, reqHost, appUrl, extraAllowedOrigins)) return false;

  // Must stay on root or /set-password route
  if (parsed.pathname !== '/' && !parsed.pathname.startsWith('/set-password')) {
    return false;
  }
  return true;
}

/**
 * Returns a safe, generic error message for 500 responses so stack traces, file paths,
 * or internal SDK messages never leak to clients.
 */
export function sanitizeErrorForClient(_err: unknown, fallbackMessage: string): string {
  return fallbackMessage;
}

/**
 * Strips plaintext credential fields before returning user profile objects in HTTP responses.
 */
export function redactSensitiveUserFields<T extends Record<string, any>>(userObj: T): Record<string, any> {
  if (!userObj || typeof userObj !== 'object') return {};
  const clone: Record<string, any> = { ...userObj };
  delete clone.initialTempPass;
  delete clone.systemAuthSecret;
  delete clone.temporaryPassword;
  delete clone.initialPassword;
  delete clone.tempPass;
  return clone;
}

/**
 * Memory-bounded sliding/fixed-window rate limiter with automatic stale entry eviction.
 */
export class BoundedRateLimiter {
  private readonly store = new Map<string, { count: number; firstSeen: number }>();
  private readonly maxEntries: number;

  constructor(maxEntries = 5000) {
    this.maxEntries = maxEntries;
  }

  check(
    key: string,
    maxRequests: number,
    windowMs: number,
    now = Date.now()
  ): { allowed: boolean; remaining: number; retryAfterMs: number } {
    // Periodic / capacity-based eviction of expired keys
    if (this.store.size >= this.maxEntries) {
      for (const [k, v] of this.store.entries()) {
        if (now - v.firstSeen > windowMs) {
          this.store.delete(k);
        }
      }
      // If still at capacity, evict oldest inserted entries
      while (this.store.size >= this.maxEntries) {
        const oldestKey = this.store.keys().next().value;
        if (oldestKey === undefined) break;
        this.store.delete(oldestKey);
      }
    }

    const record = this.store.get(key);
    if (!record || now - record.firstSeen > windowMs) {
      this.store.set(key, { count: 1, firstSeen: now });
      return { allowed: true, remaining: Math.max(0, maxRequests - 1), retryAfterMs: 0 };
    }

    if (record.count >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(1, windowMs - (now - record.firstSeen)),
      };
    }

    record.count += 1;
    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - record.count),
      retryAfterMs: 0,
    };
  }

  get size(): number {
    return this.store.size;
  }
}

export interface VerifiedCaller {
  uid: string;
  email: string | null;
  profile: Record<string, any> | null;
}

export function isSuperAdminCaller(caller: { email?: string | null; profile?: Record<string, any> | null } | null): boolean {
  if (!caller) return false;
  const normalizedEmail = (caller.email || '').trim().toLowerCase();
  if (normalizedEmail && SUPER_ADMIN_EMAILS.includes(normalizedEmail)) return true;
  if (caller.profile?.role === 'superAdmin') return true;
  if (Array.isArray(caller.profile?.roles) && caller.profile.roles.includes('superAdmin')) return true;
  return false;
}

export function isAccountSuspendedOrPending(profile: Record<string, any> | null | undefined): boolean {
  if (!profile) return false;
  const status = String(profile.status || '').toLowerCase();
  return (
    status === 'suspended' ||
    status === 'disabled' ||
    status === 'inactive' ||
    status === 'pending_activation' ||
    profile.isLocked === true
  );
}

export function callerBelongsToHotel(
  caller: { email?: string | null; profile?: Record<string, any> | null } | null,
  hotelId: string
): boolean {
  if (!caller) return false;
  if (isSuperAdminCaller(caller)) return true;
  if (!caller.profile || !hotelId) return false;
  if (isAccountSuspendedOrPending(caller.profile)) return false;
  return caller.profile.hotelId === hotelId || caller.profile.hotel_id === hotelId;
}

export function callerIsHotelStaff(
  caller: { email?: string | null; profile?: Record<string, any> | null } | null,
  hotelId: string
): boolean {
  if (!caller) return false;
  if (isSuperAdminCaller(caller)) return true;
  return callerBelongsToHotel(caller, hotelId);
}

function hasExplicitPermission(perms: any, required: string[]): boolean {
  if (!perms) return false;
  if (Array.isArray(perms)) {
    if (perms.includes('all')) return true;
    return required.some(r => perms.includes(r));
  }
  if (typeof perms === 'object') {
    for (const r of required) {
      if (perms[r] === true) return true;
    }
    const staffMod = perms.staff;
    if (staffMod && typeof staffMod === 'object') {
      if (staffMod.manage || staffMod.manageStaff || staffMod.create || staffMod.edit || staffMod.delete || staffMod.assignRoles || staffMod.resetPasswords) {
        return true;
      }
    }
  }
  return false;
}

export function callerHasStaffManagement(
  caller: { email?: string | null; profile?: Record<string, any> | null } | null,
  hotelId: string
): boolean {
  if (!caller) return false;
  if (isSuperAdminCaller(caller)) return true;
  if (!callerBelongsToHotel(caller, hotelId)) return false;

  const p = caller.profile!;
  if (p.role === 'hotelAdmin' || p.role === 'admin' || p.staffRole === 'admin' || p.role === 'manager') {
    return true;
  }
  if (Array.isArray(p.roles) && (p.roles.includes('hotelAdmin') || p.roles.includes('admin') || p.roles.includes('manager'))) {
    return true;
  }

  return hasExplicitPermission(p.permissions, [
    'manage_staff',
    'manage_users_admin',
    'create_users',
    'edit_users',
    'delete_users',
    'assign_roles',
    'reset_passwords',
    'manage_roles',
    'manage_roles_admin',
    'manage_permissions_admin',
  ]);
}
