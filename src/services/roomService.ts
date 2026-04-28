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
import { db, serverTimestamp, safeWrite, safeAdd, handleFirestoreError } from '../firebase';
import { 
  Room, 
  RoomType, 
  RoomBlocking, 
  InventoryConsumptionRule, 
  InventoryItem,
  InventoryTransaction,
  OperationType
} from '../types';

export const roomService = {
  // Room Blocking
  async blockRoom(hotelId: string, blocking: Omit<RoomBlocking, 'id' | 'timestamp'>) {
    try {
      const docId = await safeAdd(collection(db, 'hotels', hotelId, 'room_blockings'), {
        ...blocking,
        timestamp: serverTimestamp()
      }, hotelId, 'BLOCK_ROOM');
      
      // Update room status if blocking is current
      const now = new Date();
      const start = new Date(blocking.startDate);
      const end = new Date(blocking.endDate);
      
      if (start <= now && end >= now) {
        await safeWrite(doc(db, 'hotels', hotelId, 'rooms', blocking.roomId), { 
          status: blocking.reason === 'maintenance' ? 'maintenance' : 'out_of_service',
          updatedAt: serverTimestamp()
        }, hotelId, 'UPDATE_ROOM_STATUS_FOR_BLOCKING');
      }
      
      return docId;
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `hotels/${hotelId}/room_blockings`);
      throw error;
    }
  },

  async unblockRoom(hotelId: string, blockingId: string, roomId: string) {
    try {
      await safeDelete(doc(db, 'hotels', hotelId, 'room_blockings', blockingId), hotelId, 'UNBLOCK_ROOM');
      
      // Reset room status to dirty so it needs cleaning before booking
      await safeWrite(doc(db, 'hotels', hotelId, 'rooms', roomId), { 
        status: 'dirty',
        updatedAt: serverTimestamp()
      }, hotelId, 'RESET_ROOM_STATUS_AFTER_UNBLOCK');
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `hotels/${hotelId}/room_blockings/${blockingId}`);
      throw error;
    }
  },

  // Inventory Integration
  async triggerInventoryConsumption(hotelId: string, roomTypeId: string, trigger: InventoryConsumptionRule['trigger'], userId: string) {
    try {
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
        
        batch.update(itemRef, {
          quantity: increment(-rule.quantity),
          lastUpdated: serverTimestamp()
        });
        
        await safeAdd(collection(db, 'hotels', hotelId, 'inventory_transactions'), {
          type: 'consumption',
          itemId: rule.itemId,
          quantity: rule.quantity,
          userId: userId,
          timestamp: serverTimestamp(),
          reason: `Auto-consumption triggered by ${trigger} for room type ${roomTypeId}`,
        }, hotelId, 'INVENTORY_CONSUMPTION');
      }
      
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `hotels/${hotelId}/inventory`);
      throw error;
    }
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
    const seasonal = config.seasonalRates?.find((r: any) => r.startDate <= dateStr && r.endDate >= dateStr);
    if (seasonal) {
      rate = seasonal.rate;
    } else {
      // Check weekend/weekday
      const day = date.getDay();
      if ((day === 0 || day === 6) && config.weekendRate) {
        rate = config.weekendRate;
      } else if (config.weekdayRate) {
        rate = config.weekdayRate;
      }
    }
    
    return rate;
  }
};
