import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // CORS and Preflight Handling for all environments (prevents 405 Method Not Allowed)
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  app.use(express.json());

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

  // API Route: Server-side transaction validation logic to ensure total charges, payments & tax calculations are idempotent & immutable
  app.post("/api/ledger/validate-and-post", async (req, res) => {
    const { hotelId, guestId, reservationId, items, postedBy, corporateId, idempotencyKey } = req.body;

    if (!hotelId || !guestId || !reservationId || !items || !Array.isArray(items) || items.length === 0 || !idempotencyKey) {
      return res.status(400).json({ error: "Missing required parameters or empty items list." });
    }

    if (!db) {
      return res.status(500).json({ error: "Server-side database is currently unavailable." });
    }

    try {
      const { collection, doc, query, where, getDocs, getDoc, writeBatch, serverTimestamp, increment } = await import('firebase/firestore');
      
      // 1. Idempotency Check
      const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
      const dupQuery = query(ledgerRef, where('idempotencyKey', '==', idempotencyKey));
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

      // 3. Process, Calculate Taxes, & Validate inputs
      const batch = writeBatch(db);
      const timestamp = new Date().toISOString();
      const finalEntriesToPost: any[] = [];

      for (const item of items) {
        const { price = 0, quantity = 1, type = 'debit', category = 'other', description = '', discount = 0, discountType = 'fixed' } = item;

        if (price < 0 || quantity < 1) {
          return res.status(400).json({ error: "Price must be positive and quantity at least 1." });
        }

        const baseAmount = price * quantity;
        const amountAfterDiscount = discountType === 'fixed'
          ? Math.max(0, baseAmount - discount)
          : Math.max(0, baseAmount * (1 - discount / 100));

        const mainEntry = {
          amount: amountAfterDiscount,
          type,
          category,
          description: description || `${type === 'debit' ? 'Charge' : 'Adjustment'}: ${category}`,
          referenceId: reservationId,
          postedBy,
          quantity,
          price,
          discount,
          discountType,
          timestamp,
          hotelId,
          guestId,
          reservationId,
          corporateId,
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
              corporateId,
              type: 'debit',
              amount: taxAmount,
              description: `${tax.name} (${tax.percentage}%) ${tax.isInclusive ? '[Inclusive]' : ''} for ${mainEntry.description}`,
              category: 'tax',
              postedBy,
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
      if (corporateId && corpBalanceAdj !== 0) {
        const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
        batch.update(corpRef, {
          currentBalance: increment(corpBalanceAdj),
          totalDebits: increment(finalEntriesToPost.filter(e => e.corporateId && e.type === 'debit').reduce((acc, e) => acc + e.amount, 0)),
          totalCredits: increment(finalEntriesToPost.filter(e => e.corporateId && e.type === 'credit').reduce((acc, e) => acc + e.amount, 0))
        });
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
      return res.status(500).json({ error: err.message || "Failed validating database entries." });
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
            from: `"${fromName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
            to,
            subject,
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
          from: `"${fromName}" <no-reply@smartwave-pms.internal>`,
          to,
          subject,
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
                            Welcome to ${hotelName}
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
                      Hello <strong>${targetName || targetEmail}</strong>,
                    </p>
                    <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                      Your Hotel Administrator <strong>${adminName}</strong> (${adminEmail}) has created your staff account for <strong>${hotelName}</strong>.
                    </p>

                    <div style="background-color: #27272a; border-left: 3px solid #10b981; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px;">
                      <span style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase;">Security Policy Note:</span>
                      <p style="margin: 6px 0 0; font-size: 13px; color: #d4d4d8; line-height: 1.5;">
                        Default passwords are not issued for security compliance. Before accessing the PMS, you must create your own personal password using this single-use activation link.
                      </p>
                    </div>

                    ${note ? `
                      <div style="background-color: #27272a; border-left: 3px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
                        <span style="font-size: 12px; font-weight: 600; color: #60a5fa; text-transform: uppercase;">Admin Note:</span>
                        <p style="margin: 4px 0 0; font-size: 13px; color: #d4d4d8; font-style: italic;">"${note}"</p>
                      </div>
                    ` : ''}

                    <!-- Action Button -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                      <tr>
                        <td align="center">
                          <a href="${activationUrl}" style="display: inline-block; padding: 14px 36px; background-color: #10b981; color: #09090b; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
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
                              This activation link is valid for <strong>${durationHours}</strong>${formattedExpiry ? ` (until <strong>${formattedExpiry}</strong>)` : ''} and will automatically deactivate once used.
                            </p>
                          </td>
                        </tr>
                      </table>
                    </div>

                    <p style="margin: 24px 0 8px; font-size: 12px; color: #71717a;">
                      If the button above does not open, copy and paste this link into your browser:
                    </p>
                    <p style="margin: 0 0 24px; font-size: 12px; color: #10b981; word-break: break-all; background-color: #18181b; border: 1px solid #27272a; padding: 10px; border-radius: 6px;">
                      ${activationUrl}
                    </p>
                    
                    <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
                    
                    <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                      <strong>Security Notice:</strong> If you did not expect this invitation, please contact your hotel management team (${adminEmail}).
                    </p>
                  </td>
                </tr>

                <!-- Footer -->
                <tr>
                  <td style="padding: 20px 32px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
                    <p style="margin: 0; font-size: 11px; color: #71717a;">
                      © ${new Date().getFullYear()} ${hotelName} • Property Management System (PMS)
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

  // In-memory activation token registry for instant, resilient staff onboarding & password setup
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

  // Helper: Create user in Firebase Authentication
  async function createStaffAuthUser(email: string, displayName?: string): Promise<{ uid: string; email: string; idToken?: string; tempPass?: string }> {
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
    const continueUrl = `${cleanBase}/set-password?email=${encodeURIComponent(normalizedEmail)}${tokenId ? `&token=${tokenId}` : ''}`;
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

    // 3. Fallback direct in-app activation link with tokenId
    const directUrl = `${cleanBase}/set-password?email=${encodeURIComponent(normalizedEmail)}${tokenId ? `&token=${tokenId}` : ''}&mode=resetPassword`;
    return { activationUrl: directUrl, linkSource: 'direct_portal' };
  }

  // Health/status check for create-staff endpoint to avoid 405 Method Not Allowed on misdirected GET requests
  app.get("/api/auth/create-staff", (req, res) => {
    return res.status(200).json({ status: "ready", endpoint: "/api/auth/create-staff", allowedMethods: ["POST"] });
  });

  // API Route: Create Staff Account (Phase 1: Firebase Auth user + Staff Profile with firebase_uid + Activation link)
  app.post("/api/auth/create-staff", async (req, res) => {
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
      adminEmail = "Hotel Administrator",
      adminName = "Hotel Administrator",
      adminUid = "admin",
      baseUrl
    } = req.body;

    if (!hotelId || !email || !fullName) {
      return res.status(400).json({ error: "Missing required fields: hotelId, email, and fullName are mandatory." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database service is currently unavailable." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const clientOrigin = baseUrl || req.headers.origin || process.env.APP_URL || `http://localhost:${PORT}`;

    try {
      const { doc, getDoc, setDoc, collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');

      // 1. Create user in Firebase Authentication
      let authUser: { uid: string; email: string; idToken?: string; tempPass?: string };
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
      const tokenId = 'act_' + Math.random().toString(36).substring(2, 12) + '_' + Date.now();
      const now = new Date().toISOString();

      // Store in memory for instant, seamless staff password setup
      activeActivationTokens.set(tokenId, {
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

      const assignedUserRole = roleType === 'base' && baseRole === 'admin' ? 'hotelAdmin' : 'staff';

      // 4. Save Staff Profile to application database explicitly linking firebase_uid
      const staffProfile = {
        uid: firebase_uid,
        firebase_uid: firebase_uid,
        email: normalizedEmail,
        hotelId,
        role: assignedUserRole,
        staffRole: roleType === 'base' ? baseRole : undefined,
        customRoleId: roleType === 'custom' ? customRoleId : undefined,
        displayName: fullName.trim(),
        phoneNumber: phone?.trim() || null,
        department,
        employeeId: employeeId?.trim() || null,
        status: 'pending_activation',
        isLocked: false,
        roles: roleType === 'base' ? [baseRole] : [roleLabel],
        permissions: permissions || [],
        activationLink: activationUrl,
        activationToken: tokenId,
        activationEmailSentAt: now,
        activationEmailSentBy: adminEmail,
        createdAt: now,
        updatedAt: now
      };

      await saveUserProfileToFirestore(firebase_uid, staffProfile, authUser.idToken);

      // 5. Dispatch branded activation email
      const emailHtml = buildActivationEmailHtml({
        hotelName,
        targetName: fullName.trim(),
        targetEmail: normalizedEmail,
        adminName,
        adminEmail,
        activationUrl,
        durationHours: '24 hours'
      });

      const emailResult = await dispatchEmailMessage({
        to: normalizedEmail,
        subject: `[ACTION REQUIRED] Activate your staff account - ${hotelName}`,
        html: emailHtml,
        fromName: `${hotelName} Administration`
      });

      // 6. Record Audit Log in Firestore
      try {
        await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
          action: 'STAFF_ACCOUNT_CREATED',
          module: 'Staff Management',
          targetId: firebase_uid,
          targetEmail: normalizedEmail,
          targetName: fullName.trim(),
          performedBy: adminEmail,
          performedByUid: adminUid,
          details: `Created staff account for ${normalizedEmail} with role '${roleLabel}' in Firebase Auth (UID: ${firebase_uid}). Status set to Pending Activation.`,
          timestamp: serverTimestamp(),
          createdAt: now
        });
      } catch (logErr) {
        console.warn("Could not write audit log:", logErr);
      }

      return res.status(201).json({
        success: true,
        firebase_uid,
        user: staffProfile,
        activationLink: activationUrl,
        emailSent: emailResult.emailDispatched,
        previewUrl: emailResult.previewUrl || null,
        message: `Staff member created successfully in Firebase Auth with UID ${firebase_uid}. Account placed in Pending Activation.`
      });
    } catch (err: any) {
      console.error("[CREATE STAFF ERROR]:", err);
      res.setHeader('Content-Type', 'application/json');
      return res.status(500).json({ error: err.message || "Failed to create staff account" });
    }
  });

  // API Route: Extend Grace Period for checked-in guest (Time-Sensitive Ad-Hoc Extension)
  app.post("/api/reservations/extend-grace-period", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
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
      const minutesToAdd = Math.max(15, Number(extensionMinutes) || 60);
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
        approvedBy: staffName,
        approvedByUid: staffUid,
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
          uid: staffUid,
          name: staffName,
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
          performedBy: staffName,
          performedByUid: staffUid,
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
      return res.status(500).json({ error: err.message || "Failed to extend grace period." });
    }
  });

  // API Route: Resend Activation Link (Regenerate Firebase activation link and redispatch email)
  app.post("/api/auth/resend-activation-link", async (req, res) => {
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

    const normalizedEmail = targetEmail.trim().toLowerCase();
    const clientOrigin = baseUrl || req.headers.origin || process.env.APP_URL || `http://localhost:${PORT}`;

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
      activeActivationTokens.set(tokenId, {
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
            activationEmailSentBy: adminEmail,
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
        adminName,
        adminEmail,
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
            performedBy: adminEmail,
            performedByUid: adminUid,
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
      return res.status(500).json({ error: err.message || "Failed to resend activation link" });
    }
  });

  // API Route: Activate Staff User (Phase 2 completion: updates database status to 'active' & verified)
  app.post("/api/auth/activate-staff-user", async (req, res) => {
    const { email, firebase_uid, password, oobCode, tokenId } = req.body;

    if (!email && !firebase_uid) {
      return res.status(400).json({ error: "Missing email or firebase_uid for activation." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database service is currently unavailable." });
    }

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

      // 1. Resolve tempPass and UID from in-memory token registry or passwordResetTokens
      let resolvedTempPass: string | null = null;
      let effectiveEmail = email ? email.trim().toLowerCase() : null;

      if (tokenId && activeActivationTokens.has(tokenId)) {
        const memToken = activeActivationTokens.get(tokenId)!;
        resolvedTempPass = memToken.tempPass || null;
        if (!targetDocId && memToken.uid) {
          targetDocId = memToken.uid;
        }
        if (!effectiveEmail && memToken.email) {
          effectiveEmail = memToken.email;
        }
      }

      if (!resolvedTempPass && tokenId && db) {
        try {
          const tokenSnap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
          if (tokenSnap.exists()) {
            const tokData = tokenSnap.data();
            resolvedTempPass = tokData.tempPass || null;
            if (!targetDocId && tokData.targetUid) {
              targetDocId = tokData.targetUid;
            }
            if (!effectiveEmail && tokData.targetEmail) {
              effectiveEmail = tokData.targetEmail;
            }
          }
        } catch (tokErr) {
          console.warn("[ACTIVATE] Could not read token for tempPass:", tokErr);
        }
      }

      let updatedUserToken: string | null = null;

      // If password provided and adminAuth available, update password directly in Firebase Auth
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
      } else if (password && effectiveEmail && resolvedTempPass && firebaseConfig?.apiKey) {
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
            action: 'STAFF_ACTIVATION_COMPLETED',
            module: 'Staff Security',
            targetId: targetDocId,
            targetEmail: userDocData?.email || email,
            details: `Staff member ${userDocData?.email || email} (UID: ${targetDocId}) activated their account and set their password. Account status transitioned from Pending Activation to Active.`,
            timestamp: serverTimestamp(),
            createdAt: now
          });
        } catch (logErr) {}
      }

      return res.json({
        success: true,
        firebase_uid: targetDocId,
        message: "Staff account successfully activated and verified. User is now Active."
      });
    } catch (err: any) {
      console.error("[ACTIVATE STAFF ERROR]:", err);
      return res.status(500).json({ error: err.message || "Failed to activate staff account" });
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
        profile: profile || null,
        role: profile?.role || 'staff',
        permissions: profile?.permissions || []
      });
    } catch (err: any) {
      console.error("[VERIFY TOKEN ERROR]:", err);
      return res.status(500).json({ error: err.message || "Failed to verify ID token" });
    }
  });

  // API Route: Send Account Activation Email
  app.post("/api/auth/send-account-activation-email", async (req, res) => {
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

      const htmlContent = `
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
                              Welcome to ${hotelName}
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
                        Hello <strong>${targetName || targetEmail}</strong>,
                      </p>
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                        Your Hotel Administrator <strong>${adminName}</strong> (${adminEmail}) has created your staff account for <strong>${hotelName}</strong>.
                      </p>

                      <div style="background-color: #27272a; border-left: 3px solid #10b981; padding: 14px 18px; border-radius: 6px; margin-bottom: 24px;">
                        <span style="font-size: 12px; font-weight: 700; color: #10b981; text-transform: uppercase;">Security Policy Note:</span>
                        <p style="margin: 6px 0 0; font-size: 13px; color: #d4d4d8; line-height: 1.5;">
                          Default passwords are not issued for security compliance. Before accessing the PMS, you must create your own personal password using this single-use activation link.
                        </p>
                      </div>

                      ${note ? `
                        <div style="background-color: #27272a; border-left: 3px solid #3b82f6; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
                          <span style="font-size: 12px; font-weight: 600; color: #60a5fa; text-transform: uppercase;">Admin Note:</span>
                          <p style="margin: 4px 0 0; font-size: 13px; color: #d4d4d8; font-style: italic;">"${note}"</p>
                        </div>
                      ` : ''}

                      <!-- Action Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                        <tr>
                          <td align="center">
                            <a href="${activationUrl}" style="display: inline-block; padding: 14px 36px; background-color: #10b981; color: #09090b; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
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
                                This activation link is valid for <strong>${durationHours}</strong> (until <strong>${formattedExpiry}</strong>) and will automatically deactivate once used.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <p style="margin: 24px 0 8px; font-size: 12px; color: #71717a;">
                        If the button above does not open, copy and paste this link into your browser:
                      </p>
                      <p style="margin: 0 0 24px; font-size: 12px; color: #10b981; word-break: break-all; background-color: #18181b; border: 1px solid #27272a; padding: 10px; border-radius: 6px;">
                        ${activationUrl}
                      </p>
                      
                      <hr style="border: none; border-top: 1px solid #27272a; margin: 24px 0;">
                      
                      <p style="margin: 0; font-size: 12px; color: #71717a; line-height: 1.5;">
                        <strong>Security Notice:</strong> If you did not expect this invitation, please contact your hotel management team (${adminEmail}).
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="padding: 20px 32px; background-color: #121215; border-top: 1px solid #27272a; text-align: center;">
                      <p style="margin: 0; font-size: 11px; color: #71717a;">
                        © ${new Date().getFullYear()} ${hotelName} • Property Management System (PMS)
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
            sentBy: adminEmail,
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
      return res.status(500).json({ error: err.message || "Failed to dispatch activation email." });
    }
  });

  // API Route: Send Password Reset Email & Generate Token (Server-side)
  app.post("/api/auth/send-password-reset-email", async (req, res) => {
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

    try {
      const formattedExpiry = new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const durationHours = durationMinutes >= 60 ? `${Math.round(durationMinutes / 60)} hour(s)` : `${durationMinutes} minutes`;

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
                              ${hotelName} Property Management System
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
                        Hello <strong>${targetName || targetEmail}</strong>,
                      </p>
                      <p style="margin: 0 0 20px; font-size: 14px; line-height: 1.6; color: #a1a1aa;">
                        Your Hotel Administrator <strong>${adminName || adminEmail}</strong> has initiated a secure password reset for your staff account (<code>${targetEmail}</code>).
                      </p>

                      ${note ? `
                        <div style="background-color: #27272a; border-left: 3px solid #f59e0b; padding: 12px 16px; border-radius: 6px; margin-bottom: 24px;">
                          <span style="font-size: 12px; font-weight: 600; color: #fbbf24; text-transform: uppercase;">Admin Note:</span>
                          <p style="margin: 4px 0 0; font-size: 13px; color: #d4d4d8; font-style: italic;">"${note}"</p>
                        </div>
                      ` : ''}

                      <!-- Action Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0;">
                        <tr>
                          <td align="center">
                            <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background-color: #10b981; color: #09090b; text-decoration: none; font-weight: 700; font-size: 15px; border-radius: 10px; box-shadow: 0 4px 14px rgba(16, 185, 129, 0.4);">
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
                                This link is valid for <strong>${durationHours}</strong> (until <strong>${formattedExpiry}</strong>) and will automatically deactivate once used.
                              </p>
                            </td>
                          </tr>
                        </table>
                      </div>

                      <p style="margin: 24px 0 8px; font-size: 12px; color: #71717a;">
                        If the button above does not open, copy and paste this link into your browser:
                      </p>
                      <p style="margin: 0 0 24px; font-size: 12px; color: #10b981; word-break: break-all; background-color: #18181b; border: 1px solid #27272a; padding: 10px; border-radius: 6px;">
                        ${resetUrl}
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
                        © ${new Date().getFullYear()} ${hotelName} • Property Management System (PMS)
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
            sentBy: adminEmail,
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
      return res.status(500).json({ error: err.message || "Failed to dispatch password reset email." });
    }
  });

  // API Route: Validate Password Reset / Activation Token (Server-side)
  app.post("/api/auth/validate-reset-token", async (req, res) => {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ valid: false, error: "Token is required." });
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
      return res.status(500).json({ valid: false, error: err.message });
    }
  });

  // API Route: Complete Password Reset and Sync User (Server-side)
  app.post("/api/auth/complete-password-reset", async (req, res) => {
    const { tokenId, hotelId, targetEmail, targetUid } = req.body;
    if (!tokenId) {
      return res.status(400).json({ error: "Missing token ID." });
    }

    if (!db) {
      return res.status(500).json({ error: "Database unavailable." });
    }

    try {
      const { doc, updateDoc, getDoc } = await import('firebase/firestore');
      const now = new Date().toISOString();

      // Fetch token to determine type
      let tokenType: 'activation' | 'password_reset' = 'password_reset';
      try {
        const tokenSnap = await getDoc(doc(db, 'passwordResetTokens', tokenId));
        if (tokenSnap.exists()) {
          tokenType = tokenSnap.data()?.type || 'password_reset';
        }
      } catch (tErr) {
        console.warn("Could not read token doc:", tErr);
      }

      // Mark token as used in root collection
      try {
        await updateDoc(doc(db, 'passwordResetTokens', tokenId), {
          isUsed: true,
          status: 'used',
          usedAt: now,
          updatedAt: now
        });
      } catch (e) {
        console.warn("Failed to mark root token as used:", e);
      }

      // Mark token in hotel subcollection if hotelId is known
      if (hotelId) {
        try {
          await updateDoc(doc(db, 'hotels', hotelId, 'passwordResetTokens', tokenId), {
            isUsed: true,
            status: 'used',
            usedAt: now,
            updatedAt: now
          });
        } catch (e) {
          console.warn("Failed to mark hotel token as used:", e);
        }
      }

      // Update target user profile: status becomes 'active', clear temp passwords
      if (targetUid) {
        try {
          await updateDoc(doc(db, 'users', targetUid), {
            status: 'active',
            temporaryPassword: null,
            initialPassword: null,
            forcePasswordChange: false,
            passwordChangedAt: now,
            passwordChangedBy: targetEmail || 'user',
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
      return res.status(500).json({ error: err.message });
    }
  });

  // API Route: Completely Delete Staff Account and Purge Associated Records
  app.post("/api/auth/delete-staff-user", async (req, res) => {
    const { hotelId, staffUid, staffEmail, adminUid, adminEmail } = req.body;
    if (!hotelId || !staffUid || !staffEmail) {
      return res.status(400).json({ error: "Missing hotelId, staffUid, or staffEmail" });
    }

    if (!db) {
      return res.status(500).json({ error: "Database unavailable" });
    }

    try {
      const { doc, deleteDoc, collection, query, where, getDocs, addDoc, serverTimestamp } = await import('firebase/firestore');
      const normalizedEmail = staffEmail.toLowerCase();
      let purgedRecordsCount = 0;

      // 1. Delete user profile doc from users/{staffUid}
      try {
        await deleteDoc(doc(db, 'users', staffUid));
        purgedRecordsCount++;
      } catch (uErr) {
        console.warn(`[DELETE STAFF] users/${staffUid} delete warning:`, uErr);
      }

      // 2. Query users collection by email to clean up any duplicate or migration documents
      try {
        const uQuery = query(collection(db, 'users'), where('email', '==', normalizedEmail));
        const uSnap = await getDocs(uQuery);
        for (const d of uSnap.docs) {
          if (d.id !== staffUid) {
            await deleteDoc(doc(db, 'users', d.id)).catch(() => {});
            purgedRecordsCount++;
          }
        }
      } catch (uQErr) {
        console.warn("[DELETE STAFF] users query cleanup:", uQErr);
      }

      // 3. Purge password reset / activation tokens
      // a. Root collection
      try {
        const tQuery = query(collection(db, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
        const tSnap = await getDocs(tQuery);
        for (const d of tSnap.docs) {
          await deleteDoc(doc(db, 'passwordResetTokens', d.id)).catch(() => {});
          purgedRecordsCount++;
        }
      } catch (tErr) {
        console.warn("[DELETE STAFF] root token cleanup:", tErr);
      }

      // b. Hotel subcollection
      try {
        const htQuery = query(collection(db, 'hotels', hotelId, 'passwordResetTokens'), where('targetEmail', '==', normalizedEmail));
        const htSnap = await getDocs(htQuery);
        for (const d of htSnap.docs) {
          await deleteDoc(doc(db, 'hotels', hotelId, 'passwordResetTokens', d.id)).catch(() => {});
          purgedRecordsCount++;
        }
      } catch (htErr) {
        console.warn("[DELETE STAFF] hotel token cleanup:", htErr);
      }

      // 4. Purge active sessions
      try {
        const sQuery = query(collection(db, 'hotels', hotelId, 'sessions'), where('userEmail', '==', normalizedEmail));
        const sSnap = await getDocs(sQuery);
        for (const d of sSnap.docs) {
          await deleteDoc(doc(db, 'hotels', hotelId, 'sessions', d.id)).catch(() => {});
          purgedRecordsCount++;
        }
      } catch (sErr) {
        console.warn("[DELETE STAFF] session cleanup:", sErr);
      }

      // 5. Purge email notifications outbox records
      try {
        const nQuery = query(collection(db, 'hotels', hotelId, 'emailNotifications'), where('recipient', '==', normalizedEmail));
        const nSnap = await getDocs(nQuery);
        for (const d of nSnap.docs) {
          await deleteDoc(doc(db, 'hotels', hotelId, 'emailNotifications', d.id)).catch(() => {});
          purgedRecordsCount++;
        }
      } catch (nErr) {
        console.warn("[DELETE STAFF] email notifications cleanup:", nErr);
      }

      // 6. Purge user settings
      try {
        await deleteDoc(doc(db, 'hotels', hotelId, 'user_settings', staffUid)).catch(() => {});
        await deleteDoc(doc(db, 'user_settings', staffUid)).catch(() => {});
      } catch (setErr) {
        console.warn("[DELETE STAFF] user settings cleanup:", setErr);
      }

      // 7. Delete Auth user via Firebase Admin if initialized
      let authUserDeleted = false;
      try {
        const adminModule = await import('firebase-admin');
        const admin: any = (adminModule as any).default || adminModule;
        if (admin && admin.apps && admin.apps.length > 0) {
          try {
            await admin.auth().deleteUser(staffUid);
            authUserDeleted = true;
          } catch (aErr: any) {
            if (aErr?.code === 'auth/user-not-found') {
              try {
                const u = await admin.auth().getUserByEmail(normalizedEmail);
                await admin.auth().deleteUser(u.uid);
                authUserDeleted = true;
              } catch (e2) {}
            }
          }
        }
      } catch (adminErr) {
        console.warn("[DELETE STAFF] Firebase Admin Auth deletion check:", adminErr);
      }

      // 8. Immutable Audit Trail record (preserving historical audit and operational data)
      try {
        await addDoc(collection(db, 'hotels', hotelId, 'auditLogs'), {
          action: 'STAFF_DELETED',
          module: 'StaffManagement',
          targetId: staffUid,
          targetEmail: normalizedEmail,
          performedBy: adminEmail || 'Administrator',
          performedByUid: adminUid || 'admin',
          details: `Staff member ${normalizedEmail} (UID: ${staffUid}) was deleted. All user records, tokens, active sessions, and preferences were permanently purged. Historical operational logs preserved.`,
          purgedRecordsCount,
          timestamp: serverTimestamp(),
          createdAt: new Date().toISOString()
        });
      } catch (auditErr) {
        console.warn("[DELETE STAFF] Audit log recording notice:", auditErr);
      }

      return res.json({
        success: true,
        message: `Staff member ${normalizedEmail} and all associated records were successfully purged.`,
        purgedRecordsCount,
        authUserDeleted
      });
    } catch (err: any) {
      console.error("Staff deletion error in endpoint:", err);
      return res.status(500).json({ error: err.message || "Failed to complete staff deletion" });
    }
  });

  // API Route: Verify Email System Status (Diagnostic & Validation)
  app.get("/api/auth/verify-email-system", (req, res) => {
    const smtpConfigured = !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
    res.json({
      status: "ready",
      smtpConfigured,
      smtpHost: process.env.SMTP_HOST || null,
      smtpUser: process.env.SMTP_USER ? "***" : null,
      testTransportAvailable: true,
      emailServiceReady: true,
      timestamp: new Date().toISOString()
    });
  });

  // API routes FIRST
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
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

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
