/**
 * Authoritative Server-Side Loyalty Engine & Background Expiry Processor.
 *
 * Enforces:
 * - Authoritative server-side redemption validation (100 min, 5,000 max per booking cumulative,
 *   live unexpired balance check, booking status, settled check, eligible payable cap,
 *   active account check, duplicate & concurrency protection).
 * - Automated, idempotent, per-lot FIFO points expiry independent of admin login.
 * - Complete immutable audit ledger fields (available + lifetime balances, canonical type,
 *   staff vs system actor attribution, lot IDs, redemption refs).
 *
 * Strictly isolated to loyalty collections (`loyaltyAccounts`, `loyaltyTransactions`) and read-only
 * against reservations/ledger. NEVER mutates PMS room pricing, taxes, folios, discounts, or payments.
 */

import {
  Hotel,
  LedgerEntry,
  LoyaltyAccount,
  LoyaltyTransaction,
  Reservation,
} from '../../../types.ts';
import {
  buildDeterministicExpiryKey,
  evaluateLoyaltyPointsExpiry,
  getLoyaltyPolicy,
  mapToCanonicalLoyaltyTransactionType,
  validatePointsRedemption,
} from '../shared/loyaltyRules.ts';
import {
  fsPatchFields,
  fsReadDocWithMeta,
  fsSetDoc,
  getFirebaseAppletConfig,
  decodeFirestoreDocument,
} from '../../emailCustomization/server/firestoreRest.ts';
import { isSafeIdentifier } from '../../../utils/serverSecurity.ts';

let cachedAdminDb: any | null | undefined = undefined;

async function getOptionalAdminFirestore(): Promise<any | null> {
  if (cachedAdminDb !== undefined) return cachedAdminDb;
  try {
    const { getApps: getAdminApps } = await import('firebase-admin/app');
    const apps = getAdminApps();
    if (apps.length > 0) {
      const { getFirestore: getAdminFirestore } = await import('firebase-admin/firestore');
      cachedAdminDb = getAdminFirestore(apps[0]);
      return cachedAdminDb;
    }
    return null;
  } catch {
    cachedAdminDb = null;
    return null;
  }
}

function stripUndefinedDeep<T>(obj: T): T {
  if (obj === null || obj === undefined || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripUndefinedDeep) as unknown as T;
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj as Record<string, any>)) {
    if (v !== undefined) {
      out[k] = stripUndefinedDeep(v);
    }
  }
  return out as T;
}

function sanitizeDocId(key: string): string {
  return String(key || '').replace(/[^a-zA-Z0-9_\-:.]/g, '_').slice(0, 150);
}

// Per-(hotelId:guestId) async mutex to eliminate intra-process race conditions on concurrent redemptions/expiry
const accountLocks = new Map<string, Promise<void>>();

async function withAccountLock<T>(lockKey: string, fn: () => Promise<T>): Promise<T> {
  const prev = accountLocks.get(lockKey) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.then(() => next);
  accountLocks.set(lockKey, chained);
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (accountLocks.get(lockKey) === chained) {
      accountLocks.delete(lockKey);
    }
  }
}

/**
 * Runs a single-field Firestore REST structuredQuery to fetch only matching documents
 * (e.g., loyaltyTransactions where guestId == X, or ledger where reservationId == Y)
 * without scanning entire collections.
 */
