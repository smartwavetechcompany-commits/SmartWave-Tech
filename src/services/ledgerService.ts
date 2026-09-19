import { db } from '../firebase';
import { doc, increment, collection, getDoc, query, where, getDocs, deleteDoc, writeBatch, serverTimestamp, updateDoc } from 'firebase/firestore';
import { LedgerEntry, Reservation, FinanceRecord, Hotel } from '../types';
import { database, createAuditLog } from '../utils/database';
import { addDays, format } from 'date-fns';
import { parseLocalDateTime, BillingService, BillingEngine } from '../utils/billingEngine';
import { calculateStayDuration } from '../utils/dateUtils';

import { validateLedgerTransaction, calculateGuestFinancialPosition } from './financialService';

export const postToLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'hotelId' | 'guestId' | 'reservationId'>,
  postedBy: string,
  corporateId?: string,
  paymentMethod: 'cash' | 'card' | 'transfer' = 'cash'
) => {
  // STRICT FINANCIAL INTEGRITY CHECK: Reject any attempt to post projections, forecasts, previews, or virtual entries to live ledger
  const validation = validateLedgerTransaction(entry as any);
  if (!validation.isValid) {
    console.error('REJECTED LEDGER TRANSACTION:', validation.reason, entry);
    throw new Error(validation.reason || 'Projections, forecasts, previews, and simulations cannot modify the live ledger.');
  }

  // 0. Prevent duplicate room / overstay charges with robust multi-field idempotency
  const q = query(
    collection(db, 'hotels', hotelId, 'ledger'),
    where('reservationId', '==', reservationId)
  );
  const querySnap = await getDocs(q);

  if (entry.type === 'debit' && (entry.category === 'room' || entry.chargeType === 'room_rate' || entry.chargeType === 'overstay')) {
    const targetStartDay = entry.chargePeriodStart ? format(new Date(entry.chargePeriodStart), 'yyyy-MM-dd') : null;
    const targetEndDay = entry.chargePeriodEnd ? format(new Date(entry.chargePeriodEnd), 'yyyy-MM-dd') : null;

    const exists = querySnap.docs.some(doc => {
      const e = doc.data() as LedgerEntry;
      if (e.type !== 'debit') return false;
      if (e.category !== 'room' && e.chargeType !== 'room_rate' && e.chargeType !== 'overstay') return false;

      // Match by deterministic reference ID (e.g. resId_NIGHT_1 or resId_OVERSTAY_1)
      if (entry.referenceId && e.referenceId && e.referenceId === entry.referenceId) {
        return true;
      }

      // Match by exact charge period
      if (targetStartDay && targetEndDay && e.chargePeriodStart && e.chargePeriodEnd) {
        const eStartDay = format(new Date(e.chargePeriodStart), 'yyyy-MM-dd');
        const eEndDay = format(new Date(e.chargePeriodEnd), 'yyyy-MM-dd');
        if (eStartDay === targetStartDay && eEndDay === targetEndDay) return true;
      }

      // Match by start day and charge type
      if (targetStartDay && e.chargePeriodStart && e.chargeType === entry.chargeType) {
        const eStartDay = format(new Date(e.chargePeriodStart), 'yyyy-MM-dd');
        if (eStartDay === targetStartDay) return true;
      }

      // Match by identical description
      if (e.description && entry.description && e.description.trim() === entry.description.trim()) {
        return true;
      }

      // Match by date substring within description (e.g. "Night of Sep 07, 2026")
      if (entry.description && e.description) {
        const dateMatchTarget = entry.description.match(/Night of\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/);
        const dateMatchExisting = e.description.match(/Night of\s+([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/);
        if (dateMatchTarget && dateMatchExisting && dateMatchTarget[1] === dateMatchExisting[1]) {
          // If both represent the same night (base or overstay), skip
          if ((entry.chargeType === 'overstay' || entry.description.includes('Overstay')) === 
              (e.chargeType === 'overstay' || e.description.includes('Overstay'))) {
            return true;
          }
        }
      }

      return false;
    });

    if (exists) {
      console.warn(`Duplicate room charge skipped for reservation ${reservationId}: "${entry.description}"`);
      return;
    }
  }

  // Resolve finalCorporateId if not specified for a payment, and fetch hotel tax setup in parallel
  let finalCorporateId = corporateId;
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const hotelRef = doc(db, 'hotels', hotelId);

  const shouldFetchHotel = entry.type === 'debit' && entry.category !== 'tax' && entry.category !== 'payment';
  
  const [resSnap, hotelSnap] = await Promise.all([
    getDoc(resRef),
    shouldFetchHotel ? getDoc(hotelRef) : Promise.resolve(null)
  ]);

  if (!finalCorporateId && entry.category === 'payment' && entry.type === 'credit') {
    if (resSnap.exists()) {
      const resData = resSnap.data() as Reservation;
      if (resData.corporateId) {
        finalCorporateId = resData.corporateId;
      } else {
        // Query to see if there is any city ledger debit transfer entry
        const q = query(
          collection(db, 'hotels', hotelId, 'ledger'),
          where('reservationId', '==', reservationId)
        );
        const querySnap = await getDocs(q);
        const foundEntry = querySnap.docs.find(doc => {
          const d = doc.data() as LedgerEntry;
          return d.category === 'city_ledger' && d.type === 'debit' && d.corporateId;
        });
        if (foundEntry) {
          finalCorporateId = (foundEntry.data() as LedgerEntry).corporateId;
        }
      }
    }
  }

  const timestamp = new Date().toISOString();
  
  // 1. Prepare entries list
  const entries: Omit<LedgerEntry, 'id'>[] = [];
  
  const mainEntry: Omit<LedgerEntry, 'id'> = {
    ...entry,
    timestamp,
    hotelId,
    guestId,
    reservationId,
    corporateId: finalCorporateId,
    postedBy
  };
  entries.push(mainEntry);

  // 2. Automatically post taxes if it's a debit charge (Room, Restaurant, etc.)
  if (shouldFetchHotel && hotelSnap && hotelSnap.exists()) {
    const hotelData = hotelSnap.data();
    const activeTaxes = (hotelData.taxes || []).filter((t: any) => {
      const status = (t.status || '').toLowerCase().trim();
      const category = (t.category || '').toLowerCase().trim();
      const entryCategory = (entry.category || '').toLowerCase().trim();
      
      if (status !== 'active') return false;
      
      if (category === 'all' || category === entryCategory) return true;
      
      if (entryCategory === 'room') {
        return category !== 'f & b' && category !== 'restaurant' && category !== 'food';
      }
      
      if (entryCategory === 'restaurant' || entryCategory === 'f & b' || entryCategory === 'food') {
        return category !== 'room';
      }

      return false;
    });
    
    const baseAmount = entry.amount;
    const initialDescription = entry.description;
    let totalInclusiveTax = 0;
    const inclusiveTaxEntries: Omit<LedgerEntry, 'id'>[] = [];

    for (const tax of activeTaxes) {
      const taxName = tax.name || 'Tax';
      const taxDesc = `${taxName} (${tax.percentage}%)`;

      // RULE 6: TAX IDEMPOTENCY - Never duplicate tax if already posted for this charge
      const taxAlreadyPosted = querySnap.docs.some(doc => {
        const d = doc.data() as LedgerEntry;
        if (d.type !== 'debit' || d.category !== 'tax') return false;
        if (d.description && d.description.includes(taxDesc) && d.description.includes(initialDescription)) {
          return true;
        }
        return false;
      });

      if (taxAlreadyPosted) {
        console.log(`[postToLedger] Skipping duplicate tax ${taxDesc} for: ${initialDescription}`);
        continue;
      }

      const taxAmount = tax.isInclusive 
        ? baseAmount - (baseAmount / (1 + (tax.percentage / 100)))
        : baseAmount * (tax.percentage / 100);
      
      if (tax.isInclusive) {
        totalInclusiveTax += taxAmount;
        const taxEntry: Omit<LedgerEntry, 'id'> = {
          timestamp,
          hotelId,
          guestId,
          reservationId,
          corporateId: finalCorporateId,
          type: 'debit',
          amount: taxAmount,
          description: `${tax.name} (${tax.percentage}%) [Inclusive] for ${initialDescription}`,
          category: 'tax',
          postedBy
        };
        inclusiveTaxEntries.push(taxEntry);
      } else {
        const taxEntry: Omit<LedgerEntry, 'id'> = {
          timestamp,
          hotelId,
          guestId,
          reservationId,
          corporateId: finalCorporateId,
          type: 'debit',
          amount: taxAmount,
          description: `${tax.name} (${tax.percentage}%) for ${initialDescription}`,
          category: 'tax',
          postedBy
        };
        entries.push(taxEntry);
      }
    }

    // Adjust the primary entry amount for inclusive taxes
    entries[0].amount = baseAmount - totalInclusiveTax;
    // Also add the inclusive tax entries to the main entries list
    entries.push(...inclusiveTaxEntries);
  }

  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const batch = writeBatch(db);
  
  // 3. Post entries to ledger (append-only) using batch
  const postedIds: string[] = [];
  const nowISO = new Date().toISOString();
  
  entries.forEach(e => {
    const newDocRef = doc(ledgerRef);
    // Ensure every entry has a timestamp for stable ordering
    const finalEntry = {
      ...e,
      timestamp: e.timestamp || nowISO,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    };
    batch.set(newDocRef, finalEntry);
    postedIds.push(newDocRef.id);
  });

  // 4. Update balances
  const guestEntries = entries.filter(e => !e.corporateId);
  const corpEntries = entries.filter(e => !!e.corporateId);

  const guestBalanceAdj = guestEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);
  const corpBalanceAdj = corpEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);

  const nightCountAdj = guestEntries.filter(e => e.type === 'debit' && e.category === 'room').length;

  if (guestBalanceAdj !== 0 || nightCountAdj > 0) {
    const spentCredit = guestEntries.filter(e => e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0);
    const spentRefund = guestEntries.filter(e => e.type === 'debit' && e.category === 'refund').reduce((acc, e) => acc + e.amount, 0);
    const spentAdj = spentCredit - spentRefund;

    batch.set(guestRef, {
      ledgerBalance: increment(guestBalanceAdj),
      totalSpent: increment(spentAdj),
      totalNights: increment(nightCountAdj)
    }, { merge: true });
  }

  if (corporateId && corpBalanceAdj !== 0) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    batch.set(corpRef, {
      currentBalance: increment(corpBalanceAdj),
      totalDebits: increment(corpEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0)),
      totalCredits: increment(corpEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0))
    }, { merge: true });
  }

  // 5. Update Reservation totals using resSnap fetched at start
  if (resSnap && resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    const resUpdates: any = {};
    
    // Real cash/transfer payments: Credit payment entries increase paidAmount,
    // debit payment/refund entries decrease paidAmount
    const creditsSum = entries
      .filter(e => e.type === 'credit' && e.category === 'payment')
      .reduce((acc, e) => acc + e.amount, 0);

    const debitsSum = entries
      .filter(e => e.type === 'debit' && (e.category === 'payment' || e.category === 'refund'))
      .reduce((acc, e) => acc + e.amount, 0);

    const totalPaidAmountAdj = creditsSum - debitsSum;

    // Track discounts (credit adjustments of category discount or service, minus debit adjustments of the same)
    const discountCreditsSum = entries
      .filter(e => e.type === 'credit' && (e.category === 'discount' || e.category === 'service'))
      .reduce((acc, e) => acc + e.amount, 0);

    const discountDebitsSum = entries
      .filter(e => e.type === 'debit' && (e.category === 'discount' || e.category === 'service'))
      .reduce((acc, e) => acc + e.amount, 0);

    const totalDiscountAdj = discountCreditsSum - discountDebitsSum;

    // Debit charges that are room, payment, refund, or transfer should NOT increase the reservation's totalAmount.
    // Additionally, if the main posted charge is room-related or non-total, any automatic taxes generated for it should also not increase totalAmount.
    const nonTotalDebits = ['room', 'payment', 'refund', 'transfer', 'city_ledger'];
    const isMainEntryNonTotal = nonTotalDebits.includes(entry.category);
    const projectedTotalAdj = isMainEntryNonTotal
      ? 0
      : entries
          .filter(e => e.type === 'debit' && !nonTotalDebits.includes(e.category))
          .reduce((acc, e) => acc + e.amount, 0);

    if (projectedTotalAdj !== 0) resUpdates.totalAmount = increment(projectedTotalAdj);
    if (totalPaidAmountAdj !== 0) resUpdates.paidAmount = increment(totalPaidAmountAdj);
    if (totalDiscountAdj !== 0) resUpdates.totalDiscount = increment(totalDiscountAdj);
    
    const totalBalanceAdj = guestBalanceAdj + corpBalanceAdj;
    if (totalBalanceAdj !== 0) resUpdates.ledgerBalance = increment(totalBalanceAdj);

    // Calculate new status
    const freshTotalAmount = (resData.totalAmount || 0) + projectedTotalAdj;
    const freshPaidAmount = (resData.paidAmount || 0) + totalPaidAmountAdj;
    const freshDiscountAmount = (resData.totalDiscount || 0) + totalDiscountAdj;

    let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
    if (freshTotalAmount > 0) {
      if (freshPaidAmount + freshDiscountAmount >= freshTotalAmount - 0.01) {
        newPaymentStatus = 'paid';
      } else if (freshPaidAmount + freshDiscountAmount > 0) {
        newPaymentStatus = 'partial';
      }
    } else if (freshPaidAmount + freshDiscountAmount > 0) {
      newPaymentStatus = 'paid';
    }

    resUpdates.paymentStatus = newPaymentStatus;
    batch.set(resRef, resUpdates, { merge: true });
  }


  // 6. Finance records
  const payments = entries.filter(e => (e.category === 'payment' || e.category === 'refund'));
  const financeRef = collection(db, 'hotels', hotelId, 'finance');
  payments.forEach(p => {
    const financeDocRef = doc(financeRef);
    batch.set(financeDocRef, {
      type: p.type === 'credit' ? 'income' : 'expense',
      amount: p.amount,
      category: p.category === 'payment' ? 'Room Revenue' : 'Other',
      description: p.description,
      timestamp,
      paymentMethod,
      guestId,
      corporateId: p.corporateId || null,
      referenceId: postedIds[entries.indexOf(p)],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  // 7. Commit batch and Log once
  await database.commitBatch(hotelId, batch, {
    module: 'Ledger',
    action: 'POST_LEDGER_BATCH',
    details: `Posted ${entries.length} entries to ${reservationId} Folio. Status: ${entry.type}, Amount: ${entry.amount}`
  });

  if (reservationId) {
    // Non-blocking background verification audit
    recalculateReservationAccountFromLedger(hotelId, reservationId).catch(() => {});
  }

  return { id: postedIds[0], ...mainEntry };
};

/**
 * PRODUCTION-GRADE REVERSAL:
 * Instead of deleting ledger entries, we post a "Reversal" charge.
 * This maintains a complete financial audit trail.
 */
export const voidLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string },
  voidedBy: string
) => {
  const { firestoreId, id, reservationId, guestId, corporateId, amount, type, category, description } = ledgerEntry;
  
  // 1. Create the reversal entry
  const reversalEntry: Omit<LedgerEntry, 'id'> = {
    hotelId,
    guestId,
    reservationId,
    corporateId,
    amount: amount, // Reversal has the same amount but opposite effect
    type: type === 'debit' ? 'credit' : 'debit', // FLIP THE TYPE
    category: category || 'other',
    description: `REVERSAL: ${description} (Ref: ${firestoreId || id})`,
    timestamp: new Date().toISOString(),
    postedBy: voidedBy
  };

  // 2. Post the reversal
  return postToLedger(
    hotelId,
    guestId,
    reservationId!,
    reversalEntry,
    voidedBy,
    corporateId
  );
};

// Deprecated in favor of voidLedgerEntry for production audit compliance
export const recalculateReservationAccountFromLedger = async (
  hotelId: string,
  reservationId: string
) => {
  if (!hotelId || !reservationId) return;
  try {
    const q = query(
      collection(db, 'hotels', hotelId, 'ledger'),
      where('reservationId', '==', reservationId)
    );
    const snap = await getDocs(q);
    const validEntries = snap.docs
      .map(d => ({ id: d.id, ...d.data() } as LedgerEntry))
      .filter(e => validateLedgerTransaction(e).isValid);

    let totalDebits = 0;
    let totalCredits = 0;
    let totalPaid = 0;

    validEntries.forEach(e => {
      if (e.type === 'debit') {
        if (e.category === 'refund') {
          totalPaid -= e.amount;
        } else {
          totalDebits += e.amount;
        }
      } else if (e.type === 'credit') {
        const cat = (e.category || '').toLowerCase();
        if (cat === 'payment' || cat === 'transfer' || cat === 'city_ledger' || cat === 'corporate' || cat === 'discount') {
          totalCredits += e.amount;
          if (cat === 'payment') {
            totalPaid += e.amount;
          }
        }
      }
    });

    totalDebits = Number(totalDebits.toFixed(2));
    totalCredits = Number(totalCredits.toFixed(2));
    totalPaid = Math.max(0, Number(totalPaid.toFixed(2)));

    const ledgerBalance = Number((totalDebits - totalCredits).toFixed(2));

    const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
    const resSnap = await getDoc(resRef);
    if (!resSnap.exists()) return;

    const resData = resSnap.data() as Reservation;

    let paymentStatus: Reservation['paymentStatus'] = 'unpaid';
    if (ledgerBalance <= 0.01 && (totalPaid > 0 || totalCredits > 0 || totalDebits > 0)) {
      paymentStatus = 'paid';
    } else if (totalPaid > 0 || totalCredits > 0) {
      paymentStatus = 'partial';
    }

    await database.safeUpdate(resRef, {
      ledgerBalance,
      paidAmount: totalPaid,
      totalAmount: totalDebits > 0 ? totalDebits : (resData.totalAmount || 0),
      paymentStatus
    }, {
      hotelId,
      module: 'Reservation',
      action: 'RECALCULATE_FINANCIALS',
      details: `Re-synchronized reservation ${reservationId} financial balance from valid ledger entries`
    });

    if (resData.guestId) {
      const guestRef = doc(db, 'hotels', hotelId, 'guests', resData.guestId);
      const guestSnap = await getDoc(guestRef);
      if (guestSnap.exists()) {
        await database.safeUpdate(guestRef, {
          ledgerBalance
        }, {
          hotelId,
          module: 'Guest',
          action: 'RECALCULATE_GUEST_BALANCE',
          details: `Re-synchronized guest ${resData.guestId} ledger balance`
        });
      }
    }
  } catch (err) {
    console.error(`Failed to recalculate reservation account ${reservationId}:`, err);
  }
};

export const purgeCorruptedLedgerEntries = async (
  hotelId: string,
  entryIds: string[]
) => {
  if (!hotelId || !entryIds || entryIds.length === 0) return;
  const reservationIdsToSync = new Set<string>();

  for (const entryId of entryIds) {
    try {
      const docRef = doc(db, 'hotels', hotelId, 'ledger', entryId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as LedgerEntry;
        if (data.reservationId) reservationIdsToSync.add(data.reservationId);
      }
      await database.safeDelete(docRef, {
        hotelId,
        module: 'Ledger',
        action: 'PURGE_CORRUPTED_ENTRY',
        details: `Purged corrupted or virtual projection ledger entry ${entryId}`
      });
    } catch (err) {
      console.error(`Failed to purge ledger entry ${entryId}:`, err);
    }
  }

  for (const resId of reservationIdsToSync) {
    await recalculateReservationAccountFromLedger(hotelId, resId);
  }
};

export const deleteLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string }
) => {
  console.warn("deleteLedgerEntry is deprecated. Use voidLedgerEntry for production audit compliance.");
  const { id, firestoreId, reservationId } = ledgerEntry;
  const docId = firestoreId || id;

  if (docId) {
    await database.safeDelete(doc(db, 'hotels', hotelId, 'ledger', docId), {
      hotelId,
      module: 'Ledger',
      action: 'DELETE_LEDGER_ENTRY',
      details: `Permanently deleted ledger entry ${docId} (Discouraged)`
    });
  }

  if (reservationId) {
    await recalculateReservationAccountFromLedger(hotelId, reservationId);
  }
};


