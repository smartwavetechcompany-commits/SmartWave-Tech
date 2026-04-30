import { db } from '../firebase';
import { doc, increment, collection, getDoc, query, where, getDocs, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { LedgerEntry, Reservation, FinanceRecord } from '../types';
import { database, createAuditLog } from '../utils/database';

export const postToLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'hotelId' | 'guestId' | 'reservationId'>,
  postedBy: string,
  corporateId?: string,
  paymentMethod: 'cash' | 'card' | 'transfer' = 'cash'
) => {
  const timestamp = new Date().toISOString();
  
  // 1. Prepare entries list
  const entries: Omit<LedgerEntry, 'id'>[] = [];
  
  const mainEntry: Omit<LedgerEntry, 'id'> = {
    ...entry,
    timestamp,
    hotelId,
    guestId,
    reservationId,
    corporateId,
    postedBy
  };
  entries.push(mainEntry);

  // 2. Automatically post taxes if it's a debit charge (Room, Restaurant, etc.)
  if (entry.type === 'debit' && entry.category !== 'tax' && entry.category !== 'payment') {
    const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
    if (hotelSnap.exists()) {
      const hotelData = hotelSnap.data();
      const activeTaxes = (hotelData.taxes || []).filter((t: any) => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        const entryCategory = (entry.category || '').toLowerCase().trim();
        
        if (status !== 'active') return false;
        
        // Match logic:
        // 1. "all" always matches
        // 2. Explicit category match
        // 3. For room charges, any tax that isn't specific to F&B/Restaurant
        // 4. For F&B/Restaurant, any tax that isn't specific to Room
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
            corporateId,
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
            corporateId,
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
  }

  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
  const batch = writeBatch(db);
  
  // 3. Post entries to ledger (append-only) using batch
  const postedIds: string[] = [];
  entries.forEach(e => {
    const newDocRef = doc(ledgerRef);
    batch.set(newDocRef, {
      ...e,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    postedIds.push(newDocRef.id);
  });

  // 4. Update balances
  const guestEntries = entries.filter(e => !e.corporateId);
  const corpEntries = entries.filter(e => !!e.corporateId);

  const guestBalanceAdj = guestEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);
  const corpBalanceAdj = corpEntries.reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0);

  if (guestBalanceAdj !== 0) {
    batch.update(guestRef, {
      ledgerBalance: increment(guestBalanceAdj),
      totalSpent: increment(guestEntries.filter(e => e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0))
    });
  }

  if (corporateId && corpBalanceAdj !== 0) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    batch.update(corpRef, {
      currentBalance: increment(corpBalanceAdj),
      totalDebits: increment(corpEntries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0)),
      totalCredits: increment(corpEntries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0))
    });
  }

  // 5. Update Reservation totals
  const resSnap = await getDoc(resRef);
  if (resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    const resUpdates: any = {};
    
    const totalCreditAdjustments = entries
      .filter(e => e.type === 'credit')
      .reduce((acc, e) => acc + (e.category === 'refund' ? -e.amount : e.amount), 0);

    // FIXED LOGIC:
    // Room stay charges (and their taxes) are already part of the initial reservation.totalAmount.
    // We only increment totalAmount for ADDITIONAL services (restaurant, laundry, etc.) posted later.
    // If the PARENT entry (the first one) is 'room', then NONE of the entries in this batch should increase totalAmount.
    const isRoomCharge = entry.category === 'room';
    
    // Calculate how much we should increase the projected total
    // If it's a room charge, we don't increase it at all.
    // If it's NOT a room charge, we increase it by EVERY debit in this batch (Entry + its Taxes)
    const projectedTotalAdj = isRoomCharge 
      ? 0 
      : entries.filter(e => e.type === 'debit' && e.category !== 'payment').reduce((acc, e) => acc + e.amount, 0);

    if (projectedTotalAdj !== 0) resUpdates.totalAmount = increment(projectedTotalAdj);
    if (totalCreditAdjustments !== 0) resUpdates.paidAmount = increment(totalCreditAdjustments);
    
    const totalBalanceAdj = guestBalanceAdj + corpBalanceAdj;
    if (totalBalanceAdj !== 0) resUpdates.ledgerBalance = increment(totalBalanceAdj);

    // Calculate new status
    const freshTotalAmount = (resData.totalAmount || 0) + projectedTotalAdj;
    const freshPaidAmount = (resData.paidAmount || 0) + totalCreditAdjustments;

    let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
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
  }

  // 6. Finance records
  const payments = entries.filter(e => (e.category === 'payment' || e.category === 'refund') && !e.corporateId);
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
      referenceId: postedIds[entries.indexOf(p)],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
  });

  // 7. Commit batch and Log once
  await batch.commit();
  await createAuditLog(hotelId, 'Ledger', 'POST_LEDGER_BATCH', `Posted ${entries.length} entries to ${reservationId} Folio. Status: ${entry.type}, Amount: ${entry.amount}`);

  return { id: postedIds[0], ...mainEntry };
};