async function fsStructuredQueryByField(
  parentPath: string,
  collectionId: string,
  fieldPath: string,
  value: string,
  bearerToken?: string,
  limit = 500
): Promise<Array<Record<string, any> & { id: string }>> {
  const adminDb = !bearerToken ? await getOptionalAdminFirestore() : null;
  if (adminDb) {
    const snap = await adminDb
      .collection(`${parentPath}/${collectionId}`)
      .where(fieldPath, '==', value)
      .limit(limit)
      .get();
    return snap.docs.map((d: any) => ({ ...(d.data() as Record<string, any>), id: d.id }));
  }

  const projectId = getFirebaseAppletConfig().projectId;
  if (!projectId) {
    throw new Error('Firebase projectId is missing in firebase-applet-config.json.');
  }
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${parentPath}:runQuery`;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (bearerToken) headers.Authorization = `Bearer ${bearerToken}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      structuredQuery: {
        from: [{ collectionId }],
        where: {
          fieldFilter: {
            field: { fieldPath },
            op: 'EQUAL',
            value: { stringValue: value },
          },
        },
        limit,
      },
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    throw new Error(`Firestore query failed (${resp.status}) on ${collectionId}: ${errText.slice(0, 160)}`);
  }

  const rows = await resp.json();
  if (!Array.isArray(rows)) return [];
  const results: Array<Record<string, any> & { id: string }> = [];
  for (const row of rows) {
    if (row?.document) {
      const decoded = decodeFirestoreDocument(row.document);
      const id =
        typeof row.document.name === 'string'
          ? row.document.name.split('/').pop() || decoded.id || ''
          : decoded.id || '';
      results.push({ ...decoded, id });
    }
  }
  return results;
}

async function readDocWithMeta(
  docPath: string,
  bearerToken?: string
): Promise<{ data: Record<string, any>; updateTime?: string } | null> {
  const adminDb = !bearerToken ? await getOptionalAdminFirestore() : null;
  if (adminDb) {
    const snap = await adminDb.doc(docPath).get();
    if (!snap.exists) return null;
    return {
      data: { id: snap.id, ...(snap.data() || {}) },
      updateTime: snap.updateTime?.toDate?.()?.toISOString?.(),
    };
  }
  return fsReadDocWithMeta(docPath, bearerToken);
}

export interface ServerRedemptionInput {
  hotelId: string;
  guestId: string;
  points: number;
  reason: string;
  reservationId?: string;
  idempotencyKey: string;
  actorUid: string;
  actorName: string;
  actorEmail?: string;
  bearerToken?: string;
}

export interface ServerLoyaltyMutationResult {
  success: boolean;
  statusCode: number;
  duplicate?: boolean;
  account?: LoyaltyAccount;
  transaction?: LoyaltyTransaction;
  error?: string;
  policyNotifyEmail?: boolean;
  hotelCurrency?: string;
  guestEmail?: string;
  guestName?: string;
}

/**
 * Authoritatively validates and commits a guest loyalty points redemption on the server.
 * Uses Admin SDK transaction when available, or optimistic-concurrency REST commit + account mutex.
 */
