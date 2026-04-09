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

  // 1. Update Reservation ledgerEntries (for backward compatibility)
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  await updateDoc(resRef, {
    ledgerEntries: arrayUnion(ledgerEntry)
  });

  // 2. Add to Ledger Collection (for better querying and GuestFolio)
  const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
  const docRef = await addDoc(ledgerRef, ledgerEntry);
  
  // 3. Update Guest or Corporate Account balance
  const balanceAdjustment = entry.type === 'debit' ? -entry.amount : entry.amount;

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await updateDoc(corpRef, {
      currentBalance: increment(balanceAdjustment)
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await updateDoc(guestRef, {
      ledgerBalance: increment(balanceAdjustment),
      totalSpent: increment(entry.type === 'debit' ? entry.amount : 0)
    });
  }

  // 4. Synchronize Reservation paidAmount and paymentStatus if this is a payment
  if (entry.category === 'payment' || entry.category === 'refund') {
    if (entry.category === 'payment') {
      const resSnap = await getDoc(resRef);
      if (resSnap.exists()) {
        const resData = resSnap.data() as Reservation;
        const paymentAdjustment = entry.type === 'credit' ? entry.amount : -entry.amount;
        const newPaidAmount = Math.max(0, (resData.paidAmount || 0) + paymentAdjustment);
        const newPaymentStatus = newPaidAmount >= resData.totalAmount ? 'paid' : (newPaidAmount > 0 ? 'partial' : 'unpaid');
        
        await updateDoc(resRef, {
          paidAmount: newPaidAmount,
          paymentStatus: newPaymentStatus
        });
      }
    }

    // 5. Create Finance Record
    const financeRef = collection(db, 'hotels', hotelId, 'finance');
    const financeRecord: Omit<FinanceRecord, 'id'> = {
      type: entry.type === 'credit' ? 'income' : 'expense',
      amount: entry.amount,
      category: entry.category === 'payment' ? 'Room Revenue' : 'Other',
      description: entry.description,
      timestamp,
      paymentMethod,
      guestId,
      referenceId: docRef.id // Link to ledger entry
    };
    await addDoc(financeRef, financeRecord);
  }

  return { ...ledgerEntry, firestoreId: docRef.id };
};

export const postFullStayCharge = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  totalAmount: number,
  roomNumber: string,
  postedBy: string,
  corporateId?: string
) => {
  // Check if any room charges already exist to avoid double posting
  const ledgerQ = query(
    collection(db, 'hotels', hotelId, 'ledger'),
    where('reservationId', '==', reservationId),
    where('category', '==', 'room'),
    where('type', '==', 'debit')
  );
  const ledgerSnap = await getDocs(ledgerQ);
  if (ledgerSnap.docs.length > 0) return; // Already has room charges

  return postToLedger(hotelId, guestId, reservationId, {
    amount: totalAmount,
    type: 'debit',
    category: 'room',
    description: `Total Room Charge: Room ${roomNumber} (Full Stay)`,
    referenceId: reservationId,
    postedBy
  }, postedBy, corporateId);
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
      currentBalance: increment(reverseAmount)
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
