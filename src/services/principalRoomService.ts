import { 
  collection, 
  doc, 
  writeBatch, 
  getDoc,
  getDocs, 
  query, 
  where, 
  serverTimestamp 
} from 'firebase/firestore';
import { db } from '../firebase';
import { Reservation, LedgerEntry, Room, Hotel } from '../types';
import { createAuditLog } from '../utils/database';
import { postToLedger, settleLedger, syncKitchenOrdersForReservation } from './ledgerService';
import { validateLedgerTransaction } from './financialService';
import { calculateBilling, getReservationLiveBalance } from '../utils/billingEngine';
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

export interface PlannedPaymentAllocation {
  reservation: Reservation;
  amount: number;
  method: 'cash' | 'card' | 'transfer';
  referenceCode?: string;
  proofUrl?: string;
  isExcessMasterCredit: boolean;
}

export interface GroupPaymentPlan {
  masterInitialBalance: number;
  targets: Array<{ reservation: Reservation; remainingOwed: number }>;
  allocations: PlannedPaymentAllocation[];
  totalSubmitted: number;
  totalAllocatedToDebt: number;
  masterExcess: number;
}

const computeGroupReservationBalance = (
  res: Reservation,
  entries: LedgerEntry[],
  hotel?: Hotel | null
): number => {
  const resLedger = entries.filter(
    e => e.reservationId === res.id && validateLedgerTransaction(e).isValid
  );
  if (hotel) {
    return getReservationLiveBalance(res, hotel, resLedger);
  }
  if (resLedger.length > 0) {
    const debits = resLedger
      .filter(e => e.type === 'debit' && e.category !== 'refund')
      .reduce((s, e) => s + e.amount, 0);
    const credits = resLedger
      .filter(e => e.type === 'credit')
      .reduce((s, e) => s + e.amount, 0);
    const refunds = resLedger
      .filter(e => e.type === 'debit' && e.category === 'refund')
      .reduce((s, e) => s + e.amount, 0);
    return Number((debits - Math.max(0, credits - refunds)).toFixed(2));
  }
  return res.ledgerBalance !== undefined
    ? Number(res.ledgerBalance.toFixed(2))
    : Number(((res.totalAmount || 0) - (res.paidAmount || 0)).toFixed(2));
};

export function planGroupPaymentAllocation(
  masterReservation: Reservation,
  linkedReservations: Reservation[],
  splits: { amount: number; method: 'cash' | 'card' | 'transfer'; referenceCode?: string; proofUrl?: string }[],
  entries: LedgerEntry[],
  hotel?: Hotel | null
): GroupPaymentPlan {
  const dedupedLinked: Reservation[] = [];
  const seenIds = new Set<string>([masterReservation.id]);
  for (const r of linkedReservations) {
    if (!r || !r.id || seenIds.has(r.id)) continue;
    if (r.status === 'cancelled' || r.status === 'no_show') continue;
    seenIds.add(r.id);
    dedupedLinked.push(r);
  }

  const groupReservations = [masterReservation, ...dedupedLinked];
  const masterInitialBalance = Number(computeGroupReservationBalance(masterReservation, entries, hotel).toFixed(2));
  const targets = groupReservations.map(res => ({
    reservation: res,
    remainingOwed: Math.max(0, Number(computeGroupReservationBalance(res, entries, hotel).toFixed(2)))
  }));

  const allocations: PlannedPaymentAllocation[] = [];
  let totalSubmitted = 0;
  let totalAllocatedToDebt = 0;
  let masterExcess = 0;

  for (const split of splits) {
    let remainingSplit = Number((Number(split.amount) || 0).toFixed(2));
    if (remainingSplit <= 0) continue;
    totalSubmitted = Number((totalSubmitted + remainingSplit).toFixed(2));

    for (const target of targets) {
      if (remainingSplit <= 0.01) break;
      if (target.remainingOwed <= 0.01) continue;

      const allocAmount = Number(Math.min(remainingSplit, target.remainingOwed).toFixed(2));
      if (allocAmount <= 0.01) continue;

      target.remainingOwed = Number((target.remainingOwed - allocAmount).toFixed(2));
      remainingSplit = Number((remainingSplit - allocAmount).toFixed(2));
      totalAllocatedToDebt = Number((totalAllocatedToDebt + allocAmount).toFixed(2));

      allocations.push({
        reservation: target.reservation,
        amount: allocAmount,
        method: split.method,
        referenceCode: split.referenceCode,
        proofUrl: split.proofUrl,
        isExcessMasterCredit: false
      });
    }

    if (remainingSplit > 0.01) {
      masterExcess = Number((masterExcess + remainingSplit).toFixed(2));
      allocations.push({
        reservation: masterReservation,
        amount: remainingSplit,
        method: split.method,
        referenceCode: split.referenceCode,
        proofUrl: split.proofUrl,
        isExcessMasterCredit: true
      });
    }
  }

  return {
    masterInitialBalance,
    targets,
    allocations,
    totalSubmitted,
    totalAllocatedToDebt,
    masterExcess
  };
}

