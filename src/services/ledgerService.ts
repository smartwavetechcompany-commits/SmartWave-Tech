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

  // 1. Prepare entries list
  const entries: LedgerEntry[] = [ledgerEntry];

  // 2. Automatically post taxes if it's a room charge
  if (entry.category === 'room' && entry.type === 'debit') {
    const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
    if (hotelSnap.exists()) {
      const hotelData = hotelSnap.data();
      const activeTaxes = (hotelData.taxes || []).filter((t: any) => t.status === 'active' && (t.category === 'all' || t.category === 'room'));
      
      for (const tax of activeTaxes) {
        if (!tax.isInclusive) {
          const taxAmount = entry.amount * (tax.percentage / 100);
          const taxEntry: LedgerEntry = {
            id: Math.random().toString(36).substr(2, 9),
            timestamp,
            hotelId,
            guestId,
            reservationId,
            corporateId,
            type: 'debit',
            amount: taxAmount,
            description: `${tax.name} (${tax.percentage}%) for ${entry.description}`,
            category: 'tax',
            postedBy
          };
          entries.push(taxEntry);
          
          if (corporateId) {
            const taxCoverageEntry: LedgerEntry = {
              id: Math.random().toString(36).substr(2, 9) + '_tax_cov',
              timestamp,
              hotelId,
              guestId,
              reservationId,
              corporateId,
              type: 'credit',
              amount: taxAmount,
              description: `Corporate Coverage: ${tax.name}`,
              category: 'corporate',
              postedBy
            };
            entries.push(taxCoverageEntry);
          }
        }
      }
    }
  }

  // 3. Handle Corporate Coverage for the main entry
  if (corporateId && entry.type === 'debit') {
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
    entries.push(coverageEntry);
  }

  // 4. Prepare Reservation updates
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  const resUpdates: any = {
    ledgerEntries: arrayUnion(...entries)
  };

  // 5. Add all entries to Ledger Collection
  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const ledgerDocPromises = entries.map(e => addDoc(ledgerRef, e));

  // 6. Prepare Guest or Corporate Account updates
  let accountUpdatePromise;
  // Calculate total balance adjustment for this operation
  const totalBalanceAdjustment = entries.reduce((acc, e) => {
    return acc + (e.type === 'debit' ? e.amount : -e.amount);
  }, 0);

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    // For corporate accounts, we track the net balance of charges and payments
    accountUpdatePromise = updateDoc(corpRef, {
      currentBalance: increment(totalBalanceAdjustment),
      totalDebits: increment(entries.filter(e => e.type === 'debit').reduce((acc, e) => acc + e.amount, 0)),
      totalCredits: increment(entries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0))
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    accountUpdatePromise = updateDoc(guestRef, {
      ledgerBalance: increment(totalBalanceAdjustment),
      // Total spent should ONLY reflect actual guest payments (category 'payment')
      totalSpent: increment(entries.filter(e => e.type === 'credit' && e.category === 'payment').reduce((acc, e) => acc + e.amount, 0))
    });
  }

  // 7. Handle Payment Synchronization and Finance Record
  let financeUpdatePromise;
  const isPaymentOrRefund = entries.some(e => e.category === 'payment' || e.category === 'refund');
  const hasCorporateDebit = corporateId && entry.type === 'debit';

  if (isPaymentOrRefund || hasCorporateDebit) {
    const resSnap = await getDoc(resRef);
    if (resSnap.exists()) {
      const resData = resSnap.data() as Reservation;
      
      // paidAmount should ONLY reflect actual guest payments (category 'payment')
      const guestPaymentAmount = entries
        .filter(e => e.category === 'payment' && e.type === 'credit')
        .reduce((acc, e) => acc + e.amount, 0);
      
      const newPaidAmount = Math.max(0, (resData.paidAmount || 0) + guestPaymentAmount);
      
      // totalCoverage includes Guest Payments AND Corporate Coverage
      const totalCoverage = (resData.ledgerEntries || [])
        .filter(e => e.type === 'credit')
        .reduce((acc, e) => acc + e.amount, 0) + 
        entries.filter(e => e.type === 'credit').reduce((acc, e) => acc + e.amount, 0);

      // Correct payment status logic
      let newPaymentStatus: Reservation['paymentStatus'] = 'unpaid';
      const totalToPay = resData.totalAmount || 0;
      
      if (totalToPay > 0) {
        if (totalCoverage >= totalToPay) {
          newPaymentStatus = 'paid';
        } else if (totalCoverage > 0) {
          newPaymentStatus = 'partial';
        }
      } else if (totalCoverage > 0) {
        newPaymentStatus = 'paid';
      }
      
      resUpdates.paidAmount = newPaidAmount;
      resUpdates.paymentStatus = newPaymentStatus;
    }

    // Finance records for actual payments/refunds
    const payments = entries.filter(e => e.category === 'payment' || e.category === 'refund');
    if (payments.length > 0) {
      const financeRef = collection(db, 'hotels', hotelId, 'finance');
      const financePromises = payments.map(p => {
        const financeRecord: Omit<FinanceRecord, 'id'> = {
          type: p.type === 'credit' ? 'income' : 'expense',
          amount: p.amount,
          category: p.category === 'payment' ? 'Room Revenue' : 'Other',
          description: p.description,
          timestamp,
          paymentMethod,
          guestId,
          referenceId: p.id
        };
        return addDoc(financeRef, financeRecord);
      });
      financeUpdatePromise = Promise.all(financePromises);
    }
  }

  // 8. Execute all updates in parallel
  const results = await Promise.all([
    ...ledgerDocPromises,
    updateDoc(resRef, resUpdates),
    accountUpdatePromise,
    financeUpdatePromise
  ].filter(p => p !== undefined));

  return { ...ledgerEntry, firestoreId: results[0]?.id };
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
      currentBalance: increment(-amount),
      totalCredits: increment(amount)
    }),
    // 2. Credit to target corporate account
    updateDoc(doc(db, 'hotels', hotelId, 'corporate_accounts', toCorporateId), {
      currentBalance: increment(amount),
      totalDebits: increment(amount)
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