export async function executeAuthoritativeRedemption(
  input: ServerRedemptionInput
): Promise<ServerLoyaltyMutationResult> {
  if (!isSafeIdentifier(input.hotelId) || !isSafeIdentifier(input.guestId)) {
    return { success: false, statusCode: 400, error: 'Invalid hotelId or guestId format.' };
  }
  if (input.reservationId && !isSafeIdentifier(input.reservationId)) {
    return { success: false, statusCode: 400, error: 'Invalid reservationId format.' };
  }

  const safeKey = sanitizeDocId(input.idempotencyKey || `redeem_${input.guestId}_${Date.now()}`);
  if (!safeKey) {
    return { success: false, statusCode: 400, error: 'A valid idempotencyKey is required.' };
  }

  const lockKey = `${input.hotelId}:${input.guestId}`;
  return withAccountLock(lockKey, async () => {
    const now = new Date();
    const nowIso = now.toISOString();

    const hotelPath = `hotels/${input.hotelId}`;
    const accountPath = `hotels/${input.hotelId}/loyaltyAccounts/${input.guestId}`;
    const txPath = `hotels/${input.hotelId}/loyaltyTransactions/${safeKey}`;
    const guestPath = `hotels/${input.hotelId}/guests/${input.guestId}`;

    const [hotelMeta, guestMeta, existingTxMeta, existingGuestTxsRaw] = await Promise.all([
      readDocWithMeta(hotelPath, input.bearerToken),
      readDocWithMeta(guestPath, input.bearerToken).catch(() => null),
      readDocWithMeta(txPath, input.bearerToken),
      fsStructuredQueryByField(
        hotelPath,
        'loyaltyTransactions',
        'guestId',
        input.guestId,
        input.bearerToken,
        500
      ),
    ]);

    if (!hotelMeta) {
      return { success: false, statusCode: 404, error: 'Hotel not found.' };
    }

    const hotel = { id: input.hotelId, ...hotelMeta.data } as Hotel;
    const policy = getLoyaltyPolicy(hotel);
    const guestDoc = guestMeta?.data || null;

    // Duplicate redemption check (idempotent return)
    if (existingTxMeta) {
      const accMeta = await readDocWithMeta(accountPath, input.bearerToken);
      return {
        success: true,
        statusCode: 200,
        duplicate: true,
        account: accMeta ? (accMeta.data as LoyaltyAccount) : undefined,
        transaction: existingTxMeta.data as LoyaltyTransaction,
        policyNotifyEmail: false,
      };
    }

    // Fetch optional reservation and its ledger entries (strictly read-only)
    let reservation: Reservation | null = null;
    let reservationLedger: LedgerEntry[] | undefined = undefined;
    if (input.reservationId) {
      const [resMeta, ledgerRows] = await Promise.all([
        readDocWithMeta(`hotels/${input.hotelId}/reservations/${input.reservationId}`, input.bearerToken),
        fsStructuredQueryByField(
          hotelPath,
          'ledger',
          'reservationId',
          input.reservationId,
          input.bearerToken,
          500
        ),
      ]);
      if (!resMeta) {
        return { success: false, statusCode: 404, error: 'Referenced booking was not found.' };
      }
      reservation = { id: input.reservationId, ...resMeta.data } as Reservation;
      reservationLedger = ledgerRows as unknown as LedgerEntry[];
    }

    const existingTransactions = existingGuestTxsRaw as unknown as LoyaltyTransaction[];

    // Path A: Native Firebase Admin SDK transaction (when service account is configured)
    const adminDb = await getOptionalAdminFirestore();
    if (adminDb) {
      try {
        const trxResult = await adminDb.runTransaction(async (trx: any) => {
          const accRef = adminDb.doc(accountPath);
          const txRef = adminDb.doc(txPath);
          const [accSnap, txSnap] = await Promise.all([trx.get(accRef), trx.get(txRef)]);

          if (txSnap.exists) {
            return {
              duplicate: true as const,
              account: accSnap.exists ? (accSnap.data() as LoyaltyAccount) : undefined,
              transaction: txSnap.data() as LoyaltyTransaction,
            };
          }
          if (!accSnap.exists) {
            throw new Error('Guest does not have an active loyalty account with redeemable points.');
          }

          const currentAccount = accSnap.data() as LoyaltyAccount;
          const validation = validatePointsRedemption(input.points, policy, currentAccount.availablePoints, {
            accountIsActive: currentAccount.isActive,
            reservationId: input.reservationId,
            reservation,
            hotel,
            ledgerEntries: reservationLedger,
            existingTransactions,
            idempotencyKey: safeKey,
            now,
          });
          if (!validation.valid) {
            throw new Error(validation.error || 'Points redemption validation failed.');
          }

          const pts = Math.floor(Number(input.points));
          const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
          const updatedBalance = previousBalance - pts;
          if (updatedBalance < 0) {
            throw new Error('Redemption cannot result in a negative loyalty balance.');
          }
          const lifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));

          const updatedAccount: LoyaltyAccount = stripUndefinedDeep({
            ...currentAccount,
            availablePoints: updatedBalance,
            totalPointsRedeemed: (currentAccount.totalPointsRedeemed || 0) + pts,
            lastActivityAt: nowIso,
            updatedAt: nowIso,
          });

          const tx: LoyaltyTransaction = stripUndefinedDeep({
            id: safeKey,
            hotelId: input.hotelId,
            guestId: input.guestId,
            guestName: guestDoc?.name || currentAccount.guestName || 'Guest',
            guestEmail: guestDoc?.email || currentAccount.guestEmail,
            transactionType: 'redemption',
            canonicalType: mapToCanonicalLoyaltyTransactionType('redemption', -pts),
            points: pts,
            pointsDelta: -pts,
            previousBalance,
            updatedBalance,
            previousLifetimeBalance: lifetime,
            updatedLifetimeBalance: lifetime,
            reason: (input.reason || '').trim() || 'Loyalty points redeemed',
            adminId: input.actorUid,
            adminName: input.actorName || 'Admin',
            adminEmail: input.actorEmail,
            actorType: 'staff',
            reservationId: input.reservationId,
            redemptionRef: safeKey,
            monetaryValue: validation.monetaryValue,
            idempotencyKey: safeKey,
            timestamp: nowIso,
            createdAt: nowIso,
          });

          trx.set(accRef, updatedAccount);
          trx.set(txRef, tx);
          return { duplicate: false as const, account: updatedAccount, transaction: tx };
        });

        return {
          success: true,
          statusCode: 200,
          duplicate: trxResult.duplicate,
          account: trxResult.account,
          transaction: trxResult.transaction,
          policyNotifyEmail: !trxResult.duplicate && policy.notifyGuestsByEmail !== false,
          hotelCurrency: hotel.defaultCurrency || 'NGN',
          guestEmail: guestDoc?.email || trxResult.account?.guestEmail,
          guestName: guestDoc?.name || trxResult.account?.guestName || 'Guest',
        };
      } catch (err: any) {
        return {
          success: false,
          statusCode: 400,
          error: err?.message || 'Redemption failed.',
        };
      }
    }

    // Path B: Authoritative Firestore REST commit with optimistic concurrency precondition (`updateTime`)
    const accMeta = await readDocWithMeta(accountPath, input.bearerToken);
    if (!accMeta) {
      return {
        success: false,
        statusCode: 400,
        error: 'Guest does not have an active loyalty account with redeemable points.',
      };
    }

    const currentAccount = accMeta.data as LoyaltyAccount;
    const validation = validatePointsRedemption(input.points, policy, currentAccount.availablePoints, {
      accountIsActive: currentAccount.isActive,
      reservationId: input.reservationId,
      reservation,
      hotel,
      ledgerEntries: reservationLedger,
      existingTransactions,
      idempotencyKey: safeKey,
      now,
    });
    if (!validation.valid) {
      return {
        success: false,
        statusCode: 400,
        error: validation.error || 'Points redemption validation failed.',
      };
    }

    const pts = Math.floor(Number(input.points));
    const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
    const updatedBalance = previousBalance - pts;
    if (updatedBalance < 0) {
      return {
        success: false,
        statusCode: 400,
        error: 'Redemption cannot result in a negative loyalty balance.',
      };
    }
    const lifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));

    const updatedAccount: LoyaltyAccount = stripUndefinedDeep({
      ...currentAccount,
      availablePoints: updatedBalance,
      totalPointsRedeemed: (currentAccount.totalPointsRedeemed || 0) + pts,
      lastActivityAt: nowIso,
      updatedAt: nowIso,
    });

    const tx: LoyaltyTransaction = stripUndefinedDeep({
      id: safeKey,
      hotelId: input.hotelId,
      guestId: input.guestId,
      guestName: guestDoc?.name || currentAccount.guestName || 'Guest',
      guestEmail: guestDoc?.email || currentAccount.guestEmail,
      transactionType: 'redemption',
      canonicalType: mapToCanonicalLoyaltyTransactionType('redemption', -pts),
      points: pts,
      pointsDelta: -pts,
      previousBalance,
      updatedBalance,
      previousLifetimeBalance: lifetime,
      updatedLifetimeBalance: lifetime,
      reason: (input.reason || '').trim() || 'Loyalty points redeemed',
      adminId: input.actorUid,
      adminName: input.actorName || 'Admin',
      adminEmail: input.actorEmail,
      actorType: 'staff',
      reservationId: input.reservationId,
      redemptionRef: safeKey,
      monetaryValue: validation.monetaryValue,
      idempotencyKey: safeKey,
      timestamp: nowIso,
      createdAt: nowIso,
    });

    // Update account first with `expectedUpdateTime` precondition so concurrent updates fail cleanly
    const patchRes = await fsPatchFields(
      accountPath,
      {
        availablePoints: updatedAccount.availablePoints,
        totalPointsRedeemed: updatedAccount.totalPointsRedeemed,
        lastActivityAt: updatedAccount.lastActivityAt,
        updatedAt: updatedAccount.updatedAt,
      },
      ['availablePoints', 'totalPointsRedeemed', 'lastActivityAt', 'updatedAt'],
      input.bearerToken,
      accMeta.updateTime
    );

    if (!patchRes.ok) {
      const conflict = patchRes.status === 409 || patchRes.status === 412;
      return {
        success: false,
        statusCode: conflict ? 409 : 500,
        error: conflict
          ? 'Concurrent loyalty balance update detected. Please retry your redemption.'
          : patchRes.error || 'Failed to update loyalty account balance.',
      };
    }

    const txRes = await fsSetDoc(txPath, tx, input.bearerToken);
    if (!txRes.ok) {
      return {
        success: false,
        statusCode: 500,
        error: txRes.error || 'Failed to record immutable redemption transaction.',
      };
    }

    return {
      success: true,
      statusCode: 200,
      duplicate: false,
      account: updatedAccount,
      transaction: tx,
      policyNotifyEmail: policy.notifyGuestsByEmail !== false,
      hotelCurrency: hotel.defaultCurrency || 'NGN',
      guestEmail: guestDoc?.email || updatedAccount.guestEmail,
      guestName: guestDoc?.name || updatedAccount.guestName || 'Guest',
    };
  });
}

