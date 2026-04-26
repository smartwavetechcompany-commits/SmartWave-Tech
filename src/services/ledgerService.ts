import { db, serverTimestamp, increment, safeWrite, safeAdd, safeDelete } from '../firebase';
import { doc, collection, getDoc, query, where, getDocs } from 'firebase/firestore';
import { LedgerEntry, Guest, Reservation, FinanceRecord } from '../types';

export const postToLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'hotelId' | 'guestId' | 'reservationId'>,
  postedBy: string,
  corporateId?: string,
  paymentMethod: 'cash' | 'card' | 'transfer' = 'cash'
) => {
  const ledgerEntry: any = {
    ...entry,
    timestamp: serverTimestamp(),
    hotelId,
    guestId,
    reservationId,
    corporateId,
    postedBy
  };

  // 1. Prepare entries list for processing (we still use a list because inclusive taxes create multiple entries)
  const entries: any[] = [ledgerEntry];

  // 2. Automatically post taxes if it's a debit charge (Room, Restaurant, etc.)
  if (entry.type === 'debit' && entry.category !== 'tax' && entry.category !== 'payment') {
    const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
    if (hotelSnap.exists()) {
      const hotelData = hotelSnap.data();
      const activeTaxes = (hotelData.taxes || []).filter((t: any) => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        const entryCategory = (entry.category || '').toLowerCase().trim();
        return status === 'active' && 
          (category === 'all' || 
           category === entryCategory || 
           (entryCategory === 'room' && category === 'service') ||
           ((entryCategory === 'f & b' || entryCategory === 'restaurant') && (category === 'f & b' || category === 'restaurant'))
          );
      });
      
      const baseAmount = entry.amount;
      const initialDescription = entry.description;
      let totalInclusiveTax = 0;
      const inclusiveTaxEntries: any[] = [];

      for (const tax of activeTaxes) {
        const taxAmount = tax.isInclusive 
          ? baseAmount - (baseAmount / (1 + (tax.percentage / 100)))
          : baseAmount * (tax.percentage / 100);
        
        if (tax.isInclusive) {
          totalInclusiveTax += taxAmount;
          inclusiveTaxEntries.push({
            timestamp: serverTimestamp(),
            hotelId,
            guestId,
            reservationId,
            corporateId,
            type: 'debit',
            amount: taxAmount,
            description: `${tax.name} (${tax.percentage}%) [Inclusive] for ${initialDescription}`,
            category: 'tax',
            postedBy
          });
        } else {
          entries.push({
            timestamp: serverTimestamp(),
            hotelId,
            guestId,
            reservationId,
            corporateId,
            type: 'debit',
            amount: taxAmount,
            description: `${tax.name} (${tax.percentage}%) for ${initialDescription}`,
            category: 'tax',
            postedBy
          });
        }
      }

      // Adjust the primary entry amount for inclusive taxes
      entries[0].amount = baseAmount - totalInclusiveTax;
      entries.push(...inclusiveTaxEntries);
    }
  }

  // 3. Prepare Reservation updates
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resUpdates: any = {
    updatedAt: serverTimestamp()
  };

  // 4. Add all entries to Ledger Collection
  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const ledgerDocPromises = entries.map(e => safeAdd(ledgerRef, e, hotelId, 'POST_LEDGER_ENTRY'));
  const savedEntries = await Promise.all(ledgerDocPromises);

  // 5. Update Guest and/or Corporate Account balances
  const guestEntries = entries.filter(e => !e.corporateId);
  const corpEntries = entries.filter(e => !!e.corporateId);

  const guestBalanceAdj = guestEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);
  const corpBalanceAdj = corpEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);

  if (guestBalanceAdj !== 0) {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await safeWrite(guestRef, {
      ledgerBalance: increment(guestBalanceAdj),
      totalSpent: increment(guestEntries.filter(e => e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0))
    }, hotelId, 'UPDATE_GUEST_BALANCE');
  }

  if (corporateId && corpBalanceAdj !== 0) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await safeWrite(corpRef, {
      currentBalance: increment(corpBalanceAdj),
      totalDebits: increment(corpEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0)),
      totalCredits: increment(corpEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0))
    }, hotelId, 'UPDATE_CORPORATE_BALANCE');
  }

  // 6. Handle Reservation Payment Status Synchronization
  const resSnap = await getDoc(resRef);
  if (resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    
    const totalExtrasAdded = entries
      .filter(e => e.type === 'debit' && e.category !== 'room' && e.category !== 'tax')
      .reduce((acc, e) => acc + e.amount, 0);
    
    const guestPaymentsAdded = entries
      .filter(e => e.type === 'credit' && e.category === 'payment' && !e.corporateId)
      .reduce((acc, e) => acc + e.amount, 0);

    if (totalExtrasAdded !== 0) resUpdates.totalAmount = increment(totalExtrasAdded);
    if (guestPaymentsAdded !== 0) resUpdates.paidAmount = increment(guestPaymentsAdded);

    // Calculate status
    const freshTotalDebits = (resData.totalAmount || 0) + totalExtrasAdded;
    const freshTotalCredits = (resData.paidAmount || 0) + guestPaymentsAdded;

    let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
    if (freshTotalDebits > 0) {
      if (freshTotalCredits >= freshTotalDebits - 0.01) {
        newPaymentStatus = 'paid';
      } else if (freshTotalCredits > 0) {
        newPaymentStatus = 'partial';
      }
    } else if (freshTotalCredits > 0) {
      newPaymentStatus = 'paid';
    }

    resUpdates.paymentStatus = newPaymentStatus;
  }

  await safeWrite(resRef, resUpdates, hotelId, 'UPDATE_RESERVATION_LEDGER');

  // 7. Finance records for actual payments/refunds
  const payments = entries.filter(e => (e.category === 'payment' || e.category === 'refund') && !e.corporateId);
  if (payments.length > 0) {
    const financeRef = collection(db, 'hotels', hotelId, 'finance');
    const financePromises = savedEntries.filter((_, i) => (entries[i].category === 'payment' || entries[i].category === 'refund') && !entries[i].corporateId).map((docRef, i) => {
      const p = entries.find(ent => ent.description === entries.filter(e => (e.category === 'payment' || e.category === 'refund') && !e.corporateId)[i].description); // Rough match
      if (!p) return Promise.resolve();
      
      const financeRecord = {
        type: p.type === 'credit' ? 'income' : 'expense',
        amount: p.amount,
        category: p.category === 'payment' ? 'Room Revenue' : 'Other',
        description: p.description,
        timestamp: serverTimestamp(),
        paymentMethod,
        guestId,
        referenceId: docRef.id
      };
      return safeAdd(financeRef, financeRecord, hotelId, 'POST_FINANCE_RECORD');
    });
    await Promise.all(financePromises);
  }

  return { ...entries[0], id: savedEntries[0].id };
};

