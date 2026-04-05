import React, { useEffect, useState } from 'react';
import { collection, query, where, addDoc, doc, updateDoc, orderBy, getDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { KitchenOrder, OperationType, Reservation, Guest } from '../types';
import { postToLedger } from '../services/ledgerService';
import { createNotification } from './Notifications';
import { 
  ChefHat, 
  Clock, 
  CheckCircle2, 
  AlertCircle,
  UtensilsCrossed,
  Plus,
  History,
  Search,
  Filter,
  ChevronRight,
  Utensils,
  Coffee,
  Pizza,
  MoreHorizontal,
  Bell,
  RefreshCw,
  Download,
  Printer,
  XCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, exportToCSV } from '../utils';
import { toast } from 'sonner';

export function Kitchen() {
  const { hotel, profile } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [printingOrder, setPrintingOrder] = useState<KitchenOrder | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'preparing' | 'ready' | 'delivered'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'food' | 'drink' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [now, setNow] = useState(new Date());
  const [newOrder, setNewOrder] = useState({
    roomNumber: '',
    items: '',
    notes: '',
    category: 'food' as 'food' | 'drink' | 'other',
    price: 0,
    paymentMethod: 'cash' as 'cash' | 'card' | 'transfer' | 'room'
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    const unsubOrders = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'kitchen_orders'), orderBy('timestamp', 'desc')),
      (snap) => {
        setOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as KitchenOrder)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/kitchen_orders`);
        if (error.code === 'permission-denied') setHasPermissionError(true);
      }
    );

    const unsubReservations = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'reservations'), where('status', '==', 'checked_in')),
      (snap) => {
        setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/reservations`);
      }
    );

    const unsubGuests = onSnapshot(
      collection(db, 'hotels', hotel.id, 'guests'),
      (snap) => {
        setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/guests`);
      }
    );

    return () => {
      unsubOrders();
      unsubReservations();
      unsubGuests();
    };
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    try {
      const orderData = {
        ...newOrder,
        status: 'pending',
        timestamp: new Date().toISOString()
      };

      const orderRef = await addDoc(collection(db, 'hotels', hotel.id, 'kitchen_orders'), orderData);

      // Create notification for kitchen staff
      await createNotification(hotel.id, {
        title: 'New Kitchen Order',
        message: `New order for Room ${newOrder.roomNumber}: ${newOrder.items}`,
        type: 'info',
        userId: 'all'
      });

      // If posting to room, find reservation and post to ledger
      if (newOrder.paymentMethod === 'room' && newOrder.price > 0) {
        const res = reservations.find(r => r.roomNumber === newOrder.roomNumber);
        if (res && res.guestId) {
          await postToLedger(hotel.id, res.guestId, res.id, {
            amount: newOrder.price,
            type: 'debit',
            category: 'restaurant',
            description: `Kitchen Order (Room Service): ${newOrder.items}`,
            referenceId: orderRef.id,
            postedBy: profile.uid
          }, profile.uid, res.corporateId);
        }
      } else if (newOrder.price > 0) {
        // Add to finance records for cash, card, transfer
        await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
          type: 'income',
          amount: newOrder.price,
          category: 'Restaurant Revenue',
          description: `Kitchen Order ${orderRef.id} (Room ${newOrder.roomNumber}) - ${newOrder.paymentMethod.toUpperCase()}`,
          timestamp: new Date().toISOString(),
          paymentMethod: newOrder.paymentMethod
        });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'KITCHEN_ORDER_CREATED',
        resource: `Room ${newOrder.roomNumber}: ${newOrder.items} (${newOrder.paymentMethod})`,
        hotelId: hotel.id,
        module: 'Kitchen'
      });

      toast.success('Kitchen order created');
      setShowAddModal(false);
      setNewOrder({ roomNumber: '', items: '', notes: '', category: 'food', price: 0, paymentMethod: 'cash' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/kitchen_orders`);
      toast.error('Failed to create order');
    }
  };

  const updateOrderStatus = async (orderId: string, status: KitchenOrder['status']) => {
    if (!hotel?.id) return;
    
    const updates: any = { status };
    if (status === 'preparing') updates.preparedAt = new Date().toISOString();
    if (status === 'ready') updates.readyAt = new Date().toISOString();
    if (status === 'delivered') updates.deliveredAt = new Date().toISOString();

    try {
      await updateDoc(doc(db, 'hotels', hotel.id, 'kitchen_orders', orderId), updates);
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'KITCHEN_ORDER_STATUS_UPDATE',
        resource: `Order ${orderId}: ${status}`,
        hotelId: hotel.id,
        module: 'Kitchen'
      });
      toast.success(`Order status updated to ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/kitchen_orders/${orderId}`);
      toast.error('Failed to update order status');
    }
  };

  const activeOrders = orders.filter(o => o.status !== 'delivered');
  const historyOrders = orders.filter(o => o.status === 'delivered');

  const filteredOrders = (showHistory ? historyOrders : activeOrders).filter(o => {
    const matchesFilter = filter === 'all' || o.status === filter;
    const matchesCategory = categoryFilter === 'all' || o.category === categoryFilter;
    const matchesSearch = (o.roomNumber || '').includes(searchQuery) || (o.items?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    return matchesFilter && matchesCategory && matchesSearch;
  });

  const stats = [
    { label: 'Active Orders', count: activeOrders.length, icon: Utensils, color: 'text-blue-500' },
    { label: 'Preparing', count: orders.filter(o => o.status === 'preparing').length, icon: ChefHat, color: 'text-amber-500' },
    { label: 'Ready for Pickup', count: orders.filter(o => o.status === 'ready').length, icon: Bell, color: 'text-emerald-500' },
  ];

  const getWaitTime = (timestamp: string) => {
    const diff = Math.floor((now.getTime() - new Date(timestamp).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
  };

  const handleExport = () => {
    const dataToExport = filteredOrders.map(order => ({
      Timestamp: new Date(order.timestamp).toLocaleString(),
      Room: order.roomNumber,
      Items: order.items,
      Category: order.category,
      Status: order.status,
      Notes: order.notes || ''
    }));
    exportToCSV(dataToExport, `kitchen_orders_${new Date().toISOString().split('T')[0]}.csv`);
    toast.success('Kitchen orders exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Kitchen Management</h1>
          <p className="text-zinc-400">Manage room service orders and kitchen workflow</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "flex items-center gap-2 px-4 py-2 rounded-xl font-medium transition-all active:scale-95",
              showHistory ? "bg-emerald-500 text-white" : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            )}
          >
            <History size={18} />
            {showHistory ? 'View Active' : 'Order History'}
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            New Order
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-zinc-400 text-sm font-medium">{stat.label}</span>
              <stat.icon className={stat.color} size={20} />
            </div>
            <div className="text-2xl font-bold text-white">{stat.count}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search by room or items..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl w-full md:w-auto">
          {(['all', 'pending', 'preparing', 'ready', 'delivered'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                filter === f ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {f}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          {(['all', 'food', 'drink', 'other'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                categoryFilter === c ? "bg-emerald-500/10 text-emerald-500" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredOrders.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <UtensilsCrossed size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No orders found</p>
            </div>
          ) : (
            filteredOrders.map((order) => (
              <motion.div
                key={order.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="p-5 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-white font-bold">
                        {order.roomNumber}
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Room</div>
                        <div className="text-xs text-zinc-400 flex items-center gap-1">
                          <Clock size={10} />
                          {getWaitTime(order.timestamp)}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider flex items-center gap-1",
                      order.status === 'pending' ? "bg-blue-500/10 text-blue-500" :
                      order.status === 'preparing' ? "bg-amber-500/10 text-amber-500" :
                      order.status === 'ready' ? "bg-emerald-500/10 text-emerald-500" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      {order.status === 'preparing' && <RefreshCw size={10} className="animate-spin" />}
                      {order.status}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 mb-1">
                      {order.category === 'food' ? <Pizza size={14} className="text-amber-500" /> :
                       order.category === 'drink' ? <Coffee size={14} className="text-blue-500" /> :
                       <MoreHorizontal size={14} className="text-zinc-500" />}
                      <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{order.category}</span>
                    </div>
                    <div>
                      <p className="text-sm text-white leading-relaxed font-medium">{order.items}</p>
                    </div>
                    {(order.price > 0) && (
                      <div className="flex items-center justify-between pt-2 border-t border-zinc-800/50">
                        <div className="text-xs font-bold text-emerald-500">
                          {order.price.toLocaleString()}
                        </div>
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider bg-zinc-800 px-2 py-0.5 rounded">
                          {order.paymentMethod === 'room' ? 'Post to Room' : order.paymentMethod}
                        </div>
                      </div>
                    )}
                    {order.notes && (
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Notes</div>
                        <p className="text-xs text-zinc-400 italic">{order.notes}</p>
                      </div>
                    )}
                  </div>
                </div>

                {!showHistory && (
                  <div className="p-3 bg-zinc-950 border-t border-zinc-800 grid grid-cols-1 gap-2">
                    {order.status === 'pending' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'preparing')}
                        className="flex items-center justify-center gap-2 bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 py-2 rounded-xl text-xs font-bold transition-colors"
                      >
                        <ChefHat size={14} />
                        Start Preparing
                      </button>
                    )}
                    {order.status === 'preparing' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'ready')}
                        className="flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 py-2 rounded-xl text-xs font-bold transition-colors"
                      >
                        <Bell size={14} />
                        Mark as Ready
                      </button>
                    )}
                    {order.status === 'ready' && (
                      <button
                        onClick={() => updateOrderStatus(order.id, 'delivered')}
                        className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                      >
                        <CheckCircle2 size={14} />
                        Confirm Delivery
                      </button>
                    )}
                    <button
                      onClick={() => setPrintingOrder(order)}
                      className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                    >
                      <Printer size={14} />
                      Print Docket
                    </button>
                  </div>
                )}
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Print Docket Modal */}
      {printingOrder && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-md">
            <button 
              onClick={() => setPrintingOrder(null)}
              className="absolute -top-12 right-0 p-2 text-white hover:bg-white/10 rounded-full transition-all print:hidden"
            >
              <XCircle size={32} />
            </button>
            
            {/* Docket View */}
            <div className="bg-white text-black p-8 font-mono shadow-2xl print:shadow-none print:p-0">
              <div className="text-center border-b-2 border-black pb-4 mb-4">
                <h2 className="text-xl font-black uppercase tracking-tighter">KITCHEN DOCKET</h2>
                <p className="text-xs font-bold mt-1">{hotel?.name}</p>
                <p className="text-[10px]">{new Date(printingOrder.timestamp).toLocaleString()}</p>
              </div>
              
              <div className="flex justify-between mb-4 border-b border-black pb-2">
                <div>
                  <p className="text-[10px] font-bold uppercase">Room Number</p>
                  <p className="text-lg font-black">{printingOrder.roomNumber}</p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-bold uppercase">Order ID</p>
                  <p className="text-sm font-bold">#{printingOrder.id.slice(-6).toUpperCase()}</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase border-b border-black mb-2">Order Items</p>
                <p className="text-sm font-bold whitespace-pre-wrap leading-relaxed">
                  {printingOrder.items}
                </p>
              </div>
              
              {printingOrder.notes && (
                <div className="mb-6 bg-zinc-100 p-3 border-l-4 border-black">
                  <p className="text-[10px] font-bold uppercase mb-1">Special Instructions</p>
                  <p className="text-xs italic">{printingOrder.notes}</p>
                </div>
              )}
              
              <div className="flex justify-between border-t border-black pt-2 mb-8">
                <p className="text-[10px] font-bold uppercase">Category</p>
                <p className="text-[10px] font-bold uppercase">{printingOrder.category}</p>
              </div>
              
              <div className="text-center border-t-2 border-dashed border-black pt-4">
                <p className="text-[10px] font-bold uppercase">Kitchen Copy</p>
                <p className="text-[8px] mt-2 opacity-50">Generated by PMS Enterprise</p>
              </div>
              
              <div className="mt-8 flex justify-center print:hidden">
                <button 
                  onClick={() => window.print()}
                  className="bg-black text-white px-8 py-3 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 flex items-center gap-2"
                >
                  <Printer size={18} />
                  Print Docket
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Order Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">New Kitchen Order</h2>
            </div>
            <form onSubmit={handleAddOrder}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Room Number</label>
                    <select
                      required
                      value={newOrder.roomNumber}
                      onChange={(e) => setNewOrder({ ...newOrder, roomNumber: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select Room</option>
                      {reservations.map(res => (
                        <option key={res.id} value={res.roomNumber}>
                          Room {res.roomNumber} ({res.guestName})
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                    <select
                      value={newOrder.category}
                      onChange={(e) => setNewOrder({ ...newOrder, category: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="food">Food</option>
                      <option value="drink">Drink</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Price</label>
                    <input
                      type="number"
                      value={newOrder.price}
                      onChange={(e) => setNewOrder({ ...newOrder, price: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Payment</label>
                    <select
                      value={newOrder.paymentMethod}
                      onChange={(e) => setNewOrder({ ...newOrder, paymentMethod: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="transfer">Bank Transfer</option>
                      <option value="room">Post to Room</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Items</label>
                  <textarea
                    required
                    value={newOrder.items}
                    onChange={(e) => setNewOrder({ ...newOrder, items: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-24 resize-none"
                    placeholder="e.g. 2x Club Sandwich, 1x Orange Juice"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Special Notes</label>
                  <input
                    type="text"
                    value={newOrder.notes}
                    onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. No onions, extra ice"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!newOrder.roomNumber || !newOrder.items}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  Create Order
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
