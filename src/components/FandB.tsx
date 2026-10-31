import React, { useEffect, useState } from 'react';
import { collection, query, where, addDoc, doc, updateDoc, orderBy, getDoc, onSnapshot, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { KitchenOrder, OperationType, Reservation, Guest, InventoryItem, BarTable, InventoryCategory } from '../types';
import { postToLedger } from '../services/ledgerService';
import { createNotification } from './Notifications';
import { printDocument } from '../utils/printUtils';
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
  Calendar,
  Trash2,
  Minus,
  Edit2,
  DollarSign,
  X,
  AlertTriangle,
  ClipboardList,
  Lock,
  CreditCard,
  Building2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency, exportToCSV, safeStringify } from '../utils';
import { toast } from 'sonner';
import { format, startOfMonth, startOfDay, endOfDay } from 'date-fns';
import { hasPermission } from '../utils/permissions';

export function FandB() {
  const { hotel, profile, currency, exchangeRate, customRoles } = useAuth();
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
    payments: [{ amount: 0, method: 'cash', settlementSource: 'F&B Outlet' }] as { amount: number; method: 'cash' | 'card' | 'transfer' | 'room'; settlementSource?: 'Front Desk' | 'F&B Outlet' }[],
    discount: 0,
    discountType: 'fixed' as 'fixed' | 'percentage'
  });

  // Direct Settlement in F&B State
  const [settleOrderModal, setSettleOrderModal] = useState<KitchenOrder | null>(null);
  const [settleAmount, setSettleAmount] = useState<number>(0);
  const [settleMethod, setSettleMethod] = useState<'cash' | 'card' | 'transfer'>('cash');
  const [settleSource, setSettleSource] = useState<'F&B Outlet' | 'Front Desk'>('F&B Outlet');
  const [settleNotes, setSettleNotes] = useState<string>('');
  const [isSettling, setIsSettling] = useState(false);

  // Add Items Before Delivery State
  const [addItemsOrderModal, setAddItemsOrderModal] = useState<KitchenOrder | null>(null);
  const [additionalCart, setAdditionalCart] = useState<{ id: string; name: string; price: number; quantity: number }[]>([]);
  const [addCategoryFilter, setAddCategoryFilter] = useState<string>('all');
  const [addSearchQuery, setAddSearchQuery] = useState<string>('');
  const [customAddItem, setCustomAddItem] = useState({ name: '', price: 0 });
  const [isAddingItems, setIsAddingItems] = useState(false);

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

    if (!hasPermission(profile, 'create_fb_orders', customRoles) && profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
      toast.error('Permission denied: You do not have permission to create orders.');
      return;
    }

    // Check if room number is specified but not checked in
    const isRoomOrder = newOrder.roomNumber && newOrder.roomNumber !== 'Walk-in';
    const res = isRoomOrder ? reservations.find(r => r.roomNumber === newOrder.roomNumber && r.status === 'checked_in') : undefined;

    const hasRoomPayment = newOrder.payments.some(p => p.method === 'room');
    if (isRoomOrder && hasRoomPayment && !res) {
      toast.error(`No active checked-in guest found in Room ${newOrder.roomNumber} to charge.`);
      return;
    }

    setIsSaving(true);
    try {
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

      const orderRef = await database.safeAdd(collection(db, 'hotels', hotel.id, 'kitchen_orders'), orderData, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ADD_ORDER',
        details: `F & B Order for ${orderData.guestName} (Room ${newOrder.roomNumber})`
      });

      // Update table status if assigned
      if (newOrder.tableId) {
        const table = tables.find(t => t.id === newOrder.tableId);
        if (table) {
          database.safeUpdate(doc(db, 'hotels', hotel.id, 'tables', table.id), {
            status: 'occupied',
            currentOrderId: orderRef.id,
            currentGuestName: orderData.guestName,
            currentGuestId: newOrder.guestId || res?.guestId || '',
            totalSpend: (table.totalSpend || 0) + finalPrice,
            lastUpdated: new Date().toISOString()
          }, {
            hotelId: hotel.id,
            module: 'F & B',
            action: 'UPDATE_TABLE_STATUS',
            details: `Table ${table.tableNumber} status set to occupied`
          }).catch(() => {});
        }
      }

      // Create background notification for F & B staff
      createNotification(hotel.id, {
        title: 'New F & B Order',
        message: `New order for Room ${newOrder.roomNumber || 'Walk-in'}: ${newOrder.items}`,
        type: 'info',
        userId: 'all'
      }).catch(() => {});

      const guestId = newOrder.guestId || (res?.guestId);

      // Post charge to room ledger if applicable
      if (isRoomOrder && res && guestId) {
        await postToLedger(hotel.id, guestId, res.id, {
          amount: finalPrice,
          type: 'debit',
          category: 'F & B',
          description: `F & B Order (Room ${newOrder.roomNumber || 'Service'}): ${newOrder.items}${discountAmount > 0 ? ` (Discounted)` : ''}`,
          referenceId: orderRef.id,
          postedBy: profile.uid
        }, profile.uid, res.corporateId, 'cash', {
          uid: profile?.uid,
          email: profile?.email,
          role: profile?.role || 'staff',
          displayName: profile?.displayName || (profile as any)?.name || 'Staff'
        });
      }

      // Post payments to ledger/finance
      for (const pay of newOrder.payments) {
        if (pay.amount > 0) {
          const source = pay.settlementSource || 'F&B Outlet';
          if (isRoomOrder && res && guestId && pay.method !== 'room') {
            await postToLedger(hotel.id, guestId, res.id, {
              amount: pay.amount,
              type: 'credit',
              category: 'payment',
              description: `F & B Payment [${source}] (${pay.method.toUpperCase()}): ${newOrder.items}`,
              referenceId: orderRef.id,
              postedBy: profile.uid,
              paymentMethod: pay.method as any,
              settlementSource: source
            }, profile.uid, res.corporateId, pay.method as any, {
              uid: profile?.uid,
              email: profile?.email,
              role: profile?.role || 'staff',
              displayName: profile?.displayName || (profile as any)?.name || 'Staff'
            });

            database.safeAdd(collection(db, 'hotels', hotel.id, 'finance'), {
              type: 'income',
              amount: pay.amount,
              category: 'F & B Revenue',
              description: `F & B Order ${orderRef.id} [${source}] (Room ${newOrder.roomNumber}) - ${pay.method.toUpperCase()}`,
              timestamp: new Date().toISOString(),
              paymentMethod: pay.method,
              settlementSource: source,
              referenceId: orderRef.id,
              postedBy: profile.uid,
              processedBy: {
                uid: profile.uid,
                name: profile.displayName || (profile as any)?.name || 'Staff',
                role: profile.role || 'staff'
              }
            }, {
              hotelId: hotel.id,
              module: 'Finance',
              action: 'F&B_INCOME_RECORD',
              details: `Recorded F&B income from Room ${newOrder.roomNumber} [${source}]`
            }).catch(() => {});
          } else if (pay.method !== 'room') {
            database.safeAdd(collection(db, 'hotels', hotel.id, 'finance'), {
              type: 'income',
              amount: pay.amount,
              category: 'F & B Revenue',
              description: `F & B Order ${orderRef.id} [${source}] (Walk-in) - ${pay.method.toUpperCase()}`,
              timestamp: new Date().toISOString(),
              paymentMethod: pay.method,
              settlementSource: source,
              referenceId: orderRef.id,
              postedBy: profile.uid,
              processedBy: {
                uid: profile.uid,
                name: profile.displayName || (profile as any)?.name || 'Staff',
                role: profile.role || 'staff'
              }
            }, {
              hotelId: hotel.id,
              module: 'Finance',
              action: 'F&B_INCOME_RECORD',
              details: `Recorded walk-in F&B income [${source}]`
            }).catch(() => {});
          }
        }
      }

      // Log activity in background
      database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'F&B_ORDER_CREATED',
        resource: `Room ${newOrder.roomNumber}: ${newOrder.items}`,
        hotelId: hotel.id,
        module: 'F & B'
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'F&B order creation activity'
      }).catch(() => {});

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
        payments: [{ amount: 0, method: 'cash', settlementSource: 'F&B Outlet' }],
        discount: 0,
        discountType: 'fixed'
      });
    } catch (err: any) {
      console.error('Error in handleAddOrder:', err.message || safeStringify(err));
      toast.error(err.message || 'Failed to create order');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteOrder = async (orderId: string, roomNumber: string) => {
    if (!hotel?.id || !profile) return;

    if (!hasPermission(profile, 'delete_fb_orders', customRoles) && profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
      toast.error('Permission denied: You do not have permission to delete orders.');
      return;
    }

    if (!window.confirm(`Are you sure you want to delete order for Room ${roomNumber}? This action cannot be undone.`)) {
      return;
    }

    try {
      await database.safeDelete(doc(db, 'hotels', hotel.id, 'kitchen_orders', orderId), {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'F&B_ORDER_DELETED',
        details: `Deleted order for room ${roomNumber}`
      });
      
      // Log action
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'F&B_ORDER_DELETED',
        resource: `Order ${orderId} (Room ${roomNumber})`,
        hotelId: hotel.id,
        module: 'F & B'
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'F&B order deletion activity'
      });
      
      toast.success('Order deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/kitchen_orders/${orderId}`);
      toast.error('Failed to delete order');
    }
  };

  const updateOrderStatus = async (orderId: string, status: KitchenOrder['status']) => {
    if (!hotel?.id || !profile) return;

    if (!hasPermission(profile, 'edit_fb_orders', customRoles) && !hasPermission(profile, 'manage_kitchen', customRoles) && profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
      toast.error('Permission denied: You do not have permission to update orders.');
      return;
    }
    
    const updates: any = { status };
    if (status === 'preparing') updates.preparedAt = new Date().toISOString();
    if (status === 'ready') updates.readyAt = new Date().toISOString();
    if (status === 'delivered') updates.deliveredAt = new Date().toISOString();

    try {
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'kitchen_orders', orderId), updates, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'F&B_ORDER_STATUS_UPDATE',
        details: `Set status to ${status} for order ${orderId}`
      });
      
      // Log action
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'F&B_ORDER_STATUS_UPDATE',
        resource: `Order ${orderId}: ${status}`,
        hotelId: hotel.id,
        module: 'F & B'
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'F&B status update activity'
      });
      toast.success(`Order status updated to ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/kitchen_orders/${orderId}`);
      toast.error('Failed to update order status');
    }
  };

  // Direct Settlement in F&B Handlers
  const openSettleModal = (order: KitchenOrder, currentBalance: number) => {
    const orderTotal = order.totalAmount || order.price || 0;
    let paymentsList: { amount: number; method: string }[] = [];
    if (Array.isArray(order.payments) && order.payments.length > 0) {
      paymentsList = order.payments;
    } else if (order.paidAmount !== undefined && order.paidAmount > 0) {
      paymentsList = [{ amount: order.paidAmount, method: order.paymentMethod || 'cash' }];
    }
    const directPaid = paymentsList
      .filter(p => p.method !== 'room')
      .reduce((sum, p) => sum + (p.amount || 0), 0);

    const remaining = Math.max(0, currentBalance > 0 ? currentBalance : (orderTotal - directPaid));
    setSettleOrderModal(order);
    setSettleAmount(remaining);
    setSettleMethod('cash');
    setSettleSource('F&B Outlet');
    setSettleNotes('');
  };

  const handleSettleOrderPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !settleOrderModal || isSettling) return;

    if (settleAmount <= 0) {
      toast.error('Please enter a valid payment amount greater than 0.');
      return;
    }

    const orderTotal = settleOrderModal.totalAmount || settleOrderModal.price || 0;

    // Calculate existing direct paid
    let currentPayments: { amount: number; method: string; date?: string; reference?: string }[] = [];
    if (Array.isArray(settleOrderModal.payments) && settleOrderModal.payments.length > 0) {
      currentPayments = settleOrderModal.payments.filter(p => (p.amount || 0) > 0 && p.method !== 'room');
    } else if (settleOrderModal.paidAmount !== undefined && settleOrderModal.paidAmount > 0 && settleOrderModal.paymentMethod !== 'room') {
      currentPayments = [{
        amount: settleOrderModal.paidAmount,
        method: settleOrderModal.paymentMethod || 'cash',
        date: settleOrderModal.timestamp
      }];
    }

    const prevDirectPaid = currentPayments.reduce((sum, p) => sum + (p.amount || 0), 0);
    const newDirectPaid = prevDirectPaid + settleAmount;

    const isRoomOrder = settleOrderModal.roomNumber && settleOrderModal.roomNumber !== 'Walk-in';
    const res = isRoomOrder 
      ? (reservations.find(r => r.roomNumber === settleOrderModal.roomNumber && r.status === 'checked_in') || reservations.find(r => r.id === settleOrderModal.guestId))
      : undefined;
    const guestId = settleOrderModal.guestId || res?.guestId;

    setIsSettling(true);
    try {
      const newPaymentRecord = {
        amount: settleAmount,
        method: settleMethod,
        date: new Date().toISOString(),
        reference: settleNotes || `F&B Direct Settlement [${settleSource}] (${settleMethod.toUpperCase()})`,
        settlementSource: settleSource,
        processedBy: {
          uid: profile.uid,
          name: profile.displayName || (profile as any)?.name || 'Staff',
          role: profile.role || 'staff'
        }
      };

      const updatedPayments = [...currentPayments, newPaymentRecord];
      
      // If room order and remaining uncollected balance exists, reflect remaining room charge
      if (isRoomOrder && newDirectPaid < orderTotal) {
        updatedPayments.push({
          amount: Math.max(0, orderTotal - newDirectPaid),
          method: 'room',
          date: new Date().toISOString(),
          reference: 'Charged to Room Folio'
        });
      }

      // 1. Update Kitchen Order in Firestore
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'kitchen_orders', settleOrderModal.id), {
        payments: updatedPayments,
        paidAmount: newDirectPaid,
        settlementSource: settleSource,
        lastPaymentAt: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'SETTLE_ORDER_PAYMENT',
        details: `Settled ${formatCurrency(settleAmount, currency, exchangeRate)} [${settleSource}] via ${settleMethod} for Order ${settleOrderModal.id}`
      });

      // 2. Post to Hotel Finance Collection as Income
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'finance'), {
        type: 'income',
        amount: settleAmount,
        category: 'F & B Revenue',
        description: `F & B Direct Payment [${settleSource}] (${settleMethod.toUpperCase()}) - Room ${settleOrderModal.roomNumber || 'Walk-in'} (Order ${settleOrderModal.id.slice(-6)})${settleNotes ? `: ${settleNotes}` : ''}`,
        timestamp: new Date().toISOString(),
        paymentMethod: settleMethod,
        settlementSource: settleSource,
        referenceId: settleOrderModal.id,
        postedBy: profile.uid,
        processedBy: {
          uid: profile.uid,
          name: profile.displayName || (profile as any)?.name || 'Staff',
          role: profile.role || 'staff'
        }
      }, {
        hotelId: hotel.id,
        module: 'Finance',
        action: 'F&B_INCOME_RECORD',
        details: `Recorded F&B direct payment of ${settleAmount} [${settleSource}]`
      });

      // 3. If linked to an in-house room reservation, credit the guest ledger so room folio stays synchronized
      if (isRoomOrder && res && guestId) {
        await postToLedger(hotel.id, guestId, res.id, {
          amount: settleAmount,
          type: 'credit',
          category: 'payment',
          description: `F & B Direct Payment [${settleSource}] (${settleMethod.toUpperCase()}): ${settleOrderModal.items}${settleNotes ? ` - ${settleNotes}` : ''}`,
          referenceId: `${settleOrderModal.id}_PAY_${Date.now()}`,
          postedBy: profile.uid,
          paymentMethod: settleMethod as any,
          settlementSource: settleSource
        }, profile.uid, res.corporateId, settleMethod as any, {
          uid: profile?.uid,
          email: profile?.email,
          role: profile?.role || 'staff',
          displayName: profile?.displayName || (profile as any)?.name || 'Staff'
        });
      }

      // 4. Log Activity
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'F&B_ORDER_PAYMENT_RECORDED',
        resource: `Order ${settleOrderModal.id} (Room ${settleOrderModal.roomNumber}): ${formatCurrency(settleAmount, currency, exchangeRate)} via ${settleMethod}`,
        hotelId: hotel.id,
        module: 'F & B'
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Recorded F&B order direct settlement'
      });

      toast.success(`Payment of ${formatCurrency(settleAmount, currency, exchangeRate)} recorded successfully.`);
      setSettleOrderModal(null);
    } catch (err: any) {
      console.error('Error settling F&B order payment:', err);
      toast.error(err.message || 'Failed to record payment');
    } finally {
      setIsSettling(false);
    }
  };

  // Add Items Before Delivery Handlers
  const openAddItemsModal = (order: KitchenOrder) => {
    if (order.status === 'delivered') {
      toast.error('This order has already been delivered. No more items can be added after delivery.');
      return;
    }
    setAddItemsOrderModal(order);
    setAdditionalCart([]);
    setAddCategoryFilter('all');
    setAddSearchQuery('');
    setCustomAddItem({ name: '', price: 0 });
  };

  const addToAdditionalCart = (item: InventoryItem | { name: string; price: number; id?: string }) => {
    setAdditionalCart(prev => {
      const id = item.id || `custom-${Date.now()}`;
      const existing = prev.find(i => i.id === id || (i.name.toLowerCase() === item.name.toLowerCase() && i.id.startsWith('custom-')));
      if (existing) {
        return prev.map(i => (i.id === id || (i.name.toLowerCase() === item.name.toLowerCase() && i.id.startsWith('custom-'))) ? { ...i, quantity: i.quantity + 1 } : i);
      }
      return [...prev, { id: id, name: item.name, price: item.price, quantity: 1 }];
    });
  };

  const updateAdditionalCartQuantity = (id: string, delta: number) => {
    setAdditionalCart(prev => prev.map(i => {
      if (i.id === id) {
        const newQty = i.quantity + delta;
        return newQty > 0 ? { ...i, quantity: newQty } : null;
      }
      return i;
    }).filter(Boolean) as { id: string; name: string; price: number; quantity: number }[]);
  };

  const removeAdditionalCartItem = (id: string) => {
    setAdditionalCart(prev => prev.filter(i => i.id !== id));
  };

  const addCustomToAdditionalCart = (e: React.FormEvent) => {
    e.preventDefault();
    if (!customAddItem.name.trim() || customAddItem.price <= 0) return;
    addToAdditionalCart({ name: customAddItem.name.trim(), price: customAddItem.price });
    setCustomAddItem({ name: '', price: 0 });
    toast.success('Custom item added');
  };

  const handleAddItemsToExistingOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !addItemsOrderModal || isAddingItems) return;

    // Strict constraint: After clicking delivered no more items can be added
    if (addItemsOrderModal.status === 'delivered') {
      toast.error('This order has already been marked as DELIVERED. No more items can be added.');
      setAddItemsOrderModal(null);
      return;
    }

    if (additionalCart.length === 0) {
      toast.error('Please select at least one item to add.');
      return;
    }

    setIsAddingItems(true);
    try {
      const additionalSubtotal = additionalCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
      const newSubtotal = (addItemsOrderModal.price || 0) + additionalSubtotal;

      // Calculate Taxes on new subtotal
      const activeTaxes = (hotel?.taxes || []).filter(t => {
        const status = (t.status || '').toLowerCase().trim();
        const category = (t.category || '').toLowerCase().trim();
        return status === 'active' && (category === 'restaurant' || category === 'f & b' || category === 'all');
      });
      const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
      const totalExclusiveTax = exclusiveTaxes.reduce((acc, t) => acc + (newSubtotal * (t.percentage / 100)), 0);
      const taxDetails = activeTaxes.map(t => ({
        name: t.name,
        percentage: t.percentage,
        amount: t.isInclusive ? (newSubtotal - (newSubtotal / (1 + (t.percentage / 100)))) : (newSubtotal * (t.percentage / 100)),
        isInclusive: t.isInclusive
      }));

      // Respect existing discount if any
      let discountAmount = 0;
      const existingDiscount = (addItemsOrderModal as any).discount || 0;
      const existingDiscountType = (addItemsOrderModal as any).discountType || 'fixed';
      if (existingDiscount > 0) {
        if (existingDiscountType === 'percentage') {
          discountAmount = ((newSubtotal + totalExclusiveTax) * existingDiscount) / 100;
        } else {
          discountAmount = existingDiscount;
        }
      }

      const newFinalPrice = newSubtotal + totalExclusiveTax - discountAmount;
      const previousTotal = addItemsOrderModal.totalAmount || addItemsOrderModal.price || 0;
      const incrementalCharge = newFinalPrice - previousTotal;

      // Merge itemsList
      const existingList: { id: string; name: string; price: number; quantity: number }[] = 
        Array.isArray(addItemsOrderModal.itemsList) && addItemsOrderModal.itemsList.length > 0
          ? [...addItemsOrderModal.itemsList]
          : [];

      const mergedList = [...existingList];
      for (const newItem of additionalCart) {
        const idx = mergedList.findIndex(i => i.id === newItem.id || i.name.toLowerCase() === newItem.name.toLowerCase());
        if (idx >= 0) {
          mergedList[idx] = {
            ...mergedList[idx],
            quantity: mergedList[idx].quantity + newItem.quantity
          };
        } else {
          mergedList.push({ ...newItem });
        }
      }

      const newItemsString = mergedList.map(i => `${i.quantity}x ${i.name}`).join(', ');
      const addedItemsString = additionalCart.map(i => `${i.quantity}x ${i.name}`).join(', ');

      // 1. Update Kitchen Order in Firestore
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'kitchen_orders', addItemsOrderModal.id), {
        itemsList: mergedList,
        items: newItemsString,
        price: newSubtotal,
        taxAmount: totalExclusiveTax,
        taxDetails: taxDetails,
        totalAmount: newFinalPrice,
        lastItemsAddedAt: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ADD_ITEMS_TO_ORDER',
        details: `Added [${addedItemsString}] to Order ${addItemsOrderModal.id}`
      });

      // 2. If room order and reservation exists, post incremental debit to ledger
      const isRoomOrder = addItemsOrderModal.roomNumber && addItemsOrderModal.roomNumber !== 'Walk-in';
      const res = isRoomOrder 
        ? (reservations.find(r => r.roomNumber === addItemsOrderModal.roomNumber && r.status === 'checked_in') || reservations.find(r => r.id === addItemsOrderModal.guestId))
        : undefined;
      const guestId = addItemsOrderModal.guestId || res?.guestId;

      if (isRoomOrder && res && guestId && incrementalCharge > 0) {
        await postToLedger(hotel.id, guestId, res.id, {
          amount: incrementalCharge,
          type: 'debit',
          category: 'F & B',
          description: `F & B Order Additional Items (Room ${addItemsOrderModal.roomNumber}): ${addedItemsString}`,
          referenceId: `${addItemsOrderModal.id}_ADD_${Date.now()}`,
          postedBy: profile.uid
        }, profile.uid, res.corporateId, 'cash', {
          uid: profile?.uid,
          email: profile?.email,
          role: profile?.role || 'staff',
          displayName: profile?.displayName || (profile as any)?.name || 'Staff'
        });
      }

      // 3. Log Activity
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'F&B_ORDER_ITEMS_ADDED',
        resource: `Order ${addItemsOrderModal.id} (Room ${addItemsOrderModal.roomNumber}): Added ${addedItemsString} (+${formatCurrency(incrementalCharge, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'F & B'
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Added items to active F&B order'
      });

      toast.success(`Successfully added items to order #${addItemsOrderModal.id.slice(-6)}`);
      setAddItemsOrderModal(null);
      setAdditionalCart([]);
    } catch (err: any) {
      console.error('Error adding items to order:', err);
      toast.error(err.message || 'Failed to add items to order');
    } finally {
      setIsAddingItems(false);
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
        await database.safeUpdate(doc(db, 'hotels', hotel.id, 'tables', editingTable.id), tableData, {
          hotelId: hotel.id,
          module: 'F & B',
          action: 'TABLE_UPDATE',
          details: `Updated table ${tableData.tableNumber}`
        });
        toast.success('Table updated');
      } else {
        await database.safeAdd(collection(db, 'hotels', hotel.id, 'tables'), tableData, {
          hotelId: hotel.id,
          module: 'F & B',
          action: 'TABLE_CREATE',
          details: `Created table ${tableData.tableNumber}`
        });
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
      await database.safeDelete(doc(db, 'hotels', hotel.id, 'tables', tableId), {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'TABLE_DELETE',
        details: `Deleted table ${tableId}`
      });
      toast.success('Table deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/tables/${tableId}`);
      toast.error('Failed to delete table');
    }
  };

  const handleClearTable = async (tableId: string) => {
    if (!hotel?.id || !profile || !window.confirm('Are you sure you want to clear this table? This will mark it as available.')) return;

    try {
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'tables', tableId), {
        status: 'available',
        currentOrderId: '',
        currentGuestName: '',
        currentGuestId: '',
        currentReservationId: ''
      }, {
        hotelId: hotel.id,
        module: 'F & B',
        action: 'TABLE_CLEAR',
        details: `Cleared and reset table ${tableId}`
      });
      toast.success('Table cleared');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/tables/${tableId}`);
      toast.error('Failed to clear table');
    }
  };

  const handleExport = () => {
    if (!hasPermission(profile, 'export_reports', customRoles) && profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
      toast.error('Permission denied: You do not have permission to export reports.');
      return;
    }
    const start = startOfDay(new Date(reportFilter.startDate));
    const end = endOfDay(new Date(reportFilter.endDate));

    const dataToExport = orders
      .filter(order => {
        const orderDate = new Date(order.timestamp);
        const matchesDate = orderDate >= start && orderDate <= end;
        const matchesType = reportFilter.type === 'all' || order.category === reportFilter.type;
        return matchesDate && matchesType;
      })
      .map(order => {
        const directPaid = (order.payments || [])
          .filter(p => p.method !== 'room')
          .reduce((sum, p) => sum + (p.amount || 0), 0) || (order.paidAmount || 0);
        const sources = Array.from(new Set((order.payments || []).map(p => p.settlementSource).filter(Boolean)));
        const settlementSourceStr = sources.length > 0 ? sources.join(', ') : (order.settlementSource || 'F&B Outlet');

        return {
          Timestamp: new Date(order.timestamp).toLocaleString(),
          Room: order.roomNumber,
          Items: order.items,
          Category: order.category,
          Status: order.status,
          Price: order.price,
          'Total Amount': order.totalAmount || order.price,
          'Amount Paid': directPaid,
          Payment: order.paymentMethod,
          'Settlement Source': settlementSourceStr,
          Notes: order.notes || ''
        };
      });

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
            <div className="relative flex items-center gap-1">
              <Calendar size={12} className="text-emerald-500 ml-1" />
              <input
                type="date"
                value={reportFilter.startDate}
                onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
                className="bg-transparent text-xs text-zinc-400 font-bold px-1 py-1 focus:outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
            <span className="text-zinc-600 text-xs">-</span>
            <div className="relative flex items-center gap-1">
              <Calendar size={12} className="text-emerald-500 ml-1" />
              <input
                type="date"
                value={reportFilter.endDate}
                onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
                className="bg-transparent text-xs text-zinc-400 font-bold px-1 py-1 focus:outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
              />
            </div>
          </div>
          {(hasPermission(profile, 'export_reports', customRoles) || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
            <button 
              onClick={handleExport}
              className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Export Report</span>
              <span className="sm:hidden">Export</span>
            </button>
          )}
          {(hasPermission(profile, 'create_fb_orders', customRoles) || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
            >
              <Plus size={18} />
              New Order
            </button>
          )}
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
                filteredOrders.map((order) => {
                  const orderTotal = order.totalAmount || order.price || 0;
                  
                  // Gather payments
                  let paymentsList: { amount: number; method: string }[] = [];
                  if (Array.isArray(order.payments) && order.payments.length > 0) {
                    paymentsList = order.payments;
                  } else if (order.paidAmount !== undefined && order.paidAmount > 0) {
                    paymentsList = [{ amount: order.paidAmount, method: order.paymentMethod || 'cash' }];
                    if (order.paymentMethod === 'room' && order.paidAmount < orderTotal) {
                      paymentsList.push({ amount: orderTotal - order.paidAmount, method: 'room' });
                    }
                  } else if (order.paymentMethod) {
                    paymentsList = [{ amount: orderTotal, method: order.paymentMethod }];
                  }

                  const directPaid = paymentsList
                    .filter(p => p.method !== 'room')
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

                  const roomCharged = paymentsList
                    .filter(p => p.method === 'room')
                    .reduce((sum, p) => sum + (p.amount || 0), 0);

                  const totalAccounted = directPaid + roomCharged;
                  const balanceOwing = orderTotal - totalAccounted;
                  const weOweGuest = directPaid - orderTotal;
                  const unsettledBalance = Math.max(0, orderTotal - directPaid);
                  const isCompletelySettled = unsettledBalance <= 0.01;

                  return (
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
                          {(hasPermission(profile, 'delete_fb_orders', customRoles) || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
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
                        <div className="space-y-1 pt-2 border-t border-zinc-800/50">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider">Subtotal</span>
                            <span className="text-xs font-bold text-zinc-300">{formatCurrency(order.price, currency, exchangeRate)}</span>
                          </div>
                          
                          {order.taxDetails?.map((tax, idx) => (
                            <div key={idx} className="flex items-center justify-between">
                              <span className={cn(
                                "text-[9px] font-bold uppercase",
                                tax.isInclusive ? "text-blue-400 opacity-60" : "text-emerald-400 opacity-60"
                              )}>
                                {tax.name} ({tax.percentage}%) {tax.isInclusive ? '[Incl.]' : '[Excl.]'}
                              </span>
                              <span className="text-[9px] font-bold text-zinc-500">
                                {tax.isInclusive ? '' : '+'}{formatCurrency(tax.amount, currency, exchangeRate)}
                              </span>
                            </div>
                          ))}

                              <div className="space-y-1.5 pt-2 mt-2 border-t border-zinc-800/30">
                                <div className="flex items-center justify-between">
                                  <span className="text-[10px] text-zinc-400 font-bold uppercase tracking-wider">Grand Total</span>
                                  <span className="text-sm font-black text-emerald-400">{formatCurrency(orderTotal, currency, exchangeRate)}</span>
                                </div>

                                <div className="text-zinc-400">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider">Amount Paid</span>
                                    <span className={cn("font-bold text-xs", directPaid > 0 ? "text-emerald-400" : "text-zinc-500")}>
                                      {formatCurrency(directPaid, currency, exchangeRate)}
                                    </span>
                                  </div>
                                  {paymentsList.filter(p => p.method !== 'room').length > 0 && (
                                    <div className="flex flex-wrap gap-1 mt-1 justify-end">
                                      {paymentsList.filter(p => p.method !== 'room').map((p: any, idx: number) => (
                                        <span key={idx} className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-zinc-800 text-[9px] text-zinc-300 border border-zinc-750">
                                          <span className="capitalize">{p.method}</span>
                                          <span className="text-[8px] font-bold px-1 rounded bg-zinc-700 text-emerald-400">
                                            {p.settlementSource || 'F&B Outlet'}
                                          </span>
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                </div>

                                {roomCharged > 0 && (
                                  <div className="flex items-center justify-between text-zinc-400">
                                    <span className="text-[10px] font-semibold uppercase tracking-wider">Charged to Room</span>
                                    <span className="font-bold text-xs text-blue-400">
                                      {formatCurrency(roomCharged, currency, exchangeRate)}
                                    </span>
                                  </div>
                                )}

                                {balanceOwing > 0 ? (
                                  <div className="flex items-center justify-between p-2 mt-1 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 font-bold">
                                    <span className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                                      <AlertCircle size={12} /> Owing / Balance Due
                                    </span>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs">{formatCurrency(unsettledBalance, currency, exchangeRate)}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openSettleModal(order, unsettledBalance);
                                        }}
                                        className="px-2 py-0.5 bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black uppercase rounded-lg shadow transition-all active:scale-95 flex items-center gap-1"
                                        title="Settle directly in F&B"
                                      >
                                        <DollarSign size={11} /> Settle
                                      </button>
                                    </div>
                                  </div>
                                ) : roomCharged > 0 && !isCompletelySettled ? (
                                  <div className="flex items-center justify-between p-2 mt-1 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 font-bold">
                                    <div className="flex flex-col">
                                      <span className="text-[10px] uppercase tracking-wider flex items-center gap-1 font-bold text-amber-400">
                                        <Clock size={12} /> Pending Settlement
                                      </span>
                                      <span className="text-[9px] text-zinc-400 font-normal">
                                        {formatCurrency(unsettledBalance, currency, exchangeRate)} charged to room folio
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs font-black text-amber-300">{formatCurrency(unsettledBalance, currency, exchangeRate)}</span>
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          openSettleModal(order, unsettledBalance);
                                        }}
                                        className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-black text-[10px] font-black uppercase rounded-lg shadow transition-all active:scale-95 flex items-center gap-1"
                                        title="Settle remaining balance in F&B"
                                      >
                                        <DollarSign size={11} /> Settle
                                      </button>
                                    </div>
                                  </div>
                                ) : weOweGuest > 0 ? (
                                  <div className="flex items-center justify-between p-2 mt-1 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold">
                                    <span className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                                      <CheckCircle2 size={12} /> We Owe Guest (Change)
                                    </span>
                                    <span className="text-xs">{formatCurrency(weOweGuest, currency, exchangeRate)}</span>
                                  </div>
                                ) : (
                                  <div className="flex items-center justify-between p-1.5 mt-1 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[10px] font-bold uppercase tracking-wider">
                                    <span className="flex items-center gap-1">
                                      <CheckCircle2 size={12} /> Completely Settled
                                    </span>
                                    <span>Fully Paid</span>
                                  </div>
                                )}
                              </div>
                        </div>
                        {order.notes && (
                          <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                            <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Notes</div>
                            <p className="text-xs text-zinc-400 italic">{order.notes}</p>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="p-3 bg-zinc-950 border-t border-zinc-800 grid grid-cols-1 gap-2">
                      {order.status !== 'delivered' ? (
                        <>
                          {(hasPermission(profile, 'edit_fb_orders', customRoles) || hasPermission(profile, 'manage_kitchen', customRoles) || profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                            <>
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
                            </>
                          )}
                          <button
                            type="button"
                            onClick={() => openAddItemsModal(order)}
                            className="flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 py-2 rounded-xl text-xs font-bold transition-all active:scale-95"
                          >
                            <PlusCircle size={14} />
                            Add More Items
                          </button>
                        </>
                      ) : (
                        <div className="flex items-center justify-center gap-2 py-2 px-3 rounded-xl bg-zinc-900 border border-zinc-800/80 text-zinc-400 text-xs font-medium">
                          <Lock size={13} className="text-zinc-500" />
                          <span>Delivered • Receipt Finalized</span>
                        </div>
                      )}

                      {/* Direct settlement button: until it is completely settled, the settlement button should not go out */}
                      {unsettledBalance > 0.01 && (
                        <button
                          type="button"
                          onClick={() => openSettleModal(order, unsettledBalance)}
                          className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-400 text-black py-2.5 rounded-xl text-xs font-black transition-all shadow-lg active:scale-95"
                        >
                          <DollarSign size={14} />
                          Settle Payment ({formatCurrency(unsettledBalance, currency, exchangeRate)})
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
                  </motion.div>
                );
              })
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
            <div 
              id="fandb-kitchen-docket"
              className="bg-white text-black p-8 font-mono shadow-2xl print:shadow-none print:p-0 fandb-docket"
            >
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
                  <p className="text-sm font-bold">#{(printingOrder.id || '').slice(-6).toUpperCase()}</p>
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
                    <div className="border-t border-black pt-1 mt-2 flex justify-between text-xs font-bold">
                      <span>SUBTOTAL</span>
                      <span>{printingOrder.price.toLocaleString()}</span>
                    </div>
                    {printingOrder.taxDetails?.map((tax, idx) => (
                      <div key={idx} className="flex justify-between text-[10px]">
                        <span>{tax.name} ({tax.percentage}%) {tax.isInclusive ? '[Incl.]' : '[Excl.]'}</span>
                        <span>{tax.isInclusive ? '' : '+'}{tax.amount.toLocaleString()}</span>
                      </div>
                    ))}
                    <div className="border-t border-black pt-1 mt-1 flex justify-between text-sm font-black">
                      <span>GRAND TOTAL</span>
                      <span>{(printingOrder.totalAmount || printingOrder.price).toLocaleString()}</span>
                    </div>
                    {(() => {
                      const pTotal = printingOrder.totalAmount || printingOrder.price || 0;
                      let pPayments: { amount: number; method: string }[] = [];
                      if (Array.isArray(printingOrder.payments) && printingOrder.payments.length > 0) {
                        pPayments = printingOrder.payments;
                      } else if (printingOrder.paidAmount !== undefined && printingOrder.paidAmount > 0) {
                        pPayments = [{ amount: printingOrder.paidAmount, method: printingOrder.paymentMethod || 'cash' }];
                      } else if (printingOrder.paymentMethod) {
                        pPayments = [{ amount: pTotal, method: printingOrder.paymentMethod }];
                      }

                      const pDirectPaid = pPayments.filter(p => p.method !== 'room').reduce((sum, p) => sum + (p.amount || 0), 0);
                      const pRoomCharged = pPayments.filter(p => p.method === 'room').reduce((sum, p) => sum + (p.amount || 0), 0);
                      const pBalance = pTotal - (pDirectPaid + pRoomCharged);
                      const pChange = pDirectPaid - pTotal;

                      return (
                        <div className="mt-2 space-y-1 border-t border-black pt-2 text-xs">
                          {pDirectPaid > 0 && (
                            <div className="flex justify-between font-bold">
                              <span>AMOUNT PAID ({pPayments.filter(p => p.method !== 'room').map(p => p.method.toUpperCase()).join(', ') || 'DIRECT'})</span>
                              <span>{formatCurrency(pDirectPaid, currency, exchangeRate)}</span>
                            </div>
                          )}
                          {pRoomCharged > 0 && (
                            <div className="flex justify-between font-bold">
                              <span>CHARGED TO ROOM</span>
                              <span>{formatCurrency(pRoomCharged, currency, exchangeRate)}</span>
                            </div>
                          )}
                          {pBalance > 0 && (
                            <div className="flex justify-between font-black text-red-700 pt-1 border-t border-black/20">
                              <span>OWING / BALANCE DUE</span>
                              <span>{formatCurrency(pBalance, currency, exchangeRate)}</span>
                            </div>
                          )}
                          {pChange > 0 && (
                            <div className="flex justify-between font-black text-emerald-800 pt-1 border-t border-black/20">
                              <span>CHANGE DUE (WE OWE GUEST)</span>
                              <span>{formatCurrency(pChange, currency, exchangeRate)}</span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
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
                  onClick={() => {
                    printDocument(document.getElementById('fandb-kitchen-docket'), {
                      title: `F&B-Docket-Order-${printingOrder.id.slice(-6)}`,
                      pageSize: '80mm auto',
                      pageMargin: '0'
                    });
                  }}
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl max-h-[90vh] h-[85vh] flex flex-col overflow-hidden my-auto shadow-2xl"
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

                      {(() => {
                        const activeTaxes = (hotel?.taxes || []).filter(t => {
                          const status = (t.status || '').toLowerCase().trim();
                          const category = (t.category || '').toLowerCase().trim();
                          return status === 'active' && (category === 'restaurant' || category === 'f & b' || category === 'all');
                        });
                        const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
                        const totalExclusiveTax = exclusiveTaxes.reduce((acc, t) => acc + (newOrder.price * (t.percentage / 100)), 0);
                        
                        let discountAmount = 0;
                        if (newOrder.discount > 0) {
                          if (newOrder.discountType === 'percentage') {
                            discountAmount = ((newOrder.price + totalExclusiveTax) * newOrder.discount) / 100;
                          } else {
                            discountAmount = newOrder.discount;
                          }
                        }
                        const grandTotal = newOrder.price + totalExclusiveTax - discountAmount;
                        const totalCollected = newOrder.payments.reduce((acc, p) => acc + (p.amount || 0), 0);
                        const posOwing = grandTotal - totalCollected;
                        const posChange = totalCollected - grandTotal;

                        return (
                          <div className="space-y-1.5 pt-2 border-t border-zinc-900">
                            <div className="flex justify-between items-center">
                              <span className="text-[10px] text-zinc-500 uppercase font-bold">Total Collection</span>
                              <span className={cn(
                                "text-xs font-bold",
                                totalCollected >= grandTotal ? "text-emerald-500" : "text-amber-500"
                              )}>
                                {formatCurrency(totalCollected, currency, exchangeRate)} / {formatCurrency(grandTotal, currency, exchangeRate)}
                              </span>
                            </div>

                            {posOwing > 0 ? (
                              <div className="flex justify-between items-center p-2 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 font-bold text-xs">
                                <span className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                                  <AlertCircle size={12} /> Owing / Balance Due
                                </span>
                                <span>{formatCurrency(posOwing, currency, exchangeRate)}</span>
                              </div>
                            ) : posChange > 0 ? (
                              <div className="flex justify-between items-center p-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 font-bold text-xs">
                                <span className="text-[10px] uppercase tracking-wider flex items-center gap-1">
                                  <CheckCircle2 size={12} /> Change Due (We Owe)
                                </span>
                                <span>{formatCurrency(posChange, currency, exchangeRate)}</span>
                              </div>
                            ) : null}
                          </div>
                        );
                      })()}
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
                            <span>{tax.name} ({tax.percentage}%) [Excl.]</span>
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md max-h-[90vh] overflow-y-auto my-auto shadow-2xl"
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

      {/* Settle Order Payment Modal */}
      {settleOrderModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[70] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden my-auto shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-zinc-50 flex items-center gap-2">
                  <DollarSign size={20} className="text-emerald-400" />
                  Settle Order Payment
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Order #{settleOrderModal.id.slice(-6)} • Room {settleOrderModal.roomNumber || 'Walk-in'} ({settleOrderModal.guestName || 'Guest'})
                </p>
              </div>
              <button 
                onClick={() => setSettleOrderModal(null)} 
                className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <XCircle size={22} />
              </button>
            </div>

            {(() => {
              const orderTotal = settleOrderModal.totalAmount || settleOrderModal.price || 0;
              let paymentsList: { amount: number; method: string }[] = [];
              if (Array.isArray(settleOrderModal.payments) && settleOrderModal.payments.length > 0) {
                paymentsList = settleOrderModal.payments.filter(p => (p.amount || 0) > 0 && p.method !== 'room');
              } else if (settleOrderModal.paidAmount !== undefined && settleOrderModal.paidAmount > 0 && settleOrderModal.paymentMethod !== 'room') {
                paymentsList = [{ amount: settleOrderModal.paidAmount, method: settleOrderModal.paymentMethod || 'cash' }];
              }
              const currentDirectPaid = paymentsList.reduce((sum, p) => sum + p.amount, 0);
              const remainingDue = Math.max(0, orderTotal - currentDirectPaid);

              return (
                <form onSubmit={handleSettleOrderPayment} className="p-6 space-y-5">
                  {/* Order Financial Summary */}
                  <div className="bg-zinc-950 border border-zinc-800/80 rounded-2xl p-4 space-y-2.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Order Grand Total</span>
                      <span className="font-bold text-zinc-200">{formatCurrency(orderTotal, currency, exchangeRate)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Directly Paid to F&B</span>
                      <span className="font-bold text-emerald-400">{formatCurrency(currentDirectPaid, currency, exchangeRate)}</span>
                    </div>
                    <div className="flex items-center justify-between text-xs pt-2 border-t border-zinc-800 font-bold">
                      <span className="text-red-400">Outstanding Balance Due</span>
                      <span className="text-sm font-black text-red-400">{formatCurrency(remainingDue, currency, exchangeRate)}</span>
                    </div>
                  </div>

                  {/* Payment Amount Input */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-[11px] font-bold text-zinc-400 uppercase tracking-wider">
                        Payment Amount ({currency})
                      </label>
                      <button
                        type="button"
                        onClick={() => setSettleAmount(remainingDue)}
                        className="text-[11px] font-bold text-emerald-400 hover:text-emerald-300 transition-colors"
                      >
                        Pay Full Balance
                      </button>
                    </div>
                    <div className="relative">
                      <input
                        type="number"
                        step="any"
                        min="1"
                        max={remainingDue > 0 ? remainingDue : orderTotal}
                        required
                        value={settleAmount || ''}
                        onChange={(e) => setSettleAmount(Math.max(0, parseFloat(e.target.value) || 0))}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-lg font-black text-emerald-400 focus:outline-none focus:border-emerald-500/50"
                        placeholder="0.00"
                      />
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        type="button"
                        onClick={() => setSettleAmount(remainingDue)}
                        className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors"
                      >
                        Full ({formatCurrency(remainingDue, currency, exchangeRate)})
                      </button>
                      {remainingDue > 1 && (
                        <button
                          type="button"
                          onClick={() => setSettleAmount(Math.round(remainingDue / 2))}
                          className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs font-semibold transition-colors"
                        >
                          Half ({formatCurrency(Math.round(remainingDue / 2), currency, exchangeRate)})
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Payment Method Selector */}
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      Payment Method
                    </label>
                    <div className="grid grid-cols-3 gap-2">
                      {(['cash', 'card', 'transfer'] as const).map((method) => (
                        <button
                          key={method}
                          type="button"
                          onClick={() => setSettleMethod(method)}
                          className={cn(
                            "py-2.5 px-3 rounded-xl border text-xs font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-1.5",
                            settleMethod === method
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/30"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          )}
                        >
                          {method === 'cash' && <DollarSign size={14} />}
                          {method === 'card' && <CreditCard size={14} />}
                          {method === 'transfer' && <RefreshCw size={14} />}
                          {method}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Settlement Source Selector */}
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      Settlement Source
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                      {(['F&B Outlet', 'Front Desk'] as const).map((source) => (
                        <button
                          key={source}
                          type="button"
                          onClick={() => setSettleSource(source)}
                          className={cn(
                            "py-2.5 px-3 rounded-xl border text-xs font-bold tracking-wider transition-all flex items-center justify-center gap-2",
                            settleSource === source
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-400 ring-1 ring-emerald-500/30"
                              : "bg-zinc-950 border-zinc-800 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
                          )}
                        >
                          {source === 'F&B Outlet' ? <Utensils size={14} /> : <Building2 size={14} />}
                          <span>{source}</span>
                        </button>
                      ))}
                    </div>
                    <p className="text-[10px] text-zinc-500 mt-1">
                      Explicitly tags whether revenue is received at the F&B Outlet POS or Front Desk counter for staff earnings attribution.
                    </p>
                  </div>

                  {/* Notes / Reference */}
                  <div>
                    <label className="block text-[11px] font-bold text-zinc-400 uppercase tracking-wider mb-2">
                      Notes / Reference (Optional)
                    </label>
                    <input
                      type="text"
                      value={settleNotes}
                      onChange={(e) => setSettleNotes(e.target.value)}
                      placeholder="e.g. Paid at restaurant counter, POS slip #9872"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2.5 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>

                  {/* Action Buttons */}
                  <div className="flex items-center gap-3 pt-2">
                    <button
                      type="button"
                      onClick={() => setSettleOrderModal(null)}
                      className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      disabled={isSettling || settleAmount <= 0}
                      className="flex-1 py-3 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black rounded-xl text-xs font-black transition-all shadow-lg active:scale-95 flex items-center justify-center gap-1.5"
                    >
                      {isSettling ? (
                        <>
                          <RefreshCw size={14} className="animate-spin" />
                          Processing...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 size={15} />
                          Confirm Payment ({formatCurrency(settleAmount, currency, exchangeRate)})
                        </>
                      )}
                    </button>
                  </div>
                </form>
              );
            })()}
          </motion.div>
        </div>
      )}

      {/* Add Items to Order Modal (Available Before Delivery Only) */}
      {addItemsOrderModal && addItemsOrderModal.status !== 'delivered' && (
        <div className="fixed inset-0 bg-black/85 backdrop-blur-sm z-[70] flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-5xl max-h-[90vh] h-[85vh] flex flex-col overflow-hidden my-auto shadow-2xl"
          >
            {/* Modal Header */}
            <div className="p-5 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold text-zinc-50 flex items-center gap-2">
                  <PlusCircle size={20} className="text-blue-400" />
                  Add Items to Order #{addItemsOrderModal.id.slice(-6)}
                </h2>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Room {addItemsOrderModal.roomNumber || 'Walk-in'} • Status:{' '}
                  <span className="font-bold uppercase text-amber-400">{addItemsOrderModal.status}</span> • Current Total:{' '}
                  <span className="font-bold text-zinc-200">
                    {formatCurrency(addItemsOrderModal.totalAmount || addItemsOrderModal.price || 0, currency, exchangeRate)}
                  </span>
                </p>
              </div>
              <button 
                onClick={() => setAddItemsOrderModal(null)} 
                className="p-1.5 hover:bg-zinc-800 rounded-full text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <XCircle size={22} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 flex overflow-hidden">
              {/* Left Column: Menu Items Selection */}
              <div className="flex-1 border-r border-zinc-800 flex flex-col overflow-hidden">
                {/* Search & Category Filter */}
                <div className="p-4 border-b border-zinc-800 space-y-3">
                  <div className="relative">
                    <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
                    <input
                      type="text"
                      placeholder="Search F&B items..."
                      value={addSearchQuery}
                      onChange={(e) => setAddSearchQuery(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/50"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => setAddCategoryFilter('all')}
                      className={cn(
                        "px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                        addCategoryFilter === 'all'
                          ? "bg-blue-500 text-white"
                          : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                      )}
                    >
                      All
                    </button>
                    {fbCategories.map(cat => (
                      <button
                        key={cat.id}
                        type="button"
                        onClick={() => setAddCategoryFilter(cat.name)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-xs font-bold uppercase tracking-wider transition-all",
                          addCategoryFilter === cat.name
                            ? "bg-blue-500 text-white"
                            : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
                        )}
                      >
                        {cat.name}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Items Grid & Custom Item Form */}
                <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
                  {(() => {
                    const filteredAddInventory = inventory.filter(item => {
                      const isFBItem = fbCategoryNames.includes(item.category);
                      const matchesCategory = addCategoryFilter === 'all' ? true : item.category === addCategoryFilter;
                      const matchesSearch = !addSearchQuery.trim() || item.name.toLowerCase().includes(addSearchQuery.toLowerCase());
                      return isFBItem && matchesCategory && matchesSearch;
                    });

                    if (filteredAddInventory.length === 0) {
                      return (
                        <div className="text-center py-10 text-zinc-600">
                          <Utensils size={32} className="mx-auto mb-2 opacity-30" />
                          <p className="text-xs">No matching menu items found.</p>
                        </div>
                      );
                    }

                    return (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {filteredAddInventory.map(item => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => addToAdditionalCart(item)}
                            className="bg-zinc-950 border border-zinc-800/80 hover:border-blue-500/40 p-3 rounded-xl text-left transition-all hover:scale-[1.02] active:scale-95 group flex flex-col justify-between"
                          >
                            <div className="text-xs font-bold text-zinc-200 group-hover:text-blue-400 line-clamp-1 mb-1">
                              {item.name}
                            </div>
                            <div className="text-[11px] font-black text-emerald-400">
                              {formatCurrency(item.price, currency, exchangeRate)}
                            </div>
                          </button>
                        ))}
                      </div>
                    );
                  })()}

                  {/* Add Custom Item */}
                  <div className="bg-zinc-950 border border-zinc-800/80 p-4 rounded-xl mt-auto">
                    <h3 className="text-xs font-bold text-zinc-300 mb-2.5 flex items-center gap-1.5">
                      <Plus size={14} className="text-blue-400" />
                      Add Custom Item
                    </h3>
                    <form onSubmit={addCustomToAdditionalCart} className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      <input
                        type="text"
                        placeholder="Item Name"
                        value={customAddItem.name}
                        onChange={(e) => setCustomAddItem({ ...customAddItem, name: e.target.value })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/50"
                      />
                      <input
                        type="number"
                        placeholder="Price"
                        value={customAddItem.price || ''}
                        onChange={(e) => setCustomAddItem({ ...customAddItem, price: Number(e.target.value) })}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500/50"
                      />
                      <button
                        type="submit"
                        disabled={!customAddItem.name.trim() || customAddItem.price <= 0}
                        className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-lg text-xs font-bold transition-all py-1.5"
                      >
                        Add to Cart
                      </button>
                    </form>
                  </div>
                </div>
              </div>

              {/* Right Column: Existing Order Summary + Additional Items to Add */}
              <div className="w-84 bg-zinc-950 flex flex-col overflow-hidden">
                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                  <span className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShoppingCart size={15} className="text-blue-400" />
                    Additional Items Cart
                  </span>
                  <span className="text-xs font-bold text-blue-400">
                    {additionalCart.reduce((sum, i) => sum + i.quantity, 0)} items
                  </span>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-4">
                  {/* Existing Items in Order */}
                  <div className="bg-zinc-900/60 border border-zinc-800/60 rounded-xl p-3">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                      Already in Order #{addItemsOrderModal.id.slice(-6)}
                    </div>
                    <p className="text-xs text-zinc-300 font-medium leading-relaxed">
                      {addItemsOrderModal.items}
                    </p>
                  </div>

                  {/* Additional Items List */}
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-blue-400 mb-2">
                      New Items to Append
                    </div>
                    {additionalCart.length === 0 ? (
                      <div className="text-center py-8 text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                        <PlusCircle size={24} className="mx-auto mb-1.5 opacity-30 text-blue-400" />
                        <p className="text-xs">Click items on the left to add them to this receipt</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {additionalCart.map(item => (
                          <div 
                            key={item.id} 
                            className="flex items-center justify-between gap-2 bg-zinc-900 p-2.5 rounded-xl border border-zinc-800"
                          >
                            <div className="flex-1 min-w-0">
                              <div className="text-xs font-bold text-zinc-200 truncate">{item.name}</div>
                              <div className="text-[10px] text-emerald-400 font-bold">
                                {formatCurrency(item.price * item.quantity, currency, exchangeRate)}
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => updateAdditionalCartQuantity(item.id, -1)}
                                className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center justify-center text-zinc-300"
                              >
                                <Minus size={12} />
                              </button>
                              <span className="text-xs font-bold text-zinc-100 w-5 text-center">{item.quantity}</span>
                              <button
                                type="button"
                                onClick={() => updateAdditionalCartQuantity(item.id, 1)}
                                className="w-6 h-6 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center justify-center text-zinc-300"
                              >
                                <Plus size={12} />
                              </button>
                              <button
                                type="button"
                                onClick={() => removeAdditionalCartItem(item.id)}
                                className="w-6 h-6 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg flex items-center justify-center ml-1"
                              >
                                <Trash2 size={12} />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Totals & Submit */}
                <div className="p-4 border-t border-zinc-800 bg-zinc-900/90 space-y-3">
                  {(() => {
                    const additionalSubtotal = additionalCart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
                    const currentTotal = addItemsOrderModal.totalAmount || addItemsOrderModal.price || 0;
                    
                    // Taxes for added items
                    const activeTaxes = (hotel?.taxes || []).filter(t => {
                      const status = (t.status || '').toLowerCase().trim();
                      const category = (t.category || '').toLowerCase().trim();
                      return status === 'active' && (category === 'restaurant' || category === 'f & b' || category === 'all');
                    });
                    const exclusiveTaxes = activeTaxes.filter(t => !t.isInclusive);
                    const additionalTax = exclusiveTaxes.reduce((acc, t) => acc + (additionalSubtotal * (t.percentage / 100)), 0);
                    const additionalGrandTotal = additionalSubtotal + additionalTax;
                    const revisedGrandTotal = currentTotal + additionalGrandTotal;

                    return (
                      <>
                        <div className="space-y-1 text-xs">
                          <div className="flex items-center justify-between text-zinc-400">
                            <span>Added Items Subtotal</span>
                            <span className="font-bold text-zinc-200">{formatCurrency(additionalSubtotal, currency, exchangeRate)}</span>
                          </div>
                          {additionalTax > 0 && (
                            <div className="flex items-center justify-between text-zinc-400">
                              <span>Estimated Taxes</span>
                              <span className="font-bold text-zinc-200">+{formatCurrency(additionalTax, currency, exchangeRate)}</span>
                            </div>
                          )}
                          <div className="flex items-center justify-between text-zinc-400 pt-1 border-t border-zinc-800">
                            <span>Additional Charge</span>
                            <span className="font-bold text-blue-400">+{formatCurrency(additionalGrandTotal, currency, exchangeRate)}</span>
                          </div>
                          <div className="flex items-center justify-between text-sm font-black pt-1 border-t border-zinc-800 text-emerald-400">
                            <span>New Total Receipt</span>
                            <span>{formatCurrency(revisedGrandTotal, currency, exchangeRate)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => setAddItemsOrderModal(null)}
                            className="flex-1 py-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                          >
                            Cancel
                          </button>
                          <button
                            type="button"
                            disabled={isAddingItems || additionalCart.length === 0}
                            onClick={handleAddItemsToExistingOrder}
                            className="flex-2 py-2.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 flex items-center justify-center gap-1.5"
                          >
                            {isAddingItems ? (
                              <>
                                <RefreshCw size={14} className="animate-spin" />
                                Updating...
                              </>
                            ) : (
                              <>
                                <CheckCircle2 size={15} />
                                Update Receipt (+{formatCurrency(additionalGrandTotal, currency, exchangeRate)})
                              </>
                            )}
                          </button>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