export const deleteLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string }
) => {
  const { id, firestoreId, reservationId, guestId, corporateId, amount, type, category, description } = ledgerEntry;
  const docId = firestoreId || id;

  // 1. Delete from Ledger Collection (or mark as deleted/reversed for audit?)
  // For production PMS, usually we don't delete, we reverse. 
  // But if the user wants purely append-only, deletion is risky.
  // However, I will follow safe deletion if requested, but better to use safeUpdate to mark it.
  // For now, I'll stick to deletion as per existing logic but using safe tools.
  if (docId) {
    await deleteDoc(doc(db, 'hotels', hotelId, 'ledger', docId));
    await createAuditLog(hotelId, 'Ledger', 'DELETE_LEDGER_ENTRY', `Deleted ledger entry ${docId}`);
  }

  // 2. Synchronize Reservation
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId!);
  const resSnap = await getDoc(resRef);
  if (resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    const resUpdates: any = {};
    let totalAdj = 0;
    let paidAdj = 0;
    
    if (type === 'credit' && (category === 'payment' || category === 'refund')) {
      paidAdj = category === 'refund' ? amount : -amount;
      resUpdates.paidAmount = increment(paidAdj);
    }
    
    if (type === 'debit') {
      // Room charges and taxes associated with room charges do NOT affect totalAmount
      // because they were already factored into the projected total at booking.
      const isRoomRelated = category === 'room' || description.toLowerCase().includes('room charge');
      if (!isRoomRelated) {
        totalAdj = -amount;
        resUpdates.totalAmount = increment(totalAdj);
      }
    }

    // Adjust ledger balance
    const balanceAdj = type === 'debit' ? -amount : amount;
    resUpdates.ledgerBalance = increment(balanceAdj);

    // Recalculate status
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

    await database.safeUpdate(resRef, resUpdates, {
      hotelId,
      module: 'Reservation',
      action: 'SYNC_AFTER_DELETE',
      details: `Synced reservation after deleting ledger entry`
    });

    // 3. Delete corresponding Finance Record if payment
    if (type === 'credit' && category === 'payment') {
      const financeQ = query(
        collection(db, 'hotels', hotelId, 'finance'),
        where('referenceId', '==', docId)
      );
      const financeSnap = await getDocs(financeQ);
      for (const fDoc of financeSnap.docs) {
        await deleteDoc(fDoc.ref);
      }
    }
  }

  // 4. Reverse the balance update
  const reverseAmount = type === 'debit' ? -amount : amount;

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await database.safeUpdate(corpRef, {
      currentBalance: increment(reverseAmount),
      totalDebits: increment(type === 'debit' ? -amount : 0),
      totalCredits: increment(type === 'credit' ? -amount : 0)
    }, {
      hotelId,
      module: 'Corporate',
      action: 'REVERSE_BALANCE',
      details: `Reversed corporate balance by ${reverseAmount} due to deletion`
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await database.safeUpdate(guestRef, {
      ledgerBalance: increment(reverseAmount),
      totalSpent: increment(type === 'credit' && category === 'payment' ? -amount : 0)
    }, {
      hotelId,
      module: 'Guest',
      action: 'REVERSE_BALANCE',
      details: `Reversed guest balance by ${reverseAmount} due to deletion`
    });
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
  await postToLedger(hotelId, guestId, fromReservationId, {
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Balance Transfer to Res #${toReservationId.slice(-6).toUpperCase()}`,
    referenceId: toReservationId,
    postedBy
  }, postedBy, corporateId);

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
  
  await database.safeUpdate(doc(db, 'hotels', hotelId, 'corporate_accounts', fromCorporateId), {
    currentBalance: increment(-amount),
    totalCredits: increment(amount)
  }, {
    hotelId,
    module: 'Corporate',
    action: 'TRANSFER_OUT',
    details: `Transferred ${amount} out to ${toCorporateId}`
  });

  await database.safeUpdate(doc(db, 'hotels', hotelId, 'corporate_accounts', toCorporateId), {
    currentBalance: increment(amount),
    totalDebits: increment(amount)
  }, {
    hotelId,
    module: 'Corporate',
    action: 'TRANSFER_IN',
    details: `Transferred ${amount} in from ${fromCorporateId}`
  });

  await database.safeAdd(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    corporateId: fromCorporateId,
    reservationId: 'CORP_TRANSFER',
    timestamp,
    amount,
    type: 'credit',
    category: 'transfer',
    description: `Transfer to Corporate Account: ${toCorporateId} ${notes ? `(${notes})` : ''}`,
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
    description: `Transfer from Corporate Account: ${fromCorporateId} ${notes ? `(${notes})` : ''}`,
    postedBy
  }, {
    hotelId,
    module: 'Ledger',
    action: 'CORP_TRANSFER_LOG',
    details: `Logged in-transfer for corporate account`
  });
};
