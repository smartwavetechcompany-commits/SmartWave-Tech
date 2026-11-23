/**
 * Express API Routes for Authoritative Server-Side Loyalty Controls:
 * - POST /api/loyalty/redeem
 * - POST /api/loyalty/process-expiry
 * - POST /api/loyalty/cron/process-expiry
 *
 * Enforces authentication, strict hotel tenant isolation, RBAC (`hotelAdmin` / `superAdmin`
 * or custom role with `manage_loyalty`), and server-authoritative validation rules.
 */

import crypto from 'crypto';
import type express from 'express';
import {
  callerBelongsToHotel,
  isSafeIdentifier,
  isSuperAdminCaller,
  type VerifiedCaller,
} from '../../../utils/serverSecurity.ts';
import { fsReadDoc } from '../../emailCustomization/server/firestoreRest.ts';
import {
  executeAuthoritativeExpiryForGuest,
  executeAuthoritativeRedemption,
  runScheduledLoyaltyExpirySweep,
  type ExpiryEmailDispatcher,
} from './loyaltyServerService.ts';
import type { LoyaltyAccount, LoyaltyTransaction } from '../../../types.ts';

export interface LoyaltyRoutesDeps {
  requireAuth: (
    req: express.Request,
    res: express.Response
  ) => Promise<(VerifiedCaller & { idToken: string }) | null>;
  dispatchLoyaltyNotification?: (params: {
    hotelId: string;
    eventType: 'loyalty.points_redeemed' | 'loyalty.points_expired';
    guestId: string;
    guestName: string;
    guestEmail: string;
    reservationId?: string;
    transaction: LoyaltyTransaction;
    account: LoyaltyAccount;
    currency?: string;
  }) => Promise<void>;
}

async function callerCanManageHotelLoyalty(
  caller: VerifiedCaller & { idToken: string },
  hotelId: string
): Promise<boolean> {
  if (isSuperAdminCaller(caller)) return true;
  if (!callerBelongsToHotel(caller, hotelId)) return false;
  const role = String(caller.profile?.role || '').trim();
  if (role === 'hotelAdmin' || role === 'admin' || role === 'superAdmin') return true;

  const customRoleId =
    typeof caller.profile?.customRoleId === 'string' ? caller.profile.customRoleId.trim() : '';
  if (customRoleId && isSafeIdentifier(customRoleId)) {
    try {
      const roleDoc = await fsReadDoc(`hotels/${hotelId}/customRoles/${customRoleId}`, caller.idToken);
      const perms = Array.isArray(roleDoc?.permissions) ? roleDoc.permissions : [];
      if (perms.includes('manage_loyalty')) return true;
    } catch {
      return false;
    }
  }
  return false;
}

function timingSafeSecretMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return crypto.timingSafeEqual(a, b);
}

