import { 
  collection, 
  addDoc, 
  updateDoc, 
  doc, 
  getDocs, 
  query, 
  where, 
  writeBatch, 
  increment,
  Timestamp,
  getDoc
} from 'firebase/firestore';
import { db } from '../firebase';
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
    const docRef = await addDoc(blockingRef, {
      ...blocking,
      timestamp: new Date().toISOString()
    });
    
    // Update room status if blocking is current
    const now = new Date().toISOString();
    if (blocking.startDate <= now && blocking.endDate >= now) {
      const roomRef = doc(db, 'hotels', hotelId, 'rooms', blocking.roomId);
      await updateDoc(roomRef, { 
        status: blocking.reason === 'maintenance' ? 'maintenance' : 'out_of_order' 
      });
    }
    
    return docRef.id;
  },

  async unblockRoom(hotelId: string, blockingId: string, roomId: string) {
    const blockingRef = doc(db, 'hotels', hotelId, 'room_blockings', blockingId);
    await updateDoc(blockingRef, { endDate: new Date().toISOString() });
    
    // Reset room status to vacant/clean or similar
    const roomRef = doc(db, 'hotels', hotelId, 'rooms', roomId);
    await updateDoc(roomRef, { status: 'vacant' });
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
    
    await batch.commit();
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
