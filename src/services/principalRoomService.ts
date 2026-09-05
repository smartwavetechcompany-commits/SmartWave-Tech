import { 
  collection, 
  doc, 
  writeBatch, 
  getDocs, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Reservation, LedgerEntry, Room } from '../types';
import { createAuditLog } from '../utils/database';
import { postToLedger, settleLedger } from './ledgerService';
import { toast } from 'sonner';

export interface GroupChargeBreakdown {
  id: string;
  description: string;
  sourceRoomNumber: string;
  sourceReservationId?: string;
  category: string;
  amount: number;
  type: 'debit' | 'credit';
  date: string;
  postedBy: string;
  postedByName?: string;
  paymentMethod?: string;
}

export interface GroupFinancialSummary {
  masterReservation: Reservation;
  linkedReservations: Reservation[];
  masterTotalAmount: number;
  masterPaidAmount: number;
  masterBalance: number;
  groupTotalCharges: number;
  groupTotalPayments: number;
  groupNetBalance: number;
  chargesByRoom: Record<string, {
    roomNumber: string;
    guestName: string;
    totalCharges: number;
    totalPayments: number;
    balance: number;
    entries: GroupChargeBreakdown[];
  }>;
  allGroupEntries: GroupChargeBreakdown[];
}

export const principalRoomService = {
  /**
   * Link one or more rooms to a Principal (Master) Room
   */
  async linkRoomsToPrincipal(
    hotelId: string,
    masterReservation: Reservation,
    childReservations: Reservation[],
    userContext?: { uid: string; email?: string; role?: string; displayName?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!hotelId || !masterReservation || childReservations.length === 0) {
      throw new Error('Missing parameters for grouping rooms');
    }

    // Verify child reservations aren't already masters with linked rooms
    for (const child of childReservations) {
      if (child.id === masterReservation.id) {
        throw new Error(`Cannot link room ${child.roomNumber} to itself.`);
      }
      if (child.isPrincipalRoom && child.linkedReservationIds && child.linkedReservationIds.length > 0) {
        throw new Error(`Room ${child.roomNumber} is already a master room with linked rooms. Unlink its rooms first.`);
      }
    }

    const batch = writeBatch(db);
    const existingLinkedIds = new Set(masterReservation.linkedReservationIds || []);
    const existingLinkedRooms = new Set(masterReservation.linkedRoomNumbers || []);

    const newlyAddedIds: string[] = [];
    const newlyAddedRooms: string[] = [];

    for (const child of childReservations) {
      existingLinkedIds.add(child.id);
      existingLinkedRooms.add(child.roomNumber);
      newlyAddedIds.push(child.id);
      newlyAddedRooms.push(child.roomNumber);

      const childDocRef = doc(db, 'hotels', hotelId, 'reservations', child.id);
      batch.update(childDocRef, {
        principalReservationId: masterReservation.id,
        principalRoomNumber: masterReservation.roomNumber,
        isPrincipalRoom: false,
        updatedAt: new Date().toISOString()
      });
    }

    const masterDocRef = doc(db, 'hotels', hotelId, 'reservations', masterReservation.id);
    batch.update(masterDocRef, {
      isPrincipalRoom: true,
      linkedReservationIds: Array.from(existingLinkedIds),
      linkedRoomNumbers: Array.from(existingLinkedRooms),
      updatedAt: new Date().toISOString()
    });

    await batch.commit();

    await createAuditLog(
      hotelId,
      'FrontDesk',
      'link_rooms_to_master',
      `Linked rooms [${newlyAddedRooms.join(', ')}] to Master Room ${masterReservation.roomNumber} (Guest: ${masterReservation.guestName})`,
      'success',
      {
        masterId: masterReservation.id,
        masterRoom: masterReservation.roomNumber,
        linkedIds: newlyAddedIds,
        linkedRooms: newlyAddedRooms
      },
      userContext
    );

    return {
      success: true,
      message: `Successfully linked ${newlyAddedRooms.join(', ')} to Master Room ${masterReservation.roomNumber}`
    };
  },

  /**
   * Unlink a room from a Principal Room (splits group during stay)
   */
  async unlinkRoomFromPrincipal(
    hotelId: string,
    masterReservation: Reservation,
    childReservation: Reservation,
    userContext?: { uid: string; email?: string; role?: string; displayName?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!hotelId || !masterReservation || !childReservation) {
      throw new Error('Missing parameters to unlink room');
    }

    const batch = writeBatch(db);

    const updatedLinkedIds = (masterReservation.linkedReservationIds || []).filter(id => id !== childReservation.id);
    const updatedLinkedRooms = (masterReservation.linkedRoomNumbers || []).filter(rm => rm !== childReservation.roomNumber);

    const masterDocRef = doc(db, 'hotels', hotelId, 'reservations', masterReservation.id);
    batch.update(masterDocRef, {
      linkedReservationIds: updatedLinkedIds,
      linkedRoomNumbers: updatedLinkedRooms,
      isPrincipalRoom: updatedLinkedIds.length > 0,
      updatedAt: new Date().toISOString()
    });

    const childDocRef = doc(db, 'hotels', hotelId, 'reservations', childReservation.id);
    batch.update(childDocRef, {
      principalReservationId: null,
      principalRoomNumber: null,
      updatedAt: new Date().toISOString()
    });

    await batch.commit();

    await createAuditLog(
      hotelId,
      'FrontDesk',
      'unlink_room_from_master',
      `Unlinked Room ${childReservation.roomNumber} from Master Room ${masterReservation.roomNumber}`,
      'success',
      {
        masterId: masterReservation.id,
        masterRoom: masterReservation.roomNumber,
        unlinkedRoomId: childReservation.id,
        unlinkedRoomNumber: childReservation.roomNumber
      },
      userContext
    );

    return {
      success: true,
      message: `Unlinked Room ${childReservation.roomNumber} from Master Room ${masterReservation.roomNumber}`
    };
  },

  /**
   * Move a linked room from one Master Room to another Master Room
   */
  async moveRoomToAnotherMaster(
    hotelId: string,
    currentMaster: Reservation,
    newMaster: Reservation,
    targetReservation: Reservation,
    userContext?: { uid: string; email?: string; role?: string; displayName?: string }
  ): Promise<{ success: boolean; message: string }> {
    if (!hotelId || !currentMaster || !newMaster || !targetReservation) {
      throw new Error('Missing parameters to transfer linked room');
    }

    const batch = writeBatch(db);

    // 1. Remove from current master
    const updatedOldLinkedIds = (currentMaster.linkedReservationIds || []).filter(id => id !== targetReservation.id);
    const updatedOldLinkedRooms = (currentMaster.linkedRoomNumbers || []).filter(rm => rm !== targetReservation.roomNumber);
    const oldMasterDocRef = doc(db, 'hotels', hotelId, 'reservations', currentMaster.id);
    batch.update(oldMasterDocRef, {
      linkedReservationIds: updatedOldLinkedIds,
      linkedRoomNumbers: updatedOldLinkedRooms,
      isPrincipalRoom: updatedOldLinkedIds.length > 0,
      updatedAt: new Date().toISOString()
    });

    // 2. Add to new master
    const updatedNewLinkedIds = Array.from(new Set([...(newMaster.linkedReservationIds || []), targetReservation.id]));
    const updatedNewLinkedRooms = Array.from(new Set([...(newMaster.linkedRoomNumbers || []), targetReservation.roomNumber]));
    const newMasterDocRef = doc(db, 'hotels', hotelId, 'reservations', newMaster.id);
    batch.update(newMasterDocRef, {
      isPrincipalRoom: true,
      linkedReservationIds: updatedNewLinkedIds,
      linkedRoomNumbers: updatedNewLinkedRooms,
      updatedAt: new Date().toISOString()
    });

    // 3. Update target reservation
    const targetDocRef = doc(db, 'hotels', hotelId, 'reservations', targetReservation.id);
    batch.update(targetDocRef, {
      principalReservationId: newMaster.id,
      principalRoomNumber: newMaster.roomNumber,
      updatedAt: new Date().toISOString()
    });

    await batch.commit();

    await createAuditLog(
      hotelId,
      'FrontDesk',
      'move_room_group',
      `Moved Room ${targetReservation.roomNumber} from Master Room ${currentMaster.roomNumber} to Master Room ${newMaster.roomNumber}`,
      'success',
      {
        targetReservationId: targetReservation.id,
        fromMasterId: currentMaster.id,
        toMasterId: newMaster.id
      },
      userContext
    );

    return {
      success: true,
      message: `Moved Room ${targetReservation.roomNumber} to Master Room ${newMaster.roomNumber}`
    };
  },

  /**
   * Post a charge with explicit source room identification (e.g. Accommodation - Room 213, Restaurant - Room 215)
   */
  async postGroupCharge(
    hotelId: string,
    chargeRoomNumber: string,
    reservation: Reservation,
    charge: {
      amount: number;
      category: 'room' | 'restaurant' | 'service' | 'laundry' | 'other' | string;
      description: string;
      quantity?: number;
      price?: number;
    },
    userContext: { uid: string; name?: string; role?: string }
  ) {
    const formattedDescription = charge.description.toLowerCase().includes(`room ${chargeRoomNumber}`)
      ? charge.description
      : `${charge.description} - Room ${chargeRoomNumber}`;

    return await postToLedger(
      hotelId,
      reservation.guestId || 'guest',
      reservation.id,
      {
        amount: charge.amount,
        type: 'debit',
        category: charge.category as any,
        description: formattedDescription,
        referenceId: reservation.id,
        postedBy: userContext.uid,
        quantity: charge.quantity || 1,
        price: charge.price || charge.amount,
        sourceRoomNumber: chargeRoomNumber,
        sourceReservationId: reservation.id,
        isLinkedRoomCharge: !!reservation.principalReservationId,
        masterReservationId: reservation.principalReservationId || (reservation.isPrincipalRoom ? reservation.id : undefined)
      } as any,
      userContext.uid
    );
  },

  /**
   * Post group payment / settlement to Master Folio or individual room
   */
  async postGroupPayment(
    hotelId: string,
    masterReservation: Reservation,
    splits: { amount: number; method: 'cash' | 'card' | 'transfer'; referenceCode?: string; proofUrl?: string }[],
    userContext: { uid: string; name?: string; role?: string },
    options?: { targetReservationId?: string; isConsolidated?: boolean; notes?: string }
  ) {
    const targetReservation = options?.targetReservationId 
      ? masterReservation 
      : masterReservation;

    for (const split of splits) {
      if (split.amount > 0) {
        await settleLedger(
          hotelId,
          targetReservation.guestId || 'group-guest',
          targetReservation.id,
          split.amount,
          split.method,
          userContext.uid,
          undefined,
          split.referenceCode,
          split.proofUrl
        );
      }
    }

    await createAuditLog(
      hotelId,
      'FrontDesk',
      'group_payment_settled',
      `Posted group payment of ${splits.reduce((sum, s) => sum + s.amount, 0)} to Master Room ${masterReservation.roomNumber} (${masterReservation.guestName})`,
      'success',
      {
        masterId: masterReservation.id,
        masterRoom: masterReservation.roomNumber,
        splits,
        options
      },
      userContext
    );
  },

  /**
   * Process Checkout for:
   * 1. Master room only
   * 2. Linked room only
   * 3. Entire group (Master + all Linked Rooms)
   */
  async checkoutGroup(
    hotelId: string,
    masterReservation: Reservation,
    allReservationsInGroup: Reservation[],
    mode: 'entire_group' | 'master_only' | 'linked_only',
    targetChildId?: string,
    userContext?: { uid: string; email?: string; role?: string; displayName?: string }
  ): Promise<{ success: boolean; message: string; checkedOutRooms: string[] }> {
    const batch = writeBatch(db);
    const checkedOutRooms: string[] = [];

    const nowIso = new Date().toISOString();

    if (mode === 'entire_group') {
      // Checkout master and all linked rooms
      for (const res of allReservationsInGroup) {
        const resRef = doc(db, 'hotels', hotelId, 'reservations', res.id);
        batch.update(resRef, {
          status: 'checked_out',
          operationalStatus: 'checked_out',
          checkOutDateTime: nowIso,
          updatedAt: nowIso
        });

        if (res.roomId) {
          const roomRef = doc(db, 'hotels', hotelId, 'rooms', res.roomId);
          batch.update(roomRef, {
            status: 'dirty',
            lastFlaggedAt: nowIso
          });
        }
        checkedOutRooms.push(res.roomNumber);
      }
    } else if (mode === 'master_only') {
      // Checkout master reservation only, but keep linked rooms active (or promote first linked to master)
      const resRef = doc(db, 'hotels', hotelId, 'reservations', masterReservation.id);
      batch.update(resRef, {
        status: 'checked_out',
        operationalStatus: 'checked_out',
        checkOutDateTime: nowIso,
        updatedAt: nowIso
      });

      if (masterReservation.roomId) {
        const roomRef = doc(db, 'hotels', hotelId, 'rooms', masterReservation.roomId);
        batch.update(roomRef, {
          status: 'dirty',
          lastFlaggedAt: nowIso
        });
      }
      checkedOutRooms.push(masterReservation.roomNumber);
    } else if (mode === 'linked_only' && targetChildId) {
      // Checkout a single linked room
      const targetRes = allReservationsInGroup.find(r => r.id === targetChildId);
      if (!targetRes) {
        throw new Error('Target linked room not found in group');
      }

      const resRef = doc(db, 'hotels', hotelId, 'reservations', targetRes.id);
      batch.update(resRef, {
        status: 'checked_out',
        operationalStatus: 'checked_out',
        checkOutDateTime: nowIso,
        updatedAt: nowIso
      });

      if (targetRes.roomId) {
        const roomRef = doc(db, 'hotels', hotelId, 'rooms', targetRes.roomId);
        batch.update(roomRef, {
          status: 'dirty',
          lastFlaggedAt: nowIso
        });
      }
      checkedOutRooms.push(targetRes.roomNumber);

      // Remove from master linked list
      const updatedLinkedIds = (masterReservation.linkedReservationIds || []).filter(id => id !== targetRes.id);
      const updatedLinkedRooms = (masterReservation.linkedRoomNumbers || []).filter(rm => rm !== targetRes.roomNumber);

      const masterDocRef = doc(db, 'hotels', hotelId, 'reservations', masterReservation.id);
      batch.update(masterDocRef, {
        linkedReservationIds: updatedLinkedIds,
        linkedRoomNumbers: updatedLinkedRooms,
        updatedAt: nowIso
      });
    }

    await batch.commit();

    await createAuditLog(
      hotelId,
      'FrontDesk',
      `group_checkout_${mode}`,
      `Checked out ${checkedOutRooms.join(', ')} under Master Room ${masterReservation.roomNumber} (${masterReservation.guestName}) [Mode: ${mode}]`,
      'success',
      {
        masterId: masterReservation.id,
        masterRoom: masterReservation.roomNumber,
        checkedOutRooms,
        mode
      },
      userContext
    );

    return {
      success: true,
      message: `Checked out rooms: ${checkedOutRooms.join(', ')}`,
      checkedOutRooms
    };
  },

  /**
   * Aggregate complete financial breakdown for Master + Linked rooms
   */
  calculateGroupFinancials(
    masterReservation: Reservation,
    linkedReservations: Reservation[],
    allLedgerEntries: LedgerEntry[]
  ): GroupFinancialSummary {
    const allResIds = new Set([masterReservation.id, ...linkedReservations.map(r => r.id)]);
    const resMap = new Map<string, Reservation>();
    resMap.set(masterReservation.id, masterReservation);
    linkedReservations.forEach(r => resMap.set(r.id, r));

    const roomNumberMap = new Map<string, string>();
    roomNumberMap.set(masterReservation.id, masterReservation.roomNumber);
    linkedReservations.forEach(r => roomNumberMap.set(r.id, r.roomNumber));

    const chargesByRoom: Record<string, {
      roomNumber: string;
      guestName: string;
      totalCharges: number;
      totalPayments: number;
      balance: number;
      entries: GroupChargeBreakdown[];
    }> = {};

    // Initialize all rooms
    for (const res of [masterReservation, ...linkedReservations]) {
      chargesByRoom[res.roomNumber] = {
        roomNumber: res.roomNumber,
        guestName: res.guestName,
        totalCharges: 0,
        totalPayments: 0,
        balance: 0,
        entries: []
      };
    }

    const allGroupEntries: GroupChargeBreakdown[] = [];

    // Filter ledger entries that belong to this group
    const relevantEntries = allLedgerEntries.filter(entry => {
      if (entry.reservationId && allResIds.has(entry.reservationId)) return true;
      if (entry.masterReservationId === masterReservation.id) return true;
      if (entry.sourceReservationId && allResIds.has(entry.sourceReservationId)) return true;
      return false;
    });

    for (const entry of relevantEntries) {
      // Determine source room
      let sourceRoom = entry.sourceRoomNumber;
      if (!sourceRoom && entry.reservationId && roomNumberMap.has(entry.reservationId)) {
        sourceRoom = roomNumberMap.get(entry.reservationId);
      }
      if (!sourceRoom) {
        sourceRoom = masterReservation.roomNumber;
      }

      const breakdown: GroupChargeBreakdown = {
        id: entry.id,
        description: entry.description,
        sourceRoomNumber: sourceRoom,
        sourceReservationId: entry.reservationId || entry.sourceReservationId,
        category: entry.category,
        amount: entry.amount,
        type: entry.type,
        date: entry.timestamp,
        postedBy: entry.postedBy,
        postedByName: (entry as any).postedByName || entry.postedBy,
        paymentMethod: entry.paymentMethod
      };

      allGroupEntries.push(breakdown);

      if (!chargesByRoom[sourceRoom]) {
        chargesByRoom[sourceRoom] = {
          roomNumber: sourceRoom,
          guestName: resMap.get(entry.reservationId || '')?.guestName || 'Guest',
          totalCharges: 0,
          totalPayments: 0,
          balance: 0,
          entries: []
        };
      }

      chargesByRoom[sourceRoom].entries.push(breakdown);
      if (entry.type === 'debit') {
        chargesByRoom[sourceRoom].totalCharges += entry.amount;
        chargesByRoom[sourceRoom].balance += entry.amount;
      } else {
        chargesByRoom[sourceRoom].totalPayments += entry.amount;
        chargesByRoom[sourceRoom].balance -= entry.amount;
      }
    }

    let groupTotalCharges = 0;
    let groupTotalPayments = 0;

    Object.values(chargesByRoom).forEach(group => {
      groupTotalCharges += group.totalCharges;
      groupTotalPayments += group.totalPayments;
    });

    const masterTotalAmount = chargesByRoom[masterReservation.roomNumber]?.totalCharges || 0;
    const masterPaidAmount = chargesByRoom[masterReservation.roomNumber]?.totalPayments || 0;
    const masterBalance = masterTotalAmount - masterPaidAmount;

    return {
      masterReservation,
      linkedReservations,
      masterTotalAmount,
      masterPaidAmount,
      masterBalance,
      groupTotalCharges,
      groupTotalPayments,
      groupNetBalance: groupTotalCharges - groupTotalPayments,
      chargesByRoom,
      allGroupEntries: allGroupEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
  }
};