export function mountLoyaltyRoutes(app: express.Express, deps: LoyaltyRoutesDeps): void {
  // 1. Authoritative Server-Side Points Redemption
  app.post('/api/loyalty/redeem', async (req, res) => {
    const caller = await deps.requireAuth(req, res);
    if (!caller) return;

    const { hotelId, guestId, points, reason, reservationId, idempotencyKey } = req.body || {};

    if (!hotelId || !guestId || !isSafeIdentifier(hotelId) || !isSafeIdentifier(guestId)) {
      return res.status(400).json({ success: false, error: 'Valid hotelId and guestId are required.' });
    }
    if (reservationId !== undefined && reservationId !== null && reservationId !== '') {
      if (typeof reservationId !== 'string' || !isSafeIdentifier(reservationId)) {
        return res.status(400).json({ success: false, error: 'Invalid reservationId format.' });
      }
    }

    const numPoints = Number(points);
    if (!Number.isFinite(numPoints) || !Number.isInteger(numPoints) || numPoints <= 0) {
      return res.status(400).json({ success: false, error: 'Redemption points must be a positive whole number.' });
    }

    const authorized = await callerCanManageHotelLoyalty(caller, hotelId);
    if (!authorized) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not have permission to redeem loyalty points for this hotel.',
      });
    }

    try {
      const result = await executeAuthoritativeRedemption({
        hotelId,
        guestId,
        points: numPoints,
        reason: typeof reason === 'string' ? reason.slice(0, 240) : 'Loyalty points redeemed',
        reservationId: typeof reservationId === 'string' && reservationId.trim() ? reservationId.trim() : undefined,
        idempotencyKey:
          typeof idempotencyKey === 'string' && idempotencyKey.trim()
            ? idempotencyKey.trim().slice(0, 150)
            : `redeem_${guestId}_${Date.now()}`,
        actorUid: caller.uid,
        actorName:
          String(caller.profile?.displayName || caller.profile?.name || caller.email || 'Hotel Admin'),
        actorEmail: caller.email || undefined,
        bearerToken: caller.idToken,
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.error || 'Redemption validation failed.',
        });
      }

      // Post-commit branded guest email (non-blocking, deduplicated)
      if (
        !result.duplicate &&
        result.policyNotifyEmail &&
        result.guestEmail &&
        result.transaction &&
        result.account &&
        deps.dispatchLoyaltyNotification
      ) {
        void deps
          .dispatchLoyaltyNotification({
            hotelId,
            eventType: 'loyalty.points_redeemed',
            guestId,
            guestName: result.guestName || result.account.guestName || 'Guest',
            guestEmail: result.guestEmail,
            reservationId: result.transaction.reservationId,
            transaction: result.transaction,
            account: result.account,
            currency: result.hotelCurrency,
          })
          .catch((err) => console.warn('[API /api/loyalty/redeem] Post-commit email notice:', err?.message || err));
      }

      return res.status(200).json({
        success: true,
        duplicate: Boolean(result.duplicate),
        account: result.account,
        transaction: result.transaction,
      });
    } catch (err: any) {
      console.error('[API /api/loyalty/redeem] Unexpected error:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Failed to process loyalty redemption.' });
    }
  });

  // 2. Authoritative Server-Side Points Expiry Processing (Single Guest)
  app.post('/api/loyalty/process-expiry', async (req, res) => {
    const caller = await deps.requireAuth(req, res);
    if (!caller) return;

    const { hotelId, guestId } = req.body || {};
    if (!hotelId || !guestId || !isSafeIdentifier(hotelId) || !isSafeIdentifier(guestId)) {
      return res.status(400).json({ success: false, error: 'Valid hotelId and guestId are required.' });
    }

    const authorized = await callerCanManageHotelLoyalty(caller, hotelId);
    if (!authorized) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You do not have permission to process loyalty expiry for this hotel.',
      });
    }

    try {
      const result = await executeAuthoritativeExpiryForGuest({
        hotelId,
        guestId,
        actorUid: caller.uid,
        actorName:
          String(caller.profile?.displayName || caller.profile?.name || caller.email || 'Hotel Admin'),
        actorEmail: caller.email || undefined,
        triggeredBySystem: false,
        bearerToken: caller.idToken,
      });

      if (!result.success) {
        return res.status(result.statusCode || 400).json({
          success: false,
          error: result.error || 'Failed to process expired points.',
        });
      }

      if (
        !result.duplicate &&
        result.policyNotifyEmail &&
        result.guestEmail &&
        result.transaction &&
        result.account &&
        deps.dispatchLoyaltyNotification
      ) {
        void deps
          .dispatchLoyaltyNotification({
            hotelId,
            eventType: 'loyalty.points_expired',
            guestId,
            guestName: result.guestName || result.account.guestName || 'Guest',
            guestEmail: result.guestEmail,
            transaction: result.transaction,
            account: result.account,
            currency: result.hotelCurrency,
          })
          .catch((err) => console.warn('[API /api/loyalty/process-expiry] Post-commit email notice:', err?.message || err));
      }

      return res.status(200).json({
        success: true,
        duplicate: Boolean(result.duplicate),
        account: result.account,
        transaction: result.transaction,
      });
    } catch (err: any) {
      console.error('[API /api/loyalty/process-expiry] Unexpected error:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Failed to process expired points.' });
    }
  });

  // 3. Automated / Cron Loyalty Expiry Sweep (Independent of Admin Login)
  app.post('/api/loyalty/cron/process-expiry', async (req, res) => {
    const expectedSecret = (process.env.LOYALTY_CRON_SECRET || process.env.CRON_SECRET || '').trim();
    const providedSecret = String(
      req.headers['x-loyalty-cron-secret'] || req.headers['x-cron-secret'] || ''
    ).trim();

    let authorized = false;
    if (expectedSecret && providedSecret && timingSafeSecretMatch(providedSecret, expectedSecret)) {
      authorized = true;
    } else {
      const caller = await deps.requireAuth(req, res);
      if (!caller) return;
      if (!isSuperAdminCaller(caller)) {
        return res.status(403).json({
          success: false,
          error: 'Forbidden: Automated expiry sweep requires cron secret or SuperAdmin credentials.',
        });
      }
      authorized = true;
    }

    if (!authorized) {
      return res.status(401).json({ success: false, error: 'Unauthorized.' });
    }

    const rawHotelId = typeof req.body?.hotelId === 'string' ? req.body.hotelId.trim() : undefined;
    if (rawHotelId && !isSafeIdentifier(rawHotelId)) {
      return res.status(400).json({ success: false, error: 'Invalid hotelId.' });
    }

    try {
      const dispatcher: ExpiryEmailDispatcher | undefined = deps.dispatchLoyaltyNotification
        ? async (p) => {
            await deps.dispatchLoyaltyNotification!({
              hotelId: p.hotelId,
              eventType: 'loyalty.points_expired',
              guestId: p.guestId,
              guestName: p.guestName,
              guestEmail: p.guestEmail,
              transaction: p.transaction,
              account: p.account,
            });
          }
        : undefined;

      const summary = await runScheduledLoyaltyExpirySweep(dispatcher, rawHotelId);
      return res.status(200).json({ success: true, summary });
    } catch (err: any) {
      console.error('[API /api/loyalty/cron/process-expiry] Error:', err?.message || err);
      return res.status(500).json({ success: false, error: 'Failed to execute loyalty expiry sweep.' });
    }
  });
}