export const deleteLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string }
) => {
  const { id, firestoreId, reservationId, guestId, corporateId, amount, type, category } = ledgerEntry;

  // 1. Remove from Ledger Collection
  if (firestoreId) {
    await safeDelete(doc(db, 'hotels', hotelId, 'ledger', firestoreId), hotelId, 'DELETE_LEDGER_ENTRY');
  }

  // 2. Remove from Reservation array (Legacy, but we keep it for now if it exists, though we stopped adding to it)
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resSnap = await getDoc(resRef);
  if (resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    // We update status and balances based on removal
    const resUpdates: any = {
      updatedAt: serverTimestamp()
    };
    
    // 3. Reverse the balance update
    const reverseAmount = type === 'debit' ? -amount : amount;

    if (corporateId) {
      const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
      await safeWrite(corpRef, {
        currentBalance: increment(reverseAmount),
        totalDebits: increment(type === 'debit' ? -amount : 0),
        totalCredits: increment(type === 'credit' ? -amount : 0)
      }, hotelId, 'REVERSE_CORPORATE_BALANCE');
    } else {
      const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
      await safeWrite(guestRef, {
        ledgerBalance: increment(reverseAmount),
        totalSpent: increment(type === 'credit' && category === 'payment' ? -amount : 0)
      }, hotelId, 'REVERSE_GUEST_BALANCE');
    }

    let paidAdj = 0;
    let totalAdj = 0;
    if (type === 'credit' && category === 'payment' && !corporateId) {
      paidAdj = -amount;
      resUpdates.paidAmount = increment(paidAdj);
    }
    
    if (type === 'debit' && category !== 'room' && category !== 'tax') {
      totalAdj = -amount;
      resUpdates.totalAmount = increment(totalAdj);
    }

    // Recalculate payment status
    const projectedTotal = (resData.totalAmount || 0) + totalAdj;
    const projectedPaid = (resData.paidAmount || 0) + paidAdj;
    
    let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
    if (projectedTotal > 0) {
      if (projectedPaid >= projectedTotal - 0.01) {
        newPaymentStatus = 'paid';
      } else if (projectedPaid > 0) {
        newPaymentStatus = 'partial';
      }
    } else if (projectedPaid > 0) {
      newPaymentStatus = 'paid';
    }
    resUpdates.paymentStatus = newPaymentStatus;

    // Remove from array if it was there
    if (resData.ledgerEntries) {
      resUpdates.ledgerEntries = resData.ledgerEntries.filter(e => e.id !== id);
    }

    await safeWrite(resRef, resUpdates, hotelId, 'SYNC_RESERVATION_DELETION');

    // 5. Delete corresponding Finance Record if payment
    if (type === 'credit' && category === 'payment' && !corporateId) {
      const financeQ = query(
        collection(db, 'hotels', hotelId, 'finance'),
        where('referenceId', '==', firestoreId || id)
      );
      const financeSnap = await getDocs(financeQ);
      for (const fDoc of financeSnap.docs) {
        await safeDelete(fDoc.ref, hotelId, 'DELETE_FINANCE_RECORD_FROM_LEDGER');
      }
    }
  }
};

