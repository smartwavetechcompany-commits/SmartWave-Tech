import React, { useEffect, useState } from 'react';
import { collection, query, where, addDoc, doc, updateDoc, orderBy, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { KitchenOrder, OperationType, Reservation, Guest, InventoryItem, BarTable, InventoryCategory } from '../types';
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
  XCircle,
  ShoppingCart,
  PlusCircle,
  Trash2,
  Minus,
  Edit2,
  DollarSign,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, exportToCSV, safeStringify } from '../utils';
import { toast } from 'sonner';
import { format, startOfMonth, startOfDay, endOfDay } from 'date-fns';

export function FandB() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [orders, setOrders] = useState<KitchenOrder[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [tables, setTables] = useState<BarTable[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTableModal, setShowTableModal] = useState(false);
  const [editingTable, setEditingTable] = useState<BarTable | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [printingOrder, setPrintingOrder] = useState<KitchenOrder | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'preparing' | 'ready' | 'delivered'>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'food' | 'drink' | 'other'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [now, setNow] = useState(new Date());
  
  const [cart, setCart] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);
  const [reportFilter, setReportFilter] = useState({
    type: 'all' as string,
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd')
  });
  const [newOrder, setNewOrder] = useState({
    roomNumber: '',
    tableId: '',
    tableNumber: '',
    guestId: '',
    items: '',
    notes: '',
    category: 'all' as string,
    price: 0,
    payments: [{ amount: 0, method: 'cash' }] as { amount: number; method: 'cash' | 'card' | 'transfer' | 'room' }[],
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage'
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

    const unsubInventory = onSnapshot(
      collection(db, 'hotels', hotel.id, 'inventory'),
      (snap) => {
        setInventory(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory`);
      }
    );

    const unsubCategories = onSnapshot(
      collection(db, 'hotels', hotel.id, 'inventory_categories'),
      (snap) => {
        setCategories(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryCategory)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_categories`);
      }
    );

    const unsubTables = onSnapshot(
      query(collection(db, 'hotels', hotel.id, 'tables'), orderBy('tableNumber', 'asc')),
      (snap) => {
        setTables(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as BarTable)));
      },
      (error: any) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/tables`);
      }
    );

    return () => {
      unsubOrders();
      unsubReservations();
      unsubGuests();
      unsubInventory();
      unsubCategories();
      unsubTables();
    };
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const [customItem, setCustomItem] = useState({ name: '', price: 0 });

  const fbCategories = categories.filter(c => c.isFB);
  const fbCategoryNames = fbCategories.map(c => c.name);

  const filteredInventory = inventory.filter(item => {
    const isFBItem = fbCategoryNames.includes(item.category);
    const matchesCategory = newOrder.category === 'all' ? true : item.category === newOrder.category;
    return isFBItem && matchesCategory;
  });

  const addToCart = (item: InventoryItem | { name: string; price: number; id?: string }) => {
    setCart(prev => {
      const id = item.id || `custom-${Date.now()}`;
      const existing = prev.find(i => i.id === id || (i.name === item.name && i.id.startsWith('custom-')));
      if (existing) {
        return prev.map(i => (i.id === id || (i.name === item.name && i.id.startsWith('custom-'))) ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { id: id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const addCustomToCart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customItem.name || customItem.price <= 0) return;
    addToCart({ name: customItem.name, price: customItem.price });
    setCustomItem({ name: '', price: 0 });
    toast.success('Custom item added to cart');
  };

  const removeFromCart = (id: string) => {
    setCart(prev => prev.filter(i => i.id !== id));
  };

  const updateCartQuantity = (id: string, delta: number) => {
    setCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQty = Math.max(1, i.quantity + delta);
        return { ...i, quantity: newQty };
      }
      return i;
    }));
  };

  useEffect(() => {
    const total = cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const itemsString = cart.map(i => `${i.quantity}x ${i.name}`).join(', ');
    setNewOrder(prev => ({ ...prev, price: total, items: itemsString }));
  }, [cart]);

  const handleAddOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;

    setIsSaving(true);
    try {
      const res = reservations.find(r => r.roomNumber === newOrder.roomNumber && r.status === 'checked_in');
      
      // Calculate Taxes
      const activeTaxes = (hotel?.taxes || []).filter(t => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        return status === 'active' && (category === 'restaurant' || category === 'f & b' || category === 'all');
      });
      const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
      const totalExclusiveTax = exclusiveTaxes.reduce((acc, t) => acc + (newOrder.price * (t.percentage / 100)), 0);
      const taxDetails = activeTaxes.map(t => ({
        name: t.name,
        percentage: t.percentage,
        amount: t.isInclusive ? (newOrder.price - (newOrder.price / (1 + (t.percentage / 100)))) : (newOrder.price * (t.percentage / 100)),
        isInclusive: t.isInclusive
      }));

      // Calculate discount
      let discountAmount = 0;
      if (newOrder.discount > 0) {
        if (newOrder.discountType === 'percentage') {
          discountAmount = ((newOrder.price + totalExclusiveTax) * newOrder.discount) / 100;
        } else {
          discountAmount = newOrder.discount;
        }
      }
      const finalPrice = newOrder.price + totalExclusiveTax - discountAmount;

      const orderData = {
        ...newOrder,
        itemsList: cart,
        guestName: res?.guestName || guests.find(g => g.id === newOrder.guestId)?.name || 'Walk-in',
        hotelId: hotel.id,
        status: 'pending',
        timestamp: new Date().toISOString(),
        taxAmount: totalExclusiveTax,
        taxDetails: taxDetails,
        totalAmount: finalPrice
      };

      const orderRef = await addDoc(collection(db, 'hotels', hotel.id, 'kitchen_orders'), orderData);

      // Update table status if assigned
      if (newOrder.tableId) {
        const table = tables.find(t => t.id === newOrder.tableId);
        if (table) {
          await updateDoc(doc(db, 'hotels', hotel.id, 'tables', table.id), {
            status: 'occupied',
            currentOrderId: orderRef.id,
            currentGuestName: orderData.guestName,
            currentGuestId: newOrder.guestId || res?.guestId || '',
            totalSpend: (table.totalSpend || 0) + newOrder.price,
            lastUpdated: new Date().toISOString()
          });
        }
      }

      // Create notification for F & B staff
      await createNotification(hotel.id, {
        title: 'New F & B Order',
        message: `New order for Room ${newOrder.roomNumber}: ${newOrder.items}`,
        type: 'info',
        userId: 'all'
      });

      const guestId = newOrder.guestId || (res?.guestId);

      // NEW LOGIC: If a room is selected, always post the charge to the room folio
      // This ensures it appears on the guest's final receipt.
      if (newOrder.roomNumber !== 'Walk-in' && res && guestId) {
        console.log('Posting charge to room ledger for reservation:', res.id);
        
        // 1. Post the main charge (Debit)
        await postToLedger(hotel.id, guestId, res.id, {
          amount: finalPrice,
          type: 'debit',
          category: 'F & B',
          description: `F & B Order (Room ${newOrder.roomNumber || 'Service'}): ${newOrder.items}${discountAmount > 0 ? ` (Discounted)` : ''}`,
          referenceId: orderRef.id,
          postedBy: profile.uid
        }, profile.uid, res.corporateId);
      }

      // 3. If any payments were made, post them to the ledger and finance
      for (const pay of newOrder.payments) {
        if (pay.amount > 0) {
          if (newOrder.roomNumber !== 'Walk-in' && res && guestId && pay.method !== 'room') {
            console.log('Posting payment to room ledger for reservation:', res.id);
            await postToLedger(hotel.id, guestId, res.id, {
              amount: pay.amount,
              type: 'credit',
              category: 'payment',
              description: `F & B Payment (${pay.method.toUpperCase()}): ${newOrder.items}`,
              referenceId: orderRef.id,
              postedBy: profile.uid,
              paymentMethod: pay.method as any
            }, profile.uid, res.corporateId);

            // Also record the payment in finance
            await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
              type: 'income',
              amount: pay.amount,
              category: 'F & B Revenue',
              description: `F & B Order ${orderRef.id} (Room ${newOrder.roomNumber}) - ${pay.method.toUpperCase()}`,
              timestamp: new Date().toISOString(),
              paymentMethod: pay.method,
              referenceId: orderRef.id,
              postedBy: profile.uid
            });
          } else if (pay.method !== 'room') {
            // Walk-in or direct payment without room charge
            console.log('Recording walk-in payment in finance...');
            await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
              type: 'income',
              amount: pay.amount,
              category: 'F & B Revenue',
              description: `F & B Order ${orderRef.id} (Walk-in) - ${pay.method.toUpperCase()}`,
              timestamp: new Date().toISOString(),
              paymentMethod: pay.method,
              referenceId: orderRef.id,
              postedBy: profile.uid
            });
          }
        }
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'F&B_ORDER_CREATED',
        resource: `Room ${newOrder.roomNumber}: ${newOrder.items}`,
        hotelId: hotel.id,
        module: 'F & B'
      });

      toast.success('F & B order created');
      setShowAddModal(false);
      setCart([]);
      setNewOrder({ 
        roomNumber: '', 
        tableId: '', 
        tableNumber: '', 
        guestId: '', 
        items: '', 
        notes: '', 
        category: 'all', 
        price: 0, 
        payments: [{ amount: 0, method: 'cash' }],
        discount: 0,
        discountType: 'fixed'
      });
    } catch (err: any) {
      console.error('Error in handleAddOrder:', err.message || safeStringify(err));
      if (err.message === 'No active reservation or guest found for this room') {
        toast.error(err.message);
      } else {
        handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/kitchen_orders`);
        toast.error('Failed to create order');
      }
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOrder = async (orderId: string, roomNumber: string) => {
    if (!hotel?.id || !profile || (profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin')) return;

    if (!window.confirm(`Are you sure you want to delete order for Room ${roomNumber}? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'kitchen_orders', orderId));
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'F&B_ORDER_DELETED',
        resource: `Order ${orderId} (Room ${roomNumber})`,
        hotelId: hotel.id,
        module: 'F & B'
      });
      
      toast.success('Order deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/kitchen_orders/${orderId}`);
      toast.error('Failed to delete order');
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
        action: 'F&B_ORDER_STATUS_UPDATE',
        resource: `Order ${orderId}: ${status}`,
        hotelId: hotel.id,
        module: 'F & B'
      });
      toast.success(`Order status updated to ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/kitchen_orders/${orderId}`);
      toast.error('Failed to update order status');
    }
  };

  const filteredOrders = orders.filter(o => {
    const matchesFilter = filter === 'all' || o.status === filter;
    const matchesCategory = categoryFilter === 'all' || o.category === categoryFilter;
    const matchesSearch = (o.roomNumber || '').includes(searchQuery) || (o.items?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    return matchesFilter && matchesCategory && matchesSearch;
  });

  const activeOrdersCount = orders.filter(o => o.status !== 'delivered').length;

  const stats = [
    { label: 'Active Orders', count: activeOrdersCount, icon: Utensils, color: 'text-blue-500' },
    { label: 'Preparing', count: orders.filter(o => o.status === 'preparing').length, icon: ChefHat, color: 'text-amber-500' },
    { label: 'Ready for Pickup', count: orders.filter(o => o.status === 'ready').length, icon: Bell, color: 'text-emerald-500' },
  ];

  const getWaitTime = (timestamp: string) => {
    const diff = Math.floor((now.getTime() - new Date(timestamp).getTime()) / 60000);
    if (diff < 1) return 'Just now';
    if (diff < 60) return `${diff}m ago`;
    return `${Math.floor(diff / 60)}h ${diff % 60}m ago`;
  };

  const [activeTab, setActiveTab] = useState<'orders' | 'tables'>('orders');

  const handleAddTable = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    const tableData = {
      tableNumber: editingTable?.tableNumber || '',
      capacity: editingTable?.capacity || 4,
      status: editingTable?.status || 'available',
      totalSpend: editingTable?.totalSpend || 0,
      lastUpdated: new Date().toISOString()
    };

    try {
      if (editingTable?.id) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'tables', editingTable.id), tableData);
        toast.success('Table updated');
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'tables'), tableData);
        toast.success('Table added');
      }
      setShowTableModal(false);
      setEditingTable(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/tables`);
      toast.error('Failed to save table');
    }
  };

  const handleDeleteTable = async (tableId: string) => {
    if (!hotel?.id || !profile || !window.confirm('Are you sure you want to delete this table?')) return;

    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'tables', tableId));
      toast.success('Table deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/tables/${tableId}`);
      toast.error('Failed to delete table');
    }
  };

  const handleClearTable = async (tableId: string) => {
    if (!hotel?.id || !profile || !window.confirm('Are you sure you want to clear this table? This will mark it as available.')) return;

    try {
      await updateDoc(doc(db, 'hotels', hotel.id, 'tables', tableId), {
        status: 'available',
        currentOrderId: '',
        currentGuestName: '',
        currentGuestId: '',
        currentReservationId: ''
      });
      toast.success('Table cleared');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/tables/${tableId}`);
      toast.error('Failed to clear table');
    }
  };

  const handleExport = () => {
    const start = startOfDay(new Date(reportFilter.startDate));
    const end = endOfDay(new Date(reportFilter.endDate));

    const dataToExport = orders
      .filter(order => {
        const orderDate = new Date(order.timestamp);
        const matchesDate = orderDate >= start && orderDate <= end;
        const matchesType = reportFilter.type === 'all' || order.category === reportFilter.type;
        return matchesDate && matchesType;
      })
      .map(order => ({
        Timestamp: new Date(order.timestamp).toLocaleString(),
        Room: order.roomNumber,
        Items: order.items,
        Category: order.category,
        Status: order.status,
        Price: order.price,
        Payment: order.paymentMethod,
        Notes: order.notes || ''
      }));

    if (dataToExport.length === 0) {
      toast.info('No data found for the selected filters');
      return;
    }

    exportToCSV(dataToExport, `fandb_report_${reportFilter.startDate}_to_${reportFilter.endDate}.csv`);
    toast.success('F & B report exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 mb-2 tracking-tight">F & B Management</h1>
          <p className="text-zinc-400">Manage room service orders and F & B workflow</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden md:flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <select
              value={reportFilter.type}
              onChange={(e) => setReportFilter({ ...reportFilter, type: e.target.value as any })}
              className="bg-transparent text-xs text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Types</option>
              <option value="food">Food Only</option>
              <option value="drink">Drink Only</option>
              <option value="other">Other Only</option>
            </select>
            <div className="w-px h-4 bg-zinc-800" />
            <input
              type="date"
              value={reportFilter.startDate}
              onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
              className="bg-transparent text-xs text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
            <span className="text-zinc-600 text-xs">-</span>
            <input
              type="date"
              value={reportFilter.endDate}
              onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
              className="bg-transparent text-xs text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export Report</span>
            <span className="sm:hidden">Export</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            New Order
          </button>
        </div>
      </div>
      
      {/* Mobile Report Filters */}
      <div className="md:hidden flex flex-col gap-2 bg-zinc-900 border border-zinc-800 p-4 rounded-2xl mb-4">
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Report Filters</p>
        <div className="grid grid-cols-1 gap-3">
          <select
            value={reportFilter.type}
            onChange={(e) => setReportFilter({ ...reportFilter, type: e.target.value as any })}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-zinc-50"
          >
            <option value="all">All Types</option>
            <option value="food">Food Only</option>
            <option value="drink">Drink Only</option>
            <option value="other">Other Only</option>
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="date"
              value={reportFilter.startDate}
              onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-zinc-50"
            />
            <input
              type="date"
              value={reportFilter.endDate}
              onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-zinc-50"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center gap-4 border-b border-zinc-800 mb-6">
        <button
          onClick={() => setActiveTab('orders')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeTab === 'orders' ? "text-emerald-500" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          Orders
          {activeTab === 'orders' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
        </button>
        <button
          onClick={() => setActiveTab('tables')}
          className={cn(
            "pb-4 px-2 text-sm font-bold transition-all relative",
            activeTab === 'tables' ? "text-emerald-500" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          Tables
          {activeTab === 'tables' && <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-emerald-500" />}
        </button>
      </div>

      {activeTab === 'orders' ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-zinc-400 text-sm font-medium">{stat.label}</span>
                  <stat.icon className={stat.color} size={20} />
                </div>
                <div className="text-2xl font-bold text-zinc-50">{stat.count}</div>
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
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
              />
            </div>
            <div className="flex flex-wrap items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl w-full md:w-auto">
              {(['all', 'pending', 'preparing', 'ready', 'delivered'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                    filter === f ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
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
                          <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-zinc-50 font-bold">
                            {order.roomNumber === 'Walk-in' ? 'W' : order.roomNumber}
                          </div>
                          <div>
                            <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">
                              {order.roomNumber === 'Walk-in' ? (order.tableNumber ? `Table ${order.tableNumber}` : 'Walk-in') : `Room ${order.roomNumber}`}
                            </div>
                            <div className="text-[10px] text-zinc-400 font-bold">
                              {order.guestName}
                            </div>
                            <div className="text-[10px] text-zinc-500 flex items-center gap-1">
                              <Clock size={10} />
                              {getWaitTime(order.timestamp)}
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                            <button
                              onClick={() => handleDeleteOrder(order.id, order.roomNumber)}
                              className="p-1.5 hover:bg-red-500/10 text-zinc-600 hover:text-red-500 rounded-lg transition-colors"
                              title="Delete Order"
                            >
                              <Trash2 size={14} />
                            </button>
                          )}
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
                      </div>

                      <div className="space-y-3">
                        <div className="flex items-center gap-2 mb-1">
                          {order.category === 'food' ? <Pizza size={14} className="text-amber-500" /> :
                           order.category === 'drink' ? <Coffee size={14} className="text-blue-500" /> :
                           <MoreHorizontal size={14} className="text-zinc-500" />}
                          <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">{order.category}</span>
                        </div>
                        <div>
                          <p className="text-sm text-zinc-50 leading-relaxed font-medium">{order.items}</p>
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

                    {order.status !== 'delivered' && (
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
                            className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                          >
                            <CheckCircle2 size={14} />
                            Confirm Delivery
                          </button>
                        )}
                        <button
                          onClick={() => setPrintingOrder(order)}
                          className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-50 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
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
        </>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-zinc-50">Bar Tables</h2>
              <p className="text-sm text-zinc-400">Manage and track table occupancy and spending</p>
            </div>
            <button
              onClick={() => {
                setEditingTable(null);
                setShowTableModal(true);
              }}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
            >
              <Plus size={18} />
              Add Table
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {tables.map((table) => (
              <div
                key={table.id}
                className={cn(
                  "bg-zinc-900 border border-zinc-800 rounded-2xl p-6 transition-all hover:border-zinc-700",
                  table.status === 'occupied' ? "ring-1 ring-amber-500/20" : ""
                )}
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center text-xl font-black text-zinc-50">
                    {table.tableNumber}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setEditingTable(table);
                        setShowTableModal(true);
                      }}
                      className="p-2 hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300 rounded-lg transition-colors"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button
                      onClick={() => handleDeleteTable(table.id)}
                      className="p-2 hover:bg-red-500/10 text-zinc-500 hover:text-red-500 rounded-lg transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Status</span>
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      table.status === 'available' ? "bg-emerald-500/10 text-emerald-500" :
                      table.status === 'occupied' ? "bg-amber-500/10 text-amber-500" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      {table.status}
                    </span>
                  </div>

                  {table.status === 'occupied' && (
                    <>
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Current Guest</div>
                        <div className="text-sm font-bold text-zinc-50">{table.currentGuestName || 'Unknown'}</div>
                      </div>
                      <button
                        onClick={() => handleClearTable(table.id)}
                        className="w-full py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-50 rounded-xl text-[10px] font-bold uppercase tracking-wider transition-all"
                      >
                        Clear Table
                      </button>
                    </>
                  )}

                  <div className="flex items-center justify-between pt-4 border-t border-zinc-800">
                    <div className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Total Spend</div>
                    <div className="text-sm font-black text-emerald-500">
                      {(table.totalSpend || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Print Docket Modal */}
      {printingOrder && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-[70] flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-md">
            <button 
              onClick={() => setPrintingOrder(null)}
              className="absolute -top-12 right-0 p-2 text-zinc-50 hover:bg-white/10 rounded-full transition-all print:hidden"
            >
              <XCircle size={32} />
            </button>
            
            {/* Docket View */}
            <div className="bg-white text-black p-8 font-mono shadow-2xl print:shadow-none print:p-0">
              <div className="text-center border-b-2 border-black pb-4 mb-4">
                <h2 className="text-xl font-black uppercase tracking-tighter">F & B DOCKET</h2>
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
                {printingOrder.itemsList ? (
                  <div className="space-y-1">
                    {printingOrder.itemsList.map((item, idx) => (
                      <div key={idx} className="flex justify-between text-sm font-bold">
                        <span>{item.quantity}x {item.name}</span>
                        <span>{(item.price * item.quantity).toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="border-t border-black pt-1 mt-2 flex justify-between text-sm font-black">
                      <span>TOTAL</span>
                      <span>{printingOrder.price.toLocaleString()}</span>
                    </div>
                    {printingOrder.paidAmount !== undefined && (
                      <div className="mt-2 space-y-1 border-t border-black pt-2">
                        <div className="flex justify-between text-xs font-bold">
                          <span>PAID ({printingOrder.paymentMethod.toUpperCase()})</span>
                          <span>{printingOrder.paidAmount.toLocaleString()}</span>
                        </div>
                        {printingOrder.price - printingOrder.paidAmount > 0 && (
                          <div className="flex justify-between text-xs font-black">
                            <span>BALANCE TO ROOM</span>
                            <span>{(printingOrder.price - printingOrder.paidAmount).toLocaleString()}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-sm font-bold whitespace-pre-wrap leading-relaxed">
                    {printingOrder.items}
                  </p>
                )}
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
                  className="bg-black text-zinc-50 px-8 py-3 rounded-xl text-sm font-bold hover:bg-zinc-800 transition-all active:scale-95 flex items-center gap-2"
                >
                  <Printer size={18} />
                  Print Docket
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Order Modal (POS) */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-50">F & B POS</h2>
                <p className="text-xs text-zinc-500">Create new room service or walk-in order</p>
              </div>
              <button 
                onClick={() => setShowAddModal(false)}
                className="p-2 hover:bg-zinc-800 rounded-full text-zinc-500 transition-colors"
              >
                <XCircle size={24} />
              </button>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Menu */}
              <div className="flex-1 border-r border-zinc-800 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-zinc-800 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setNewOrder(prev => ({ ...prev, category: 'all' }))}
                    className={cn(
                      "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                      newOrder.category === 'all' 
                        ? "bg-emerald-500 text-black" 
                        : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                    )}
                  >
                    All
                  </button>
                  {fbCategories.map(cat => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setNewOrder(prev => ({ ...prev, category: cat.name }))}
                      className={cn(
                        "px-4 py-2 rounded-xl text-xs font-bold uppercase tracking-wider transition-all",
                        newOrder.category === cat.name 
                          ? "bg-emerald-500 text-black" 
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      )}
                    >
                      {cat.name}
                    </button>
                  ))}
                </div>
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-6">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                    {filteredInventory.map(item => (
                        <button
                          key={item.id}
                          onClick={() => addToCart(item)}
                          className="bg-zinc-950 border border-zinc-800 p-4 rounded-2xl text-left hover:border-emerald-500/50 transition-all group active:scale-95"
                        >
                          <div className="flex items-center justify-between mb-2">
                            {item.category.toLowerCase().includes('food') || item.category.toLowerCase().includes('meal') ? <Pizza size={16} className="text-amber-500" /> : 
                             item.category.toLowerCase().includes('drink') || item.category.toLowerCase().includes('bev') ? <Coffee size={16} className="text-blue-500" /> :
                             <Utensils size={16} className="text-zinc-500" />}
                            <Plus size={14} className="text-zinc-500 group-hover:text-emerald-500" />
                          </div>
                          <div className="text-sm font-bold text-zinc-50 mb-1 line-clamp-1">{item.name}</div>
                          <div className="text-xs font-bold text-emerald-500">{item.price.toLocaleString()}</div>
                        </button>
                      ))}
                  </div>

                  {/* Custom Item Form */}
                  <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-2xl mt-auto">
                    <h3 className="text-sm font-bold text-zinc-50 mb-4 flex items-center gap-2">
                      <Plus size={16} className="text-emerald-500" />
                      Add Custom Item
                    </h3>
                    <form onSubmit={addCustomToCart} className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      <div className="sm:col-span-1">
                        <input
                          type="text"
                          placeholder="Item Name"
                          value={customItem.name}
                          onChange={(e) => setCustomItem({ ...customItem, name: e.target.value })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="sm:col-span-1">
                        <input
                          type="number"
                          placeholder="Price"
                          value={customItem.price || ''}
                          onChange={(e) => setCustomItem({ ...customItem, price: Number(e.target.value) })}
                          className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={!customItem.name || customItem.price <= 0}
                        className="bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                      >
                        Add to Cart
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              {/* Right Column: Cart & Details */}
              <div className="w-80 bg-zinc-950 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-zinc-800">
                  <div className="flex items-center gap-2 text-zinc-400 mb-4">
                    <ShoppingCart size={18} />
                    <span className="text-sm font-bold uppercase tracking-wider">Current Order</span>
                  </div>
                  
                  <div className="space-y-3 max-h-[30vh] overflow-y-auto pr-2">
                    {cart.length === 0 ? (
                      <div className="text-center py-8 text-zinc-600">
                        <Utensils size={32} className="mx-auto mb-2 opacity-20" />
                        <p className="text-xs">Cart is empty</p>
                      </div>
                    ) : (
                      cart.map(item => (
                        <div key={item.id} className="flex items-center justify-between gap-3 bg-zinc-900/50 p-2 rounded-xl border border-zinc-800/50">
                          <div className="flex-1 min-w-0">
                            <div className="text-xs font-bold text-zinc-50 truncate">{item.name}</div>
                            <div className="text-[10px] text-emerald-500 font-bold">{item.price.toLocaleString()}</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => updateCartQuantity(item.id, -1)}
                              className="w-6 h-6 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-50"
                            >
                              <Minus size={12} />
                            </button>
                            <span className="text-xs font-bold text-zinc-50 w-4 text-center">{item.quantity}</span>
                            <button 
                              onClick={() => updateCartQuantity(item.id, 1)}
                              className="w-6 h-6 bg-zinc-800 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-50"
                            >
                              <Plus size={12} />
                            </button>
                            <button 
                              onClick={() => removeFromCart(item.id)}
                              className="text-zinc-600 hover:text-red-500 ml-1"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Table (Optional)</label>
                    <select
                      value={newOrder.tableId}
                      onChange={(e) => {
                        const table = tables.find(t => t.id === e.target.value);
                        setNewOrder({ ...newOrder, tableId: e.target.value, tableNumber: table?.tableNumber || '' });
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">No Table</option>
                      {tables.map(table => (
                        <option key={table.id} value={table.id}>
                          Table {table.tableNumber} ({table.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Room & Guest</label>
                    <select
                      required
                      value={newOrder.roomNumber}
                      onChange={(e) => {
                        const roomNum = e.target.value;
                        const res = reservations.find(r => r.roomNumber === roomNum);
                        setNewOrder({ ...newOrder, roomNumber: roomNum, guestId: res?.guestId || '' });
                      }}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select Room</option>
                      <option value="Walk-in">Walk-in Guest</option>
                      {reservations.map(res => (
                        <option key={res.id} value={res.roomNumber}>
                          Room {res.roomNumber} ({res.guestName})
                        </option>
                      ))}
                    </select>
                  </div>

                  {newOrder.roomNumber && (
                    <div className="p-4 bg-zinc-950 rounded-2xl border border-zinc-800 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-emerald-500 font-bold text-xs uppercase tracking-wider">
                          <DollarSign size={14} />
                          Payments
                        </div>
                        <button
                          type="button"
                          onClick={() => setNewOrder({
                            ...newOrder,
                            payments: [...newOrder.payments, { amount: 0, method: 'cash' }]
                          })}
                          className="flex items-center gap-1 text-[10px] font-bold text-emerald-500 hover:text-emerald-400 uppercase"
                        >
                          <Plus size={12} /> Add Split
                        </button>
                      </div>

                      <div className="space-y-3">
                        {newOrder.payments.map((pay, index) => (
                          <div key={index} className="grid grid-cols-2 gap-3 p-3 bg-zinc-900 border border-zinc-800 rounded-xl relative group">
                            {newOrder.payments.length > 1 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const updated = [...newOrder.payments];
                                  updated.splice(index, 1);
                                  setNewOrder({ ...newOrder, payments: updated });
                                }}
                                className="absolute -top-1 -right-1 w-5 h-5 bg-zinc-800 text-zinc-500 hover:text-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all border border-zinc-700"
                              >
                                <X size={10} />
                              </button>
                            )}
                            <div>
                              <label className="block text-[9px] font-semibold text-zinc-500 uppercase mb-1">Amount</label>
                              <input 
                                type="number" 
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                                value={pay.amount || ''}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  const updated = [...newOrder.payments];
                                  updated[index].amount = val;
                                  setNewOrder({ ...newOrder, payments: updated });
                                }}
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <label className="block text-[9px] font-semibold text-zinc-500 uppercase mb-1">Method</label>
                              <select 
                                className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1 text-xs text-zinc-50 focus:border-emerald-500 outline-none"
                                value={pay.method}
                                onChange={(e) => {
                                  const updated = [...newOrder.payments];
                                  updated[index].method = e.target.value as any;
                                  setNewOrder({ ...newOrder, payments: updated });
                                }}
                              >
                                <option value="cash">Cash</option>
                                <option value="card">Card</option>
                                <option value="transfer">Transfer</option>
                                <option value="room">Charge to Room</option>
                              </select>
                            </div>
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center pt-2 border-t border-zinc-900">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold">Total Collection</span>
                        <span className={cn(
                          "text-xs font-bold",
                          newOrder.payments.reduce((acc, p) => acc + p.amount, 0) >= newOrder.price ? "text-emerald-500" : "text-yellow-500"
                        )}>
                          {newOrder.payments.reduce((acc, p) => acc + p.amount, 0).toLocaleString()} / {newOrder.price.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Discount</label>
                      <input
                        type="number"
                        value={newOrder.discount || ''}
                        onChange={(e) => setNewOrder({ ...newOrder, discount: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                        placeholder="0"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Type</label>
                      <select
                        value={newOrder.discountType}
                        onChange={(e) => setNewOrder({ ...newOrder, discountType: e.target.value as any })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                      >
                        <option value="fixed">Fixed</option>
                        <option value="percentage">%</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Special Notes</label>
                    <textarea
                      value={newOrder.notes}
                      onChange={(e) => setNewOrder({ ...newOrder, notes: e.target.value })}
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50 h-20 resize-none"
                      placeholder="e.g. No onions, extra ice..."
                    />
                  </div>
                </div>

                <div className="p-4 bg-zinc-900 border-t border-zinc-800 space-y-2">
                  <div className="flex justify-between text-xs text-zinc-500 uppercase font-bold mb-2">
                    <span>Order Summary</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-zinc-500">Subtotal</span>
                    <span className="text-zinc-50">{formatCurrency(newOrder.price, currency, exchangeRate)}</span>
                  </div>
                  {(() => {
                    const activeTaxes = (hotel?.taxes || []).filter(t => {
                      const status = (t.status || '').toLowerCase().trim();
                      const category = (t.category || '').toLowerCase().trim();
                      return status === 'active' && (category === 'restaurant' || category === 'f & b' || category === 'all');
                    });
                    
                    const inclusiveTaxes = activeTaxes.filter(t => t.isInclusive);
                    const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
                    
                    const baseAmount = newOrder.price;
                    const totalExclusiveTax = exclusiveTaxes.reduce((acc, t) => acc + (baseAmount * (t.percentage / 100)), 0);

                    return (
                      <>
                        {inclusiveTaxes.map(tax => (
                          <div key={tax.id} className="flex justify-between text-[10px] text-blue-400/80">
                            <span>{tax.name} ({tax.percentage}%) [Incl.]</span>
                            <span>{formatCurrency(baseAmount - (baseAmount / (1 + (tax.percentage / 100))), currency, exchangeRate)}</span>
                          </div>
                        ))}
                        {exclusiveTaxes.map(tax => (
                          <div key={tax.id} className="flex justify-between text-[10px] text-emerald-400/80">
                            <span>{tax.name} ({tax.percentage}%)</span>
                            <span>+{formatCurrency(baseAmount * (tax.percentage / 100), currency, exchangeRate)}</span>
                          </div>
                        ))}
                        <div className="flex justify-between items-center pt-2 border-t border-zinc-800 mt-2">
                          <span className="text-sm font-bold text-zinc-50">Grand Total</span>
                          <span className="text-xl font-black text-emerald-500">{formatCurrency(baseAmount + totalExclusiveTax, currency, exchangeRate)}</span>
                        </div>
                      </>
                    );
                  })()}
                  <button
                    onClick={handleAddOrder}
                    disabled={!newOrder.roomNumber || cart.length === 0 || isSaving}
                    className="w-full py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50 flex items-center justify-center gap-2 mt-2"
                  >
                    {isSaving ? (
                      <RefreshCw size={18} className="animate-spin" />
                    ) : (
                      <>
                        <CheckCircle2 size={18} />
                        Complete Order
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
      {/* Table Management Modal */}
      {showTableModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <h2 className="text-xl font-bold text-zinc-50">{editingTable ? 'Edit Table' : 'Add New Table'}</h2>
              <button onClick={() => setShowTableModal(false)} className="text-zinc-500 hover:text-zinc-300">
                <XCircle size={24} />
              </button>
            </div>
            <form onSubmit={handleAddTable} className="p-6 space-y-4">
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Table Number</label>
                <input
                  type="text"
                  required
                  value={editingTable?.tableNumber || ''}
                  onChange={(e) => setEditingTable(prev => ({ ...prev!, tableNumber: e.target.value }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  placeholder="e.g. 1, 2, B1, etc."
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Capacity</label>
                <input
                  type="number"
                  required
                  min="1"
                  value={editingTable?.capacity || 4}
                  onChange={(e) => setEditingTable(prev => ({ ...prev!, capacity: parseInt(e.target.value) }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold text-zinc-500 uppercase tracking-wider mb-2">Status</label>
                <select
                  value={editingTable?.status || 'available'}
                  onChange={(e) => setEditingTable(prev => ({ ...prev!, status: e.target.value as any }))}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                >
                  <option value="available">Available</option>
                  <option value="occupied">Occupied</option>
                  <option value="reserved">Reserved</option>
                </select>
              </div>
              <button
                type="submit"
                className="w-full bg-emerald-500 hover:bg-emerald-600 text-black font-bold py-4 rounded-xl transition-all active:scale-95 mt-4"
              >
                {editingTable ? 'Update Table' : 'Add Table'}
              </button>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
