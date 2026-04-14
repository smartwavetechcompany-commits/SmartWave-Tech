import { db } from '../firebase';
import { doc, updateDoc, increment, arrayUnion, collection, addDoc, deleteDoc, getDoc, query, where, getDocs, arrayRemove } from 'firebase/firestore';
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
  const timestamp = new Date().toISOString();
  const ledgerEntry: LedgerEntry = {
    ...entry,
    id: Math.random().toString(36).substr(2, 9),
    timestamp,
    hotelId,
    guestId,
    reservationId,
    corporateId,
    postedBy
  };

  // 1. Prepare Reservation updates
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resUpdates: any = {
    ledgerEntries: arrayUnion(ledgerEntry)
  };

  // 2. Add to Ledger Collection
  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const ledgerDocPromise = addDoc(ledgerRef, ledgerEntry);

  // 3. Prepare Guest or Corporate Account updates
  let accountUpdatePromise;
  // Debit (charge) increases what the guest owes. Credit (payment) decreases it.
  // We'll treat ledgerBalance as "Amount Owed" (positive = owes money, negative = credit).
  const balanceAdjustment = entry.type === 'debit' ? entry.amount : -entry.amount;

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    accountUpdatePromise = updateDoc(corpRef, {
      currentBalance: increment(balanceAdjustment),
      totalDebits: increment(entry.type === 'debit' ? entry.amount : 0)
    });

    // If it's a debit (charge) for a corporate guest, we automatically "pay" the guest folio
    // from the corporate account so the guest sees a 0 balance.
    if (entry.type === 'debit') {
      const coverageEntry: LedgerEntry = {
        id: Math.random().toString(36).substr(2, 9) + '_cov',
        timestamp,
        hotelId,
        guestId,
        reservationId,
        corporateId,
        type: 'credit',
        amount: entry.amount,
        description: `Corporate Coverage: ${entry.description}`,
        category: 'corporate',
        postedBy
      };
      resUpdates.ledgerEntries = arrayUnion(ledgerEntry, coverageEntry);
      resUpdates.paidAmount = increment(entry.amount);
      // We don't update paymentStatus here as it's handled below if needed, 
      // but actually we should update it to 'paid' if it's fully covered.
    }
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    accountUpdatePromise = updateDoc(guestRef, {
      ledgerBalance: increment(balanceAdjustment),
      totalSpent: increment(entry.type === 'debit' ? entry.amount : 0)
    });
  }

  // 4. Handle Payment Synchronization and Finance Record
  let financeUpdatePromise;
  if (entry.category === 'payment' || entry.category === 'refund' || (corporateId && entry.type === 'debit')) {
    // We still need the current paidAmount to calculate the new status correctly
    const resSnap = await getDoc(resRef);
    if (resSnap.exists()) {
      const resData = resSnap.data() as Reservation;
      const paymentAdjustment = entry.type === 'credit' ? entry.amount : (corporateId ? entry.amount : -entry.amount);
      const newPaidAmount = Math.max(0, (resData.paidAmount || 0) + paymentAdjustment);
      
      // Correct payment status logic
      let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
      const totalToPay = resData.totalAmount || 0;
      
      if (totalToPay > 0) {
        if (newPaidAmount >= totalToPay) {
          newPaymentStatus = 'paid';
        } else if (newPaidAmount > 0) {
          newPaymentStatus = 'partial';
        }
      } else if (newPaidAmount > 0) {
        newPaymentStatus = 'paid'; // If total is 0 but they paid something, it's paid
      }
      
      resUpdates.paidAmount = newPaidAmount;
      resUpdates.paymentStatus = newPaymentStatus;
    }

    if (entry.category === 'payment' || entry.category === 'refund') {
      const financeRef = collection(db, 'hotels', hotelId, 'finance');
      const financeRecord: Omit<FinanceRecord, 'id'> = {
        type: entry.type === 'credit' ? 'income' : 'expense',
        amount: entry.amount,
        category: entry.category === 'payment' ? 'Room Revenue' : 'Other',
        description: entry.description,
        timestamp,
        paymentMethod,
        guestId,
        referenceId: ledgerEntry.id // Use the generated ID for consistency
      };
      financeUpdatePromise = addDoc(financeRef, financeRecord);
    }
  }

  // 5. Execute all updates in parallel
  const [ledgerDoc] = await Promise.all([
    ledgerDocPromise,
    updateDoc(resRef, resUpdates),
    accountUpdatePromise,
    financeUpdatePromise
  ].filter(p => p !== undefined));

  return { ...ledgerEntry, firestoreId: ledgerDoc?.id };
};