export const settleLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  paymentMethod: 'cash' | 'card' | 'transfer',
  postedBy: string,
  corporateId?: string
) => {
  return postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'credit',
    category: 'payment',
    description: `Payment via ${paymentMethod}`,
    referenceId: reservationId,
    postedBy
  }, postedBy, corporateId, paymentMethod);
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
  // 1. Post credit to source reservation
  await postToLedger(hotelId, guestId, fromReservationId, {
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Balance Transfer to Res #${toReservationId.slice(-6).toUpperCase()}`,
    referenceId: toReservationId,
    postedBy
  }, postedBy, corporateId);

  // 2. Post debit to target reservation
  await postToLedger(hotelId, guestId, toReservationId, {
    amount,
    type: 'debit',
    category: 'transfer',
    description: `Balance Transfer from Res #${fromReservationId.slice(-6).toUpperCase()}`,
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
  // 1. Post credit to reservation to clear folio
  await postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'credit',
    category: 'city_ledger',
    description: 'Transfer to City Ledger',
    referenceId: reservationId,
    postedBy
  }, postedBy, corporateId);

  // 2. Post debit to guest/corporate account to maintain the debt
  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await safeWrite(corpRef, {
      currentBalance: increment(amount)
    }, hotelId, 'CITY_LEDGER_CORP_TRANSFER');
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await safeWrite(guestRef, {
      ledgerBalance: increment(amount)
    }, hotelId, 'CITY_LEDGER_GUEST_TRANSFER');
  }

  // 3. Log the transfer
  await safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
    action: 'CITY_LEDGER_TRANSFER',
    details: `City Ledger Debt from Res #${reservationId.slice(-6).toUpperCase()}`,
    timestamp: serverTimestamp(),
    userId: postedBy,
    hotelId,
    module: 'Finance'
  }, hotelId, 'LOG_CITY_LEDGER_ACTIVITY');

  await safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    guestId,
    corporateId,
    reservationId: 'CITY_LEDGER', // Special ID for non-folio debt
    amount,
    type: 'debit',
    category: 'city_ledger',
    description: `City Ledger Debt from Res #${reservationId.slice(-6).toUpperCase()}`,
    referenceId: reservationId,
    postedBy,
    timestamp: serverTimestamp()
  }, hotelId, 'LOG_CITY_LEDGER_TRANSFER');
};

export const transferCorporateBalance = async (
  hotelId: string,
  fromCorporateId: string,
  toCorporateId: string,
  amount: number,
  postedBy: string,
  notes?: string
) => {
  // 1. Debit from source corporate account
  await safeWrite(doc(db, 'hotels', hotelId, 'corporate_accounts', fromCorporateId), {
    currentBalance: increment(-amount),
    totalCredits: increment(amount)
  }, hotelId, 'CORP_BALANCE_TRANSFER_OUT');

  // 2. Credit to target corporate account
  await safeWrite(doc(db, 'hotels', hotelId, 'corporate_accounts', toCorporateId), {
    currentBalance: increment(amount),
    totalDebits: increment(amount)
  }, hotelId, 'CORP_BALANCE_TRANSFER_IN');

  // 3. Log entries in ledger
  await safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    corporateId: fromCorporateId,
    reservationId: 'CORP_TRANSFER',
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Transfer to Corporate Account: ${toCorporateId} ${notes ? `(${notes})` : ''}`,
    postedBy,
    timestamp: serverTimestamp()
  }, hotelId, 'LOG_CORP_TRANSFER_OUT');

  await safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    corporateId: toCorporateId,
    reservationId: 'CORP_TRANSFER',
    amount,
    type: 'debit',
    category: 'transfer',
    description: `Transfer from Corporate Account: ${fromCorporateId} ${notes ? `(${notes})` : ''}`,
    postedBy,
    timestamp: serverTimestamp()
  }, hotelId, 'LOG_CORP_TRANSFER_IN');
};
