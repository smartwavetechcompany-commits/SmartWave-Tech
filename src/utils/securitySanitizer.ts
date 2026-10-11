/**
 * Security & Input Validation Utilities
 * 
 * Provides defense-in-depth sanitization, rate-limiting guards,
 * XSS escaping, parameter validation, and sensitive-data redaction.
 */

/**
 * Escapes common HTML control characters to prevent Cross-Site Scripting (XSS)
 */
export function sanitizeHtml(input: unknown): string {
  if (input === null || input === undefined) return '';
  const str = String(input);
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Strips dangerous executable script tags and inline event handlers
 */
export function stripScriptTags(input: string): string {
  if (!input) return '';
  return input
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/on\w+="[^"]*"/gi, '')
    .replace(/on\w+='[^']*'/gi, '')
    .replace(/javascript:[^"']*/gi, '');
}

/**
 * Validates and normalizes email format
 */
export function sanitizeEmail(email: unknown): string {
  if (typeof email !== 'string') return '';
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  if (!email || typeof email !== 'string') return false;
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return emailRegex.test(email.trim());
}

/**
 * Validates safe identifier strings (hotelId, userId, reservationId, roomId)
 * Prevents directory traversal, path injection, or NoSQL query manipulation
 */
export function isSafeId(id: unknown): boolean {
  if (typeof id !== 'string') return false;
  const trimmed = id.trim();
  if (trimmed.length === 0 || trimmed.length > 128) return false;
  // Allow alphanumeric characters, dashes, underscores, and dots (no slashes, backslashes, or control characters)
  return /^[a-zA-Z0-9_\-\.]+$/.test(trimmed);
}

/**
 * Sanitizes numeric amounts ensuring safe currency values
 */
export function sanitizeCurrencyAmount(amount: unknown, min: number = 0, max: number = 100_000_000): number {
  const num = typeof amount === 'number' ? amount : parseFloat(String(amount));
  if (isNaN(num) || !isFinite(num)) return min;
  return Math.min(Math.max(num, min), max);
}

/**
 * Redacts sensitive credentials (passwords, auth secrets, raw credit cards) from log objects or exports
 */
export function redactSensitiveData(obj: any): any {
  if (!obj || typeof obj !== 'object') return obj;

  const sensitiveKeys = [
    'password',
    'temporaryPassword',
    'initialPassword',
    'initialTempPass',
    'systemAuthSecret',
    'token',
    'secret',
    'apiKey',
    'cardNumber',
    'cvv',
    'creditCard'
  ];

  if (Array.isArray(obj)) {
    return obj.map(redactSensitiveData);
  }

  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const isSensitive = sensitiveKeys.some(sk => key.toLowerCase().includes(sk.toLowerCase()));
    if (isSensitive) {
      result[key] = '[REDACTED]';
    } else if (value && typeof value === 'object') {
      result[key] = redactSensitiveData(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * In-memory client rate limiter to throttle sensitive UI actions (e.g., password reset requests, key issues)
 */
class ClientRateLimiter {
  private attempts: Map<string, number[]> = new Map();

  check(actionKey: string, maxAttempts: number = 5, windowMs: number = 60000): { allowed: boolean; remainingWaitMs: number } {
    const now = Date.now();
    const timestamps = (this.attempts.get(actionKey) || []).filter(t => now - t < windowMs);
    
    if (timestamps.length >= maxAttempts) {
      const oldest = timestamps[0];
      const remainingWaitMs = Math.max(0, windowMs - (now - oldest));
      return { allowed: false, remainingWaitMs };
    }

    timestamps.push(now);
    this.attempts.set(actionKey, timestamps);
    return { allowed: true, remainingWaitMs: 0 };
  }

  reset(actionKey: string) {
    this.attempts.delete(actionKey);
  }
}

export const clientRateLimiter = new ClientRateLimiter();
