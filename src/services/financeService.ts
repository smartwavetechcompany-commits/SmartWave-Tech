import { db } from '../firebase';
import { collection, doc, getDoc } from 'firebase/firestore';
import { Reservation, Room, Guest, Hotel } from '../types';
import { processAutomatedBillingForReservation, reconcileAndRepairReservationFinancials } from './ledgerService';
import { database } from '../utils/database';

export const syncDailyCharges = async (
  hotelId: string,
  profileId: string,
  profileEmail: string,
  reservations: Reservation[],
  rooms: Room[],
  guests: Guest[]
) => {
  const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
  if (!hotelSnap.exists()) {
    return { chargedCount: 0, totalAmount: 0 };
  }
  const hotel = { id: hotelSnap.id, ...hotelSnap.data() } as Hotel;

  let chargedCount = 0;
  let totalAmount = 0;

  for (const res of reservations) {
    if (res.status !== 'checked_in') continue;

    try {
      // RULE 1 & 9: Auto-reconcile and purge any duplicates first
      await reconcileAndRepairReservationFinancials(hotelId, res.id);

      // Process automated nightly billing
      const resResult = await processAutomatedBillingForReservation(hotel, res, profileId, new Date());
      chargedCount += resResult.chargedCount;
      totalAmount += resResult.totalAmount;
    } catch (err) {
      console.error(`Error during finance sync for reservation ${res.id}:`, err);
    }
  }

  // Log the sync
  if (chargedCount > 0) {
    await database.safeAdd(collection(db, 'hotels', hotelId, 'activityLogs') as any, {
      timestamp: new Date().toISOString(),
      userId: profileId,
      userEmail: profileEmail,
      action: 'FINANCE_SYNC_CHARGES',
      resource: `Synced ${chargedCount} nightly charges totaling ${totalAmount}`,
      hotelId: hotelId,
      module: 'Finance'
    }, {
      hotelId,
      module: 'Finance',
      action: 'SYNC_CHARGES_LOG',
      details: `Logged sync of ${chargedCount} charges`
    });
  }

  return { chargedCount, totalAmount };
};
