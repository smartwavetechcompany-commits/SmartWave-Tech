import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where, addDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { 
  ChefHat, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  UtensilsCrossed,
  Plus
} from 'lucide-react';
import { cn } from '../utils';

interface Order {
  id: string;
  roomNumber: string;
  items: string;
  status: 'pending' | 'preparing' | 'delivered';
  timestamp: string;
}

export function Kitchen() {
  const { hotel, profile } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [isAddingOrder, setIsAddingOrder] = useState(false);
  const [newOrder, setNewOrder] = useState({ roomNumber: '', items: '' });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    const q = query(collection(db, 'hotels', hotel.id, 'kitchen_orders'));
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Order)));
      },
      (error) => {
        if (error.code === 'permission-denied') {
          console.warn("Kitchen orders access restricted.");
          setHasPermissionError(true);
        } else {
          console.error("Kitchen orders listener error:", error);
        }
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const addOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    await addDoc(collection(db, 'hotels', hotel.id, 'kitchen_orders'), {
      ...newOrder,
      status: 'pending',
      timestamp: new Date().toISOString()
    });

    setIsAddingOrder(false);
    setNewOrder({ roomNumber: '', items: '' });
  };

  const updateOrderStatus = async (orderId: string, status: Order['status']) => {
    if (!hotel?.id) return;
    await updateDoc(doc(db, 'hotels', hotel.id, 'kitchen_orders', orderId), { status });
    
    // Log action
    await addDoc(collection(db, 'activityLogs'), {
      timestamp: new Date().toISOString(),
      userId: profile?.uid,
      userEmail: profile?.email,
      action: 'KITCHEN_ORDER_STATUS_UPDATE',
      resource: `Order ${orderId}: ${status}`,
      hotelId: hotel.id
    });
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Kitchen & Room Service</h1>
          <p className="text-zinc-400">Manage food orders and delivery</p>
        </div>
        <button 
          onClick={() => setIsAddingOrder(true)}
          className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
        >
          <Plus size={18} />
          New Order
        </button>
      </header>

      {isAddingOrder && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Create Kitchen Order</h3>
            <form onSubmit={addOrder} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room Number</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newOrder.roomNumber}
                  onChange={(e) => setNewOrder({ ...newOrder, roomNumber: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Items / Instructions</label>
                <textarea 
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none min-h-[100px]"
                  value={newOrder.items}
                  onChange={(e) => setNewOrder({ ...newOrder, items: e.target.value })}
                />
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAddingOrder(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Place Order
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {orders.length === 0 ? (
          <div className="col-span-full p-12 text-center bg-zinc-900/50 border border-zinc-800 border-dashed rounded-2xl">
            <UtensilsCrossed size={48} className="mx-auto text-zinc-700 mb-4" />
            <p className="text-zinc-500">No active kitchen orders</p>
          </div>
        ) : (
          orders.map(order => (
            <div key={order.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-lg font-bold text-white">Room {order.roomNumber}</span>
                <span className={cn(
                  "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                  order.status === 'delivered' ? "bg-emerald-500/10 text-emerald-500" :
                  order.status === 'preparing' ? "bg-blue-500/10 text-blue-500" : "bg-amber-500/10 text-amber-500"
                )}>
                  {order.status}
                </span>
              </div>
              
              <p className="text-sm text-zinc-400 line-clamp-3">{order.items}</p>

              <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] text-zinc-500 uppercase font-bold">
                  <Clock size={12} />
                  {new Date(order.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
                <div className="flex gap-2">
                  {order.status !== 'delivered' && (
                    <button 
                      onClick={() => updateOrderStatus(order.id, order.status === 'pending' ? 'preparing' : 'delivered')}
                      className="p-2 text-zinc-500 hover:text-emerald-500 transition-all active:scale-90"
                      title={order.status === 'pending' ? 'Start Preparing' : 'Mark as Delivered'}
                    >
                      <CheckCircle2 size={18} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