export interface ServerExpiryInput {
  hotelId: string;
  guestId: string;
  actorUid: string;
  actorName: string;
  actorEmail?: string;
  triggeredBySystem?: boolean;
  bearerToken?: string;
}

/**
 * Authoritatively expires due loyalty point lots for a single guest on the server.
 * Uses deterministic lot-derived idempotency keys so lots can never expire twice.
 * Reduces availablePoints only; never reduces lifetimePointsEarned or membership tier.
 */
export async function executeAuthoritativeExpiryForGuest(
  input: ServerExpiryInput
): Promise<ServerLoyaltyMutationResult> {
  if (!isSafeIdentifier(input.hotelId) || !isSafeIdentifier(input.guestId)) {
    return { success: false, statusCode: 400, error: 'Invalid hotelId or guestId format.' };
  }

  const lockKey = `${input.hotelId}:${input.guestId}`;
  return withAccountLock(lockKey, async () => {
    const now = new Date();
    const nowIso = now.toISOString();
    const hotelPath = `hotels/${input.hotelId}`;
    const accountPath = `hotels/${input.hotelId}/loyaltyAccounts/${input.guestId}`;

    const [hotelMeta, accMeta, guestTxsRaw] = await Promise.all([
      readDocWithMeta(hotelPath, input.bearerToken),
      readDocWithMeta(accountPath, input.bearerToken),
      fsStructuredQueryByField(
        hotelPath,
        'loyaltyTransactions',
        'guestId',
        input.guestId,
        input.bearerToken,
        500
      ),
    ]);

    if (!hotelMeta || !accMeta) {
      return { success: false, statusCode: 404, error: 'Hotel or loyalty account not found.' };
    }

    const hotel = { id: input.hotelId, ...hotelMeta.data } as Hotel;
    const policy = getLoyaltyPolicy(hotel);
    const currentAccount = accMeta.data as LoyaltyAccount;
    const guestTxs = guestTxsRaw as unknown as LoyaltyTransaction[];

    const expirySummary = evaluateLoyaltyPointsExpiry(guestTxs, policy.expiryReminderDays, now);
    if (expirySummary.expiredPointsUnprocessed <= 0 || expirySummary.expiredLots.length === 0) {
      return {
        success: true,
        statusCode: 200,
        duplicate: true,
        account: currentAccount,
        policyNotifyEmail: false,
      };
    }

    const safeKey = buildDeterministicExpiryKey(input.guestId, expirySummary.expiredLots);
    const txPath = `hotels/${input.hotelId}/loyaltyTransactions/${safeKey}`;
    const existingTxMeta = await readDocWithMeta(txPath, input.bearerToken);
    if (existingTxMeta) {
      return {
        success: true,
        statusCode: 200,
        duplicate: true,
        account: currentAccount,
        transaction: existingTxMeta.data as LoyaltyTransaction,
        policyNotifyEmail: false,
      };
    }

    const expiredLotIds = expirySummary.expiredLots.map((l) => l.txId);
    const actorType = input.triggeredBySystem ? 'system' : 'staff';
    const systemProcess = input.triggeredBySystem ? 'scheduled_points_expiry' : undefined;

    const adminDb = await getOptionalAdminFirestore();
    if (adminDb) {
      const trxResult = await adminDb.runTransaction(async (trx: any) => {
        const accRef = adminDb.doc(accountPath);
        const txRef = adminDb.doc(txPath);
        const [accSnap, txSnap] = await Promise.all([trx.get(accRef), trx.get(txRef)]);
        if (txSnap.exists) {
          return {
            duplicate: true as const,
            account: accSnap.exists ? (accSnap.data() as LoyaltyAccount) : undefined,
            transaction: txSnap.data() as LoyaltyTransaction,
          };
        }
        if (!accSnap.exists) {
          throw new Error('Loyalty account not found.');
        }

        const freshAcc = accSnap.data() as LoyaltyAccount;
        const previousBalance = Math.max(0, Math.floor(Number(freshAcc.availablePoints) || 0));
        const ptsToExpire = Math.min(previousBalance, expirySummary.expiredPointsUnprocessed);
        if (ptsToExpire <= 0) {
          return { duplicate: true as const, account: freshAcc };
        }

        const updatedBalance = previousBalance - ptsToExpire;
        const lifetime = Math.max(0, Math.floor(Number(freshAcc.lifetimePointsEarned) || 0));

        const updatedAccount: LoyaltyAccount = stripUndefinedDeep({
          ...freshAcc,
          availablePoints: updatedBalance,
          totalPointsExpired: (freshAcc.totalPointsExpired || 0) + ptsToExpire,
          lastActivityAt: nowIso,
          updatedAt: nowIso,
        });

        const tx: LoyaltyTransaction = stripUndefinedDeep({
          id: safeKey,
          hotelId: input.hotelId,
          guestId: input.guestId,
          guestName: freshAcc.guestName || 'Guest',
          guestEmail: freshAcc.guestEmail,
          transactionType: 'expiry',
          canonicalType: mapToCanonicalLoyaltyTransactionType('expiry', -ptsToExpire),
          points: ptsToExpire,
          pointsDelta: -ptsToExpire,
          previousBalance,
          updatedBalance,
          previousLifetimeBalance: lifetime,
          updatedLifetimeBalance: lifetime,
          reason: `Automatic expiry of ${ptsToExpire.toLocaleString()} unused loyalty points past expiry date`,
          adminId: input.actorUid,
          adminName: input.actorName || 'System Expiry Policy',
          adminEmail: input.actorEmail,
          actorType,
          systemProcess,
          expiredLotIds,
          idempotencyKey: safeKey,
          timestamp: nowIso,
          createdAt: nowIso,
        });

        trx.set(accRef, updatedAccount);
        trx.set(txRef, tx);
        return { duplicate: false as const, account: updatedAccount, transaction: tx };
      });

      return {
        success: true,
        statusCode: 200,
        duplicate: trxResult.duplicate,
        account: trxResult.account,
        transaction: 'transaction' in trxResult ? trxResult.transaction : undefined,
        policyNotifyEmail: !trxResult.duplicate && policy.notifyGuestsByEmail !== false,
        hotelCurrency: hotel.defaultCurrency || 'NGN',
        guestEmail: trxResult.account?.guestEmail,
        guestName: trxResult.account?.guestName || 'Guest',
      };
    }

    // Firestore REST optimistic-concurrency fallback
    const previousBalance = Math.max(0, Math.floor(Number(currentAccount.availablePoints) || 0));
    const ptsToExpire = Math.min(previousBalance, expirySummary.expiredPointsUnprocessed);
    if (ptsToExpire <= 0) {
      return { success: true, statusCode: 200, duplicate: true, account: currentAccount, policyNotifyEmail: false };
    }

    const updatedBalance = previousBalance - ptsToExpire;
    const lifetime = Math.max(0, Math.floor(Number(currentAccount.lifetimePointsEarned) || 0));

    const updatedAccount: LoyaltyAccount = stripUndefinedDeep({
      ...currentAccount,
      availablePoints: updatedBalance,
      totalPointsExpired: (currentAccount.totalPointsExpired || 0) + ptsToExpire,
      lastActivityAt: nowIso,
      updatedAt: nowIso,
    });

    const tx: LoyaltyTransaction = stripUndefinedDeep({
      id: safeKey,
      hotelId: input.hotelId,
      guestId: input.guestId,
      guestName: currentAccount.guestName || 'Guest',
      guestEmail: currentAccount.guestEmail,
      transactionType: 'expiry',
      canonicalType: mapToCanonicalLoyaltyTransactionType('expiry', -ptsToExpire),
      points: ptsToExpire,
      pointsDelta: -ptsToExpire,
      previousBalance,
      updatedBalance,
      previousLifetimeBalance: lifetime,
      updatedLifetimeBalance: lifetime,
      reason: `Automatic expiry of ${ptsToExpire.toLocaleString()} unused loyalty points past expiry date`,
      adminId: input.actorUid,
      adminName: input.actorName || 'System Expiry Policy',
      adminEmail: input.actorEmail,
      actorType,
      systemProcess,
      expiredLotIds,
      idempotencyKey: safeKey,
      timestamp: nowIso,
      createdAt: nowIso,
    });

    const patchRes = await fsPatchFields(
      accountPath,
      {
        availablePoints: updatedAccount.availablePoints,
        totalPointsExpired: updatedAccount.totalPointsExpired,
        lastActivityAt: updatedAccount.lastActivityAt,
        updatedAt: updatedAccount.updatedAt,
      },
      ['availablePoints', 'totalPointsExpired', 'lastActivityAt', 'updatedAt'],
      input.bearerToken,
      accMeta.updateTime
    );
    if (!patchRes.ok) {
      return {
        success: false,
        statusCode: patchRes.status === 409 || patchRes.status === 412 ? 409 : 500,
        error: patchRes.error || 'Failed to update loyalty account during expiry.',
      };
    }

    const txRes = await fsSetDoc(txPath, tx, input.bearerToken);
    if (!txRes.ok) {
      return { success: false, statusCode: 500, error: txRes.error || 'Failed to persist expiry transaction.' };
    }

    return {
      success: true,
      statusCode: 200,
      duplicate: false,
      account: updatedAccount,
      transaction: tx,
      policyNotifyEmail: policy.notifyGuestsByEmail !== false,
      hotelCurrency: hotel.defaultCurrency || 'NGN',
      guestEmail: updatedAccount.guestEmail,
      guestName: updatedAccount.guestName || 'Guest',
    };
  });
}

