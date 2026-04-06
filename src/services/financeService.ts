import { db } from '../firebase';
import { collection, getDocs, query, where, doc, setDoc, addDoc, writeBatch, increment } from 'firebase/firestore';
import { Reservation, Room, Guest, OperationType } from '../types';
import { postToLedger } from './ledgerService';
import { format, addDays, differenceInDays, parseISO, isBefore, startOfDay } from 'date-fns';

export const syncDailyCharges = async (
  hotelId: string,
  profileId: string,
  profileEmail: string,
  reservations: Reservation[],
  rooms: Room[],
  guests: Guest[]
) => {
  const today = startOfDay(new Date());
  const todayStr = format(today, 'yyyy-MM-dd');
  let chargedCount = 0;
  let totalAmount = 0;

  const batch = writeBatch(db);

  for (const res of reservations) {
    if (res.status !== 'checked_in') continue;

    const room = rooms.find(r => r.id === res.roomId);
    if (!room) continue;

    // Calculate how many nights they've stayed so far
    const checkInDate = startOfDay(parseISO(res.checkIn));
    const nightsStayedSoFar = Math.max(0, differenceInDays(today, checkInDate));

    // We should have 'nightsStayedSoFar' charges in the ledger
    // But wait, the first night is usually charged at check-in.
    // Let's check the ledger for this reservation
    const ledgerRef = collection(db, 'hotels', hotelId, 'ledger');
    const q = query(ledgerRef, where('reservationId', '==', res.id), where('category', '==', 'room'));
    const ledgerSnap = await getDocs(q);
    const existingChargesCount = ledgerSnap.docs.length;

    // If they've stayed 3 nights, they should have 3 charges.
    // If they overstay, nightsStayedSoFar will be > (checkOut - checkIn).
    
    const chargesNeeded = nightsStayedSoFar + 1; // +1 because we charge for the current night too? 
    // Actually, usually hotels charge at the end of the day or at check-in.
    // Let's say: at any point, they should have been charged for all nights up to (and including) tonight.
    
    if (existingChargesCount < chargesNeeded) {
      const nightsToCharge = chargesNeeded - existingChargesCount;
      
      for (let i = 0; i < nightsToCharge; i++) {
        const chargeDate = addDays(checkInDate, existingChargesCount + i);
        const chargeDateStr = format(chargeDate, 'MMM dd, yyyy');
        
        // Calculate nightly rate
        let nightlyRate = res.nightlyRate || room.price;
        
        await postToLedger(hotelId, res.guestId || 'unknown', res.id, {
          amount: nightlyRate,
          type: 'debit',
          category: 'room',
          description: `Nightly room charge - ${chargeDateStr} (Room ${res.roomNumber})`,
          referenceId: res.id,
          postedBy: profileId
        }, profileId, res.corporateId);

        chargedCount++;
        totalAmount += nightlyRate;
      }
    }
  }

  // Log the sync
  if (chargedCount > 0) {
    await addDoc(collection(db, 'hotels', hotelId, 'activityLogs'), {
      timestamp: new Date().toISOString(),
      userId: profileId,
      userEmail: profileEmail,
      action: 'FINANCE_SYNC_CHARGES',
      resource: `Synced ${chargedCount} nightly charges totaling ${totalAmount}`,
      hotelId: hotelId,
      module: 'Finance'
    });
  }

  return { chargedCount, totalAmount };
};