export const settleLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  postedBy: string,
  corporateId?: string,
  referenceCode?: string,
  proofUrl?: string
) => {
  return postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'credit',
    category: 'payment',
    description: `Payment via ${paymentMethod.toUpperCase()}${referenceCode ? ` (Ref: ${referenceCode})` : ''}`,
    referenceId: reservationId,
    postedBy,
    referenceCode,
    proofUrl
  } as any, postedBy, corporateId, paymentMethod);
};

export const transferLedgerBalance = async (
  hotelId: string,
  guestId: string,
  fromReservationId: string,
  toReservationId: string,
  amount: number,
  postedBy: string,
  corporateId?: string
) => {
  await postToLedger(hotelId, guestId, fromReservationId, {
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Balance Transfer to Res #${(toReservationId || '').slice(-6).toUpperCase()}`,
    referenceId: toReservationId,
    postedBy
  }, postedBy, corporateId);

  await postToLedger(hotelId, guestId, toReservationId, {
    amount,
    type: 'debit',
    category: 'transfer',
    description: `Balance Transfer from Res #${(fromReservationId || '').slice(-6).toUpperCase()}`,
    referenceId: fromReservationId,
    postedBy
  }, postedBy, corporateId);
};

export const refundGuest = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  reason: string,
  postedBy: string,
  corporateId?: string
) => {
  return postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'debit',
    category: 'refund',
    description: `Refund: ${reason}`,
    referenceId: reservationId,
    postedBy
  }, postedBy, corporateId);
};