// ============================================================================
// UNATTENDED SERVER-SIDE BACKGROUND EXPIRY SCHEDULER
// (Runs independently of whether any administrator is logged in)
// ============================================================================

export type ExpiryEmailDispatcher = (params: {
  hotelId: string;
  guestId: string;
  guestName: string;
  guestEmail: string;
  transaction: LoyaltyTransaction;
  account: LoyaltyAccount;
}) => Promise<void>;

export interface LoyaltyExpirySweepSummary {
  hotelsChecked: number;
  accountsChecked: number;
  accountsExpired: number;
  totalPointsExpired: number;
  errors: number;
}

export async function runScheduledLoyaltyExpirySweep(
  onExpiredCommit?: ExpiryEmailDispatcher,
  targetHotelId?: string
): Promise<LoyaltyExpirySweepSummary> {
  const summary: LoyaltyExpirySweepSummary = {
    hotelsChecked: 0,
    accountsChecked: 0,
    accountsExpired: 0,
    totalPointsExpired: 0,
    errors: 0,
  };

  const adminDb = await getOptionalAdminFirestore();
  if (!adminDb) return summary;

  let hotelDocs: Array<{ id: string; data: Record<string, any> }> = [];
  if (targetHotelId && isSafeIdentifier(targetHotelId)) {
    const snap = await adminDb.doc(`hotels/${targetHotelId}`).get();
    if (snap.exists) hotelDocs = [{ id: snap.id, data: snap.data() || {} }];
  } else {
    const snap = await adminDb.collection('hotels').limit(100).get();
    hotelDocs = snap.docs.map((d: any) => ({ id: d.id, data: d.data() || {} }));
  }

  for (const h of hotelDocs) {
    const hotel = { id: h.id, ...h.data } as Hotel;
    const policy = getLoyaltyPolicy(hotel);
    if (!policy.enabled) continue;
    summary.hotelsChecked++;

    try {
      const accountsSnap = await adminDb
        .collection(`hotels/${h.id}/loyaltyAccounts`)
        .where('availablePoints', '>', 0)
        .limit(250)
        .get();

      for (const accDoc of accountsSnap.docs) {
        summary.accountsChecked++;
        try {
          const result = await executeAuthoritativeExpiryForGuest({
            hotelId: h.id,
            guestId: accDoc.id,
            actorUid: 'system_loyalty_expiry',
            actorName: 'Automated Loyalty Expiry Service',
            triggeredBySystem: true,
          });
          if (result.success && !result.duplicate && result.transaction && result.account) {
            summary.accountsExpired++;
            summary.totalPointsExpired += result.transaction.points;
            if (result.policyNotifyEmail && result.guestEmail && onExpiredCommit) {
              await onExpiredCommit({
                hotelId: h.id,
                guestId: accDoc.id,
                guestName: result.guestName || result.account.guestName || 'Guest',
                guestEmail: result.guestEmail,
                transaction: result.transaction,
                account: result.account,
              }).catch(() => {});
            }
          }
        } catch {
          summary.errors++;
        }
      }
    } catch {
      summary.errors++;
    }
  }

  return summary;
}

