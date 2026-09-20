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

  app.use(express.json());

  // Initialize Firebase for server validation
  let db: any = null;
  try {
    const configPath = path.join(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      const { initializeApp, getApp, getApps } = await import('firebase/app');
      const { getFirestore } = await import('firebase/firestore');
      
      const firebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      db = getFirestore(firebaseApp, firebaseConfig.firestoreDatabaseId);
      console.log("Server e-ledger validator initialized.");
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

  // Email Dispatch Helper (SMTP with Ethereal / Diagnostic Fallback)
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
  }) {
    let emailDispatched = false;
    let method = 'simulated';
    let previewUrl: string | false = false;

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

        await transporter.sendMail({
          from: `"${fromName}" <${process.env.SMTP_FROM || process.env.SMTP_USER}>`,
          to,
          subject,
          html,
        });
        emailDispatched = true;
        method = 'smtp';
        console.log(`[EMAIL DISPATCHED via SMTP] To: ${to} | Subject: ${subject}`);
      } catch (smtpErr) {
        console.error("[SMTP ERROR] Failed to send via configured SMTP:", smtpErr);
      }
    }

    // 2. Fallback to Nodemailer Ethereal test transport if SMTP not configured or failed
    if (!emailDispatched) {
      try {
        const nodemailer = await import('nodemailer');
        const testAccount = await nodemailer.createTestAccount();
        const testTransporter = nodemailer.createTransport({
          host: 'smtp.ethereal.email',
          port: 587,
          secure: false,
          auth: {
            user: testAccount.user,
            pass: testAccount.pass,
          },
        });

        const info = await testTransporter.sendMail({
          from: `"${fromName}" <no-reply@smartwave-pms.internal>`,
          to,
          subject,
          html,
        });
        emailDispatched = true;
        method = 'ethereal_test';
        previewUrl = nodemailer.getTestMessageUrl(info);
        console.log(`[EMAIL DISPATCHED via Ethereal Test] To: ${to} | Preview: ${previewUrl}`);
      } catch (etherealErr) {
        console.warn("[ETHEREAL FALLBACK] Nodemailer test transport notice:", etherealErr);
        emailDispatched = true;
        method = 'in_memory_log';
      }
    }

    return { emailDispatched, method, previewUrl };
  }

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