export const settleOverpayment = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  method: 'cash' | 'card' | 'transfer',
  postedBy: string,
  corporateId?: string
) => {
  return postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'debit',
    category: 'payment',
    description: `Overpayment Settlement (${method})`,
    referenceId: reservationId,
    postedBy
  }, postedBy, corporateId, method);
};

export const transferToCityLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  postedBy: string,
  corporateId?: string
) => {
  // 1. Credit the reservation (Guest/Folio side) - removes debt from reservation's guest folio
  await postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'credit',
    category: 'city_ledger',
    description: 'Transfer to City Ledger (Folio Credit)',
    referenceId: reservationId,
    postedBy
  }, postedBy); // NO corporateId here for the guest credit

  // 2. Debit the corporate (Company side) - adds debt to corporate account
  if (corporateId) {
    await postToLedger(hotelId, guestId, reservationId, {
      amount,
      type: 'debit',
      category: 'city_ledger',
      description: 'Transfer from Guest Folio (Folio Debit)',
      referenceId: reservationId,
      postedBy
    }, postedBy, corporateId);

    // Link the reservation to the corporate account as well
    const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
    await updateDoc(resRef, { corporateId });
  }
};

export const transferCorporateBalance = async (
  hotelId: string,
  fromCorporateId: string,
  toCorporateId: string,
  amount: number,
  postedBy: string,
  notes?: string
) => {
  const timestamp = new Date().toISOString();
  
  // Fetch from and to account names to make the ledger descriptions and logs human-readable
  const fromRef = doc(db, 'hotels', hotelId, 'corporate_accounts', fromCorporateId);
  const toRef = doc(db, 'hotels', hotelId, 'corporate_accounts', toCorporateId);
  
  const [fromSnap, toSnap] = await Promise.all([
    getDoc(fromRef),
    getDoc(toRef)
  ]);
  
  const fromName = fromSnap.exists() ? (fromSnap.data() as any).name : fromCorporateId;
  const toName = toSnap.exists() ? (toSnap.data() as any).name : toCorporateId;
  
  await database.safeUpdate(fromRef, {
    currentBalance: increment(-amount),
    totalCredits: increment(amount)
  }, {
    hotelId,
    module: 'Corporate',
    action: 'TRANSFER_OUT',
    details: `Transferred ${amount} out to ${toName}`
  });

  await database.safeUpdate(toRef, {
    currentBalance: increment(amount),
    totalDebits: increment(amount)
  }, {
    hotelId,
    module: 'Corporate',
    action: 'TRANSFER_IN',
    details: `Transferred ${amount} in from ${fromName}`
  });

  await database.safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    corporateId: fromCorporateId,
    reservationId: 'CORP_TRANSFER',
    timestamp,
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Transfer to Corporate Account: ${toName} ${notes ? `(${notes})` : ''}`,
    postedBy
  }, {
    hotelId,
    module: 'Ledger',
    action: 'CORP_TRANSFER_LOG',
    details: `Logged out-transfer for corporate account`
  });

  await database.safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    corporateId: toCorporateId,
    reservationId: 'CORP_TRANSFER',
    timestamp,
    amount,
    type: 'debit',
    category: 'transfer',
    description: `Transfer from Corporate Account: ${fromName} ${notes ? `(${notes})` : ''}`,
    postedBy
  }, {
    hotelId,
    module: 'Ledger',
    action: 'CORP_TRANSFER_LOG',
    details: `Logged in-transfer for corporate account`
  });
};

export interface FolioReconciliationReport {
  reservationId: string;
  roomNumber: string;
  guestId: string;
  bookedNights: number;
  overstayNights: number;
  legitimateTotalNights: number;
  purgedDuplicateEntriesCount: number;
  purgedEntryIds: string[];
  totalCharges: number;
  totalPayments: number;
  totalCredits: number;
  expectedBalance: number;
  previousStoredBalance: number;
  isReconciled: boolean;
  discrepancy: number;
}

/**
 * PRODUCTION-GRADE FINANCIAL RECONCILIATION & PURGE ENGINE
 * Strict enforcement of Rules 1, 2, 3, 4, 6, 8, 9:
 * 1. Checks exact booked nights + overstay nights (additive, never multiplied)
 * 2. Identifies any duplicate room entries for identical nights or exceeding legitimate stay duration
 * 3. Identifies and purges attached tax debits for duplicate charges
 * 4. Recalculates exact true balance: SUM(Charges) - SUM(Payments) - SUM(Credits)
 * 5. Reconciles reservation.ledgerBalance, totalAmount, paidAmount, and guest.ledgerBalance
 */
export const reconcileAndRepairReservationFinancials = async (
  hotelId: string,
  reservationId: string,
  existingEntries?: LedgerEntry[]
): Promise<FolioReconciliationReport> => {
  if (!hotelId || !reservationId) {
    throw new Error('hotelId and reservationId are required for financial reconciliation');
  }

  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const [resSnap, hotelSnap] = await Promise.all([
    getDoc(resRef),
    getDoc(doc(db, 'hotels', hotelId))
  ]);
  if (!resSnap.exists()) {
    throw new Error(`Reservation ${reservationId} not found`);
  }
  const res = resSnap.data() as Reservation;
  const hotel = hotelSnap.exists() ? (hotelSnap.data() as Hotel) : null;

  let ledgerEntries = existingEntries;
  if (!ledgerEntries) {
    const q = query(
      collection(db, 'hotels', hotelId, 'ledger'),
      where('reservationId', '==', reservationId)
    );
    const snap = await getDocs(q);
    ledgerEntries = snap.docs.map(doc => ({ id: doc.id, firestoreId: doc.id, ...doc.data() } as LedgerEntry & { firestoreId?: string }));
  }

  // Authoritative duration and rate calculations from single engine
  const duration = BillingEngine.calculateStay(res, hotel);
  const bookedNights = Math.max(1, duration.bookedNights || res.nights || 1);
  const overstayNights = Math.max(0, duration.overstayNights || 0);
  const legitimateTotalNights = duration.totalNights;
  const nightlyRate = BillingEngine.getNightlyRate(res, hotel, ledgerEntries);

  // Identify all room debit charges (base room and overstay)
  const roomDebits = ledgerEntries.filter(e => 
    e.type === 'debit' && 
    (e.category === 'room' || e.chargeType === 'room_rate' || e.chargeType === 'overstay')
  );

  const duplicateIds: string[] = [];

  // Group room charges by date or night representation to keep at most 1 charge per distinct night
  const chargesByNightKey: { [key: string]: (LedgerEntry & { firestoreId?: string })[] } = {};
  
  roomDebits.forEach(entry => {
    let key = '';
    if (entry.chargePeriodStart) {
      key = format(new Date(entry.chargePeriodStart), 'yyyy-MM-dd');
    } else if (entry.description) {
      const match = entry.description.match(/(?:Night of|Nightly room charge -|Period \d+ past checkout).*?([A-Za-z]{3}\s+\d{1,2},\s+\d{4})/i) ||
                    entry.description.match(/(\d{4}-\d{2}-\d{2})/);
      if (match) {
        key = match[1];
      } else {
        key = entry.description.trim();
      }
    }
    if (!key) key = entry.id;

    if (!chargesByNightKey[key]) {
      chargesByNightKey[key] = [];
    }
    chargesByNightKey[key].push(entry);
  });

  const retainedRoomCharges: (LedgerEntry & { firestoreId?: string })[] = [];

  // For each night key, keep only the earliest valid entry; mark all other duplicates for purging
  Object.entries(chargesByNightKey).forEach(([_, list]) => {
    list.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    retainedRoomCharges.push(list[0]);
    for (let k = 1; k < list.length; k++) {
      const dupId = list[k].firestoreId || list[k].id;
      if (dupId && !duplicateIds.includes(dupId)) {
        duplicateIds.push(dupId);
      }
    }
  });

  // If the number of retained room charges still exceeds legitimateTotalNights:
  // e.g. guest booked 1 night + 1 overstay night = 2 nights, but 5 charges were posted!
  if (retainedRoomCharges.length > legitimateTotalNights) {
    retainedRoomCharges.sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());
    const excess = retainedRoomCharges.slice(legitimateTotalNights);
    excess.forEach(entry => {
      const excessId = entry.firestoreId || entry.id;
      if (excessId && !duplicateIds.includes(excessId)) {
        duplicateIds.push(excessId);
      }
    });
  }

  // Identify any attached tax entries for the purged duplicate charges
  if (duplicateIds.length > 0) {
    const dupEntries = ledgerEntries.filter(e => duplicateIds.includes((e as any).firestoreId || e.id));
    dupEntries.forEach(dup => {
      const dupDesc = dup.description;
      if (dupDesc) {
        const matchingTaxes = ledgerEntries!.filter(e => 
          e.type === 'debit' && 
          e.category === 'tax' && 
          e.description && 
          (e.description.includes(dupDesc) || (dup.id && e.description.includes(dup.id)))
        );
        matchingTaxes.forEach(t => {
          const tId = (t as any).firestoreId || t.id;
          if (tId && !duplicateIds.includes(tId)) {
            duplicateIds.push(tId);
          }
        });
      }
    });

    console.warn(`[FolioReconciliation] Purging ${duplicateIds.length} duplicate/excess charges for reservation ${reservationId}`, duplicateIds);
    await purgeCorruptedLedgerEntries(hotelId, duplicateIds);
  }

  // Remaining clean ledger entries
  const cleanEntries = ledgerEntries.filter(e => !duplicateIds.includes((e as any).firestoreId || e.id));

  // Calculate authoritative balances according to RULE 2:
  // Expected Balance = SUM(All Charges) - SUM(All Payments) - SUM(All Credits)
  let totalCharges = 0;
  let totalPayments = 0;
  let totalCredits = 0;
  let totalPaid = 0;

  cleanEntries.forEach(e => {
    if (e.type === 'debit') {
      if (e.category === 'refund') {
        totalPaid -= e.amount;
      } else {
        totalCharges += e.amount;
      }
    } else if (e.type === 'credit') {
      const cat = (e.category || '').toLowerCase();
      if (cat === 'payment' || cat === 'transfer' || cat === 'city_ledger' || cat === 'corporate' || cat === 'discount') {
        totalCredits += e.amount;
        if (cat === 'payment') {
          totalPaid += e.amount;
        }
      }
    }
  });

  totalCharges = Number(totalCharges.toFixed(2));
  totalCredits = Number(totalCredits.toFixed(2));
  totalPayments = Math.max(0, Number(totalPaid.toFixed(2)));
  const expectedBalance = Number((totalCharges - totalCredits).toFixed(2));
  const previousStoredBalance = res.ledgerBalance || 0;
  const discrepancy = Number((previousStoredBalance - expectedBalance).toFixed(2));

  // Update reservation document with authoritative reconciled numbers
  await database.safeUpdate(resRef, {
    ledgerBalance: expectedBalance,
    totalAmount: totalCharges,
    paidAmount: totalPayments,
    nightlyRate,
    nights: bookedNights,
    overstayNights,
    paymentStatus: expectedBalance <= 0.01 && (totalPayments > 0 || totalCredits > 0 || totalCharges > 0) ? 'paid' : (totalPayments > 0 || totalCredits > 0 ? 'partial' : 'unpaid'),
    financialStatus: expectedBalance > 0.01 ? (totalPayments > 0 ? 'PARTIALLY_PAID' : 'OUTSTANDING') : 'SETTLED'
  }, {
    hotelId,
    module: 'Reconciliation',
    action: 'FOLIO_RECONCILIATION',
    details: `Reconciled reservation ${reservationId}. Balance corrected from ${previousStoredBalance} to ${expectedBalance}. Purged ${duplicateIds.length} duplicate entries.`
  });

  // Update guest document
  if (res.guestId) {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', res.guestId);
    const guestSnap = await getDoc(guestRef);
    if (guestSnap.exists()) {
      await database.safeUpdate(guestRef, {
        ledgerBalance: expectedBalance
      }, {
        hotelId,
        module: 'Guest',
        action: 'GUEST_BALANCE_RECONCILE',
        details: `Reconciled guest ${res.guestId} ledger balance to ${expectedBalance}`
      });
    }
  }

  return {
    reservationId,
    roomNumber: res.roomNumber || '',
    guestId: res.guestId || '',
    bookedNights,
    overstayNights,
    legitimateTotalNights,
    purgedDuplicateEntriesCount: duplicateIds.length,
    purgedEntryIds: duplicateIds,
    totalCharges,
    totalPayments,
    totalCredits,
    expectedBalance,
    previousStoredBalance,
    isReconciled: true,
    discrepancy
  };
};

export const detectAndPurgeDuplicateOverstayCharges = async (
  hotelId: string,
  res: Reservation,
  existingEntries?: LedgerEntry[]
): Promise<string[]> => {
  if (!hotelId || !res?.id) return [];
  const recon = await reconcileAndRepairReservationFinancials(hotelId, res.id, existingEntries);
  return recon.purgedEntryIds;
};

export const processAutomatedBillingForReservation = async (
  hotel: Hotel,
  res: Reservation,
  profileUid: string,
  currentTime: Date = new Date()
) => {
  if (!res.guestId || !res.autoNightDeduction || res.status !== 'checked_in') {
    return { chargedCount: 0, totalAmount: 0 };
  }

  const { checkInDateTime, checkOutDateTime, originalNights } = BillingService.calculateStayWindow(res, hotel);
  const checkOutTime = res.checkOutTime || hotel?.defaultCheckOutTime || '12:00';
  let nightlyRate = BillingEngine.getNightlyRate(res, hotel);

  if (nightlyRate <= 0) {
    return { chargedCount: 0, totalAmount: 0 };
  }

  // 1. Fetch current ledger entries for this reservation
  const ledgerQ = query(
    collection(db, 'hotels', hotel.id, 'ledger'),
    where('reservationId', '==', res.id)
  );
  const ledgerSnap = await getDocs(ledgerQ);
  let ledgerEntries = ledgerSnap.docs.map(doc => ({ id: doc.id, firestoreId: doc.id, ...doc.data() } as LedgerEntry & { firestoreId: string }));

  // 2. Auto-Heal: Immediately detect and purge any duplicate or runaway overstay entries
  const purgedIds = await detectAndPurgeDuplicateOverstayCharges(hotel.id, res, ledgerEntries);
  if (purgedIds.length > 0) {
    ledgerEntries = ledgerEntries.filter(e => !purgedIds.includes(e.id) && !purgedIds.includes(e.firestoreId));
  }

  // Authoritative stay duration calculation from single engine
  const stayDuration = BillingEngine.calculateStay(res, hotel, currentTime);
  const maxAllowedOverstayNights = Math.max(0, stayDuration.overstayNights);
  const maxAllowedTotalNights = stayDuration.totalNights;
  nightlyRate = BillingEngine.getNightlyRate(res, hotel, ledgerEntries);

  let chargedCount = 0;
  let totalAmountCharged = 0;
  let lastChargeTime = res.lastChargeDateTime;
  let nextChargeTime = res.nextChargeDateTime;

  // Track room charges already on ledger
  const postedRoomDebits = ledgerEntries.filter(e => 
    e.type === 'debit' && 
    (e.category === 'room' || e.chargeType === 'room_rate' || e.chargeType === 'overstay')
  );

  // If total posted room charges already reach or exceed allowed stay duration, STOP!
  if (postedRoomDebits.length >= maxAllowedTotalNights) {
    return { chargedCount: 0, totalAmount: 0 };
  }

  // 3. Process Base Stay Nights
  for (let i = 1; i <= originalNights; i++) {
    const Start = i === 1 
      ? checkInDateTime 
      : parseLocalDateTime(format(addDays(checkInDateTime, i - 1), 'yyyy-MM-dd'), checkOutTime);
    const End = parseLocalDateTime(format(addDays(checkInDateTime, i), 'yyyy-MM-dd'), checkOutTime);

    // This night is chargeable if currentTime is past its start time, OR if it's the first night
    const isNightChargeable = i === 1 || currentTime >= Start;
    if (isNightChargeable) {
      const startStr = Start.toISOString();
      const endStr = End.toISOString();

      const entryStartDay = format(Start, 'yyyy-MM-dd');
      const entryEndDay = format(End, 'yyyy-MM-dd');

      // Check if already posted
      const exists = ledgerEntries.some(e => {
        if (e.type !== 'debit') return false;

        // Match by deterministic reference ID
        if (e.referenceId === `${res.id}_NIGHT_${i}`) return true;

        if (e.chargeType === 'room_rate' && e.chargePeriodStart && e.chargePeriodEnd) {
          const eStartDay = format(new Date(e.chargePeriodStart), 'yyyy-MM-dd');
          const eEndDay = format(new Date(e.chargePeriodEnd), 'yyyy-MM-dd');
          if (eStartDay === entryStartDay && eEndDay === entryEndDay) {
            return true;
          }
        }

        // Check by matching date in description
        if (e.description && (e.category === 'room' || e.chargeType === 'room_rate')) {
          if (e.description.includes(format(Start, 'MMM dd, yyyy'))) {
            return true;
          }
        }

        // Fallback: if i === 1 and there is ANY room debit in the ledger, treat it as representing Night 1
        if (i === 1 && (e.category === 'room' || e.chargeType === 'room_rate')) {
          return true;
        }
        return false;
      });

      if (!exists && (postedRoomDebits.length + chargedCount) < maxAllowedTotalNights) {
        await postToLedger(hotel.id, res.guestId, res.id, {
          amount: nightlyRate,
          type: 'debit',
          category: 'room',
          description: `Nightly Room Charge: ${res.roomNumber} (Night of ${format(Start, 'MMM dd, yyyy')}) (Night ${i} of ${originalNights})`,
          referenceId: `${res.id}_NIGHT_${i}`,
          postedBy: profileUid,
          chargePeriodStart: startStr,
          chargePeriodEnd: endStr,
          chargeType: 'room_rate'
        } as any, profileUid, res.corporateId);

        chargedCount++;
        totalAmountCharged += nightlyRate;
        lastChargeTime = currentTime.toISOString();
        nextChargeTime = BillingService.calculateNextChargeDateTime(res, hotel, i).toISOString();
      }
    }
  }

  // 4. Process Overstay Nights strictly capped by maxAllowedOverstayNights
  const gracePeriodMinutes = hotel?.settings?.checkout?.gracePeriod ?? 0;
  const minutesPastCheckout = (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60);

  if (currentTime > checkOutDateTime && minutesPastCheckout > gracePeriodMinutes && hotel.autoChargeOverstays !== false && maxAllowedOverstayNights > 0) {
    const policy = hotel?.overstayPolicy || 'grace';
    const graceHours = hotel?.overstayGraceHours ?? 2;
    const partialHours = hotel?.overstayPartialHours ?? 3;
    const partialPercentage = hotel?.overstayPartialPercentage ?? 50;
    const fullHours = hotel?.overstayFullHours ?? 6;

    // STRICT BOUNDARY: Never iterate beyond actual allowed overstay nights!
    for (let j = 1; j <= maxAllowedOverstayNights; j++) {
      // If total posted room charges have reached maxAllowedTotalNights, stop!
      if ((postedRoomDebits.length + chargedCount) >= maxAllowedTotalNights) {
        break;
      }

      const Start = addDays(checkOutDateTime, j - 1);
      const End = addDays(checkOutDateTime, j);

      if (currentTime >= Start) {
        const startStr = Start.toISOString();
        const endStr = End.toISOString();

        const hoursPastPeriod = Math.min(24, (currentTime.getTime() - Start.getTime()) / (1000 * 60 * 60));
        let targetAmount = 0;

        if (policy === 'grace') {
          if (hoursPastPeriod > graceHours) {
            targetAmount = nightlyRate;
          }
        } else if (policy === 'partial') {
          if (hoursPastPeriod > fullHours) {
            targetAmount = nightlyRate;
          } else if (hoursPastPeriod > partialHours) {
            targetAmount = nightlyRate * (partialPercentage / 100);
          }
        } else if (policy === 'full') {
          if (hoursPastPeriod > fullHours) {
            targetAmount = nightlyRate;
          }
        } else if (policy === 'full_night' || policy === 'immediate_full') {
          targetAmount = nightlyRate;
        } else {
          if (hoursPastPeriod > graceHours) {
            targetAmount = nightlyRate;
          }
        }

        if (targetAmount > 0) {
          const entryStartDay = format(Start, 'yyyy-MM-dd');
          const entryEndDay = format(End, 'yyyy-MM-dd');

          // Check if already posted by referenceId, charge period, description, or start day
          const alreadyPosted = ledgerEntries.some(e => {
            if (e.type !== 'debit') return false;
            // Match by deterministic reference ID
            if (e.referenceId === `${res.id}_OVERSTAY_${j}`) return true;

            if (e.chargeType !== 'overstay' && !e.description?.toLowerCase().includes('overstay')) return false;

            if (e.chargePeriodStart) {
              const eStartDay = format(new Date(e.chargePeriodStart), 'yyyy-MM-dd');
              if (eStartDay === entryStartDay) return true;
            }
            if (e.description && (e.description.includes(format(Start, 'MMM dd, yyyy')) || e.description.includes(`Period ${j}`))) {
              return true;
            }
            return false;
          });

          if (!alreadyPosted) {
            await postToLedger(hotel.id, res.guestId, res.id, {
              amount: targetAmount,
              type: 'debit',
              category: 'room',
              description: `Overstay Room Charge: ${res.roomNumber} (Night of ${format(Start, 'MMM dd, yyyy')}) (Period ${j} past checkout)`,
              referenceId: `${res.id}_OVERSTAY_${j}`,
              postedBy: profileUid,
              chargePeriodStart: startStr,
              chargePeriodEnd: endStr,
              chargeType: 'overstay'
            } as any, profileUid, res.corporateId);

            chargedCount++;
            totalAmountCharged += targetAmount;
            lastChargeTime = currentTime.toISOString();
            nextChargeTime = BillingService.calculateNextChargeDateTime(res, hotel, originalNights + j).toISOString();
          }
        }
      }
    }
  }

  // 5. Update the Reservation fields in the database
  const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
  const updates: any = {};
  
  if (!res.checkInDateTime) updates.checkInDateTime = checkInDateTime.toISOString();
  if (!res.checkOutDateTime) updates.checkOutDateTime = checkOutDateTime.toISOString();
  if (lastChargeTime && res.lastChargeDateTime !== lastChargeTime) updates.lastChargeDateTime = lastChargeTime;
  if (nextChargeTime && res.nextChargeDateTime !== nextChargeTime) updates.nextChargeDateTime = nextChargeTime;

  if (Object.keys(updates).length > 0) {
    await database.safeUpdate(resRef, updates, {
      hotelId: hotel.id,
      module: 'Reservation',
      action: 'UPDATE_BILLING_TIMESTAMPS',
      details: 'Automated billing fields and timestamps updated'
    });
  }

  // Ensure balances and taxes are completely reconciled and synchronized to single financial engine
  await reconcileAndRepairReservationFinancials(hotel.id, res.id);

  return { chargedCount, totalAmount: totalAmountCharged };
};

/**
 * REFACTORED RESERVATION DELETION WITH FINANCIAL REVERSAL & CLEANUP
 * Atomically purges/reverses all ledger entries associated with a reservation,
 * updates room status, deletes reservation document, recalculates guest & corporate balances,
 * and creates audit logs to ensure zero orphan transactions.
 */
export const deleteReservationWithFinancialReversal = async (
  hotelId: string,
  reservation: Reservation,
  userProfile?: { uid: string; email: string; role: string } | null
): Promise<{ success: boolean; deletedEntriesCount: number }> => {
  if (!hotelId || !reservation?.id) {
    throw new Error('Invalid parameters: hotelId and reservation ID are required.');
  }

  const reservationId = reservation.id;
  const batch = writeBatch(db);

  // 1. Query all ledger entries associated with this reservation
  const ledgerQuery = query(
    collection(db, 'hotels', hotelId, 'ledger'),
    where('reservationId', '==', reservationId)
  );
  const ledgerSnap = await getDocs(ledgerQuery);

  let deletedEntriesCount = 0;
  ledgerSnap.docs.forEach((ledgerDoc) => {
    batch.delete(ledgerDoc.ref);
    deletedEntriesCount++;
  });

  // 2. Delete the reservation document
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  batch.delete(resRef);

  // 3. If checked in and assigned to a room, mark the room as clean/available
  if (
    reservation.status === 'checked_in' &&
    reservation.roomId &&
    typeof reservation.roomId === 'string' &&
    reservation.roomId.trim() !== ''
  ) {
    const roomRef = doc(db, 'hotels', hotelId, 'rooms', reservation.roomId.trim());
    batch.update(roomRef, { status: 'clean' });
  }

  // Commit batch atomically
  await database.commitBatch(hotelId, batch, {
    module: 'Front Desk',
    action: 'DELETE_RESERVATION_WITH_FINANCIAL_REVERSAL',
    details: `Deleted reservation ${reservationId} (${reservation.guestName || 'Guest'}) and purged ${deletedEntriesCount} associated ledger transaction(s)`,
    userContext: userProfile ? { uid: userProfile.uid, email: userProfile.email, role: userProfile.role } : undefined
  });

  // 4. Recalculate Guest Profile Outstanding Balance
  if (reservation.guestId) {
    try {
      const guestRef = doc(db, 'hotels', hotelId, 'guests', reservation.guestId);
      const guestSnap = await getDoc(guestRef);
      if (guestSnap.exists()) {
        // Query remaining reservations for this guest
        const remainingResSnap = await getDocs(
          query(
            collection(db, 'hotels', hotelId, 'reservations'),
            where('guestId', '==', reservation.guestId)
          )
        );
        const remainingReservations = remainingResSnap.docs
          .filter(d => d.id !== reservationId)
          .map(d => ({ id: d.id, ...d.data() } as Reservation));

        // Query remaining ledger entries for this guest
        const remainingLedgerSnap = await getDocs(
          query(
            collection(db, 'hotels', hotelId, 'ledger'),
            where('guestId', '==', reservation.guestId)
          )
        );
        const remainingLedger = remainingLedgerSnap.docs
          .filter(d => d.data().reservationId !== reservationId)
          .map(d => ({ id: d.id, ...d.data() } as LedgerEntry));

        // Calculate authoritative financial position
        const position = calculateGuestFinancialPosition(
          { id: reservation.guestId, email: reservation.guestEmail },
          remainingReservations,
          null,
          remainingLedger
        );

        await database.safeUpdate(
          guestRef,
          { ledgerBalance: position.outstandingBalance },
          {
            hotelId,
            module: 'Guest',
            action: 'RECALCULATE_GUEST_BALANCE',
            details: `Recalculated outstanding balance for guest ${reservation.guestId} after deleting reservation ${reservationId}`
          }
        );
      }
    } catch (gErr) {
      console.warn("Could not recalculate guest balance after reservation deletion:", gErr);
    }
  }

  // 5. Recalculate Corporate Account Balance if applicable
  if (reservation.corporateId) {
    try {
      const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', reservation.corporateId);
      const corpSnap = await getDoc(corpRef);
      if (corpSnap.exists()) {
        const corpLedgerSnap = await getDocs(
          query(
            collection(db, 'hotels', hotelId, 'ledger'),
            where('corporateId', '==', reservation.corporateId)
          )
        );
        const corpEntries = corpLedgerSnap.docs
          .filter(d => d.data().reservationId !== reservationId)
          .map(d => d.data() as LedgerEntry);

        const newCorpBalance = corpEntries.reduce((acc, e) => {
          if (e.type === 'debit') return acc + e.amount;
          if (e.type === 'credit') return acc - e.amount;
          return acc;
        }, 0);

        await database.safeUpdate(
          corpRef,
          { currentBalance: Number(newCorpBalance.toFixed(2)) },
          {
            hotelId,
            module: 'Corporate',
            action: 'RECALCULATE_CORPORATE_BALANCE',
            details: `Recalculated corporate account ${reservation.corporateId} balance after deleting reservation ${reservationId}`
          }
        );
      }
    } catch (cErr) {
      console.warn("Could not recalculate corporate balance after reservation deletion:", cErr);
    }
  }

  return { success: true, deletedEntriesCount };
};