async function resolveGroupContext(
  hotelId: string,
  masterReservation: Reservation,
  options?: { linkedReservations?: Reservation[]; hotel?: Hotel | null }
): Promise<{ master: Reservation; linked: Reservation[]; hotel: Hotel | null }> {
  let resolvedHotel = options?.hotel ?? null;
  if (options?.hotel === undefined) {
    try {
      const hotelSnap = await getDoc(doc(db, 'hotels', hotelId));
      if (hotelSnap.exists()) {
        resolvedHotel = { id: hotelSnap.id, ...hotelSnap.data() } as Hotel;
      }
    } catch (err) {
      console.warn('Could not load hotel in resolveGroupContext:', err);
    }
  }

  let resolvedMaster = masterReservation;
  const passedLinked = options?.linkedReservations;
  if (passedLinked && passedLinked.length > 0) {
    const seen = new Set<string>([resolvedMaster.id]);
    const cleanLinked = passedLinked.filter(r => {
      if (!r || !r.id || seen.has(r.id)) return false;
      if (r.status === 'cancelled' || r.status === 'no_show') return false;
      seen.add(r.id);
      return true;
    });
    return { master: resolvedMaster, linked: cleanLinked, hotel: resolvedHotel };
  }

  // Fallback / automatic Firestore lookup when caller omitted or passed empty linkedReservations
  const linkedMap = new Map<string, Reservation>();
  try {
    const masterSnap = await getDoc(doc(db, 'hotels', hotelId, 'reservations', masterReservation.id));
    if (masterSnap.exists()) {
      resolvedMaster = { id: masterSnap.id, ...masterSnap.data() } as Reservation;
    }

    const qLinked = query(
      collection(db, 'hotels', hotelId, 'reservations'),
      where('principalReservationId', '==', resolvedMaster.id)
    );
    const linkedSnap = await getDocs(qLinked);
    linkedSnap.docs.forEach(d => {
      const data = { id: d.id, ...d.data() } as Reservation;
      if (data.id !== resolvedMaster.id && data.status !== 'cancelled' && data.status !== 'no_show') {
        linkedMap.set(data.id, data);
      }
    });

    for (const linkedId of resolvedMaster.linkedReservationIds || []) {
      if (!linkedId || linkedId === resolvedMaster.id || linkedMap.has(linkedId)) continue;
      const childSnap = await getDoc(doc(db, 'hotels', hotelId, 'reservations', linkedId));
      if (childSnap.exists()) {
        const data = { id: childSnap.id, ...childSnap.data() } as Reservation;
        if (data.status !== 'cancelled' && data.status !== 'no_show') {
          linkedMap.set(data.id, data);
        }
      }
    }
  } catch (err) {
    console.warn('Could not resolve linked reservations from Firestore:', err);
  }

  return {
    master: resolvedMaster,
    linked: Array.from(linkedMap.values()),
    hotel: resolvedHotel
  };
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
   * Reallocate any existing excess overpayment credit on the Master Room folio
   * to settle outstanding debt on linked rooms without inflating charges or duplicating Finance revenue.
   */
  async reallocateMasterCreditToLinkedRooms(
    hotelId: string,
    masterReservation: Reservation,
    linkedReservations: Reservation[],
    userContext: { uid: string; name?: string; role?: string },
    options?: { ledgerEntries?: LedgerEntry[]; hotel?: Hotel | null }
  ): Promise<{ appliedAmount: number; settledRooms: string[] }> {
    if (!hotelId || !masterReservation) {
      return { appliedAmount: 0, settledRooms: [] };
    }

    const { master: resolvedMaster, linked: resolvedLinked, hotel: resolvedHotel } =
      await resolveGroupContext(hotelId, masterReservation, {
        linkedReservations,
        hotel: options?.hotel
      });

    if (resolvedLinked.length === 0) {
      return { appliedAmount: 0, settledRooms: [] };
    }

    let entries = options?.ledgerEntries;
    if (!entries) {
      const snap = await getDocs(collection(db, 'hotels', hotelId, 'ledger'));
      entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
    }

    let availableMasterCredit = Math.max(
      0,
      Number((-computeGroupReservationBalance(resolvedMaster, entries, resolvedHotel)).toFixed(2))
    );
    if (availableMasterCredit <= 0.01) {
      return { appliedAmount: 0, settledRooms: [] };
    }

    let totalApplied = 0;
    const settledRooms: string[] = [];

    for (const child of resolvedLinked) {
      if (availableMasterCredit <= 0.01) break;
      const childOwed = Math.max(
        0,
        Number(computeGroupReservationBalance(child, entries, resolvedHotel).toFixed(2))
      );
      if (childOwed <= 0.01) continue;

      const applyAmt = Number(Math.min(availableMasterCredit, childOwed).toFixed(2));
      if (applyAmt <= 0.01) continue;

      await postToLedger(
        hotelId,
        resolvedMaster.guestId || 'group-guest',
        resolvedMaster.id,
        {
          amount: applyAmt,
          type: 'debit',
          category: 'refund',
          description: `Master Credit Applied to Linked Room ${child.roomNumber}`,
          referenceId: child.id,
          postedBy: userContext.uid,
          skipAutomaticTax: true,
          skipFinanceMirror: true,
          masterReservationId: resolvedMaster.id,
          sourceRoomNumber: resolvedMaster.roomNumber,
          sourceReservationId: resolvedMaster.id
        } as any,
        userContext.uid,
        resolvedMaster.corporateId || undefined,
        'cash',
        { uid: userContext.uid, displayName: userContext.name, role: userContext.role }
      );

      await postToLedger(
        hotelId,
        child.guestId || 'group-guest',
        child.id,
        {
          amount: applyAmt,
          type: 'credit',
          category: 'payment',
          description: `Settled via Master Room ${resolvedMaster.roomNumber} Credit`,
          referenceId: resolvedMaster.id,
          postedBy: userContext.uid,
          skipAutomaticTax: true,
          skipFinanceMirror: true,
          settlementSource: 'Front Desk',
          masterReservationId: resolvedMaster.id,
          sourceRoomNumber: child.roomNumber,
          sourceReservationId: child.id
        } as any,
        userContext.uid,
        child.corporateId || undefined,
        'cash',
        { uid: userContext.uid, displayName: userContext.name, role: userContext.role }
      );

      await syncKitchenOrdersForReservation(
        hotelId,
        child.id,
        applyAmt,
        'cash',
        userContext.uid,
        resolvedMaster.id,
        { uid: userContext.uid, displayName: userContext.name, role: userContext.role },
        'Front Desk Folio Settlement'
      );

      availableMasterCredit = Number((availableMasterCredit - applyAmt).toFixed(2));
      totalApplied = Number((totalApplied + applyAmt).toFixed(2));
      settledRooms.push(child.roomNumber);
    }

    if (totalApplied > 0) {
      await createAuditLog(
        hotelId,
        'FrontDesk',
        'master_credit_reallocated_to_linked_rooms',
        `Applied ${totalApplied} Master Room ${resolvedMaster.roomNumber} credit to settle linked room(s): ${settledRooms.join(', ')}`,
        'success',
        { masterId: resolvedMaster.id, appliedAmount: totalApplied, settledRooms },
        userContext
      );
    }

    return { appliedAmount: totalApplied, settledRooms };
  },

  /**
   * Post group payment / settlement to Master Folio and automatically allocate
   * across Master + all Linked Rooms' outstanding balances
   */
  async postGroupPayment(
    hotelId: string,
    masterReservation: Reservation,
    splits: { amount: number; method: 'cash' | 'card' | 'transfer'; referenceCode?: string; proofUrl?: string }[],
    userContext: { uid: string; name?: string; role?: string },
    options?: {
      targetReservationId?: string;
      isConsolidated?: boolean;
      notes?: string;
      linkedReservations?: Reservation[];
      ledgerEntries?: LedgerEntry[];
      hotel?: Hotel | null;
    }
  ): Promise<{
    totalSubmitted: number;
    totalAllocatedToDebt: number;
    masterExcess: number;
    allocations: Array<{ reservationId: string; roomNumber: string; amount: number; method: string; isExcessMasterCredit: boolean }>;
  }> {
    const { master: resolvedMaster, linked, hotel: resolvedHotel } = await resolveGroupContext(
      hotelId,
      masterReservation,
      { linkedReservations: options?.linkedReservations, hotel: options?.hotel }
    );
    const groupReservations = [resolvedMaster, ...linked];

    if (options?.targetReservationId && options?.isConsolidated === false) {
      const targetReservation = groupReservations.find(r => r.id === options.targetReservationId) || resolvedMaster;
      const singleAllocs: Array<{ reservationId: string; roomNumber: string; amount: number; method: string; isExcessMasterCredit: boolean }> = [];
      let submitted = 0;
      for (const split of splits) {
        if (split.amount > 0) {
          submitted += split.amount;
          await settleLedger(
            hotelId,
            targetReservation.guestId || 'group-guest',
            targetReservation.id,
            split.amount,
            split.method,
            userContext.uid,
            targetReservation.corporateId || undefined,
            split.referenceCode,
            split.proofUrl,
            { uid: userContext.uid, displayName: userContext.name, role: userContext.role },
            'Front Desk',
            {
              masterReservationId: resolvedMaster.id,
              sourceRoomNumber: targetReservation.roomNumber,
              sourceReservationId: targetReservation.id
            }
          );
          singleAllocs.push({
            reservationId: targetReservation.id,
            roomNumber: targetReservation.roomNumber,
            amount: split.amount,
            method: split.method,
            isExcessMasterCredit: false
          });
        }
      }
      return {
        totalSubmitted: Number(submitted.toFixed(2)),
        totalAllocatedToDebt: Number(submitted.toFixed(2)),
        masterExcess: 0,
        allocations: singleAllocs
      };
    }

    // Load ledger entries for the group if not passed in
    let entries = options?.ledgerEntries;
    if (!entries) {
      const snap = await getDocs(collection(db, 'hotels', hotelId, 'ledger'));
      entries = snap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
    }

    const plan = planGroupPaymentAllocation(resolvedMaster, linked, splits, entries, resolvedHotel);
    const recordedAllocations: Array<{
      reservationId: string;
      roomNumber: string;
      amount: number;
      method: string;
      isExcessMasterCredit: boolean;
    }> = [];

    for (const alloc of plan.allocations) {
      const isChildRoom = alloc.reservation.id !== resolvedMaster.id;
      const customDescription = alloc.isExcessMasterCredit
        ? `Overpayment / Group Credit via ${alloc.method.toUpperCase()} (Master Room ${resolvedMaster.roomNumber})${alloc.referenceCode ? ` (Ref: ${alloc.referenceCode})` : ''}`
        : isChildRoom
        ? `Payment via ${alloc.method.toUpperCase()} (Allocated from Master Room ${resolvedMaster.roomNumber})${alloc.referenceCode ? ` (Ref: ${alloc.referenceCode})` : ''}`
        : undefined;

      await settleLedger(
        hotelId,
        alloc.reservation.guestId || 'group-guest',
        alloc.reservation.id,
        alloc.amount,
        alloc.method,
        userContext.uid,
        alloc.reservation.corporateId || undefined,
        alloc.referenceCode,
        alloc.proofUrl,
        { uid: userContext.uid, displayName: userContext.name, role: userContext.role },
        'Front Desk',
        {
          description: customDescription,
          masterReservationId: resolvedMaster.id,
          sourceRoomNumber: alloc.reservation.roomNumber,
          sourceReservationId: alloc.reservation.id
        }
      );

      recordedAllocations.push({
        reservationId: alloc.reservation.id,
        roomNumber: alloc.reservation.roomNumber,
        amount: alloc.amount,
        method: alloc.method,
        isExcessMasterCredit: alloc.isExcessMasterCredit
      });
    }

    // If Master Room already had excess credit from earlier Master Folio payments and linked rooms still owe debt,
    // automatically apply that excess Master credit to settle the remaining linked room balances.
    if (plan.masterInitialBalance < -0.01 && linked.length > 0) {
      const stillOwingLinked = plan.targets
        .slice(1)
        .filter(t => t.remainingOwed > 0.01)
        .map(t => t.reservation);

      if (stillOwingLinked.length > 0) {
        const freshLedgerSnap = await getDocs(collection(db, 'hotels', hotelId, 'ledger'));
        const freshEntries = freshLedgerSnap.docs.map(d => ({ id: d.id, ...d.data() } as LedgerEntry));
        await this.reallocateMasterCreditToLinkedRooms(
          hotelId,
          resolvedMaster,
          stillOwingLinked,
          userContext,
          { ledgerEntries: freshEntries, hotel: resolvedHotel }
        );
      }
    }

    await createAuditLog(
      hotelId,
      'FrontDesk',
      'group_payment_settled',
      `Posted group payment of ${plan.totalSubmitted} across Master Room ${resolvedMaster.roomNumber} group (${recordedAllocations.map(a => `Room ${a.roomNumber}: ${a.amount}`).join(', ')})`,
      'success',
      {
        masterId: resolvedMaster.id,
        masterRoom: resolvedMaster.roomNumber,
        splits,
        allocations: recordedAllocations,
        options: { isConsolidated: options?.isConsolidated, notes: options?.notes }
      },
      userContext
    );

    return {
      totalSubmitted: plan.totalSubmitted,
      totalAllocatedToDebt: plan.totalAllocatedToDebt,
      masterExcess: plan.masterExcess,
      allocations: recordedAllocations
    };
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
    allLedgerEntries: LedgerEntry[],
    hotel?: Hotel | null
  ): GroupFinancialSummary {
    const allGroupRes = [masterReservation, ...linkedReservations];
    const allResIds = new Set(allGroupRes.map(r => r.id));
    const resMap = new Map<string, Reservation>();
    allGroupRes.forEach(r => resMap.set(r.id, r));

    const roomNumberMap = new Map<string, string>();
    allGroupRes.forEach(r => roomNumberMap.set(r.id, r.roomNumber));

    const chargesByRoom: Record<string, {
      roomNumber: string;
      guestName: string;
      totalCharges: number;
      totalPayments: number;
      balance: number;
      entries: GroupChargeBreakdown[];
    }> = {};

    const validLedgerEntries = allLedgerEntries.filter(e => validateLedgerTransaction(e).isValid);

    // Initialize all rooms
    for (const res of allGroupRes) {
      const resLedger = validLedgerEntries.filter(e => e.reservationId === res.id);
      if (hotel) {
        const billing = calculateBilling(res, hotel, resLedger);
        const liveBal = getReservationLiveBalance(res, hotel, resLedger);
        chargesByRoom[res.roomNumber] = {
          roomNumber: res.roomNumber,
          guestName: res.guestName,
          totalCharges: billing.totalCharges,
          totalPayments: billing.totalPayments,
          balance: liveBal,
          entries: []
        };
      } else {
        chargesByRoom[res.roomNumber] = {
          roomNumber: res.roomNumber,
          guestName: res.guestName,
          totalCharges: 0,
          totalPayments: 0,
          balance: 0,
          entries: []
        };
      }
    }

    const allGroupEntries: GroupChargeBreakdown[] = [];

    // Filter ledger entries that belong to this group
    const relevantEntries = validLedgerEntries.filter(entry => {
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
      if (!hotel) {
        if (entry.type === 'debit') {
          if (entry.category !== 'refund') {
            chargesByRoom[sourceRoom].totalCharges += entry.amount;
            chargesByRoom[sourceRoom].balance += entry.amount;
          } else {
            chargesByRoom[sourceRoom].totalPayments -= entry.amount;
            chargesByRoom[sourceRoom].balance += entry.amount;
          }
        } else {
          chargesByRoom[sourceRoom].totalPayments += entry.amount;
          chargesByRoom[sourceRoom].balance -= entry.amount;
        }
      }
    }

    let groupTotalCharges = 0;
    let groupTotalPayments = 0;
    let groupNetBalance = 0;

    Object.values(chargesByRoom).forEach(group => {
      groupTotalCharges += group.totalCharges;
      groupTotalPayments += group.totalPayments;
      groupNetBalance += group.balance;
    });

    const masterTotalAmount = chargesByRoom[masterReservation.roomNumber]?.totalCharges || 0;
    const masterPaidAmount = chargesByRoom[masterReservation.roomNumber]?.totalPayments || 0;
    const masterBalance = chargesByRoom[masterReservation.roomNumber]?.balance ?? (masterTotalAmount - masterPaidAmount);

    return {
      masterReservation,
      linkedReservations,
      masterTotalAmount,
      masterPaidAmount,
      masterBalance,
      groupTotalCharges,
      groupTotalPayments,
      groupNetBalance: Number(groupNetBalance.toFixed(2)),
      chargesByRoom,
      allGroupEntries: allGroupEntries.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    };
  }
};
