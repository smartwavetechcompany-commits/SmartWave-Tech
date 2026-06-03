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