export const deleteLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string }
) => {
  const { id, firestoreId, reservationId, guestId, corporateId, amount, type, category } = ledgerEntry;

  // 1. Remove from Ledger Collection
  if (firestoreId) {
    await deleteDoc(doc(db, 'hotels', hotelId, 'ledger', firestoreId));
  }

  // 2. Remove from Reservation array
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resSnap = await getDoc(resRef);
  if (resSnap.exists()) {
    const resData = resSnap.data() as Reservation;
    const entryToRemove = resData.ledgerEntries?.find(e => e.id === id);
    if (entryToRemove) {
      await updateDoc(resRef, {
        ledgerEntries: arrayRemove(entryToRemove)
      });
    }

    // 4. Synchronize Reservation paidAmount and paymentStatus if this was a payment
    if (type === 'credit' && category === 'payment') {
      const newPaidAmount = Math.max(0, (resData.paidAmount || 0) - amount);
      const newPaymentStatus = newPaidAmount >= resData.totalAmount ? 'paid' : (newPaidAmount > 0 ? 'partial' : 'unpaid');
      
      await updateDoc(resRef, {
        paidAmount: newPaidAmount,
        paymentStatus: newPaymentStatus
      });

      // 5. Delete corresponding Finance Record
      const financeQ = query(
        collection(db, 'hotels', hotelId, 'finance'),
        where('referenceId', '==', firestoreId)
      );
      const financeSnap = await getDocs(financeQ);
      for (const fDoc of financeSnap.docs) {
        await deleteDoc(fDoc.ref);
      }
    }
  }

  // 3. Reverse the balance update
  const reverseAmount = type === 'debit' ? amount : -amount;

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await updateDoc(corpRef, {
      currentBalance: increment(reverseAmount),
      totalDebits: increment(type === 'debit' ? -amount : 0)
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await updateDoc(guestRef, {
      ledgerBalance: increment(reverseAmount),
      totalSpent: increment(type === 'debit' ? -amount : 0)
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
  // We do this by posting a debit that doesn't affect the reservation's paidAmount logic
  // but affects the ledgerBalance. 
  // Actually, postToLedger already updated the balance (credit reduced it).
  // So we need to add it back.
  
  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await updateDoc(corpRef, {
      currentBalance: increment(amount)
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await updateDoc(guestRef, {
      ledgerBalance: increment(amount)
    });
  }

  // 3. Log the transfer
  await addDoc(collection(db, 'hotels', hotelId, 'ledger'), {
    hotelId,
    guestId,
    corporateId,
    reservationId: 'CITY_LEDGER', // Special ID for non-folio debt
    timestamp: new Date().toISOString(),
    amount,
    type: 'debit',
    category: 'city_ledger',
    description: `City Ledger Debt from Res #${reservationId.slice(-6).toUpperCase()}`,
    referenceId: reservationId,
    postedBy
  });
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
  const batch = [
    // 1. Debit from source corporate account (increases balance if it's a debt transfer, or decreases if it's a credit transfer)
    // Actually, usually we transfer debt. So source balance decreases, target balance increases.
    updateDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', fromCorporateId), {
      currentBalance: increment(-amount)
    }),
    // 2. Credit to target corporate account
    updateDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', toCorporateId), {
      currentBalance: increment(amount)
    }),
    // 3. Log entries in ledger
    addDoc(collection(db, 'hotels', hotelId, 'ledger'), {
      hotelId,
      corporateId: fromCorporateId,
      reservationId: 'CORP_TRANSFER',
      timestamp,
      amount,
      type: 'credit',
      category: 'transfer',
      description: `Transfer to Corporate Account: ${toCorporateId} ${notes ? `(${notes})` : ''}`,
      postedBy
    }),
    addDoc(collection(db, 'hotels', hotelId, 'ledger'), {
      hotelId,
      corporateId: toCorporateId,
      reservationId: 'CORP_TRANSFER',
      timestamp,
      amount,
      type: 'debit',
      category: 'transfer',
      description: `Transfer from Corporate Account: ${fromCorporateId} ${notes ? `(${notes})` : ''}`,
      postedBy
    })
  ];

  await Promise.all(batch);
};
