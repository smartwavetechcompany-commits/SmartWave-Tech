import { db } from '../firebase';
import { doc, increment, collection, getDoc, query, where, getDocs, deleteDoc, writeBatch, serverTimestamp } from 'firebase/firestore';
import { LedgerEntry, Reservation, FinanceRecord, Hotel } from '../types';
import { database, createAuditLog } from '../utils/database';
import { addDays, format } from 'date-fns';
import { parseLocalDateTime, BillingService } from '../utils/billingEngine';

export const postToLedger = async (
  hotelId: string,
  guestId: string,
  reservationId: string,
  entry: Omit<LedgerEntry, 'id' | 'timestamp' | 'hotelId' | 'guestId' | 'reservationId'>,
  postedBy: string,
  corporateId?: string,
  paymentMethod: 'cash' | 'card' | 'transfer' = 'cash'
) => {
  // 0. Prevent duplicate room / overstay charges
  if (entry.chargePeriodStart && entry.chargePeriodEnd && entry.chargeType) {
    const q = query(
      collection(db, 'hotels', hotelId, 'ledger'),
      where('reservationId', '==', reservationId),
      where('chargePeriodStart', '==', entry.chargePeriodStart),
      where('chargePeriodEnd', '==', entry.chargePeriodEnd),
      where('chargeType', '==', entry.chargeType),
      where('type', '==', 'debit')
    );
    const querySnap = await getDocs(q);
    if (!querySnap.empty) {
      const errMsg = `Duplicate charge detected and rejected: ${entry.chargeType} from ${entry.chargePeriodStart} to ${entry.chargePeriodEnd}.`;
      console.warn(errMsg);
      throw new Error(errMsg);
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

    batch.update(guestRef, {
      ledgerBalance: increment(guestBalanceAdj),
      totalSpent: increment(spentAdj),
      totalNights: increment(nightCountAdj)
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
    
    // Real cash/transfer payments: Credit payment entries increase paidAmount,
    // debit payment/refund entries decrease paidAmount
    const creditsSum = entries
      .filter(e => e.type === 'credit' && e.category === 'payment')
      .reduce((acc, e) => acc + e.amount, 0);

    const debitsSum = entries
      .filter(e => e.type === 'debit' && (e.category === 'payment' || e.category === 'refund'))
      .reduce((acc, e) => acc + e.amount, 0);

    const totalPaidAmountAdj = creditsSum - debitsSum;

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
    
    const totalBalanceAdj = guestBalanceAdj + corpBalanceAdj;
    if (totalBalanceAdj !== 0) resUpdates.ledgerBalance = increment(totalBalanceAdj);

    // Calculate new status
    const freshTotalAmount = (resData.totalAmount || 0) + projectedTotalAdj;
    const freshPaidAmount = (resData.paidAmount || 0) + totalPaidAmountAdj;

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
export const deleteLedgerEntry = async (
  hotelId: string,
  ledgerEntry: LedgerEntry & { firestoreId?: string }
) => {
  console.warn("deleteLedgerEntry is deprecated. Use voidLedgerEntry for production audit compliance.");
  const { id, firestoreId, reservationId, guestId, corporateId, amount, type, category, description } = ledgerEntry;
  const docId = firestoreId || id;

  // For backward compatibility, we still allow it but strongly discourage
  if (docId) {
    await database.safeDelete(doc(db, 'hotels', hotelId, 'ledger', docId), {
      hotelId,
      module: 'Ledger',
      action: 'DELETE_LEDGER_ENTRY',
      details: `Permanently deleted ledger entry ${docId} (Discouraged)`
    });
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
      const isRoomRelated = category === 'room' || description.toLowerCase().includes('room charge');
      if (!isRoomRelated) {
        totalAdj = -amount;
        resUpdates.totalAmount = increment(totalAdj);
      }
    }

    const balanceAdj = type === 'debit' ? -amount : amount;
    resUpdates.ledgerBalance = increment(balanceAdj);

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
  const nightlyRate = res.nightlyRate || (originalNights > 0 ? (res.totalAmount / originalNights) : 0) || 0;

  if (nightlyRate <= 0) {
    return { chargedCount: 0, totalAmount: 0 };
  }

  // Fetch ledger entries for this reservation
  const ledgerQ = query(
    collection(db, 'hotels', hotel.id, 'ledger'),
    where('reservationId', '==', res.id)
  );
  const ledgerSnap = await getDocs(ledgerQ);
  const ledgerEntries = ledgerSnap.docs.map(doc => ({ id: doc.id, ...doc.data() } as LedgerEntry));

  let chargedCount = 0;
  let totalAmountCharged = 0;
  let lastChargeTime = res.lastChargeDateTime;
  let nextChargeTime = res.nextChargeDateTime;

  // 1. Process Base Stay Nights
  for (let i = 1; i <= originalNights; i++) {
    const Start = i === 1 
      ? checkInDateTime 
      : parseLocalDateTime(format(addDays(checkInDateTime, i - 1), 'yyyy-MM-dd'), checkOutTime);
    const End = parseLocalDateTime(format(addDays(checkInDateTime, i), 'yyyy-MM-dd'), checkOutTime);

    // This night is chargeable if currentTime is past its start time, OR if it's the first night (since guest has checked in)
    const isNightChargeable = i === 1 || currentTime >= Start;
    if (isNightChargeable) {
      const startStr = Start.toISOString();
      const endStr = End.toISOString();

      // Check if already posted
      const exists = ledgerEntries.some(e => {
        // Match exact period if available
        if (e.chargePeriodStart === startStr && e.chargePeriodEnd === endStr && e.chargeType === 'room_rate' && e.type === 'debit') {
          return true;
        }
        // Fallback: if i === 1 and there is ANY room debit in the ledger, treat it as representing Night 1
        if (i === 1 && e.category === 'room' && e.type === 'debit') {
          return true;
        }
        return false;
      });

      if (!exists) {
        await postToLedger(hotel.id, res.guestId, res.id, {
          amount: nightlyRate,
          type: 'debit',
          category: 'room',
          description: `Nightly Room Charge: ${res.roomNumber} (Night of ${format(Start, 'MMM dd, yyyy')}) (Night ${i} of ${originalNights})`,
          referenceId: res.id,
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

  // 2. Process Overstay Nights
  if (currentTime > checkOutDateTime && hotel.autoChargeOverstays !== false) {
    const policy = hotel?.overstayPolicy || 'grace';
    const graceHours = hotel?.overstayGraceHours ?? 2;
    const partialHours = hotel?.overstayPartialHours ?? 3;
    const partialPercentage = hotel?.overstayPartialPercentage ?? 50;
    const fullHours = hotel?.overstayFullHours ?? 6;

    const hoursPast = (currentTime.getTime() - checkOutDateTime.getTime()) / (1000 * 60 * 60);
    const maxOverstayDays = Math.ceil(hoursPast / 24);

    for (let j = 1; j <= maxOverstayDays; j++) {
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
          const postedAmount = ledgerEntries
            .filter(e => 
              e.chargePeriodStart === startStr && 
              e.chargePeriodEnd === endStr && 
              e.chargeType === 'overstay' && 
              e.type === 'debit'
            )
            .reduce((sum, e) => sum + e.amount, 0);

          if (postedAmount < targetAmount - 0.01) {
            const dueAmount = targetAmount - postedAmount;
            
            await postToLedger(hotel.id, res.guestId, res.id, {
              amount: dueAmount,
              type: 'debit',
              category: 'room',
              description: `Overstay Room Charge: ${res.roomNumber} (Night of ${format(Start, 'MMM dd, yyyy')}) (Period ${j} past checkout)${postedAmount > 0 ? ' [Upgrade to Full]' : ''}`,
              referenceId: res.id,
              postedBy: profileUid,
              chargePeriodStart: startStr,
              chargePeriodEnd: endStr,
              chargeType: 'overstay'
            } as any, profileUid, res.corporateId);

            chargedCount++;
            totalAmountCharged += dueAmount;
            lastChargeTime = currentTime.toISOString();
            nextChargeTime = BillingService.calculateNextChargeDateTime(res, hotel, originalNights + j).toISOString();
          }
        }
      }
    }
  }

  // 3. Update the Reservation fields in the database
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

  return { chargedCount, totalAmount: totalAmountCharged };
};
