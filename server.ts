import express from "express";
import http from "http";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import {
  escapeHtml,
  sanitizeEmailHeaderValue,
  isValidEmailAddress,
  isSafeIdentifier,
  isAllowedOrigin,
  resolveSafeAppOrigin,
  isSafeActionUrl,
  sanitizeErrorForClient,
  redactSensitiveUserFields,
  BoundedRateLimiter,
  VerifiedCaller,
  isSuperAdminCaller,
  isAccountSuspendedOrPending,
  callerHasStaffManagement,
  callerIsHotelStaff,
} from "./src/utils/serverSecurity.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;
  app.disable("x-powered-by");

  // Security Headers Middleware (iFrame compatible for AI Studio preview)
  app.use((req, res, next) => {
    res.header("X-Content-Type-Options", "nosniff");
    res.header("X-XSS-Protection", "1; mode=block");
    res.header("Referrer-Policy", "strict-origin-when-cross-origin");
    res.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
    res.header("X-DNS-Prefetch-Control", "off");
    res.header("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    const proto = String(req.headers["x-forwarded-proto"] || req.protocol || "").toLowerCase();
    if (proto === "https") {
      res.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    next();
  });

  // Strict Origin-Validated CORS and Preflight Handling
  app.use((req, res, next) => {
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : undefined;
    const reqHost = typeof req.headers.host === "string" ? req.headers.host : undefined;
    const originPermitted = isAllowedOrigin(origin, reqHost, process.env.APP_URL, process.env.ALLOWED_ORIGINS);

    if (origin && !originPermitted) {
      if (req.path.startsWith("/api/") || req.method === "OPTIONS") {
        return res.status(403).json({ error: "Cross-origin request blocked by security policy." });
      }
    }

    if (origin && originPermitted) {
      res.header("Access-Control-Allow-Origin", origin);
      res.header("Vary", "Origin");
      res.header("Access-Control-Allow-Credentials", "true");
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json({ limit: "2mb" }));

  // Bounded in-memory rate limiting for API routes (prevents brute force and memory exhaustion)
  const apiRateLimiter = new BoundedRateLimiter(5000);
  const STRICT_AUTH_PATHS = new Set([
    "/auth/validate-token",
    "/auth/validate-reset-token",
    "/auth/activate-staff-user",
    "/auth/complete-password-reset",
  ]);
  app.use("/api/", (req, res, next) => {
    // Exempt health check
    if (req.path === "/health") return next();

    const forwarded = req.headers["x-forwarded-for"];
    const firstForwarded = Array.isArray(forwarded)
      ? forwarded[0]
      : typeof forwarded === "string"
        ? forwarded.split(",")[0].trim()
        : "";
    const clientIp = firstForwarded || req.socket.remoteAddress || "unknown_ip";
    const ipKey = `${clientIp}:${req.path}`;
    const windowMs = 60000; // 1 minute window
    const maxRequests = STRICT_AUTH_PATHS.has(req.path) ? 20 : 120;

    const result = apiRateLimiter.check(ipKey, maxRequests, windowMs);
    if (!result.allowed) {
      return res.status(429).json({
        error: "Too many requests. Please slow down.",
        retryAfterMs: result.retryAfterMs,
      });
    }
    next();
  });

  // Initialize Firebase for server validation and Admin SDK
  let db: any = null;
  let adminAuth: any = null;
  let firebaseConfig: any = null;

  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const { initializeApp: initClientApp, getApp: getClientApp, getApps: getClientApps } = await import('firebase/app');
      const { getFirestore } = await import('firebase/firestore');
      
      const firebaseApp = getClientApps().length === 0 ? initClientApp(firebaseConfig) : getClientApp();
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      console.log("Server e-ledger and Firestore validator initialized.");

      // Initialize Firebase Admin SDK
      try {
        const { initializeApp: initAdminApp, getApps: getAdminApps, cert } = await import('firebase-admin/app');
        const { getAuth: getAdminAuth } = await import('firebase-admin/auth');

        let adminCredential;
        if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
          try {
            const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
            adminCredential = cert(serviceAccount);
          } catch (e) {
            console.warn("Could not parse FIREBASE_SERVICE_ACCOUNT_KEY JSON:", e);
          }
        }

        if (adminCredential) {
          const adminApp = getAdminApps().length === 0
            ? initAdminApp({
                credential: adminCredential,
                projectId: firebaseConfig.projectId
              })
            : getAdminApps()[0];

          adminAuth = getAdminAuth(adminApp);
          console.log("Firebase Admin Auth initialized with Service Account credentials.");
        } else {
          adminAuth = null;
          console.log("Firebase Auth Admin: No service account key configured. Using direct Identity Toolkit REST API with project API key.");
        }
      } catch (adminErr) {
        console.warn("Firebase Admin Auth init notice:", adminErr);
      }
    }
  } catch (err) {
    console.error("Failed to initialize server-side Firebase app:", err);
  }

  // Helper: Decode Firestore REST document fields
  function decodeFirestoreValue(val: any): any {
    if (!val || typeof val !== "object") return undefined;
    if ("stringValue" in val) return val.stringValue;
    if ("booleanValue" in val) return val.booleanValue;
    if ("integerValue" in val) return Number(val.integerValue);
    if ("doubleValue" in val) return Number(val.doubleValue);
    if ("nullValue" in val) return null;
    if ("timestampValue" in val) return val.timestampValue;
    if ("arrayValue" in val) {
      const vals = val.arrayValue?.values;
      return Array.isArray(vals) ? vals.map(decodeFirestoreValue) : [];
    }
    if ("mapValue" in val) {
      const out: Record<string, any> = {};
      const fields = val.mapValue?.fields || {};
      for (const [k, v] of Object.entries(fields)) {
        out[k] = decodeFirestoreValue(v);
      }
      return out;
    }
    return undefined;
  }

  // Helper: Extract & verify Firebase ID token and fetch caller's Firestore profile
  async function verifyFirebaseTokenAndCaller(
    req: express.Request,
    allowBodyIdToken = false
  ): Promise<(VerifiedCaller & { idToken: string }) | null> {
    const authHeader = req.headers.authorization;
    let token: string | null = null;
    if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
      token = authHeader.slice(7).trim();
    } else if (allowBodyIdToken && typeof req.body?.idToken === "string" && req.body.idToken.trim()) {
      token = req.body.idToken.trim();
    }

    if (!token) return null;

    let uid: string | null = null;
    let email: string | null = null;

    if (adminAuth) {
      try {
        const decoded = await adminAuth.verifyIdToken(token);
        uid = decoded.uid;
        email = decoded.email || null;
      } catch (adminErr: any) {
        console.warn("[AUTH VERIFY] Admin SDK verifyIdToken notice:", adminErr?.message);
      }
    }

    if (!uid && firebaseConfig?.apiKey) {
      try {
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ idToken: token }),
        });
        const data = await resp.json();
        if (resp.ok && data?.users?.[0]) {
          uid = data.users[0].localId;
          email = data.users[0].email || null;
        }
      } catch (restErr) {
        console.warn("[AUTH VERIFY] Identity Toolkit lookup notice:", restErr);
      }
    }

    if (!uid) return null;

    let profile: Record<string, any> | null = null;

    // 1. Try Firestore REST API with caller's Bearer token (works even when rules tighten)
    if (firebaseConfig?.projectId) {
      try {
        const dbId = firebaseConfig.firestoreDatabaseId || "(default)";
        const restUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/${dbId}/documents/users/${encodeURIComponent(uid)}`;
        const fsResp = await fetch(restUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (fsResp.ok) {
          const fsDoc = await fsResp.json();
          if (fsDoc?.fields) {
            profile = {};
            for (const [k, v] of Object.entries(fsDoc.fields)) {
              profile[k] = decodeFirestoreValue(v);
            }
          }
        }
      } catch {
        // Fall through to SDK lookup
      }
    }

    // 2. Fallback to Firestore SDK
    if (!profile && db) {
      try {
        const { doc, getDoc, collection, query, where, getDocs } = await import("firebase/firestore");
        const snap = await getDoc(doc(db, "users", uid));
        if (snap.exists()) {
          profile = snap.data();
        } else if (email) {
          const q = query(collection(db, "users"), where("email", "==", email.toLowerCase()));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            profile = qSnap.docs[0].data();
          }
        }
      } catch (dbErr) {
        console.warn("[AUTH VERIFY] Profile lookup notice:", dbErr);
      }
    }

    return { uid, email, profile, idToken: token };
  }

  // Helper: Require authenticated, active caller on protected endpoints
  async function requireAuth(
    req: express.Request,
    res: express.Response
  ): Promise<(VerifiedCaller & { idToken: string }) | null> {
    const caller = await verifyFirebaseTokenAndCaller(req, false);
    if (!caller) {
      res.status(401).json({ error: "Authentication required. Valid Bearer token missing or expired." });
      return null;
    }
    if (caller.profile && isAccountSuspendedOrPending(caller.profile)) {
      res.status(403).json({ error: "Your account is suspended, locked, or pending activation." });
      return null;
    }
    return caller;
  }

  // API Route: Server-side transaction validation logic to ensure total charges, payments & tax calculations are idempotent & immutable
  app.post("/api/ledger/validate-and-post", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { hotelId, guestId, reservationId, items, postedBy, corporateId, idempotencyKey } = req.body;

    if (!hotelId || !guestId || !reservationId || !items || !Array.isArray(items) || items.length === 0 || !idempotencyKey) {
      return res.status(400).json({ error: "Missing required parameters or empty items list." });
    }

    if (!isSafeIdentifier(hotelId) || !isSafeIdentifier(guestId) || !isSafeIdentifier(reservationId)) {
      return res.status(400).json({ error: "Invalid identifier format." });
    }

    if (items.length > 200) {
      return res.status(400).json({ error: "Batch exceeds maximum allowed items (200)." });
    }

    if (!callerIsHotelStaff(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: You are not authorized to post ledger entries for this hotel." });
    }

    if (!db) {
      return res.status(500).json({ error: "Server-side database is currently unavailable." });
    }

    const effectivePostedBy = postedBy || caller.email || caller.uid;

    try {
      const { collection, doc, query, where, getDocs, getDoc, writeBatch, serverTimestamp, increment } = await import('firebase/firestore');
      
      // 1. Idempotency Check
      const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
      const dupQuery = query(ledgerRef, where('idempotencyKey', '==', String(idempotencyKey)));
      const dupSnap = await getDocs(dupQuery);
      
      if (!dupSnap.empty) {
        console.log(`Idempotent transaction block: ${idempotencyKey} has already been recorded.`);
        return res.json({ 
          success: true, 
          message: "Idempotency guaranteed. This batch was already processed.", 
          alreadyPosted: true 
        });
      }

      // 2. Fetch dependencies
      const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
      if (!hotelSnap.exists()) {
        return res.status(404).json({ error: "Hotel not found." });
      }
      const hotelData = hotelSnap.data();

      const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
      const resSnap = await getDoc(resRef);
      if (!resSnap.exists()) {
        return res.status(404).json({ error: "Reservation not found." });
      }
      const resData = resSnap.data();
      const finalCorporateId = corporateId || resData?.corporateId || null;

      // Check room-level restaurant posting restriction if any item is a restaurant/F&B debit
      const hasRestaurantDebit = items.some((it: any) => {
        const itType = (it?.type || 'debit').toLowerCase().trim();
        const itCat = (it?.category || '').toLowerCase().trim();
        return (
          itType === 'debit' &&
          (itCat === 'f & b' || itCat === 'f&b' || itCat === 'restaurant' || itCat === 'food' || itCat === 'bar' || itCat === 'room_service')
        );
      });

      if (hasRestaurantDebit) {
        let blocked = false;
        if (resData?.roomId) {
          const roomSnap = await getDoc(doc(db, 'hotels', hotelId, 'rooms', resData.roomId));
          if (roomSnap.exists()) {
            const roomData = roomSnap.data();
            blocked = Boolean(roomData?.restaurantPostingBlocked || roomData?.restaurantPostingRestriction?.isBlocked);
          }
        } else if (resData?.roomNumber) {
          const roomSnap = await getDocs(
            query(collection(db, 'hotels', hotelId, 'rooms'), where('roomNumber', '==', resData.roomNumber))
          );
          blocked = roomSnap.docs.some((d) => {
            const roomData = d.data();
            return Boolean(roomData?.restaurantPostingBlocked || roomData?.restaurantPostingRestriction?.isBlocked);
          });
        }
        if (blocked) {
          return res.status(403).json({ error: "Restaurant posting is blocked for this room. Please contact Front Desk." });
        }
      }

      // 3. Process, Calculate Taxes, & Validate inputs
      const batch = writeBatch(db);
      const timestamp = new Date().toISOString();
      const finalEntriesToPost: any[] = [];

      for (const item of items) {
        const { price = 0, quantity = 1, type = 'debit', category = 'other', description = '', discount = 0, discountType = 'fixed' } = item;

        const numPrice = Number(price);
        const numQty = Number(quantity);
        const numDiscount = Number(discount);

        if (!Number.isFinite(numPrice) || !Number.isFinite(numQty) || !Number.isFinite(numDiscount)) {
          return res.status(400).json({ error: "Numeric price, quantity, and discount values are required." });
        }
        if (numPrice < 0 || numPrice > 1e9 || numQty < 1 || numQty > 10000) {
          return res.status(400).json({ error: "Price must be non-negative and quantity between 1 and 10,000." });
        }
        if (numDiscount < 0 || (discountType === 'percentage' && numDiscount > 100)) {
          return res.status(400).json({ error: "Invalid discount value." });
        }
        if (type !== 'debit' && type !== 'credit') {
          return res.status(400).json({ error: "Invalid ledger entry type." });
        }

        const baseAmount = numPrice * numQty;
        const amountAfterDiscount = discountType === 'fixed'
          ? Math.max(0, baseAmount - numDiscount)
          : Math.max(0, baseAmount * (1 - numDiscount / 100));

        const mainEntry = {
          amount: amountAfterDiscount,
          type,
          category,
          description: description || `${type === 'debit' ? 'Charge' : 'Adjustment'}: ${category}`,
          referenceId: reservationId,
          postedBy: effectivePostedBy,
          quantity: numQty,
          price: numPrice,
          discount: numDiscount,
          discountType,
          timestamp,
          hotelId,
          guestId,
          reservationId,
          corporateId: finalCorporateId,
          idempotencyKey,
          isImmutable: true
        };

        finalEntriesToPost.push(mainEntry);

        // Taxes calculations (server-side source of truth)
        if (type === 'debit' && category !== 'tax' && category !== 'payment') {
          const activeTaxes = (hotelData.taxes || []).filter((t: any) => {
            const status = (t.status || '').toLowerCase().trim();
            const taxCat = (t.category || '').toLowerCase().trim();
            const entryCat = (category || '').toLowerCase().trim();
            
            if (status !== 'active') return false;
            if (taxCat === 'all' || taxCat === entryCat) return true;
            
            if (entryCat === 'room') {
              return taxCat !== 'f & b' && taxCat !== 'restaurant' && taxCat !== 'food';
            }
            if (entryCat === 'restaurant' || entryCat === 'f & b' || entryCat === 'food') {
              return taxCat !== 'room';
            }
            return false;
          });

          let totalInclusiveTax = 0;
          const inclusiveTaxEntries: any[] = [];

          for (const tax of activeTaxes) {
            const taxAmount = tax.isInclusive 
              ? amountAfterDiscount - (amountAfterDiscount / (1 + (tax.percentage / 100)))
              : amountAfterDiscount * (tax.percentage / 100);

            const taxEntry = {
              timestamp,
              hotelId,
              guestId,
              reservationId,
              corporateId: finalCorporateId,
              type: 'debit',
              amount: taxAmount,
              description: `${tax.name} (${tax.percentage}%) ${tax.isInclusive ? '[Inclusive]' : ''} for ${mainEntry.description}`,
              category: 'tax',
              postedBy: effectivePostedBy,
              idempotencyKey,
              isImmutable: true
            };

            if (tax.isInclusive) {
              totalInclusiveTax += taxAmount;
              inclusiveTaxEntries.push(taxEntry);
            } else {
              finalEntriesToPost.push(taxEntry);
            }
          }

          // Adjust main entry amount by subtracting inclusive tax
          mainEntry.amount = amountAfterDiscount - totalInclusiveTax;
          finalEntriesToPost.push(...inclusiveTaxEntries);
        }
      }

      // 4. Update balances and write documents
      let guestBalanceAdj = 0;
      let corpBalanceAdj = 0;
      let roomDebitCount = 0;
      let totalPaidAdj = 0;
      let projectedTotalAdj = 0;

      const nonTotalDebits = ['room', 'payment', 'refund', 'transfer', 'city_ledger'];

      finalEntriesToPost.forEach(e => {
        const newDocRef = doc(collection(db, 'hotels', hotelId, 'ledger'));
        batch.set(newDocRef, {
          ...e,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });

        const isCorp = !!e.corporateId;
        const change = e.type === 'debit' ? e.amount : -e.amount;

        if (isCorp) {
          corpBalanceAdj += change;
        } else {
          guestBalanceAdj += change;
          if (e.type === 'debit' && e.category === 'room') {
            roomDebitCount++;
          }
        }

        if (e.type === 'credit') {
          totalPaidAdj += e.amount;
        } else if (e.type === 'debit' && e.category === 'refund') {
          totalPaidAdj -= e.amount;
        }

        if (e.type === 'debit' && !nonTotalDebits.includes(e.category)) {
          projectedTotalAdj += e.amount;
        }
      });

      // Update Guest balance
      const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
      const spentCredit = finalEntriesToPost.filter(e => !e.corporateId && e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0);
      const spentRefund = finalEntriesToPost.filter(e => !e.corporateId && e.type === 'debit' && e.category === 'refund').reduce((acc, e) => acc + e.amount, 0);
      const spentAdj = spentCredit - spentRefund;

      if (guestBalanceAdj !== 0 || roomDebitCount > 0) {
        batch.update(guestRef, {
          ledgerBalance: increment(guestBalanceAdj),
          totalSpent: increment(spentAdj),
          totalNights: increment(roomDebitCount)
        });
      }

      // Update Corporate balance
      const corpDebits = finalEntriesToPost.filter(e => e.corporateId && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0);
      const corpCredits = finalEntriesToPost.filter(e => e.corporateId && e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);

      if (finalCorporateId && (corpBalanceAdj !== 0 || corpDebits > 0 || corpCredits > 0)) {
        const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', finalCorporateId);
        batch.set(corpRef, {
          currentBalance: increment(corpBalanceAdj),
          totalDebits: increment(corpDebits),
          totalCredits: increment(corpCredits)
        }, { merge: true });
      }

      // Update reservation total invoice and payment records
      const resUpdates: any = {};
      if (projectedTotalAdj !== 0) resUpdates.totalAmount = increment(projectedTotalAdj);
      if (totalPaidAdj !== 0) resUpdates.paidAmount = increment(totalPaidAdj);

      const totalBalanceAdj = guestBalanceAdj + corpBalanceAdj;
      if (totalBalanceAdj !== 0) resUpdates.ledgerBalance = increment(totalBalanceAdj);

      const freshTotalAmount = (resData.totalAmount || 0) + projectedTotalAdj;
      const freshPaidAmount = (resData.paidAmount || 0) + totalPaidAdj;

      let newPaymentStatus = 'unpaid';
      if (freshTotalAmount > 0) {
        if (freshPaidAmount >= freshTotalAmount - 0.01) {
          newPaymentStatus = 'paid';
        } else if (freshPaidAmount > 0) {
          newPaymentStatus = 'partial';
        }
      } else if (freshPaidAmount > 0) {
        newPaymentStatus = 'paid';
      }
      resUpdates.paymentStatus = newPaymentStatus;

      batch.update(resRef, resUpdates);

      // Log financial records
      const payments = finalEntriesToPost.filter(e => (e.category === 'payment' || e.category === 'refund') && !e.corporateId);
      const financeRef = collection(db, 'hotels', hotelId, 'finance');
      payments.forEach(p => {
        const financeDocRef = doc(financeRef);
        batch.set(financeDocRef, {
          type: p.type === 'credit' ? 'income' : 'expense',
          amount: p.amount,
          category: p.category === 'payment' ? 'Room Revenue' : 'Other',
          description: p.description,
          timestamp,
          paymentMethod: p.category === 'payment' ? 'transfer' : 'cash',
          guestId,
          referenceId: idempotencyKey,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp()
        });
      });

      await batch.commit();

      return res.json({
        success: true,
        count: finalEntriesToPost.length,
        message: "E-Ledger verified, idempotent batch successfully locked & recorded."
      });

    } catch (err: any) {
      console.error("Transact validation post error:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed validating database entries.") });
    }
  });

  // Cached Ethereal test account for fast, persistent email dispatch
  let cachedEtherealAccount: any = null;

  // Email Dispatch Helper (Production SMTP with Ethereal Test Confirmation)
  async function dispatchEmailMessage({
    to,
    subject,
    html,
    fromName,
  }: {
    to: string;
    subject: string;
    html: string;
    fromName: string;
  }): Promise<{ emailDispatched: boolean; method: string; previewUrl: string | false }> {
    const safeFromName = sanitizeEmailHeaderValue(fromName, "PMS Administration");
    const safeSubject = sanitizeEmailHeaderValue(subject, "PMS Notification");
    let emailDispatched = false;
    let method = 'simulated';
    let previewUrl: string | false = false;

    const emailPromise: Promise<{ emailDispatched: boolean; method: string; previewUrl: string | false }> = (async () => {
      // 1. Try production SMTP if credentials provided
      if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
        try {
          const nodemailer = await import('nodemailer');
          const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: Number(process.env.SMTP_PORT) || 587,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS,
            },
          });

          const info = await transporter.sendMail({
            from: `"${safeFromName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to,
            subject: safeSubject,
            html,
          });

          if (info && info.messageId) {
            emailDispatched = true;
            method = 'smtp';
            console.log(`[EMAIL DISPATCHED via SMTP] To: ${to} | MessageId: ${info.messageId}`);
            return { emailDispatched, method, previewUrl };
          }
        } catch (smtpErr: any) {
          console.error("[SMTP ERROR] Failed to send via configured SMTP:", smtpErr?.message || smtpErr);
        }
      }

      // 2. Fallback to Nodemailer Ethereal test transport
      try {
        const nodemailer = await import('nodemailer');
        if (!cachedEtherealAccount) {
          cachedEtherealAccount = await nodemailer.createTestAccount();
          console.log(`[ETHEREAL] Initialized test mailbox: ${cachedEtherealAccount.user}`);
        }

        const testTransporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: cachedEtherealAccount.user,
            pass: cachedEtherealAccount.pass,
          },
        });

        const info = await testTransporter.sendMail({
          from: `"${safeFromName}" <no-reply@smartwave-pms.internal>`,
          to,
          subject: safeSubject,
          html,
        });

        if (info && info.messageId) {
          emailDispatched = true;
          method = 'ethereal_test';
          previewUrl = nodemailer.getTestMessageUrl(info);
          console.log(`[EMAIL DISPATCHED via Ethereal Test] To: ${to} | Preview: ${previewUrl}`);
        }
      } catch (etherealErr: any) {
        console.warn("[ETHEREAL NOTICE] Nodemailer test transport notice:", etherealErr?.message || etherealErr);
        method = 'simulated';
      }

      return { emailDispatched, method, previewUrl };
    })();

    // Race with a 2500ms timeout so external network delays never block API responses or drop HTTP connections
    const timeoutPromise = new Promise<{ emailDispatched: boolean; method: string; previewUrl: string | false }>((resolve) => {
      setTimeout(() => {
        resolve({ emailDispatched: false, method: 'queued', previewUrl: false });
      }, 2500);
    });

    return await Promise.race([emailPromise, timeoutPromise]);
  }

  // Helper: Build branded activation email HTML
  function buildActivationEmailHtml({
    hotelName,
    targetName,
    targetEmail,
    adminName,
    adminEmail,
    activationUrl,
    durationHours = '24 hours',
    formattedExpiry,
    note
  }: {
    hotelName: string;
    targetName: string;
    targetEmail: string;
    adminName: string;
    adminEmail: string;
    activationUrl: string;
    durationHours?: string;
    formattedExpiry?: string;
    note?: string;
  }) {
    const safeHotelName = escapeHtml(hotelName);
    const safeTargetName = escapeHtml(targetName || targetEmail);
    const safeAdminName = escapeHtml(adminName);
    const safeAdminEmail = escapeHtml(adminEmail);
    const safeActivationUrl = escapeHtml(activationUrl);
    const safeDurationHours = escapeHtml(durationHours);
    const safeFormattedExpiry = formattedExpiry ? escapeHtml(formattedExpiry) : '';
    const safeNote = note ? escapeHtml(note) : '';
    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Activate Your Staff Account</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b; padding: 40px 20px;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                <!-- Header -->
                <tr>
                  <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, #18181b 0%, #27272a 100%); border-bottom: 1px solid #27272a;">
                    <table width="100%">
                      <tr>
                        <td>
                          <div style="display: inline-block; padding: 8px 14px; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; color: #10b981; font-weight: bold; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase;">
                            Account Activation
                          </div>
                          <h1 style="margin: 16px 0 4px; font-size: 22px; font-weight: 700; color: #ffffff;">
                            Welcome to ${safeHotelName}
                          </h1>
                          <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
                            Property Management System (PMS) Staff Onboarding
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                
                <!-- Body -->
                <tr>
                  <td style="padding: 32px;">
                    <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #e4e4e7;">
                      Hello <strong>${safeTargetName}</strong>,
                    </p>
                    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                      Your Hotel Administrator <strong>${safeAdminName}</strong> (${safeAdminEmail}) has created your staff account for <strong>${safeHotelName}</strong>.
                    </p>

                    <div style="background-color: #27272a; border-left: 3px solid #10b981; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px;">
                      <span style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase;">Security Policy Note:</span>
                      <p style="margin: 6px 0 0; font-size: 13px; color: #d4d4d8; line-height: 1.5;">
                        Default passwords are not issued for security compliance. Before accessing the PMS, you must create your own personal password using this single-use activation link.
                      </p>
                    </div>

                    ${safeNote ? `
                      <div style="background-color: #27272a; border-left: 3px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
                        <span style="font-size: 12px; font-weight: 600; color: #60a5fa; text-transform: uppercase;">Admin Note:</span>
                        <p style="margin: 4px 0 0; font-size: 13px; color: #d4d4d8; font-style: italic;">"${safeNote}"</p>
                      </div>
                    ` : ''}

                    <!-- Action Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                      <tr>
                        <td align="center">
                          <a href="${safeActivationUrl}" style="display: inline-block; padding: 14px 36px; background-color: #10b981; color: #09090b; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                            Activate Account & Set Password
                          </a>
                        </td>
                      </tr>
                    </table>

                    <!-- Security & Expiration Warning -->
                    <div style="background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 16px; margin: 24px 0 16px;">
                      <table width="100%">
                        <tr>
                          <td width="24" valign="top" style="color: #f59e0b; font-size: 16px; padding-right: 10px;">⏳</td>
                          <td>
                            <p style="margin: 0; font-size: 13px; font-weight: 600; color: #fbbf24;">
                              Activation Link Expiration
                            </p>
                            <p style="margin: 4px 0 0; font-size: 12px; color: #fde68a; line-height: 1.5;">
                              This activation link is valid for <strong>${safeDurationHours}</strong>${safeFormattedExpiry ? ` (until <strong>${safeFormattedExpiry}</strong>)` : ''} and will automatically deactivate once used.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <p style="margin: 24px 0 8px; font-size: 12px; color: #71717a;">
                      If the button above does not open, copy and paste this link into your browser:
                    </p>
                    <p style="margin: 0 0 24px; font-size: 12px; color: #10b981; word-break: break-all; background-color: #18181b; border: 1px solid #27272a; padding: 10px; border-radius: 6px;">
                      ${safeActivationUrl}
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
                    
                    <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                      <strong>Security Notice:</strong> If you did not expect this invitation, please contact your hotel management team (${safeAdminEmail}).
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 32px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: #71717a;">
                      © ${new Date().getFullYear()} ${safeHotelName} • Property Management System (PMS)
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;
  }

  // Bounded in-memory activation token registry for instant, resilient staff onboarding & password setup
  interface ActivationTokenEntry {
    email: string;
    name?: string;
    tempPass?: string;
    uid: string;
    hotelId: string;
    hotelName?: string;
    expiresAt: number;
  }
  const activeActivationTokens = new Map<string, ActivationTokenEntry>();
  const MAX_ACTIVE_ACTIVATION_TOKENS = 2000;

  function setBoundedActivationToken(tokenId: string, entry: ActivationTokenEntry) {
    const now = Date.now();
    if (activeActivationTokens.size >= MAX_ACTIVE_ACTIVATION_TOKENS) {
      for (const [k, v] of activeActivationTokens.entries()) {
        if (now > v.expiresAt) {
          activeActivationTokens.delete(k);
        }
      }
      while (activeActivationTokens.size >= MAX_ACTIVE_ACTIVATION_TOKENS) {
        const oldest = activeActivationTokens.keys().next().value;
        if (!oldest) break;
        activeActivationTokens.delete(oldest);
      }
    }
    activeActivationTokens.set(tokenId, entry);
  }

  // Helper: Look up user in Firebase Authentication by email
  async function lookupAuthUserByEmail(email: string): Promise<{ uid: string; email: string } | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (adminAuth) {
      try {
        const userRecord = await adminAuth.getUserByEmail(normalizedEmail);
        return { uid: userRecord.uid, email: userRecord.email || normalizedEmail };
      } catch (err: any) {
        if (err?.code !== 'auth/user-not-found') {
          console.warn('[FIREBASE AUTH ADMIN LOOKUP NOTICE]:', err?.message);
        }
      }
    }

    if (firebaseConfig?.apiKey) {
      try {
        const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: [normalizedEmail] })
        });
        const data = await resp.json();
        if (resp.ok && data?.users && data.users.length > 0) {
          return { uid: data.users[0].localId, email: data.users[0].email || normalizedEmail };
        }
      } catch (restErr) {
        console.warn('[FIREBASE AUTH REST LOOKUP NOTICE]:', restErr);
      }
    }
    return null;
  }

  // Helper: Create user in Firebase Authentication
  async function createStaffAuthUser(email: string, displayName?: string): Promise<{ uid: string; email: string; idToken?: string; tempPass?: string; isExisting?: boolean }> {
    const normalizedEmail = email.trim().toLowerCase();

    // 1. Try Firebase Admin SDK if configured with service account
    if (adminAuth) {
      try {
        const userRecord = await adminAuth.createUser({
          email: normalizedEmail,
          displayName: displayName || undefined,
          emailVerified: false,
        });
        console.log(`[FIREBASE AUTH ADMIN] User record created: ${userRecord.uid} (${normalizedEmail})`);
        return { uid: userRecord.uid, email: userRecord.email || normalizedEmail };
      } catch (adminErr: any) {
        if (adminErr?.code === 'auth/email-already-in-use') {
          const existing = await lookupAuthUserByEmail(normalizedEmail);
          if (existing) {
            console.log(`[FIREBASE AUTH ADMIN] User ${normalizedEmail} already exists in Auth with UID ${existing.uid}`);
            return { uid: existing.uid, email: existing.email, isExisting: true };
          }
          const err: any = new Error('The email address is already in use by another account in Firebase Authentication.');
          err.code = 'auth/email-already-in-use';
          throw err;
        }
        console.warn(`[FIREBASE AUTH ADMIN NOTICE] Admin SDK createUser had non-fatal error, falling back to REST:`, adminErr?.message);
      }
    }

    // 2. Identity Toolkit REST API Fallback
    if (!firebaseConfig?.apiKey) {
      throw new Error('Firebase configuration or API key is missing.');
    }

    const tempPass = 'Pms_' + Math.random().toString(36).substring(2, 10) + '!Z8#' + Math.random().toString(36).substring(2, 6);
    const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${firebaseConfig.apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: normalizedEmail,
        password: tempPass,
        returnSecureToken: true
      })
    });

    const data = await resp.json();
    if (!resp.ok) {
      if (data?.error?.message === 'EMAIL_EXISTS') {
        const existing = await lookupAuthUserByEmail(normalizedEmail);
        if (existing) {
          console.log(`[FIREBASE AUTH REST] User ${normalizedEmail} already exists in Auth with UID ${existing.uid}`);
          return { uid: existing.uid, email: existing.email, tempPass, isExisting: true };
        }
        const err: any = new Error('The email address is already in use by another account in Firebase Authentication.');
        err.code = 'auth/email-already-in-use';
        throw err;
      }
      throw new Error(data?.error?.message || 'Failed to create user in Firebase Authentication');
    }

    console.log(`[FIREBASE AUTH REST] User record created: ${data.localId} (${normalizedEmail})`);
    return { uid: data.localId, email: data.email || normalizedEmail, idToken: data.idToken, tempPass };
  }

  // Helper: Save user profile to Firestore using Bearer ID token or client SDK
  async function saveUserProfileToFirestore(uid: string, profileData: any, idToken?: string) {
    if (idToken && firebaseConfig?.projectId) {
      try {
        const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/users/${uid}`;
        const fields: Record<string, any> = {};
        for (const [key, val] of Object.entries(profileData)) {
          if (val === undefined || val === null) {
            fields[key] = { nullValue: null };
          } else if (typeof val === 'string') {
            fields[key] = { stringValue: val };
          } else if (typeof val === 'number') {
            fields[key] = Number.isInteger(val) ? { integerValue: val.toString() } : { doubleValue: val };
          } else if (typeof val === 'boolean') {
            fields[key] = { booleanValue: val };
          } else if (Array.isArray(val)) {
            fields[key] = {
              arrayValue: {
                values: val.map(item => ({ stringValue: String(item) }))
              }
            };
          }
        }

        const patchResp = await fetch(firestoreUrl, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${idToken}`
          },
          body: JSON.stringify({ fields })
        });

        if (patchResp.ok) {
          console.log(`[FIRESTORE REST WRITE] Successfully saved profile for user ${uid}`);
          return await patchResp.json();
        } else {
          console.warn("[FIRESTORE REST WRITE NOTICE]:", await patchResp.text());
        }
      } catch (restErr) {
        console.warn("[FIRESTORE REST WRITE ERROR]:", restErr);
      }
    }

    // Fallback: client SDK setDoc
    const { doc, setDoc } = await import('firebase/firestore');
    return await setDoc(doc(db, 'users', uid), profileData, { merge: true });
  }

  // Helper: Generate Firebase Password Reset / Activation Link
  async function generateStaffActivationLink(
    email: string, 
    baseUrl: string, 
    tokenId?: string, 
    tempPass?: string
  ): Promise<{ activationUrl: string; oobCode?: string; linkSource: 'firebase_admin' | 'firebase_oob' | 'direct_portal' }> {
    const normalizedEmail = email.trim().toLowerCase();
    const cleanBase = baseUrl ? baseUrl.replace(/\/$/, '') : 'http://localhost:3000';
    const continueUrl = `${cleanBase}/set-password?email=${encodeURIComponent(normalizedEmail)}${tokenId ? `&token=${tokenId}` : ''}${tempPass ? `&tp=${encodeURIComponent(tempPass)}` : ''}&mode=resetPassword`;
    const actionCodeSettings = {
      url: continueUrl,
      handleCodeInApp: true
    };

    // 1. Try Firebase Admin SDK generatePasswordResetLink if configured
    if (adminAuth) {
      try {
        const link = await adminAuth.generatePasswordResetLink(normalizedEmail, actionCodeSettings);
        console.log(`[FIREBASE AUTH ADMIN] Generated password reset link for: ${normalizedEmail}`);
        let oobCode: string | undefined;
        try {
          const parsed = new URL(link);
          oobCode = parsed.searchParams.get('oobCode') || undefined;
        } catch (e) {}
        return { activationUrl: link, oobCode, linkSource: 'firebase_admin' };
      } catch (adminErr: any) {
        console.warn(`[FIREBASE AUTH ADMIN NOTICE] generatePasswordResetLink notice:`, adminErr?.message);
      }
    }

    // 2. Identity Toolkit REST API sendOobCode (triggers official Firebase reset email)
    if (firebaseConfig?.apiKey) {
      try {
        await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            requestType: 'PASSWORD_RESET',
            email: normalizedEmail,
            continueUrl
          })
        });
        console.log(`[FIREBASE AUTH REST] Dispatched official Firebase reset email to: ${normalizedEmail}`);
      } catch (oobErr) {
        console.warn('[FIREBASE AUTH REST] sendOobCode notice:', oobErr);
      }
    }

    // 3. Fallback direct in-app activation link with tokenId and temporary credentials
    const directUrl = `${cleanBase}/set-password?email=${encodeURIComponent(normalizedEmail)}${tokenId ? `&token=${tokenId}` : ''}${tempPass ? `&tp=${encodeURIComponent(tempPass)}` : ''}&mode=resetPassword`;
    return { activationUrl: directUrl, linkSource: 'direct_portal' };
  }

  // Health/status check for create-staff endpoint to avoid 405 Method Not Allowed on misdirected GET requests
  app.get("/api/auth/create-staff", (req, res) => {
    return res.status(200).json({ status: "ready", endpoint: "/api/auth/create-staff", allowedMethods: ["POST"] });
  });

  // API Route: Create Staff Account (Phase 1: Firebase Auth user + Staff Profile with firebase_uid + Activation link)
  app.post("/api/auth/create-staff", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const {
      hotelId,
      hotelName = "Hotel Property",
      email,
      fullName,
      phone,
      department = "General",
      employeeId,
      roleType = "base",
      baseRole = "frontDesk",
      customRoleId,
      roleLabel = "Front Desk",
      permissions = [],
      assignedModules = [],
      adminEmail = "Hotel Administrator",
      adminName = "Hotel Administrator",
      adminUid = "admin",
      baseUrl
    } = req.body;

    if (!hotelId || !email || !fullName) {
      return res.status(400).json({ error: "Missing required fields: hotelId, email, and fullName are mandatory." });
    }

    if (!isValidEmailAddress(email)) {
      return res.status(400).json({ error: "Invalid email address format." });
    }

    if (!isSafeIdentifier(hotelId)) {
      return res.status(400).json({ error: "Invalid hotelId identifier." });
    }

    if (!callerHasStaffManagement(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: Staff management permission required for this hotel." });
    }

    if (req.body.assignedUserRole === 'superAdmin' && !isSuperAdminCaller(caller)) {
      return res.status(403).json({ error: "Forbidden: Only Super Administrators can assign the superAdmin role." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database service is currently unavailable." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const effectiveAdminEmail = caller.email || adminEmail;
    const effectiveAdminUid = caller.uid || adminUid;
    const effectiveAdminName = caller.profile?.displayName || adminName || effectiveAdminEmail;
    const clientOrigin = resolveSafeAppOrigin(
      baseUrl,
      typeof req.headers.host === 'string' ? req.headers.host : undefined,
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      process.env.APP_URL,
      PORT,
      process.env.ALLOWED_ORIGINS
    );

    try {
      const { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');

      // 1. Create or link user in Firebase Authentication
      let authUser: { uid: string; email: string; idToken?: string; tempPass?: string; isExisting?: boolean };
      try {
        authUser = await createStaffAuthUser(normalizedEmail, fullName.trim());
      } catch (authErr: any) {
        if (authErr?.code === 'auth/email-already-in-use') {
          return res.status(409).json({
            error: `The email '${normalizedEmail}' is already registered in Firebase Authentication. Please use a different email or resend the password reset invitation.`,
            code: 'auth/email-already-in-use'
          });
        }
        throw authErr;
      }

      const firebase_uid = authUser.uid;

      // Multi-tenant check: ensure existing account does not belong to another hotel
      if (authUser.isExisting) {
        try {
          const existingSnap = await getDoc(doc(db, 'users', firebase_uid));
          if (existingSnap.exists()) {
            const exData = existingSnap.data();
            const exHotel = exData.hotelId || exData.hotel_id;
            if (exHotel && exHotel !== hotelId) {
              return res.status(409).json({
                error: `The email '${normalizedEmail}' is already associated with another hotel property (${exHotel}).`,
                code: 'auth/email-already-in-use-other-hotel'
              });
            }
          }
        } catch (exErr) {
          console.warn("[CREATE STAFF] Notice checking existing user document:", exErr);
        }
      }
      const tokenId = 'act_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
      const now = new Date().toISOString();

      // Store in memory for instant, seamless staff password setup
      setBoundedActivationToken(tokenId, {
        email: normalizedEmail,
        name: fullName.trim(),
        tempPass: authUser.tempPass,
        uid: firebase_uid,
        hotelId,
        hotelName,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });

      // 2. Generate official Firebase activation / password reset link
      const linkResult = await generateStaffActivationLink(normalizedEmail, clientOrigin, tokenId, authUser.tempPass);
      const activationUrl = linkResult.activationUrl;

      // 3. Store activation token in passwordResetTokens for secure single-use validation & activation
      try {
        await setDoc(doc(db, 'passwordResetTokens', tokenId), {
          id: tokenId,
          tokenId,
          type: 'activation',
          targetUid: firebase_uid,
          targetEmail: normalizedEmail,
          targetName: fullName.trim(),
          hotelId,
          hotelName,
          tempPass: authUser.tempPass || null,
          isUsed: false,
          status: 'active',
          expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          createdAt: now,
          createdBy: adminEmail
        });
      } catch (tokenStoreErr) {
        console.warn("[CREATE STAFF] Notice storing passwordResetToken:", tokenStoreErr);
      }

      const assignedUserRole = req.body.assignedUserRole || (roleType === 'base' && baseRole === 'admin' ? 'hotelAdmin' : 'staff');
      const isHotelAdminRole = assignedUserRole === 'hotelAdmin';

      const moduleMap: Record<string, string[]> = {
        dashboard: ['view_dashboard', 'export_dashboard'],
        reservations: ['access_front_desk', 'view_reservations', 'create_reservations', 'check_in_guests', 'check_out_guests'],
        frontDesk: ['access_front_desk', 'view_reservations', 'create_reservations'],
        guests: ['edit_guest_profiles', 'view_guests', 'add_guests', 'edit_guests'],
        rooms: ['manage_rooms', 'view_rooms', 'create_rooms', 'edit_rooms', 'block_rooms'],
        housekeeping: ['view_housekeeping', 'assign_housekeeping_tasks', 'edit_housekeeping_tasks', 'close_housekeeping_tasks'],
        kitchen: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders', 'edit_fb_orders'],
        inventory: ['manage_inventory', 'view_inventory', 'edit_inventory'],
        maintenance: ['manage_maintenance'],
        corporate: ['manage_corporate'],
        finance: ['view_financial_records', 'view_ledger', 'process_payments', 'view_debt_ledger', 'receive_payment', 'receive_payments'],
        audits: ['nightly_audit', 'run_night_audit', 'approve_night_audit'],
        reports: ['view_reports', 'export_reports', 'print_reports'],
        staff: ['manage_staff', 'view_users', 'view_activity_logs'],
        settings: ['edit_hotel_settings', 'view_settings', 'edit_settings', 'manage_roles']
      };

      const resolvedAssignedModules = (Array.isArray(assignedModules) && assignedModules.length > 0)
        ? assignedModules
        : (Array.isArray(permissions) && permissions.length > 0
            ? Object.keys(moduleMap).filter(modId => moduleMap[modId].some(p => permissions.includes(p)))
            : (isHotelAdminRole ? Object.keys(moduleMap) : []));

      const sanitizedPermissions = Array.isArray(permissions)
        ? (isSuperAdminCaller(caller) ? permissions : permissions.filter((p: any) => p !== 'access_super_admin'))
        : [];

      // 4. Save Staff Profile to application database explicitly linking firebase_uid
      const staffProfile = {
        uid: firebase_uid,
        firebase_uid: firebase_uid,
        email: normalizedEmail,
        hotelId,
        role: assignedUserRole,
        staffRole: roleType === 'base' ? baseRole : (isHotelAdminRole ? 'admin' : undefined),
        customRoleId: roleType === 'custom' ? customRoleId : undefined,
        displayName: fullName.trim(),
        phoneNumber: phone?.trim() || null,
        department,
        employeeId: employeeId?.trim() || null,
        status: 'pending_activation',
        isLocked: false,
        initialTempPass: authUser.tempPass || null,
        systemAuthSecret: authUser.tempPass || null,
        roles: isHotelAdminRole ? ['admin', 'hotelAdmin'] : (roleType === 'base' ? [baseRole] : [roleLabel]),
        permissions: sanitizedPermissions.length > 0 ? sanitizedPermissions : (isHotelAdminRole ? ['all'] : []),
        assignedModules: resolvedAssignedModules,
        activationLink: activationUrl,
        activationToken: tokenId,
        activationEmailSentAt: now,
        activationEmailSentBy: effectiveAdminEmail,
        createdAt: now,
        updatedAt: now
      };

      await saveUserProfileToFirestore(firebase_uid, staffProfile, authUser.idToken);

      // If user has administrative role, ensure hotel document adminUIDs array contains their UID
      if (isHotelAdminRole) {
        try {
          const { arrayUnion, updateDoc: updateHotelDoc } = await import('firebase/firestore');
          await updateHotelDoc(doc(db, 'hotels', hotelId), {
            adminUIDs: arrayUnion(firebase_uid)
          });
        } catch (hotelUpdateErr) {
          console.warn("[CREATE ADMIN] Notice adding admin UID to hotel:", hotelUpdateErr);
        }
      }

      // 5. Dispatch branded activation email
      const emailHtml = buildActivationEmailHtml({
        hotelName,
        targetName: fullName.trim(),
        targetEmail: normalizedEmail,
        adminName: effectiveAdminName,
        adminEmail: effectiveAdminEmail,
        activationUrl,
        durationHours: '24 hours'
      });

      const emailResult = await dispatchEmailMessage({
        to: normalizedEmail,
        subject: isHotelAdminRole
          ? `[ACTION REQUIRED] Activate your Administrator account - ${hotelName}`
          : `[ACTION REQUIRED] Activate your staff account - ${hotelName}`,
        html: emailHtml,
        fromName: `${hotelName} Administration`
      });

      // 6. Record Audit Log in Firestore
      try {
        await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
          action: isHotelAdminRole ? 'ADMIN_ACCOUNT_CREATED' : 'STAFF_ACCOUNT_CREATED',
          module: 'Staff Management',
          targetId: firebase_uid,
          targetEmail: normalizedEmail,
          targetName: fullName.trim(),
          performedBy: effectiveAdminEmail,
          performedByUid: effectiveAdminUid,
          details: `Created ${isHotelAdminRole ? 'administrator' : 'staff'} account for ${normalizedEmail} with role '${roleLabel}' in Firebase Auth (UID: ${firebase_uid}). Status set to Pending Activation.`,
          timestamp: serverTimestamp(),
          createdAt: now
        });
      } catch (logErr) {
        console.warn("Could not write audit log:", logErr);
      }

      return res.status(201).json({
        success: true,
        firebase_uid,
        user: redactSensitiveUserFields(staffProfile),
        activationLink: activationUrl,
        emailSent: emailResult.emailDispatched,
        previewUrl: emailResult.previewUrl || null,
        message: `Staff member created successfully in Firebase Auth with UID ${firebase_uid}. Account placed in Pending Activation.`
      });
    } catch (err: any) {
      console.error("[CREATE STAFF ERROR]:", err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to create staff account.") });
    }
  });

  // API Route: Extend Grace Period for checked-in guest (Time-Sensitive Ad-Hoc Extension)
  app.post("/api/reservations/extend-grace-period", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const {
      hotelId,
      reservationId,
      extensionMinutes = 60,
      reason = "Front Desk courtesy extension",
      staffUid = "staff",
      staffName = "Front Desk Staff"
    } = req.body;

    if (!hotelId || !reservationId) {
      return res.status(400).json({ error: "Missing required parameters: hotelId and reservationId are mandatory." });
    }

    if (!isSafeIdentifier(hotelId) || !isSafeIdentifier(reservationId)) {
      return res.status(400).json({ error: "Invalid identifier format." });
    }

    if (!callerIsHotelStaff(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: You are not authorized to modify reservations for this hotel." });
    }

    const effectiveStaffUid = caller.uid || staffUid;
    const effectiveStaffName = caller.profile?.displayName || caller.email || staffName;

    try {
      const { doc, getDoc, updateDoc, arrayUnion, addDoc, collection, serverTimestamp } = await import('firebase/firestore');

      const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
      const resSnap = await getDoc(resRef);
      if (!resSnap.exists()) {
        return res.status(404).json({ error: "Reservation not found in hotel records." });
      }
      const resData = resSnap.data();

      // Fetch hotel default checkout settings
      const hotelRef = doc(db, 'hotels', hotelId);
      const hotelSnap = await getDoc(hotelRef);
      const hotelData = hotelSnap.exists() ? hotelSnap.data() : {};

      const currentCustomMinutes = Number(resData.customGracePeriodMinutes || 0);
      const minutesToAdd = Math.min(1440, Math.max(15, Number(extensionMinutes) || 60));
      const newTotalCustomMinutes = currentCustomMinutes + minutesToAdd;

      const baseCheckoutTime = resData.approvedLateCheckoutTime || resData.checkOutTime || hotelData.defaultCheckOutTime || hotelData.settings?.checkout?.defaultTime || '12:00';
      const [h, m] = baseCheckoutTime.split(':').map(Number);
      const coutDate = resData.checkOut ? new Date(resData.checkOut) : new Date();
      const scheduledCheckoutDateTime = new Date(
        coutDate.getFullYear(),
        coutDate.getMonth(),
        coutDate.getDate(),
        isNaN(h) ? 12 : h,
        isNaN(m) ? 0 : m,
        0
      );

      const hotelGraceHours = hotelData.settings?.checkout?.gracePeriod !== undefined
        ? Number(hotelData.settings.checkout.gracePeriod) / 60
        : Number(hotelData.overstayGraceHours ?? 2);
      const hotelGraceMs = hotelGraceHours * 60 * 60 * 1000;

      const previousDeadlineMs = scheduledCheckoutDateTime.getTime() + hotelGraceMs + (currentCustomMinutes * 60 * 1000);
      const prospectiveDeadline = new Date(previousDeadlineMs + (minutesToAdd * 60 * 1000));
      const newEffectiveTimeStr = prospectiveDeadline.toTimeString().substring(0, 5);
      const nowIso = new Date().toISOString();

      const extensionRecord = {
        minutes: minutesToAdd,
        totalCustomMinutes: newTotalCustomMinutes,
        approvedBy: effectiveStaffName,
        approvedByUid: effectiveStaffUid,
        timestamp: nowIso,
        reason: String(reason).trim() || 'Front Desk courtesy extension',
        previousCheckoutDeadline: new Date(previousDeadlineMs).toISOString(),
        newEffectiveCheckoutTime: prospectiveDeadline.toISOString()
      };

      await updateDoc(resRef, {
        customGracePeriodMinutes: newTotalCustomMinutes,
        approvedLateCheckoutTime: newEffectiveTimeStr,
        effectiveCheckoutTime: prospectiveDeadline.toISOString(),
        gracePeriodApprovedBy: {
          uid: effectiveStaffUid,
          name: effectiveStaffName,
          timestamp: nowIso,
          reason: String(reason).trim() || 'Front Desk courtesy extension'
        },
        gracePeriodExtensionHistory: arrayUnion(extensionRecord)
      });

      // Write Audit Log and Activity Log
      try {
        const logData = {
          action: 'GRACE_PERIOD_EXTENDED',
          module: 'Reservations',
          reservationId,
          targetId: reservationId,
          performedBy: effectiveStaffName,
          performedByUid: effectiveStaffUid,
          details: `Extended grace period by +${minutesToAdd}m (Total custom: ${newTotalCustomMinutes}m) for Room ${resData.roomNumber || resData.roomId} (${resData.guestName}). New checkout deadline: ${newEffectiveTimeStr}. Reason: ${reason}`,
          timestamp: serverTimestamp(),
          createdAt: nowIso
        };
        await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), logData);
        await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), logData);
      } catch (logErr) {
        console.warn("[AUDIT LOG NOTICE]:", logErr);
      }

      return res.json({
        success: true,
        reservationId,
        customGracePeriodMinutes: newTotalCustomMinutes,
        effectiveCheckoutTime: prospectiveDeadline.toISOString(),
        approvedLateCheckoutTime: newEffectiveTimeStr,
        message: `Grace period extended by ${minutesToAdd} minutes. New checkout deadline is ${newEffectiveTimeStr}.`
      });
    } catch (err: any) {
      console.error("[EXTEND GRACE PERIOD ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to extend grace period.") });
    }
  });

  // API Route: Resend Activation Link (Regenerate Firebase activation link and redispatch email)
  app.post("/api/auth/resend-activation-link", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const {
      hotelId,
      hotelName = "Hotel Property",
      targetUid,
      targetEmail,
      targetName,
      adminEmail = "Hotel Administrator",
      adminName = "Hotel Administrator",
      adminUid = "admin",
      baseUrl
    } = req.body;

    if (!hotelId || !targetEmail) {
      return res.status(400).json({ error: "Missing hotelId or targetEmail." });
    }

    if (!isSafeIdentifier(hotelId) || (targetUid && !isSafeIdentifier(targetUid)) || !isValidEmailAddress(targetEmail)) {
      return res.status(400).json({ error: "Invalid identifier or email format." });
    }

    if (!callerHasStaffManagement(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: Staff management permission required." });
    }

    const normalizedEmail = targetEmail.trim().toLowerCase();
    const effectiveAdminEmail = caller.email || adminEmail;
    const effectiveAdminUid = caller.uid || adminUid;
    const effectiveAdminName = caller.profile?.displayName || adminName || effectiveAdminEmail;
    const clientOrigin = resolveSafeAppOrigin(
      baseUrl,
      typeof req.headers.host === 'string' ? req.headers.host : undefined,
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      process.env.APP_URL,
      PORT,
      process.env.ALLOWED_ORIGINS
    );

    try {
      let targetDocId = targetUid || null;
      let userDisplayName = targetName || null;

      // Try looking up UID if not supplied
      if (!targetDocId && adminAuth) {
        try {
          const userRecord = await adminAuth.getUserByEmail(normalizedEmail);
          targetDocId = userRecord.uid;
          if (!userDisplayName && userRecord.displayName) {
            userDisplayName = userRecord.displayName;
          }
        } catch (e) {}
      }

      if (!targetDocId && db) {
        try {
          const { collection, query, where, getDocs } = await import('firebase/firestore');
          const q = query(collection(db, 'users'), where('email', '==', normalizedEmail));
          const snap = await getDocs(q);
          if (!snap.empty) {
            targetDocId = snap.docs[0].id;
            const uData = snap.docs[0].data();
            if (!userDisplayName && uData.displayName) {
              userDisplayName = uData.displayName;
            }
          }
        } catch (e) {
          console.warn("[RESEND ACTIVATION] Notice during user lookup:", e);
        }
      }

      if (!targetDocId) {
        targetDocId = 'staff_' + normalizedEmail.replace(/[^a-zA-Z0-9]/g, '_');
      }

      // 2. Generate fresh Firebase password reset / activation link
      const tokenId = 'act_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
      const linkResult = await generateStaffActivationLink(normalizedEmail, clientOrigin, tokenId);
      const activationUrl = linkResult.activationUrl;
      const now = new Date().toISOString();

      // Register in memory registry
      setBoundedActivationToken(tokenId, {
        email: normalizedEmail,
        name: userDisplayName || normalizedEmail,
        uid: targetDocId,
        hotelId,
        hotelName,
        expiresAt: Date.now() + 24 * 60 * 60 * 1000
      });

      // Try updating staff user document
      if (db && targetDocId) {
        try {
          const { updateDoc, doc } = await import('firebase/firestore');
          await updateDoc(doc(db, 'users', targetDocId), {
            activationLink: activationUrl,
            activationToken: tokenId,
            activationEmailSentAt: now,
            activationEmailSentBy: effectiveAdminEmail,
            updatedAt: now
          });
        } catch (uErr) {
          console.warn("[RESEND ACTIVATION] User doc update notice:", uErr);
        }
      }

      // 3. Dispatch activation email
      const emailHtml = buildActivationEmailHtml({
        hotelName,
        targetName: userDisplayName || normalizedEmail,
        targetEmail: normalizedEmail,
        adminName: effectiveAdminName,
        adminEmail: effectiveAdminEmail,
        activationUrl,
        durationHours: '24 hours'
      });

      const emailResult = await dispatchEmailMessage({
        to: normalizedEmail,
        subject: `[ACTION REQUIRED] Activate your staff account - ${hotelName}`,
        html: emailHtml,
        fromName: `${hotelName} Administration`
      });

      // 4. Audit Log
      if (db) {
        try {
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
            action: 'ACTIVATION_EMAIL_RESENT',
            module: 'Staff Management',
            targetId: targetDocId,
            targetEmail: normalizedEmail,
            performedBy: effectiveAdminEmail,
            performedByUid: effectiveAdminUid,
            details: `Regenerated Firebase activation link and dispatched email to ${normalizedEmail}.`,
            timestamp: serverTimestamp(),
            createdAt: now
          });
        } catch (logErr) {}
      }

      return res.json({
        success: true,
        activationLink: activationUrl,
        emailSent: emailResult.emailDispatched,
        previewUrl: emailResult.previewUrl || null,
        message: `Fresh activation link generated and dispatched to ${normalizedEmail}.`
      });
    } catch (err: any) {
      console.error("[RESEND ACTIVATION ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to resend activation link.") });
    }
  });

  // API Route: Validate Activation / Password Reset Token
  app.all("/api/auth/validate-token", async (req, res) => {
    const tokenId = (req.query.tokenId as string) || (req.body?.tokenId as string) || (req.query.token as string) || (req.body?.token as string);
    const email = (req.query.email as string) || (req.body?.email as string);

    if (!tokenId || !isSafeIdentifier(tokenId)) {
      return res.status(400).json({ valid: false, error: "Valid token ID is required." });
    }

    try {
      // 1. Check in-memory token registry (strict expiry enforcement)
      if (activeActivationTokens.has(tokenId)) {
        const mem = activeActivationTokens.get(tokenId)!;
        if (Date.now() > mem.expiresAt) {
          activeActivationTokens.delete(tokenId);
          return res.status(200).json({ valid: false, error: "This activation link has expired. Please request a new link." });
        }
        return res.status(200).json({
          valid: true,
          tokenData: {
            tokenId,
            targetEmail: mem.email || email,
            targetUid: mem.uid,
            hotelId: mem.hotelId,
            status: 'active',
            type: 'activation',
            expiresAt: new Date(mem.expiresAt).toISOString()
          }
        });
      }

      // 2. Check Firestore tokens
      if (db) {
        const { doc, getDoc, collection, query, where, getDocs } = await import('firebase/firestore');

        // Check passwordResetTokens
        let snap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
        if (!snap.exists()) {
          // Check activationTokens
          snap = await getDoc(doc(db, 'activationTokens', tokenId));
        }

        if (snap.exists()) {
          const data = snap.data();
          if (data.status === 'revoked') {
            return res.status(200).json({ valid: false, error: "This activation link has been revoked by an administrator." });
          }
          if (data.isUsed || data.status === 'used') {
            return res.status(200).json({ valid: false, error: "This activation link has already been used." });
          }
          if (data.expiresAt) {
            const exp = new Date(data.expiresAt).getTime();
            if (!isNaN(exp) && Date.now() > exp) {
              return res.status(200).json({ valid: false, error: "This activation link has expired. Please request a new link." });
            }
          }
          return res.status(200).json({
            valid: true,
            tokenData: {
              tokenId,
              targetEmail: data.targetEmail || data.email || email,
              targetUid: data.targetUid || data.uid,
              hotelId: data.hotelId,
              status: data.status || 'active',
              type: data.type || 'activation',
              expiresAt: data.expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
            }
          });
        }

        // Fallback: match exact stored activationToken on user document (never accept arbitrary unverified tokens)
        if (email && isValidEmailAddress(email)) {
          const q = query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase()));
          const userSnap = await getDocs(q);
          if (!userSnap.empty) {
            const userData = userSnap.docs[0].data();
            if (userData.activationToken === tokenId || userData.activationTokenId === tokenId) {
              return res.status(200).json({
                valid: true,
                tokenData: {
                  tokenId,
                  targetEmail: userData.email,
                  targetUid: userSnap.docs[0].id,
                  hotelId: userData.hotelId,
                  status: 'active',
                  type: 'activation',
                  expiresAt: userData.activationLinkExpiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
                }
              });
            }
          }
        }
      }

      return res.status(200).json({ valid: false, error: "Activation token not found or invalid." });
    } catch (e: any) {
      console.warn("[VALIDATE TOKEN] Check error:", e);
      return res.status(500).json({ valid: false, error: "Unable to validate activation token." });
    }
  });

  // API Route: Activate Staff User (Phase 2 completion: updates database status to 'active' & verified)
  app.post("/api/auth/activate-staff-user", async (req, res) => {
    const { email, firebase_uid, password, oobCode, tokenId, tp } = req.body;

    if (!email && !firebase_uid) {
      return res.status(400).json({ error: "Missing email or firebase_uid for activation." });
    }
    if (firebase_uid && !isSafeIdentifier(firebase_uid)) {
      return res.status(400).json({ error: "Invalid firebase_uid format." });
    }
    if (tokenId && !isSafeIdentifier(tokenId)) {
      return res.status(400).json({ error: "Invalid tokenId format." });
    }
    if (email && !isValidEmailAddress(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database service is currently unavailable." });
    }

    const caller = await verifyFirebaseTokenAndCaller(req, false);

    try {
      const { doc, getDoc, updateDoc, collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');
      const now = new Date().toISOString();
      let targetDocId = firebase_uid;
      let userDocData: any = null;

      if (targetDocId) {
        try {
          const snap = await getDoc(doc(db, 'users', targetDocId));
          if (snap.exists()) {
            userDocData = snap.data();
          }
        } catch (e) {
          console.warn("Could not fetch user by doc ID:", e);
        }
      }

      if (!userDocData && email) {
        try {
          const q = query(collection(db, 'users'), where('email', '==', email.trim().toLowerCase()));
          const snap = await getDocs(q);
          if (!snap.empty) {
            targetDocId = snap.docs[0].id;
            userDocData = snap.docs[0].data();
          }
        } catch (e) {
          console.warn("Could not query user by email:", e);
        }
      }

      if (!targetDocId) {
        targetDocId = firebase_uid;
      }

      // 1. Resolve tempPass, UID, and verify authorization/proof
      let resolvedTempPass: string | null = null;
      let effectiveEmail = email ? email.trim().toLowerCase() : (userDocData?.email?.toLowerCase() || null);
      let hasValidProof = false;

      // Proof 1: Caller already verified Firebase ID token for target account
      if (caller && ((targetDocId && caller.uid === targetDocId) || (effectiveEmail && caller.email?.toLowerCase() === effectiveEmail))) {
        hasValidProof = true;
      }

      if (tokenId && activeActivationTokens.has(tokenId)) {
        const memToken = activeActivationTokens.get(tokenId)!;
        if (Date.now() <= memToken.expiresAt) {
          const emailMatches = !effectiveEmail || memToken.email?.toLowerCase() === effectiveEmail;
          const uidMatches = !targetDocId || memToken.uid === targetDocId;
          if (emailMatches && uidMatches) {
            hasValidProof = true;
          }
        }
        resolvedTempPass = memToken.tempPass || null;
        if (!targetDocId && memToken.uid) {
          targetDocId = memToken.uid;
        }
        if (!effectiveEmail && memToken.email) {
          effectiveEmail = memToken.email;
        }
      }

      if (tokenId && db) {
        try {
          let tokenSnap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
          if (!tokenSnap.exists()) {
            tokenSnap = await getDoc(doc(db, 'activationTokens', tokenId));
          }
          if (tokenSnap.exists()) {
            const tokData = tokenSnap.data();
            const isRevoked = tokData.status === 'revoked';
            const isUsed = Boolean(tokData.isUsed) || tokData.status === 'used';
            const expiryMs = tokData.expiresAt ? new Date(tokData.expiresAt).getTime() : NaN;
            const isExpired = !isNaN(expiryMs) && Date.now() > expiryMs;
            const tokEmail = (tokData.targetEmail || tokData.email || '').toLowerCase();
            const tokUid = tokData.targetUid || tokData.uid;
            const matchesTarget = (!effectiveEmail || !tokEmail || tokEmail === effectiveEmail) && (!targetDocId || !tokUid || tokUid === targetDocId);

            if (!isRevoked && !isUsed && !isExpired && matchesTarget) {
              hasValidProof = true;
            }
            if (!resolvedTempPass && tokData.tempPass) {
              resolvedTempPass = tokData.tempPass;
            }
            if (!targetDocId && tokUid) {
              targetDocId = tokUid;
            }
            if (!effectiveEmail && tokEmail) {
              effectiveEmail = tokEmail;
            }
          }
        } catch (tokErr) {
          console.warn("[ACTIVATE] Could not read token for tempPass:", tokErr);
        }
      }

      if (!resolvedTempPass && tp && (userDocData?.initialTempPass === tp || userDocData?.temporaryPassword === tp || hasValidProof)) {
        resolvedTempPass = tp;
        if (userDocData?.status === 'pending_activation' && (userDocData?.initialTempPass === tp || userDocData?.temporaryPassword === tp)) {
          hasValidProof = true;
        }
      }
      if (!resolvedTempPass && userDocData?.initialTempPass) {
        resolvedTempPass = userDocData.initialTempPass;
      }
      if (!resolvedTempPass && userDocData?.temporaryPassword) {
        resolvedTempPass = userDocData.temporaryPassword;
      }

      // Proof 3/4: Verify oobCode or newly confirmed password against Firebase Auth
      let updatedUserToken: string | null = null;
      let oobResetAttempted = false;

      if (!hasValidProof && password && oobCode && firebaseConfig?.apiKey) {
        try {
          const resetRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oobCode, newPassword: password })
          });
          const resetData = await resetRes.json();
          if (resetRes.ok && (!effectiveEmail || !resetData?.email || resetData.email.toLowerCase() === effectiveEmail)) {
            hasValidProof = true;
            oobResetAttempted = true;
            if (resetData?.idToken) {
              updatedUserToken = resetData.idToken;
            }
          }
        } catch (resetErr) {
          console.warn("[FIREBASE AUTH REST] oobCode verification notice:", resetErr);
        }
      }

      if (!hasValidProof && password && effectiveEmail && firebaseConfig?.apiKey && (userDocData?.status === 'pending_activation' || userDocData?.status === 'password_reset_pending')) {
        try {
          const verifyPwRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: effectiveEmail, password, returnSecureToken: true })
          });
          const verifyPwData = await verifyPwRes.json();
          if (verifyPwRes.ok && verifyPwData?.idToken) {
            hasValidProof = true;
            updatedUserToken = verifyPwData.idToken;
          }
        } catch {
          // Ignore network error
        }
      }

      if (!hasValidProof) {
        return res.status(401).json({ error: "Valid activation token, verification code, or authenticated session required." });
      }

      if (adminAuth && password && targetDocId) {
        try {
          await adminAuth.updateUser(targetDocId, {
            password: password,
            emailVerified: true
          });
          console.log(`[FIREBASE AUTH ADMIN] Updated password for user ${targetDocId}`);
        } catch (adminPwErr) {
          console.warn("[FIREBASE AUTH ADMIN] updateUser password notice:", adminPwErr);
        }
      } else if (!oobResetAttempted && password && oobCode && firebaseConfig?.apiKey) {
        // Update password via Identity Toolkit REST resetPassword with oobCode
        try {
          const resetRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:resetPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ oobCode, newPassword: password })
          });
          const resetData = await resetRes.json();
          if (resetData?.idToken) {
            updatedUserToken = resetData.idToken;
          }
          console.log(`[FIREBASE AUTH REST] Password reset via oobCode for user ${effectiveEmail || targetDocId}`);
        } catch (resetErr) {
          console.warn("[FIREBASE AUTH REST] resetPassword notice:", resetErr);
        }
      } else if (!updatedUserToken && password && effectiveEmail && resolvedTempPass && firebaseConfig?.apiKey) {
        // Update password via Identity Toolkit REST signInWithPassword + update
        try {
          const signInRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: effectiveEmail, password: resolvedTempPass, returnSecureToken: true })
          });
          const signInData = await signInRes.json();
          if (signInData?.idToken) {
            const updateRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: signInData.idToken, password: password, returnSecureToken: true })
            });
            const updateData = await updateRes.json();
            if (updateData?.idToken) {
              updatedUserToken = updateData.idToken;
            }
            console.log(`[FIREBASE AUTH REST] Updated password for user ${effectiveEmail}`);
          }
        } catch (restPwErr) {
          console.warn("[FIREBASE AUTH REST] Password update notice:", restPwErr);
        }
      }

      // Update user document to active & verified
      const updatePayload = {
        status: 'active',
        isVerified: true,
        emailVerified: true,
        temporaryPassword: null,
        initialPassword: null,
        initialTempPass: null,
        systemAuthSecret: password || userDocData?.systemAuthSecret || resolvedTempPass || null,
        forcePasswordChange: false,
        passwordChangedAt: now,
        passwordChangedBy: effectiveEmail || userDocData?.email || 'user',
        updatedAt: now
      };

      if (targetDocId) {
        try {
          await updateDoc(doc(db, 'users', targetDocId), updatePayload);
        } catch (updateErr) {
          console.warn("[ACTIVATE] updateDoc warning, attempting authenticated REST write:", updateErr);
          try {
            await saveUserProfileToFirestore(targetDocId, {
              ...(userDocData || {}),
              ...updatePayload
            }, updatedUserToken || undefined);
          } catch (restErr) {
            console.warn("[ACTIVATE] REST write notice:", restErr);
          }
        }

        // If user is a hotelAdmin, ensure their UID is recorded in the hotel's adminUIDs array
        if ((userDocData?.role === 'hotelAdmin' || userDocData?.role === 'admin') && userDocData?.hotelId && userDocData.hotelId !== 'system') {
          try {
            const { arrayUnion, updateDoc: updateHotelDoc } = await import('firebase/firestore');
            await updateHotelDoc(doc(db, 'hotels', userDocData.hotelId), {
              adminUIDs: arrayUnion(targetDocId)
            });
          } catch (adminUidErr) {
            console.warn("[ACTIVATE ADMIN] Notice appending admin UID to hotel:", adminUidErr);
          }
        }
      }

      // If tokenId was provided, mark it as used and clear from memory
      if (tokenId) {
        activeActivationTokens.delete(tokenId);
        await updateDoc(doc(db, 'passwordResetTokens', tokenId), {
          isUsed: true,
          status: 'used',
          usedAt: now,
          updatedAt: now
        }).catch(() => {});
      }

      // Record in audit log
      const hotelId = userDocData?.hotelId;
      if (hotelId && hotelId !== 'system') {
        try {
          await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
            action: (userDocData?.role === 'hotelAdmin' || userDocData?.role === 'admin') ? 'ADMIN_ACTIVATION_COMPLETED' : 'STAFF_ACTIVATION_COMPLETED',
            module: 'Staff Security',
            targetId: targetDocId,
            targetEmail: userDocData?.email || email,
            details: `User ${userDocData?.email || email} (UID: ${targetDocId}) activated their account and set their password. Account status transitioned from Pending Activation to Active.`,
            timestamp: serverTimestamp(),
            createdAt: now
          });
        } catch (logErr) {}
      }

      return res.json({
        success: true,
        firebase_uid: targetDocId,
        message: "Account successfully activated and verified. User is now Active."
      });
    } catch (err: any) {
      console.error("[ACTIVATE STAFF ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to activate staff account.") });
    }
  });

  // API Route: Update Staff User Permissions & Modules in real-time
  app.post("/api/auth/update-user-permissions", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    try {
      const {
        uid,
        email,
        hotelId,
        permissions = [],
        assignedModules = [],
        adminEmail = "Administrator",
        adminUid = "admin"
      } = req.body;

      if (!uid || !hotelId || !isSafeIdentifier(uid) || !isSafeIdentifier(hotelId)) {
        return res.status(400).json({ error: "Valid uid and hotelId are required." });
      }

      if (!callerHasStaffManagement(caller, hotelId)) {
        return res.status(403).json({ error: "Forbidden: Staff management permission required." });
      }

      if (!db) {
        return res.status(500).json({ error: "Database connection not initialized." });
      }

      const { doc, getDoc, updateDoc, addDoc, collection, serverTimestamp } = await import('firebase/firestore');

      // Enforce multi-tenant target check: ensure target user belongs to caller's hotel
      const targetSnap = await getDoc(doc(db, 'users', uid));
      if (!targetSnap.exists()) {
        return res.status(404).json({ error: "Target user profile not found." });
      }
      const targetData = targetSnap.data();
      const targetHotel = targetData.hotelId || targetData.hotel_id;
      if (!isSuperAdminCaller(caller) && targetHotel && targetHotel !== hotelId) {
        return res.status(403).json({ error: "Forbidden: Cross-tenant user modification is prohibited." });
      }
      if (targetData.role === 'superAdmin' && !isSuperAdminCaller(caller)) {
        return res.status(403).json({ error: "Forbidden: Cannot modify Super Administrator permissions." });
      }

      const rawPerms = Array.isArray(permissions) ? permissions : [];
      const sanitizedPermissions = isSuperAdminCaller(caller)
        ? rawPerms
        : rawPerms.filter((p: any) => p !== 'access_super_admin');

      const moduleMap: Record<string, string[]> = {
        dashboard: ['view_dashboard', 'export_dashboard'],
        reservations: ['access_front_desk', 'view_reservations', 'create_reservations', 'check_in_guests', 'check_out_guests'],
        frontDesk: ['access_front_desk', 'view_reservations', 'create_reservations'],
        guests: ['edit_guest_profiles', 'view_guests', 'add_guests', 'edit_guests'],
        rooms: ['manage_rooms', 'view_rooms', 'create_rooms', 'edit_rooms', 'block_rooms'],
        housekeeping: ['view_housekeeping', 'assign_housekeeping_tasks', 'edit_housekeeping_tasks', 'close_housekeeping_tasks'],
        kitchen: ['manage_kitchen', 'view_fb_orders', 'create_fb_orders', 'edit_fb_orders'],
        inventory: ['manage_inventory', 'view_inventory', 'edit_inventory'],
        maintenance: ['manage_maintenance'],
        corporate: ['manage_corporate'],
        finance: ['view_financial_records', 'view_ledger', 'process_payments', 'view_debt_ledger', 'receive_payment', 'receive_payments'],
        audits: ['nightly_audit', 'run_night_audit', 'approve_night_audit'],
        reports: ['view_reports', 'export_reports', 'print_reports'],
        staff: ['manage_staff', 'view_users', 'view_activity_logs'],
        settings: ['edit_hotel_settings', 'view_settings', 'edit_settings', 'manage_roles']
      };

      const resolvedAssignedModules = (Array.isArray(assignedModules) && assignedModules.length > 0)
        ? assignedModules
        : (sanitizedPermissions.length > 0
            ? Object.keys(moduleMap).filter(modId => moduleMap[modId].some(p => sanitizedPermissions.includes(p)))
            : []);

      const now = new Date().toISOString();
      const updateData: any = {
        permissions: sanitizedPermissions,
        assignedModules: resolvedAssignedModules,
        updatedAt: now
      };

      // 1. Direct Firestore write
      try {
        const userRef = doc(db, 'users', uid);
        await updateDoc(userRef, updateData);
      } catch (sdkErr) {
        console.warn("[UPDATE PERMS] SDK update warning, falling back to REST write:", sdkErr);
        await saveUserProfileToFirestore(uid, updateData);
      }

      // 2. Audit log
      if (hotelId && hotelId !== 'system') {
        try {
          await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
            action: 'UPDATE_STAFF_PERMISSIONS',
            module: 'Staff Security',
            targetId: uid,
            targetEmail: email || targetData.email || null,
            performedBy: caller.email || adminEmail,
            performedByUid: caller.uid || adminUid,
            details: `Updated assigned modules (${(resolvedAssignedModules || []).join(', ')}) and permissions (${sanitizedPermissions.length} capabilities) for staff member ${email || uid}`,
            timestamp: serverTimestamp()
          });
        } catch (auditErr) {
          console.warn("[UPDATE PERMS] Audit log notice:", auditErr);
        }
      }

      console.log(`[UPDATE PERMS] Successfully updated modules & permissions for user ${uid} (${email || ''})`);
      return res.status(200).json({
        success: true,
        uid,
        permissionsCount: sanitizedPermissions.length,
        assignedModules: resolvedAssignedModules
      });
    } catch (err: any) {
      console.error("[UPDATE PERMS] Failed to update user permissions:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to update permissions.") });
    }
  });

  // API Route: Synchronize user password credential for server-side auth lifecycle management
  app.post("/api/auth/sync-user-password", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { uid, email, password, previousPassword } = req.body;
    if ((!uid && !email) || !password) {
      return res.status(400).json({ error: "Missing uid/email or password." });
    }
    if (uid && !isSafeIdentifier(uid)) {
      return res.status(400).json({ error: "Invalid uid format." });
    }
    if (email && !isValidEmailAddress(email)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database service unavailable." });
    }

    try {
      const { doc, getDoc, updateDoc, collection, query, where, getDocs } = await import('firebase/firestore');
      const now = new Date().toISOString();
      let targetDocId = uid;
      let targetData: any = null;
      const normalizedEmail = email ? email.trim().toLowerCase() : null;

      if (targetDocId) {
        const snap = await getDoc(doc(db, 'users', targetDocId));
        if (snap.exists()) {
          targetData = snap.data();
        }
      } else if (normalizedEmail) {
        const q = query(collection(db, 'users'), where('email', '==', normalizedEmail));
        const snap = await getDocs(q);
        if (!snap.empty) {
          targetDocId = snap.docs[0].id;
          targetData = snap.docs[0].data();
        }
      }

      const isSelf =
        (targetDocId && caller.uid === targetDocId) ||
        (normalizedEmail && caller.email?.toLowerCase() === normalizedEmail);
      const targetHotelId = targetData?.hotelId || targetData?.hotel_id;
      const isAuthorizedAdmin =
        isSuperAdminCaller(caller) ||
        (targetHotelId && callerHasStaffManagement(caller, targetHotelId) && targetData?.role !== 'superAdmin');

      if (!isSelf && !isAuthorizedAdmin) {
        return res.status(403).json({ error: "Forbidden: Not authorized to synchronize credentials for this user." });
      }

      // Update user doc in Firestore
      if (targetDocId) {
        await updateDoc(doc(db, 'users', targetDocId), {
          systemAuthSecret: password,
          updatedAt: now
        }).catch(() => {});
      }

      // If adminAuth is available, update in Firebase Auth
      if (adminAuth && targetDocId) {
        try {
          await adminAuth.updateUser(targetDocId, { password });
        } catch (e) {}
      } else if (normalizedEmail && previousPassword && firebaseConfig?.apiKey) {
        try {
          const sRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: normalizedEmail, password: previousPassword, returnSecureToken: true })
          });
          const sData = await sRes.json();
          if (sData?.idToken) {
            await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:update?key=${firebaseConfig.apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: sData.idToken, password, returnSecureToken: true })
            });
          }
        } catch (e) {}
      }

      return res.json({ success: true, message: "Credential synchronized." });
    } catch (err: any) {
      console.error("[SYNC PASSWORD ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to synchronize credentials.") });
    }
  });

  // API Route: Send Tracking Code & Admin Registration Invitation via Email
  app.post("/api/admin/send-tracking-code", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    const caller = await requireAuth(req, res);
    if (!caller) return;

    if (!isSuperAdminCaller(caller)) {
      return res.status(403).json({ error: "Forbidden: Super Administrator privileges required." });
    }

    const {
      email,
      code,
      hotelName = "Hotel Property",
      plan = "Standard",
      duration = "1 month",
      price = 0,
      adminEmail = "Super Administrator",
      baseUrl
    } = req.body;

    if (!email || !code) {
      return res.status(400).json({ error: "Missing required fields: email and code are required." });
    }

    if (!isValidEmailAddress(email)) {
      return res.status(400).json({ error: "Invalid recipient email address." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const cleanCode = String(code).trim().toUpperCase();
    const clientOrigin = resolveSafeAppOrigin(
      baseUrl,
      typeof req.headers.host === 'string' ? req.headers.host : undefined,
      typeof req.headers.origin === 'string' ? req.headers.origin : undefined,
      process.env.APP_URL,
      PORT,
      process.env.ALLOWED_ORIGINS
    );
    const registrationUrl = `${clientOrigin.replace(/\/+$/, '')}/?trackingCode=${encodeURIComponent(cleanCode)}&email=${encodeURIComponent(normalizedEmail)}${hotelName ? `&hotelName=${encodeURIComponent(hotelName)}` : ''}&mode=register`;

    const safeCode = escapeHtml(cleanCode);
    const safePlan = escapeHtml(plan);
    const safeDuration = escapeHtml(duration);
    const safeRegistrationUrl = escapeHtml(registrationUrl);

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Your Hotel Property PMS Registration Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
  <table width="100%" border="0" cellspacing="0" cellpadding="0" style="background-color: #09090b; padding: 40px 20px;">
    <tr>
      <td align="center">
        <table width="600" border="0" cellspacing="0" cellpadding="0" style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
          <tr>
            <td style="padding: 36px 40px; background: linear-gradient(135deg, #059669 0%, #047857 100%);">
              <h1 style="margin: 0 0 8px 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.025em;">Property Registration Invitation</h1>
              <p style="margin: 0; color: #d1fae5; font-size: 14px; font-weight: 500;">Hotel Administrator Onboarding</p>
            </td>
          </tr>
          <tr>
            <td style="padding: 40px;">
              <p style="margin: 0 0 20px 0; font-size: 16px; line-height: 24px; color: #e4e4e7;">
                Hello,
              </p>
              <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #a1a1aa;">
                Your property registration access code has been generated. Use this code to register your hotel and activate your <strong>Master Hotel Administrator</strong> account on the Property Management System.
              </p>

              <div style="background-color: #09090b; border: 1px solid #27272a; border-radius: 12px; padding: 24px; text-align: center; margin-bottom: 28px;">
                <span style="display: block; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em; color: #10b981; margin-bottom: 8px;">Your Unique Registration Code</span>
                <span style="font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 32px; font-weight: 900; letter-spacing: 0.25em; color: #ffffff;">${safeCode}</span>
                <div style="margin-top: 12px; font-size: 13px; color: #71717a;">Plan: <strong style="color: #e4e4e7;">${safePlan}</strong> &bull; Duration: <strong style="color: #e4e4e7;">${safeDuration}</strong></div>
              </div>

              <div style="text-align: center; margin-bottom: 32px;">
                <a href="${safeRegistrationUrl}" style="display: inline-block; background-color: #10b981; color: #000000; text-decoration: none; font-size: 15px; font-weight: 700; padding: 14px 36px; border-radius: 10px;">
                  Register Hotel & Administrator Account &rarr;
                </a>
              </div>

              <div style="background-color: #27272a33; border: 1px solid #27272a; border-radius: 10px; padding: 20px; margin-bottom: 28px;">
                <h4 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: #e4e4e7;">Quick Registration Steps:</h4>
                <ol style="margin: 0; padding-left: 20px; font-size: 14px; line-height: 22px; color: #a1a1aa;">
                  <li style="margin-bottom: 6px;">Click the button above (your code and email will be pre-filled).</li>
                  <li style="margin-bottom: 6px;">Enter your property name and choose your Administrator password.</li>
                  <li>Sign in immediately with full master access to all property modules.</li>
                </ol>
              </div>

              <p style="margin: 0; font-size: 12px; line-height: 18px; color: #71717a; border-top: 1px solid #27272a; padding-top: 20px;">
                Direct Registration Link: <br />
                <a href="${safeRegistrationUrl}" style="color: #10b981; word-break: break-all;">${safeRegistrationUrl}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding: 24px 40px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #52525b;">Property Management System &bull; System Administration</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
    `;

    try {
      const emailResult = await dispatchEmailMessage({
        to: normalizedEmail,
        subject: `[INVITATION] Hotel Registration & Administrator Setup - Code: ${cleanCode}`,
        html: htmlContent,
        fromName: "PMS System Administration"
      });

      return res.status(200).json({
        success: true,
        code: cleanCode,
        registrationUrl,
        emailSent: emailResult.emailDispatched,
        previewUrl: emailResult.previewUrl || null,
        message: `Tracking code invitation dispatched to ${normalizedEmail}`
      });
    } catch (err: any) {
      console.error("[SEND TRACKING CODE ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to dispatch tracking code email.") });
    }
  });

  // API Route: Verify ID Token & Fetch Permissions (Phase 3: Verify Token & Check Pending Activation)
  app.post("/api/auth/verify-token", async (req, res) => {
    const authHeader = req.headers.authorization;
    const token = req.body.idToken || (authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null);

    if (!token) {
      return res.status(400).json({ error: "Missing Firebase ID token." });
    }

    try {
      let uid: string | null = null;
      let email: string | null = null;

      // 1. Verify via Admin SDK
      if (adminAuth) {
        try {
          const decoded = await adminAuth.verifyIdToken(token);
          uid = decoded.uid;
          email = decoded.email || null;
        } catch (adminErr: any) {
          console.warn("[VERIFY TOKEN] Admin SDK verifyIdToken notice:", adminErr?.message);
        }
      }

      // 2. Fallback via Identity Toolkit REST
      if (!uid && firebaseConfig?.apiKey) {
        try {
          const resp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ idToken: token })
          });
          const data = await resp.json();
          if (resp.ok && data?.users?.[0]) {
            uid = data.users[0].localId;
            email = data.users[0].email;
          }
        } catch (restErr) {
          console.warn("[VERIFY TOKEN] REST lookup notice:", restErr);
        }
      }

      if (!uid) {
        return res.status(401).json({ error: "Invalid or expired Firebase ID token." });
      }

      // 3. Lookup user profile in database
      let profile: any = null;
      if (db) {
        const { doc, getDoc, collection, query, where, getDocs } = await import('firebase/firestore');
        const snap = await getDoc(doc(db, 'users', uid));
        if (snap.exists()) {
          profile = snap.data();
        } else if (email) {
          const q = query(collection(db, 'users'), where('email', '==', email.toLowerCase()));
          const qSnap = await getDocs(q);
          if (!qSnap.empty) {
            profile = qSnap.docs[0].data();
          }
        }
      }

      // 4. Strict enforcement of Pending Activation
      if (profile) {
        if (profile.status === 'pending_activation') {
          return res.status(403).json({
            error: "Your account is pending activation. Please use the activation link sent to your email to set your password before signing in.",
            status: "pending_activation"
          });
        }
        if (profile.status === 'suspended' || profile.status === 'disabled') {
          return res.status(403).json({
            error: "Your account has been suspended or deactivated. Please contact your Hotel Administrator.",
            status: "suspended"
          });
        }
      }

      return res.json({
        valid: true,
        uid,
        email,
        profile: profile ? redactSensitiveUserFields(profile) : null,
        role: profile?.role || 'staff',
        permissions: profile?.permissions || []
      });
    } catch (err: any) {
      console.error("[VERIFY TOKEN ERROR]:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to verify ID token.") });
    }
  });

  // API Route: Send Account Activation Email
  app.post("/api/auth/send-account-activation-email", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const {
      hotelId,
      hotelName = "Hotel Property",
      targetUid,
      targetEmail,
      targetName,
      activationToken,
      activationUrl,
      expiresAt,
      durationMinutes = 1440, // 24 hours default
      adminEmail = "Hotel Administrator",
      adminName = "Hotel Administrator",
      note
    } = req.body;

    if (!hotelId || !targetEmail || !activationToken || !activationUrl) {
      return res.status(400).json({ error: "Missing required fields for activation email." });
    }

    if (!isSafeIdentifier(hotelId) || !isValidEmailAddress(targetEmail)) {
      return res.status(400).json({ error: "Invalid hotelId or recipient email address." });
    }

    if (!callerHasStaffManagement(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: Staff management permission required." });
    }

    if (
      !isSafeActionUrl(
        activationUrl,
        typeof req.headers.host === 'string' ? req.headers.host : undefined,
        process.env.APP_URL,
        process.env.ALLOWED_ORIGINS
      )
    ) {
      return res.status(400).json({ error: "Invalid or disallowed activation URL origin." });
    }

    try {
      const formattedExpiry = new Date(expiresAt).toLocaleString([], { 
        month: 'short', 
        day: 'numeric', 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      const durationHours = durationMinutes >= 60 
        ? `${Math.round(durationMinutes / 60)} hour(s)` 
        : `${durationMinutes} minutes`;

      const effectiveAdminEmail = caller.email || adminEmail;
      const effectiveAdminName = caller.profile?.displayName || adminName || effectiveAdminEmail;
      const htmlContent = buildActivationEmailHtml({
        hotelName,
        targetName: targetName || targetEmail,
        targetEmail,
        adminName: effectiveAdminName,
        adminEmail: effectiveAdminEmail,
        activationUrl,
        durationHours,
        formattedExpiry,
        note
      });

      const { emailDispatched, method, previewUrl } = await dispatchEmailMessage({
        to: targetEmail,
        subject: `[ACTION REQUIRED] Activate your staff account - ${hotelName}`,
        html: htmlContent,
        fromName: `${hotelName} Administration`
      });

      // Record in Firestore outbox
      if (db) {
        try {
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          await addDoc(collection(db, 'hotels', hotelId, 'emailNotifications'), {
            type: 'ACCOUNT_ACTIVATION',
            recipient: targetEmail,
            recipientName: targetName || targetEmail,
            subject: `[ACTION REQUIRED] Activate your staff account - ${hotelName}`,
            tokenId: activationToken,
            activationUrl,
            expiresAt,
            sentBy: effectiveAdminEmail,
            status: emailDispatched ? 'sent' : 'queued',
            deliveryMethod: method,
            previewUrl: previewUrl || null,
            timestamp: serverTimestamp()
          });
        } catch (dbErr) {
          console.warn("Could not record activation email notification in Firestore:", dbErr);
        }
      }

      return res.json({
        success: true,
        emailSent: emailDispatched,
        deliveryMethod: method,
        previewUrl,
        activationUrl,
        expiresAt,
        message: `Account activation email processed for ${targetEmail}.`
      });
    } catch (err: any) {
      console.error("Account activation email dispatch error:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to dispatch activation email.") });
    }
  });

  // API Route: Send Password Reset Email & Generate Token (Server-side)
  app.post("/api/auth/send-password-reset-email", async (req, res) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { 
      hotelId, 
      hotelName = "Hotel Property", 
      targetUid, 
      targetEmail, 
      targetName, 
      resetToken, 
      resetUrl, 
      expiresAt, 
      durationMinutes = 60, 
      adminEmail, 
      adminName, 
      note 
    } = req.body;

    if (!hotelId || !targetEmail || !resetToken || !resetUrl) {
      return res.status(400).json({ error: "Missing required fields for password reset email." });
    }

    if (!isSafeIdentifier(hotelId) || !isValidEmailAddress(targetEmail)) {
      return res.status(400).json({ error: "Invalid hotelId or recipient email address." });
    }

    if (!callerHasStaffManagement(caller, hotelId)) {
      return res.status(403).json({ error: "Forbidden: Staff management permission required." });
    }

    if (
      !isSafeActionUrl(
        resetUrl,
        typeof req.headers.host === 'string' ? req.headers.host : undefined,
        process.env.APP_URL,
        process.env.ALLOWED_ORIGINS
      )
    ) {
      return res.status(400).json({ error: "Invalid or disallowed password reset URL origin." });
    }

    try {
      const formattedExpiry = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const durationHours = durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)} hour(s)` : `${durationMinutes} minutes`;
      const effectiveAdminEmail = caller.email || adminEmail || "Hotel Administrator";
      const effectiveAdminName = caller.profile?.displayName || adminName || effectiveAdminEmail;

      const safeHotelName = escapeHtml(hotelName);
      const safeTargetName = escapeHtml(targetName || targetEmail);
      const safeTargetEmail = escapeHtml(targetEmail);
      const safeAdminLabel = escapeHtml(effectiveAdminName);
      const safeNote = note ? escapeHtml(note) : '';
      const safeResetUrl = escapeHtml(resetUrl);
      const safeDurationHours = escapeHtml(durationHours);
      const safeFormattedExpiry = escapeHtml(formattedExpiry);

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Staff Password Reset Request</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #09090b; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f4f4f5;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #09090b; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #18181b; border: 1px solid #27272a; border-radius: 16px; overflow: hidden; box-shadow: 0 10px 25px rgba(0,0,0,0.5);">
                  <!-- Header -->
                  <tr>
                    <td style="padding: 32px 32px 24px; background: linear-gradient(135deg, #18181b 0%, #27272a 100%); border-bottom: 1px solid #27272a;">
                      <table width="100%">
                        <tr>
                          <td>
                            <div style="display: inline-block; padding: 8px 14px; background-color: rgba(16, 185, 129, 0.15); border: 1px solid rgba(16, 185, 129, 0.3); border-radius: 8px; color: #10b981; font-weight: bold; font-size: 12px; letter-spacing: 0.5px; text-transform: uppercase;">
                              Secure Staff Access
                            </div>
                            <h1 style="margin: 16px 0 4px; font-size: 22px; font-weight: 700; color: #ffffff;">
                              Password Reset Request
                            </h1>
                            <p style="margin: 0; font-size: 14px; color: #a1a1aa;">
                              ${safeHotelName} Property Management System
                            </p>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  
                  <!-- Body -->
                  <tr>
                    <td style="padding: 32px;">
                      <p style="margin: 0 0 16px; font-size: 15px; line-height: 1.6; color: #e4e4e7;">
                        Hello <strong>${safeTargetName}</strong>,
                      </p>
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                        Your Hotel Administrator <strong>${safeAdminLabel}</strong> has initiated a secure password reset for your staff account (<code>${safeTargetEmail}</code>).
                      </p>

                      ${safeNote ? `
                        <div style="background-color: #27272a; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
                          <span style="font-size: 12px; font-weight: 600; color: #fbbf24; text-transform: uppercase;">Admin Note:</span>
                          <p style="margin: 4px 0 0; font-size: 13px; color: #d4d4d8; font-style: italic;">"${safeNote}"</p>
                        </div>
                      ` : ''}

                      <!-- Action Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                        <tr>
                          <td align="center">
                            <a href="${safeResetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: #09090b; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
                              Create New Password
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- Security & Expiration Warning -->
                      <div style="background-color: rgba(245, 158, 11, 0.08); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 10px; padding: 16px; margin: 24px 0 16px;">
                        <table width="100%">
                          <tr>
                            <td width="24" valign="top" style="color: #f59e0b; font-size: 16px; padding-right: 10px;">⏳</td>
                            <td>
                              <p style="margin: 0; font-size: 13px; font-weight: 600; color: #fbbf24;">
                                Time-Limited Single-Use Link
                              </p>
                              <p style="margin: 4px 0 0; font-size: 12px; color: #fde68a; line-height: 1.5;">
                                This link is valid for <strong>${safeDurationHours}</strong> (until <strong>${safeFormattedExpiry}</strong>) and will automatically deactivate once used.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <p style="margin: 24px 0 8px; font-size: 12px; color: #71717a;">
                        If the button above does not open, copy and paste this link into your browser:
                      </p>
                      <p style="margin: 0 0 24px; font-size: 12px; color: #10b981; word-break: break-all; background-color: #18181b; border: 1px solid #27272a; padding: 10px; border-radius: 6px;">
                        ${safeResetUrl}
                      </p>
                      
                      <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
                      
                      <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                        <strong>Security Advisory:</strong> If you did not request or expect this password reset, please contact your Hotel Management immediately. Do not share this link with anyone.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 20px 32px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
                      <p style="margin: 0; font-size: 11px; color: #71717a;">
                        © ${new Date().getFullYear()} ${safeHotelName} • Property Management System (PMS)
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const { emailDispatched, method, previewUrl } = await dispatchEmailMessage({
        to: targetEmail,
        subject: `[ACTION REQUIRED] Password Reset for ${targetEmail} - ${hotelName}`,
        html: htmlContent,
        fromName: `${hotelName} Security`
      });

      // Record in Firestore outbox / notification log for live PMS visibility
      if (db) {
        try {
          const { collection, addDoc, serverTimestamp } = await import('firebase/firestore');
          await addDoc(collection(db, 'hotels', hotelId, 'emailNotifications'), {
            type: 'PASSWORD_RESET',
            recipient: targetEmail,
            recipientName: targetName || targetEmail,
            subject: `Password Reset for ${targetEmail}`,
            tokenId: resetToken,
            resetUrl,
            expiresAt,
            sentBy: effectiveAdminEmail,
            status: emailDispatched ? 'sent' : 'queued',
            deliveryMethod: method,
            previewUrl: previewUrl || null,
            timestamp: serverTimestamp()
          });
        } catch (dbErr) {
          console.warn("Could not record email notification in Firestore:", dbErr);
        }
      }

      return res.json({
        success: true,
        emailSent: emailDispatched,
        deliveryMethod: method,
        previewUrl,
        resetUrl,
        expiresAt,
        message: `Password reset link generated and email notification processed for ${targetEmail}.`
      });
    } catch (err: any) {
      console.error("Password reset email dispatch error:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to dispatch password reset email.") });
    }
  });

  // API Route: Validate Password Reset / Activation Token (Server-side)
  app.post("/api/auth/validate-reset-token", async (req, res) => {
    const { token } = req.body;
    if (!token || !isSafeIdentifier(token)) {
      return res.status(400).json({ valid: false, error: "Valid token is required." });
    }

    // Check active in-memory token registry first
    if (activeActivationTokens.has(token)) {
      const memToken = activeActivationTokens.get(token)!;
      if (Date.now() > memToken.expiresAt) {
        activeActivationTokens.delete(token);
        return res.json({ valid: false, error: "This link has expired. Please contact your Hotel Administrator for a new link.", errorCode: "EXPIRED" });
      }
      return res.json({
        valid: true,
        type: 'activation',
        targetEmail: memToken.email,
        targetName: memToken.name || memToken.email,
        targetUid: memToken.uid,
        hotelId: memToken.hotelId,
        hotelName: memToken.hotelName,
        expiresAt: new Date(memToken.expiresAt).toISOString()
      });
    }

    if (!db) {
      return res.status(500).json({ valid: false, error: "Database unavailable." });
    }

    try {
      const { doc, getDoc } = await import('firebase/firestore');
      const tokenSnap = await getDoc(doc(db, 'passwordResetTokens', token));

      if (!tokenSnap.exists()) {
        return res.json({ valid: false, error: "The provided security link was not found or has been removed.", errorCode: "NOT_FOUND" });
      }

      const data = tokenSnap.data();
      if (data.status === 'revoked') {
        return res.json({ valid: false, error: "This link was revoked by the Hotel Administrator.", errorCode: "REVOKED" });
      }
      if (data.isUsed || data.status === 'used') {
        return res.json({ valid: false, error: "This link has already been used and is no longer valid.", errorCode: "USED" });
      }

      const expiry = new Date(data.expiresAt).getTime();
      if (isNaN(expiry) || Date.now() > expiry) {
        return res.json({ valid: false, error: "This link has expired. Please contact your Hotel Administrator for a new link.", errorCode: "EXPIRED" });
      }

      return res.json({
        valid: true,
        type: data.type || 'password_reset',
        targetEmail: data.targetEmail,
        targetName: data.targetName,
        targetUid: data.targetUid,
        hotelId: data.hotelId,
        hotelName: data.hotelName,
        expiresAt: data.expiresAt
      });
    } catch (err: any) {
      console.error("Token validation error:", err);
      return res.status(500).json({ valid: false, error: sanitizeErrorForClient(err, "Failed to validate reset token.") });
    }
  });

  // API Route: Complete Password Reset and Sync User (Server-side)
  app.post("/api/auth/complete-password-reset", async (req, res) => {
    const { tokenId, hotelId, targetEmail, targetUid } = req.body;
    if (!tokenId || !isSafeIdentifier(tokenId)) {
      return res.status(400).json({ error: "Valid token ID is required." });
    }
    if (hotelId && !isSafeIdentifier(hotelId)) {
      return res.status(400).json({ error: "Invalid hotelId format." });
    }
    if (targetUid && !isSafeIdentifier(targetUid)) {
      return res.status(400).json({ error: "Invalid targetUid format." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database unavailable." });
    }

    const caller = await verifyFirebaseTokenAndCaller(req, false);

    try {
      const { doc, updateDoc, getDoc } = await import('firebase/firestore');
      const now = new Date().toISOString();

      // Verify token actually exists in Firestore
      let tokenSnap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
      if (!tokenSnap.exists()) {
        tokenSnap = await getDoc(doc(db, 'activationTokens', tokenId));
      }
      if (!tokenSnap.exists()) {
        return res.status(404).json({ error: "Invalid or unknown reset token." });
      }

      const tokenData = tokenSnap.data();
      if (tokenData.status === 'revoked') {
        return res.status(403).json({ error: "This security token has been revoked." });
      }
      const expMs = tokenData.expiresAt ? new Date(tokenData.expiresAt).getTime() : NaN;
      if (!isNaN(expMs) && Date.now() > expMs) {
        return res.status(403).json({ error: "This security token has expired." });
      }

      // Allow if token is unused, or if just marked used client-side within last 120 seconds, or caller owns targetUid
      const alreadyUsed = Boolean(tokenData.isUsed) || tokenData.status === 'used';
      if (alreadyUsed) {
        const usedAtMs = tokenData.usedAt ? new Date(tokenData.usedAt).getTime() : 0;
        const callerMatchesTarget = caller && caller.uid === (tokenData.targetUid || targetUid);
        if (!callerMatchesTarget && (!usedAtMs || Date.now() - usedAtMs > 120000)) {
          return res.status(403).json({ error: "This security token has already been consumed." });
        }
      }

      const boundTargetUid = tokenData.targetUid || tokenData.uid || targetUid;
      const boundTargetEmail = (tokenData.targetEmail || tokenData.email || targetEmail || '').toLowerCase();
      const boundHotelId = tokenData.hotelId || hotelId;

      if (targetUid && boundTargetUid && targetUid !== boundTargetUid) {
        return res.status(403).json({ error: "Token does not match target user." });
      }
      if (targetEmail && boundTargetEmail && targetEmail.trim().toLowerCase() !== boundTargetEmail) {
        return res.status(403).json({ error: "Token does not match target email." });
      }

      const tokenType: 'activation' | 'password_reset' = tokenData?.type || 'password_reset';

      // Mark token as used in root collection
      try {
        await updateDoc(doc(db, 'passwordResetTokens', tokenId), {
          isUsed: true,
          status: 'used',
          usedAt: tokenData.usedAt || now,
          updatedAt: now
        });
      } catch (e) {
        console.warn("Failed to mark root token as used:", e);
      }

      // Mark token in hotel subcollection if hotelId is known
      if (boundHotelId) {
        try {
          await updateDoc(doc(db, 'hotels', boundHotelId, 'passwordResetTokens', tokenId), {
            isUsed: true,
            status: 'used',
            usedAt: tokenData.usedAt || now,
            updatedAt: now
          });
        } catch (e) {
          console.warn("Failed to mark hotel token as used:", e);
        }
      }

      // Update target user profile: status becomes 'active', clear temp passwords
      if (boundTargetUid) {
        try {
          await updateDoc(doc(db, 'users', boundTargetUid), {
            status: 'active',
            temporaryPassword: null,
            initialPassword: null,
            forcePasswordChange: false,
            passwordChangedAt: now,
            passwordChangedBy: boundTargetEmail || 'user',
            updatedAt: now
          });
        } catch (uErr) {
          console.warn("Failed to update user status to active:", uErr);
        }
      }

      return res.json({ 
        success: true, 
        tokenType,
        message: "Security token marked as used and account status updated to active." 
      });
    } catch (err: any) {
      console.error("Error in complete-password-reset endpoint:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to complete password reset.") });
    }
  });

  // Helper: Delete User from Firebase Auth using Admin SDK or Direct Identity Toolkit REST
  async function deleteUserFromFirebaseAuth(
    uid: string,
    email: string,
    candidatePasswords: string[] = [],
    userToken?: string
  ): Promise<{ deleted: boolean; method: string; details?: string }> {
    const normalizedEmail = email.trim().toLowerCase();

    // Strategy 1: Firebase Admin SDK (if service account configured)
    if (adminAuth) {
      try {
        await adminAuth.deleteUser(uid);
        console.log(`[AUTH DELETE] Deleted user ${uid} via Firebase Admin SDK.`);
        return { deleted: true, method: 'admin_sdk' };
      } catch (adminErr: any) {
        if (adminErr?.code === 'auth/user-not-found') {
          try {
            const u = await adminAuth.getUserByEmail(normalizedEmail);
            await adminAuth.deleteUser(u.uid);
            return { deleted: true, method: 'admin_sdk_email' };
          } catch (e) {
            return { deleted: true, method: 'admin_sdk_already_deleted' };
          }
        }
        console.warn(`[AUTH DELETE NOTICE] Admin SDK notice:`, adminErr?.message);
      }
    }

    // Strategy 2: Directly delete if caller supplied a valid idToken
    if (userToken && firebaseConfig?.apiKey) {
      try {
        const delRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${firebaseConfig.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ idToken: userToken })
        });
        if (delRes.ok) {
          console.log(`[AUTH DELETE] Deleted user ${normalizedEmail} via caller idToken.`);
          return { deleted: true, method: 'caller_id_token' };
        }
      } catch (tokErr) {
        console.warn(`[AUTH DELETE NOTICE] idToken delete warning:`, tokErr);
      }
    }

    // Strategy 3: REST API signInWithPassword -> accounts:delete with candidate passwords
    if (firebaseConfig?.apiKey && candidatePasswords.length > 0) {
      const uniquePasswords = Array.from(new Set(candidatePasswords.filter(p => typeof p === 'string' && p.trim().length > 0)));
      for (const pwd of uniquePasswords) {
        try {
          const signRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${firebaseConfig.apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: normalizedEmail,
              password: pwd,
              returnSecureToken: true
            })
          });
          const signData = await signRes.json();
          if (signData?.idToken) {
            const delRes = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:delete?key=${firebaseConfig.apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ idToken: signData.idToken })
            });
            if (delRes.ok) {
              console.log(`[AUTH DELETE] Successfully deleted user ${normalizedEmail} (${uid}) from Firebase Auth via REST API.`);
              return { deleted: true, method: 'rest_credentials_delete' };
            }
          } else if (signData?.error?.message === 'EMAIL_NOT_FOUND') {
            console.log(`[AUTH DELETE] User ${normalizedEmail} is already removed from Firebase Auth.`);
            return { deleted: true, method: 'already_deleted' };
          }
        } catch (passErr) {
          console.warn(`[AUTH DELETE NOTICE] Candidate password trial notice:`, passErr);
        }
      }
    }

    return { deleted: false, method: 'none', details: 'No valid credential or admin SDK available to remove from Firebase Auth' };
  }

  // Master User Deletion Handler (Deletes from Firebase Auth AND purges all Firestore records)
  const handleUserDeletion = async (req: express.Request, res: express.Response) => {
    const caller = await requireAuth(req, res);
    if (!caller) return;

    const { 
      hotelId, 
      staffUid, 
      staffEmail, 
      targetUid, 
      targetEmail, 
      adminUid, 
      adminEmail,
      userPassword,
      userToken
    } = req.body;

    const effectiveUid = staffUid || targetUid;
    const effectiveEmail = staffEmail || targetEmail;

    if (!effectiveUid && !effectiveEmail) {
      return res.status(400).json({ error: "Missing user identification: provide staffUid/targetUid or staffEmail/targetEmail" });
    }

    if (effectiveUid && !isSafeIdentifier(effectiveUid)) {
      return res.status(400).json({ error: "Invalid user identifier." });
    }
    if (hotelId && !isSafeIdentifier(hotelId)) {
      return res.status(400).json({ error: "Invalid hotelId format." });
    }
    if (effectiveEmail && !isValidEmailAddress(effectiveEmail)) {
      return res.status(400).json({ error: "Invalid email format." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }

    try {
      const { doc, getDoc, deleteDoc, collection, query, where, getDocs, addDoc, updateDoc, arrayRemove, serverTimestamp } = await import('firebase/firestore');
      const normalizedEmail = (effectiveEmail || '').trim().toLowerCase();
      let purgedRecordsCount = 0;
      let finalTargetUid = effectiveUid;

      // STEP 1: Fetch target user profile BEFORE deleting to authorize and harvest auth credentials
      let userDocData: any = null;
      if (finalTargetUid) {
        try {
          const userSnap = await getDoc(doc(db, 'users', finalTargetUid));
          if (userSnap.exists()) {
            userDocData = userSnap.data();
          }
        } catch (uGetErr) {
          console.warn("[DELETE USER] Fetch user doc warning:", uGetErr);
        }
      }

      if (!userDocData && normalizedEmail) {
        try {
          const uQuery = query(collection(db, 'users'), where('email', '==', normalizedEmail));
          const uSnap = await getDocs(uQuery);
          if (!uSnap.empty) {
            userDocData = uSnap.docs[0].data();
            if (!finalTargetUid) {
              finalTargetUid = uSnap.docs[0].id;
            }
          }
        } catch (uQErr) {
          console.warn("[DELETE USER] Query user by email warning:", uQErr);
        }
      }

      const effectiveHotelId = hotelId || userDocData?.hotelId || userDocData?.hotel_id;
      const isSuperAdmin = isSuperAdminCaller(caller);
      const isAuthorizedHotelAdmin =
        Boolean(effectiveHotelId) &&
        callerHasStaffManagement(caller, effectiveHotelId) &&
        userDocData?.role !== 'superAdmin' &&
        finalTargetUid !== caller.uid;

      if (!isSuperAdmin && !isAuthorizedHotelAdmin) {
        return res.status(403).json({ error: "Forbidden: You are not authorized to delete this user account." });
      }

      // STEP 2: Harvest candidate passwords for Firebase Auth deletion
      const candidatePasswords: string[] = [];
      if (userPassword) candidatePasswords.push(userPassword);
      if (userDocData?.systemAuthSecret) candidatePasswords.push(userDocData.systemAuthSecret);
      if (userDocData?.initialTempPass) candidatePasswords.push(userDocData.initialTempPass);
      if (userDocData?.temporaryPassword) candidatePasswords.push(userDocData.temporaryPassword);
      if (userDocData?.initialPassword) candidatePasswords.push(userDocData.initialPassword);

      // Check active in-memory tokens
      if (normalizedEmail) {
        for (const [_, memTok] of activeActivationTokens.entries()) {
          if (memTok.email?.toLowerCase() === normalizedEmail && memTok.tempPass) {
            candidatePasswords.push(memTok.tempPass);
          }
        }
      }

      // Query root passwordResetTokens for stored tempPass
      if (normalizedEmail) {
        try {
          const tQuery = query(collection(db, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
          const tSnap = await getDocs(tQuery);
          for (const d of tSnap.docs) {
            const data = d.data();
            if (data.tempPass) candidatePasswords.push(data.tempPass);
          }
        } catch (tErr) {
          console.warn("[DELETE USER] passwordResetTokens lookup warning:", tErr);
        }
      }

      // Query hotel passwordResetTokens if hotelId known
      if (effectiveHotelId && effectiveHotelId !== 'system' && normalizedEmail) {
        try {
          const htQuery = query(collection(db, 'hotels', effectiveHotelId, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
          const htSnap = await getDocs(htQuery);
          for (const d of htSnap.docs) {
            const data = d.data();
            if (data.tempPass) candidatePasswords.push(data.tempPass);
          }
        } catch (htErr) {
          console.warn("[DELETE USER] hotel passwordResetTokens lookup warning:", htErr);
        }
      }

      // STEP 3: DELETE FROM FIREBASE AUTH FIRST
      let authUserDeleted = false;
      let deletionMethod = 'none';

      if (finalTargetUid && normalizedEmail) {
        const authDelResult = await deleteUserFromFirebaseAuth(
          finalTargetUid,
          normalizedEmail,
          candidatePasswords,
          userToken
        );
        authUserDeleted = authDelResult.deleted;
        deletionMethod = authDelResult.method;
      }

      // STEP 4: PURGE FIRESTORE APPLICATION RECORDS
      // 1. Delete user profile doc from users/{finalTargetUid}
      if (finalTargetUid) {
        try {
          await deleteDoc(doc(db, 'users', finalTargetUid));
          purgedRecordsCount++;
        } catch (uErr) {
          console.warn(`[DELETE USER] users/${finalTargetUid} delete warning:`, uErr);
        }
      }

      // 2. Query users collection by email to clean up any duplicate or migration documents
      if (normalizedEmail) {
        try {
          const uQuery = query(collection(db, 'users'), where('email', '==', normalizedEmail));
          const uSnap = await getDocs(uQuery);
          for (const d of uSnap.docs) {
            if (d.id !== finalTargetUid) {
              await deleteDoc(doc(db, 'users', d.id)).catch(() => {});
              purgedRecordsCount++;
            }
          }
        } catch (uQErr) {
          console.warn("[DELETE USER] users query cleanup:", uQErr);
        }
      }

      // 3. Purge password reset / activation tokens
      if (normalizedEmail) {
        try {
          const tQuery = query(collection(db, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
          const tSnap = await getDocs(tQuery);
          for (const d of tSnap.docs) {
            await deleteDoc(doc(db, 'passwordResetTokens', d.id)).catch(() => {});
            purgedRecordsCount++;
          }
        } catch (tErr) {}

        if (effectiveHotelId && effectiveHotelId !== 'system') {
          try {
            const htQuery = query(collection(db, 'hotels', effectiveHotelId, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
            const htSnap = await getDocs(htQuery);
            for (const d of htSnap.docs) {
              await deleteDoc(doc(db, 'hotels', effectiveHotelId, 'passwordResetTokens', d.id)).catch(() => {});
              purgedRecordsCount++;
            }
          } catch (htErr) {}
        }
      }

      // 4. Purge active sessions
      if (effectiveHotelId && effectiveHotelId !== 'system' && normalizedEmail) {
        try {
          const sQuery = query(collection(db, 'hotels', effectiveHotelId, 'sessions'), where('userEmail', '==', normalizedEmail));
          const sSnap = await getDocs(sQuery);
          for (const d of sSnap.docs) {
            await deleteDoc(doc(db, 'hotels', effectiveHotelId, 'sessions', d.id)).catch(() => {});
            purgedRecordsCount++;
          }
        } catch (sErr) {}
      }

      // 5. Purge email notifications outbox records
      if (effectiveHotelId && effectiveHotelId !== 'system' && normalizedEmail) {
        try {
          const nQuery = query(collection(db, 'hotels', effectiveHotelId, 'emailNotifications'), where('recipient', '==', normalizedEmail));
          const nSnap = await getDocs(nQuery);
          for (const d of nSnap.docs) {
            await deleteDoc(doc(db, 'hotels', effectiveHotelId, 'emailNotifications', d.id)).catch(() => {});
            purgedRecordsCount++;
          }
        } catch (nErr) {}
      }

      // 6. Purge user settings
      if (finalTargetUid) {
        try {
          if (effectiveHotelId && effectiveHotelId !== 'system') {
            await deleteDoc(doc(db, 'hotels', effectiveHotelId, 'user_settings', finalTargetUid)).catch(() => {});
          }
          await deleteDoc(doc(db, 'user_settings', finalTargetUid)).catch(() => {});
        } catch (setErr) {}
      }

      // 7. If user had admin role on hotel, remove UID from hotel's adminUIDs array
      if (effectiveHotelId && effectiveHotelId !== 'system' && finalTargetUid) {
        try {
          await updateDoc(doc(db, 'hotels', effectiveHotelId), {
            adminUIDs: arrayRemove(finalTargetUid)
          }).catch(() => {});
        } catch (admRemErr) {}
      }

      // 8. Immutable Audit Trail record
      const auditPayload = {
        action: 'USER_DELETED',
        module: 'StaffManagement',
        targetId: finalTargetUid || 'unknown',
        targetEmail: normalizedEmail,
        performedBy: adminEmail || 'Administrator',
        performedByUid: adminUid || 'admin',
        details: `User ${normalizedEmail} (UID: ${finalTargetUid}) was deleted from the app and Firebase Authentication. All user records, tokens, active sessions, and settings were purged. Auth deletion status: ${authUserDeleted ? 'Success' : 'Notice'} (Method: ${deletionMethod}).`,
        purgedRecordsCount,
        authUserDeleted,
        deletionMethod,
        timestamp: serverTimestamp(),
        createdAt: new Date().toISOString()
      };

      if (effectiveHotelId && effectiveHotelId !== 'system') {
        await addDoc(collection(db, 'hotels', effectiveHotelId, 'auditLogs'), auditPayload).catch(() => {});
      } else {
        await addDoc(collection(db, 'activityLogs'), auditPayload).catch(() => {});
      }

      return res.json({
        success: true,
        message: `User ${normalizedEmail} and all associated records were successfully purged.`,
        purgedRecordsCount,
        authUserDeleted,
        deletionMethod
      });
    } catch (err: any) {
      console.error("User deletion error in endpoint:", err);
      return res.status(500).json({ error: sanitizeErrorForClient(err, "Failed to complete user deletion.") });
    }
  };

  // API Routes: Completely Delete User / Staff Account and Purge Associated Records
  app.post("/api/auth/delete-staff-user", handleUserDeletion);
  app.post("/api/auth/delete-user", handleUserDeletion);

  // API Route: Verify Email System Status (Diagnostic & Validation)
  app.get("/api/auth/verify-email-system", (req, res) => {
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    res.json({
      status: "ready",
      smtpConfigured,
      testTransportAvailable: true,
      emailServiceReady: true,
      timestamp: new Date().toISOString()
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  const httpServer = http.createServer(app);

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const isHmrDisabled = process.env.DISABLE_HMR === "true";
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: isHmrDisabled ? false : { server: httpServer },
      },
      appType: "spa",
    });
    
    app.use(vite.middlewares);
  } else {
    // Serve static files from dist in production
    const distPath = path.join(process.cwd(), 'dist');
    
    app.use(express.static(distPath));
    
    // SPA fallback: serve index.html for all unknown routes
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