let expirySchedulerStarted = false;
let expirySchedulerInFlight = false;
let loggedMissingAdminForExpiry = false;

/**
 * Starts a non-blocking, overlap-guarded periodic loyalty expiry sweep in the server process.
 * Strictly isolated from PMS billing/checkout; never blocks startup or causes crashes.
 */
export function startLoyaltyExpiryBackgroundJob(
  onExpiredCommit?: ExpiryEmailDispatcher,
  intervalMs = 6 * 60 * 60 * 1000 // every 6 hours
): void {
  if (expirySchedulerStarted) return;
  expirySchedulerStarted = true;

  const runTick = async () => {
    if (expirySchedulerInFlight) return;
    const adminDb = await getOptionalAdminFirestore();
    if (!adminDb) {
      if (!loggedMissingAdminForExpiry) {
        loggedMissingAdminForExpiry = true;
        console.log(
          '[LoyaltyExpiryScheduler] Waiting for FIREBASE_SERVICE_ACCOUNT_KEY for unattended background expiry sweeps (live redemption expiry exclusion and POST /api/loyalty/process-expiry remain active).'
        );
      }
      return;
    }

    expirySchedulerInFlight = true;
    try {
      const summary = await runScheduledLoyaltyExpirySweep(onExpiredCommit);
      if (summary.accountsExpired > 0 || summary.errors > 0) {
        console.log(
          `[LoyaltyExpiryScheduler] Sweep complete — hotels=${summary.hotelsChecked}, accounts=${summary.accountsChecked}, expiredAccounts=${summary.accountsExpired}, totalPointsExpired=${summary.totalPointsExpired}, errors=${summary.errors}`
        );
      }
    } catch (err: any) {
      console.error('[LoyaltyExpiryScheduler] Sweep error (non-fatal):', err?.message || err);
    } finally {
      expirySchedulerInFlight = false;
    }
  };

  // Delayed startup (90s after HTTP server is live) so boot & health checks are never impacted
  const bootTimer = setTimeout(() => {
    void runTick();
  }, 90_000);
  if (typeof bootTimer.unref === 'function') bootTimer.unref();

  const loopTimer = setInterval(() => {
    void runTick();
  }, intervalMs);
  if (typeof loopTimer.unref === 'function') loopTimer.unref();

  console.log('[LoyaltyExpiryScheduler] Automated loyalty points expiry scheduler initialized (6h interval).');
}
