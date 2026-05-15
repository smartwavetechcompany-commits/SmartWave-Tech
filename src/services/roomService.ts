import { 
  collection, 
  doc, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  increment,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
import { database } from '../utils/database';
import { 
  Room, 
  RoomType, 
  RoomBlocking, 
  InventoryConsumptionRule, 
  InventoryItem,
  InventoryTransaction
} from '../types';

export const roomService = {
  // Room Blocking
  async blockRoom(hotelId: string, blocking: Omit<RoomBlocking, 'id' | 'timestamp'>) {
    const blockingRef = collection(db, 'hotels', hotelId, 'room_blockings');
    
    // Create the blocking record
    const docRef = await database.safeAdd(blockingRef as any, {
      ...blocking,
      timestamp: new Date().toISOString()
    }, {
      hotelId,
      module: 'Rooms',
      action: 'BLOCK_ROOM',
      details: `Blocked room ${blocking.roomId} for ${blocking.reason}`
    });
    
    // Update room status if blocking is current
    // Use date strings for comparison to avoid time-of-day issues
    const today = new Date().toISOString().split('T')[0];
    const isCurrent = blocking.startDate <= today && blocking.endDate >= today;
    
    if (isCurrent) {
      try {
        const roomRef = doc(db, 'hotels', hotelId, 'rooms', blocking.roomId);
        await database.safeUpdate(roomRef, { 
          status: blocking.reason === 'maintenance' ? 'maintenance' : 'out_of_order' 
        }, {
          hotelId,
          module: 'Rooms',
          action: 'UPDATE_ROOM_STATUS',
          details: `Updated room ${blocking.roomId} status due to active blocking`
        });
      } catch (statusError) {
        // Log but don't fail the whole block operation if only status update fails
        console.error("Failed to update room status for blocking:", statusError);
      }
    }
    
    return docRef.id;
  },

  async unblockRoom(hotelId: string, blockingId: string, roomId: string) {
    const blockingRef = doc(db, 'hotels', hotelId, 'room_blockings', blockingId);
    await database.safeDelete(blockingRef, {
      hotelId,
      module: 'Rooms',
      action: 'DELETE_BLOCKING',
      details: `Removed/Deleted blocking record for room ${roomId}`
    });
    
    // Reset room status to dirty so it needs cleaning before booking
    try {
      const roomRef = doc(db, 'hotels', hotelId, 'rooms', roomId);
      await database.safeUpdate(roomRef, { status: 'dirty' }, {
        hotelId,
        module: 'Rooms',
        action: 'RESET_ROOM_STATUS',
        details: `Reset room ${roomId} to dirty after unblocking`
      });
    } catch (statusError) {
      console.error("Failed to reset room status after unblocking:", statusError);
    }
  },

  isRoomBlocked(roomBlockings: RoomBlocking[], roomId: string, date: Date | string): boolean {
    const selectedDate = typeof date === 'string' ? new Date(date) : date;
    const dateStr = selectedDate.toISOString().split('T')[0];
    const hour = selectedDate.getHours();
    const minute = selectedDate.getMinutes();
    const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
    const dayOfWeek = selectedDate.getDay();

    return roomBlockings.some(blocking => {
      if (blocking.roomId !== roomId) return false;

      const start = new Date(blocking.startDate);
      const end = new Date(blocking.endDate);
      const checkDate = new Date(dateStr);

      // Basic date range check
      let isInRange = checkDate >= start && checkDate <= end;

      // Frequency based check
      if (!isInRange) {
        if (blocking.frequency === 'daily') {
          isInRange = checkDate >= start;
        } else if (blocking.frequency === 'weekly' && blocking.daysOfWeek) {
          isInRange = checkDate >= start && blocking.daysOfWeek.includes(dayOfWeek);
        } else if (blocking.frequency === 'monthly') {
          isInRange = checkDate >= start && checkDate.getDate() === start.getDate();
        }
      }

      if (!isInRange) return false;

      // Time interval check if specified
      if (blocking.startTime && blocking.endTime) {
        return timeStr >= blocking.startTime && timeStr <= blocking.endTime;
      }

      return true;
    });
  },

  // Inventory Integration
  async triggerInventoryConsumption(hotelId: string, roomTypeId: string, trigger: InventoryConsumptionRule['trigger'], userId: string) {
    const rulesRef = collection(db, 'hotels', hotelId, 'inventory_consumption_rules');
    const q = query(rulesRef, where('trigger', '==', trigger));
    const snap = await getDocs(q);
    
    const rules = snap.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as InventoryConsumptionRule))
      .filter(rule => !rule.roomTypeId || rule.roomTypeId === roomTypeId);
      
    if (rules.length === 0) return;

    const batch = writeBatch(db);
    
    for (const rule of rules) {
      const itemRef = doc(db, 'hotels', hotelId, 'inventory', rule.itemId);
      const txRef = doc(collection(db, 'hotels', hotelId, 'inventory_transactions'));
      
      batch.update(itemRef, {
        quantity: increment(-rule.quantity),
        lastUpdated: new Date().toISOString()
      });
      
      const tx: Omit<InventoryTransaction, 'id'> = {
        type: 'consumption',
        itemId: rule.itemId,
        quantity: rule.quantity,
        userId: userId,
        timestamp: new Date().toISOString(),
        reason: `Auto-consumption triggered by ${trigger} for room type ${roomTypeId}`,
      };
      
      batch.set(txRef, tx);
    }
    
    await database.commitBatch(hotelId, batch, {
      module: 'Inventory',
      action: 'AUTO_CONSUMPTION',
      details: `Triggered ${trigger} inventory consumption for room type ${roomTypeId}`
    });
  },


  // Rate Management
  async calculateCurrentRate(hotelId: string, roomTypeId: string, date: Date): Promise<number> {
    const configRef = collection(db, 'hotels', hotelId, 'rate_configurations');
    const q = query(configRef, where('roomTypeId', '==', roomTypeId));
    const snap = await getDocs(q);
    
    if (snap.empty) {
      // Fallback to base price from RoomType
      const typeRef = doc(db, 'hotels', hotelId, 'room_types', roomTypeId);
      const typeSnap = await getDoc(typeRef);
      return typeSnap.exists() ? (typeSnap.data() as RoomType).basePrice : 0;
    }
    
    const config = snap.docs[0].data() as any;
    let rate = config.baseRate;
    
    // Check seasonal rates
    const dateStr = date.toISOString().split('T')[0];
    if (config.seasonalRates && Array.isArray(config.seasonalRates)) {
      const seasonal = config.seasonalRates.find((r: any) => r.startDate <= dateStr && r.endDate >= dateStr);
      if (seasonal) {
        return seasonal.rate;
      }
    }

    // Check weekend/weekday
    const day = date.getDay();
    if ((day === 0 || day === 6) && config.weekendRate && config.weekendRate > 0) {
      return config.weekendRate;
    } else if (config.weekdayRate && config.weekdayRate > 0) {
      return config.weekdayRate;
    }
    
    return config.baseRate;
  }
};
