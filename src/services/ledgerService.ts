import { db } from '../firebase';
import { doc, updateDoc, increment, arrayUnion, getDoc } from 'firebase/firestore';
import { LedgerEntry, Guest, Reservation } from '../types';

export const postToLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'hotelId' | 'guestId'>,
  postedBy: string,
  corporateId?: string
) => {
  const timestamp = new Date().toISOString();
  const ledgerEntry: LedgerEntry = {
    ...entry,
    id: Math.random().toString(36).substr(2, 9),
    timestamp,
    hotelId,
    guestId,
    postedBy
  };

  // 1. Update Reservation ledgerEntries
  const resRef = doc(db, 'hotels', hotelId, 'reservations', reservationId);
  await updateDoc(resRef, {
    ledgerEntries: arrayUnion(ledgerEntry)
  });

  // 2. Update Guest or Corporate Account balance
  const amount = entry.type === 'debit' ? entry.amount : -entry.amount;

  if (corporateId) {
    const corpRef = doc(db, 'hotels', hotelId, 'corporate_accounts', corporateId);
    await updateDoc(corpRef, {
      currentBalance: increment(amount)
    });
  } else {
    const guestRef = doc(db, 'hotels', hotelId, 'guests', guestId);
    await updateDoc(guestRef, {
      ledgerBalance: increment(amount),
      totalSpent: increment(entry.type === 'debit' ? entry.amount : 0)
    });
  }

  return ledgerEntry;
};

export const settleLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  amount: number,
  paymentMethod: string,
  postedBy: string
) => {
  return postToLedger(hotelId, guestId, reservationId, {
    amount,
    type: 'credit',
    category: 'payment',
    description: `Payment via ${paymentMethod}`,
    referenceId: reservationId,
    postedBy
  }, postedBy);
};
