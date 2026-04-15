import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, orderBy, addDoc, where, onSnapshot, doc, updateDoc, getDoc, deleteDoc, increment } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { FinanceRecord, OperationType, Guest, Reservation, Room, Supplier, Account, PurchaseOrder, Commission, InventoryItem, CorporateAccount } from '../types';
import { settleLedger, refundGuest, settleOverpayment } from '../services/ledgerService';
import { syncDailyCharges } from '../services/financeService';
import { GuestFolio } from './GuestFolio';
import { 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  Plus,
  Search,
  Calendar,
  Filter,
  Download,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  PieChart,
  BarChart3,
  ChevronRight,
  CreditCard,
  Banknote,
  Send,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Building2,
  FileText,
  Users,
  History,
  LayoutDashboard,
  Receipt,
  ArrowLeftRight,
  Percent,
  Trash2
} from 'lucide-react';
import { cn, formatCurrency, exportToCSV, safeStringify } from '../utils';
import { fuzzySearch } from '../utils/searchUtils';
import { format, isToday, isValid, startOfMonth, endOfMonth, isWithinInterval, subMonths, startOfDay, addDays, endOfDay } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { toast } from 'sonner';

export function Finance() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [records, setRecords] = useState<FinanceRecord[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [showPaySupplierModal, setShowPaySupplierModal] = useState<Supplier | null>(null);
  const [showAddAccountModal, setShowAddAccountModal] = useState(false);
  const [showAddPOModal, setShowAddPOModal] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'income' | 'expense'>('all');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [methodFilter, setMethodFilter] = useState('all');
  const [timeRange, setTimeRange] = useState<'today' | 'month' | 'all' | 'custom'>('month');
  const [customDateRange, setCustomDateRange] = useState({ start: '', end: '' });
  const [newRecord, setNewRecord] = useState({
    description: '',
    amount: 0,
    type: 'income' as 'income' | 'expense',
    category: 'Room Revenue',
    paymentMethod: 'cash' as 'cash' | 'card' | 'transfer'
  });

  const [payData, setPayData] = useState({ amount: 0, method: 'cash' as const, notes: '' });

  const [newSupplier, setNewSupplier] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    category: 'Supplies',
    balance: 0
  });

  const [newAccount, setNewAccount] = useState({
    code: '',
    name: '',
    type: 'asset' as Account['type'],
    description: '',
    balance: 0
  });

  const [newPO, setNewPO] = useState({
    supplierId: '',
    items: [] as PurchaseOrder['items'],
    totalAmount: 0,
    status: 'pending' as const,
    paymentStatus: 'unpaid' as const,
    dueDate: format(addDays(new Date(), 7), 'yyyy-MM-dd')
  });

  const [reportFilter, setReportFilter] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    category: 'all'
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [activeTab, setActiveTab] = useState<'overview' | 'transactions' | 'ledger' | 'city_ledger' | 'suppliers' | 'accounts' | 'expenses' | 'pos' | 'commissions' | 'payments' | 'reports'>('overview');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [commissions, setCommissions] = useState<Commission[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [corporateAccounts, setCorporateAccounts] = useState<CorporateAccount[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const categories = {
    income: ['Room Revenue', 'Restaurant', 'Laundry', 'Events', 'Other'],
    expense: ['Salaries', 'Maintenance', 'Utilities', 'Supplies', 'Marketing', 'Taxes', 'Other']
  };

  const [showSettleModal, setShowSettleModal] = useState<Guest | CorporateAccount | null>(null);
  const [settleData, setSettleData] = useState({ amount: 0, method: 'cash' as const, notes: '' });
  const [showFolio, setShowFolio] = useState(false);
  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    // Fetch Suppliers
    const unsubSuppliers = onSnapshot(collection(db, 'hotels', hotel.id, 'suppliers'), (snap) => {
      setSuppliers(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Supplier)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/suppliers`);
    });

    // Fetch Accounts
    const unsubAccounts = onSnapshot(collection(db, 'hotels', hotel.id, 'accounts'), (snap) => {
      setAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Account)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/accounts`);
    });

    // Fetch Purchase Orders
    const unsubPOs = onSnapshot(collection(db, 'hotels', hotel.id, 'purchaseOrders'), (snap) => {
      setPurchaseOrders(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/purchaseOrders`);
    });

    // Fetch Commissions
    const unsubCommissions = onSnapshot(collection(db, 'hotels', hotel.id, 'commissions'), (snap) => {
      setCommissions(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Commission)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/commissions`);
    });

    // Fetch Inventory for POs
    const unsubInv = onSnapshot(collection(db, 'hotels', hotel.id, 'inventory'), (snap) => {
      setInventoryItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/inventory`);
    });

    return () => {
      unsubSuppliers();
      unsubAccounts();
      unsubPOs();
      unsubCommissions();
      unsubInv();
    };
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const navItems = [
    { id: 'overview', label: 'Overview', icon: PieChart },
    { id: 'transactions', label: 'Transactions', icon: RefreshCw },
    { id: 'ledger', label: 'Guest Accounts', icon: Users },
    { id: 'city_ledger', label: 'City Ledger', icon: Building2 },
    { id: 'suppliers', label: 'Supplier Accounts', icon: Building2 },
    { id: 'accounts', label: 'Chart of Accounts', icon: Wallet },
    { id: 'expenses', label: 'Expense Records', icon: TrendingDown },
    { id: 'pos', label: 'Purchase Orders', icon: FileText },
    { id: 'commissions', label: 'Commissions', icon: DollarSign },
    { id: 'payments', label: 'Payments', icon: CreditCard },
    { id: 'reports', label: 'Finance Reports', icon: BarChart3 },
  ];

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'hotels', hotel.id, 'finance'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setRecords(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as FinanceRecord)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/finance`);
      if (error.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'hotels', hotel.id, 'guests'), where('ledgerBalance', '!=', 0));
    const unsub = onSnapshot(q, (snap) => {
      setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/guests`);
    });

    // Fetch reservations and rooms for syncing
    const unsubRes = onSnapshot(collection(db, 'hotels', hotel.id, 'reservations'), (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
    });

    const unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
    });

    const unsubCorp = onSnapshot(collection(db, 'hotels', hotel.id, 'corporate_accounts'), (snap) => {
      setCorporateAccounts(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as CorporateAccount)));
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/corporate_accounts`);
    });

    return () => {
      unsub();
      unsubRes();
      unsubRooms();
      unsubCorp();
    };
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const handleDeleteTransaction = async (id: string, description: string, amount: number) => {
    if (!hotel?.id || !profile || profile.role !== 'hotelAdmin' && profile.role !== 'superAdmin') return;
    
    if (!window.confirm(`Are you sure you want to delete this transaction: "${description}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'finance', id));
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'FINANCE_RECORD_DELETED',
        resource: `${description} (${formatCurrency(amount, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'Finance'
      });
      
      toast.success('Transaction deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/finance/${id}`);
      toast.error('Failed to delete transaction');
    }
  };

  const handleSyncCharges = async () => {
    if (!hotel?.id || !profile) return;
    setIsSyncing(true);
    try {
      const result = await syncDailyCharges(hotel.id, profile.uid, profile.email, reservations, rooms, guests);
      if (result.chargedCount > 0) {
        toast.success(`Successfully synced ${result.chargedCount} charges totaling ${formatCurrency(result.totalAmount, currency, exchangeRate)}`);
      } else {
        toast.info('All guest accounts are up to date.');
      }
    } catch (err: any) {
      console.error("Sync charges error:", err.message || safeStringify(err));
      toast.error('Failed to sync charges');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleSettleBalance = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !showSettleModal) return;

    try {
      setIsSaving(true);
      const entity = showSettleModal;
      const amount = settleData.amount;
      
      const isCorporate = 'contactPerson' in entity;
      const currentBalance = isCorporate ? (entity as CorporateAccount).currentBalance : (entity as Guest).ledgerBalance;
      const entityName = entity.name;
      const entityId = entity.id;

      // Find the most recent reservation for this entity to post the ledger entry
      const lastRes = reservations
        .filter(r => isCorporate ? r.corporateId === entityId : r.guestId === entityId)
        .sort((a, b) => new Date(b.checkIn).getTime() - new Date(a.checkIn).getTime())[0];

      if (!lastRes) {
        toast.error('No reservation found for this account to post the settlement.');
        return;
      }

      if (currentBalance < 0) {
        // Entity owes money: Post a payment (credit)
        await settleLedger(hotel.id, isCorporate ? 'corporate' : entityId, lastRes.id, amount, settleData.method, profile.uid, isCorporate ? entityId : undefined);
      } else {
        // Entity has credit: Post a refund/settlement (debit)
        await settleOverpayment(hotel.id, isCorporate ? 'corporate' : entityId, lastRes.id, amount, settleData.method, profile.uid, isCorporate ? entityId : undefined);
      }

      toast.success('Balance settled successfully');
      setShowSettleModal(null);
      setSettleData({ amount: 0, method: 'cash', notes: '' });
    } catch (err: any) {
      console.error("Settle balance error:", err.message || safeStringify(err));
      toast.error('Failed to settle balance');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddSupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    setIsSaving(true);
    console.log('Starting handleAddSupplier with data:', newSupplier);
    try {
      const supplierRef = await addDoc(collection(db, 'hotels', hotel.id, 'suppliers'), {
        ...newSupplier,
        createdAt: new Date().toISOString()
      });
      console.log('Supplier added with ID:', supplierRef.id);
      toast.success('Supplier added successfully');
      setShowAddSupplierModal(false);
      setNewSupplier({ name: '', email: '', phone: '', address: '', category: 'Supplies', balance: 0 });
    } catch (err: any) {
      console.error('Error in handleAddSupplier:', err.message || safeStringify(err));
      handleFirestoreError(err, OperationType.CREATE, `hotels/${hotel.id}/suppliers`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePaySupplier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !showPaySupplierModal) return;
    setIsSaving(true);
    try {
      const supplier = showPaySupplierModal;
      const amount = payData.amount;

      // Update supplier balance
      await updateDoc(doc(db, 'hotels', hotel.id, 'suppliers', supplier.id), {
        balance: (supplier.balance || 0) - amount
      });

      // Record as expense
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        type: 'expense',
        amount: amount,
        category: 'Supplies',
        description: `Supplier Payment: ${supplier.name} (${payData.notes || 'No notes'})`,
        timestamp: new Date().toISOString(),
        paymentMethod: payData.method
      });

      toast.success('Payment recorded successfully');
      setShowPaySupplierModal(null);
      setPayData({ amount: 0, method: 'cash', notes: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/suppliers/${showPaySupplierModal.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    setIsSaving(true);
    console.log('Starting handleCreateAccount with data:', newAccount);
    try {
      const accountRef = await addDoc(collection(db, 'hotels', hotel.id, 'accounts'), {
        ...newAccount,
        balance: Number(newAccount.balance)
      });
      console.log('Account created with ID:', accountRef.id);
      toast.success('Account created successfully');
      setShowAddAccountModal(false);
      setNewAccount({ code: '', name: '', type: 'asset', description: '', balance: 0 });
    } catch (err: any) {
      console.error('Error in handleCreateAccount:', err.message || safeStringify(err));
      handleFirestoreError(err, OperationType.CREATE, `hotels/${hotel.id}/accounts`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCreatePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || isSaving) return;
    if (newPO.items.length === 0) {
      toast.error('Please add at least one item to the PO');
      return;
    }
    setIsSaving(true);
    console.log('Starting handleCreatePO with data:', newPO);
    try {
      const poRef = await addDoc(collection(db, 'hotels', hotel.id, 'purchaseOrders'), {
        ...newPO,
        timestamp: new Date().toISOString()
      });

      // Update supplier balance (liability)
      const supplierRef = doc(db, 'hotels', hotel.id, 'suppliers', newPO.supplierId);
      await updateDoc(supplierRef, {
        balance: increment(newPO.totalAmount)
      });

      console.log('Purchase Order created with ID:', poRef.id);
      toast.success('Purchase Order created successfully');
      setShowAddPOModal(false);
      setNewPO({ supplierId: '', items: [], totalAmount: 0, status: 'pending', paymentStatus: 'unpaid', dueDate: format(addDays(new Date(), 7), 'yyyy-MM-dd') });
    } catch (err: any) {
      console.error('Error in handleCreatePO:', err.message || safeStringify(err));
      handleFirestoreError(err, OperationType.CREATE, `hotels/${hotel.id}/purchaseOrders`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleReceivePO = async (po: PurchaseOrder) => {
    if (!hotel?.id || !profile) return;
    if (po.status === 'received') return;

    setIsSaving(true);
    try {
      // Update PO status
      await updateDoc(doc(db, 'hotels', hotel.id, 'purchaseOrders', po.id), {
        status: 'received'
      });

      // Update inventory for each item
      for (const item of po.items) {
        const itemRef = doc(db, 'hotels', hotel.id, 'inventory', item.itemId);
        const itemDoc = await getDoc(itemRef);
        if (itemDoc.exists()) {
          const currentQty = itemDoc.data().quantity || 0;
          await updateDoc(itemRef, {
            quantity: currentQty + item.quantity,
            lastUpdated: new Date().toISOString()
          });
        }
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'INVENTORY_PO_RECEIVED',
        resource: `PO #${po.id.slice(0, 8)} received, inventory updated`,
        hotelId: hotel.id,
        module: 'Inventory'
      });

      toast.success('Purchase Order received and inventory updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/purchaseOrders/${po.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handlePayPO = async (po: PurchaseOrder) => {
    if (!hotel?.id || !profile) return;
    if (po.paymentStatus === 'paid') return;

    setIsSaving(true);
    try {
      // Update PO payment status
      await updateDoc(doc(db, 'hotels', hotel.id, 'purchaseOrders', po.id), {
        paymentStatus: 'paid'
      });

      // Update supplier balance
      const supplierRef = doc(db, 'hotels', hotel.id, 'suppliers', po.supplierId);
      await updateDoc(supplierRef, {
        balance: increment(-po.totalAmount)
      });

      // Record as expense in finance
      const supplier = suppliers.find(s => s.id === po.supplierId);
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        type: 'expense',
        amount: po.totalAmount,
        category: 'Supplies',
        description: `PO Payment: #${po.id.slice(0, 8)} to ${supplier?.name || 'Supplier'}`,
        timestamp: new Date().toISOString(),
        paymentMethod: 'transfer', // Default for POs
        referenceId: po.id,
        postedBy: profile.uid
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'FINANCE_PO_PAID',
        resource: `PO #${po.id.slice(0, 8)} paid (${formatCurrency(po.totalAmount, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'Finance'
      });

      toast.success('Purchase Order marked as paid and finance record created');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/purchaseOrders/${po.id}`);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDownloadReport = (reportTitle: string) => {
    let data: any[] = [];
    let filename = `${reportTitle.toLowerCase().replace(/\s+/g, '_')}_${reportFilter.startDate}_to_${reportFilter.endDate}.csv`;

    const start = startOfDay(new Date(reportFilter.startDate));
    const end = endOfDay(new Date(reportFilter.endDate));

    const filterByDate = (items: any[]) => items.filter(item => {
      const date = new Date(item.timestamp || item.createdAt || item.date);
      return date >= start && date <= end;
    });

    switch (reportTitle) {
      case 'Expense Type Report':
        const expenseRecords = filterByDate(records.filter(r => r.type === 'expense'));
        const byCategory = categories.expense.map(cat => ({
          Category: cat,
          Total: expenseRecords.filter(r => r.category === cat).reduce((acc, r) => acc + r.amount, 0)
        }));
        data = byCategory;
        break;
      case 'Net Income Report':
        const periodRecords = filterByDate(records);
        const pIncome = periodRecords.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
        const pExpense = periodRecords.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
        data = [
          { Item: 'Total Income', Amount: pIncome },
          { Item: 'Total Expense', Amount: pExpense },
          { Item: 'Net Income', Amount: pIncome - pExpense }
        ];
        break;
      case 'Transaction Report':
        data = filterByDate(records)
          .filter(r => reportFilter.category === 'all' || r.category === reportFilter.category)
          .map(r => ({
            Date: format(new Date(r.timestamp), 'yyyy-MM-dd HH:mm'),
            Description: r.description,
            Category: r.category,
            Type: r.type,
            Amount: r.amount,
            Method: r.paymentMethod
          }));
        break;
      case 'Balance Sheet':
        data = accounts.map(a => ({
          Code: a.code,
          Account: a.name,
          Type: a.type,
          Balance: a.balance
        }));
        break;
      case 'Inventory Value':
        data = inventoryItems.map(i => ({
          Item: i.name,
          Category: i.category,
          Quantity: i.quantity,
          Unit: i.unit,
          UnitPrice: i.price || 0,
          EstimatedValue: i.quantity * (i.price || 0)
        }));
        break;
      case 'Store Balance':
        const periodStoreRecords = filterByDate(records);
        const methods = ['cash', 'card', 'transfer'];
        data = methods.map(method => ({
          'Store Point': method.toUpperCase(),
          Income: periodStoreRecords.filter(r => r.type === 'income' && r.paymentMethod === method).reduce((acc, r) => acc + r.amount, 0),
          Expense: periodStoreRecords.filter(r => r.type === 'expense' && r.paymentMethod === method).reduce((acc, r) => acc + r.amount, 0),
          Balance: periodStoreRecords.filter(r => r.type === 'income' && r.paymentMethod === method).reduce((acc, r) => acc + r.amount, 0) - 
                   periodStoreRecords.filter(r => r.type === 'expense' && r.paymentMethod === method).reduce((acc, r) => acc + r.amount, 0)
        }));
        break;
      default:
        toast.info('This report is currently being generated. Please check back soon.');
        return;
    }

    if (data.length > 0) {
      exportToCSV(data, filename);
      toast.success(`${reportTitle} downloaded successfully`);
    } else {
      toast.info('No data available for this report');
    }
  };

  const handleAddRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;

    try {
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        ...newRecord,
        timestamp: new Date().toISOString()
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'FINANCE_RECORD_CREATED',
        resource: `${newRecord.type.toUpperCase()}: ${newRecord.description} (${formatCurrency(newRecord.amount, currency, exchangeRate)})`,
        hotelId: hotel.id,
        module: 'Finance'
      });

      setShowAddModal(false);
      setNewRecord({ description: '', amount: 0, type: 'income', category: 'Room Revenue', paymentMethod: 'cash' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/finance`);
    }
  };

  const filteredRecords = records.filter(r => {
    const matchesSearch = fuzzySearch(r.description || '', searchQuery) || 
                         fuzzySearch(r.category || '', searchQuery);
    const matchesType = filterType === 'all' || r.type === filterType;
    const matchesCategory = categoryFilter === 'all' || r.category === categoryFilter;
    const matchesMethod = methodFilter === 'all' || r.paymentMethod === methodFilter;
    
    let matchesTime = true;
    if (timeRange === 'today') matchesTime = isToday(new Date(r.timestamp));
    if (timeRange === 'month') {
      const start = startOfMonth(new Date());
      const end = endOfMonth(new Date());
      matchesTime = isWithinInterval(new Date(r.timestamp), { start, end });
    }
    if (timeRange === 'custom' && customDateRange.start && customDateRange.end) {
      const start = startOfDay(new Date(customDateRange.start));
      const end = endOfDay(new Date(customDateRange.end));
      matchesTime = isWithinInterval(new Date(r.timestamp), { start, end });
    }

    return matchesSearch && matchesType && matchesCategory && matchesMethod && matchesTime;
  });

  const totalIncome = filteredRecords.filter(r => r.type === 'income').reduce((acc, r) => acc + r.amount, 0);
  const totalExpense = filteredRecords.filter(r => r.type === 'expense').reduce((acc, r) => acc + r.amount, 0);
  const balance = totalIncome - totalExpense;

  const stats = [
    { label: 'Net Balance', value: formatCurrency(balance, currency, exchangeRate), icon: Wallet, color: 'text-zinc-50', bg: 'bg-zinc-900' },
    { label: 'Total Income', value: formatCurrency(totalIncome, currency, exchangeRate), icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/5' },
    { label: 'Total Expenses', value: formatCurrency(totalExpense, currency, exchangeRate), icon: TrendingDown, color: 'text-red-500', bg: 'bg-red-500/5' },
    { label: "Transactions", value: filteredRecords.length, icon: BarChart3, color: 'text-amber-500', bg: 'bg-amber-500/5' },
  ];

  const chartData = [
    { name: 'Income', value: totalIncome, color: '#10b981' },
    { name: 'Expense', value: totalExpense, color: '#ef4444' }
  ];

  const filteredLedger = guests.filter(g => 
    (g.ledgerBalance || 0) !== 0 && (
      fuzzySearch(g.name || '', searchQuery) || 
      fuzzySearch(g.email || '', searchQuery) || 
      fuzzySearch(g.phone || '', searchQuery)
    )
  );

  const handleExport = () => {
    const dataToExport = activeTab === 'transactions' ? filteredRecords : filteredLedger;
    const filename = activeTab === 'transactions' ? `transactions_${format(new Date(), 'yyyy-MM-dd')}.csv` : `ledger_${format(new Date(), 'yyyy-MM-dd')}.csv`;
    
    const formattedData = dataToExport.map(item => {
      if (activeTab === 'transactions') {
        const record = item as FinanceRecord;
        return {
          Date: format(new Date(record.timestamp), 'yyyy-MM-dd HH:mm'),
          Description: record.description,
          Type: record.type,
          Category: record.category,
          Amount: record.amount,
          PaymentMethod: record.paymentMethod
        };
      } else {
        const guest = item as Guest;
        return {
          Name: guest.name,
          Email: guest.email,
          Phone: guest.phone,
          Balance: guest.ledgerBalance || 0,
          Status: (guest.ledgerBalance || 0) < 0 ? 'Debt' : (guest.ledgerBalance || 0) > 0 ? 'Credit' : 'Balanced'
        };
      }
    });

    exportToCSV(formattedData, filename);
    toast.success('Exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 mb-2 tracking-tight">Financial Management</h1>
          <p className="text-zinc-400">Track income, expenses and overall hotel performance</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleSyncCharges}
            disabled={isSyncing}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95 disabled:opacity-50"
            title="Sync missing daily charges for all checked-in guests"
          >
            <RefreshCw size={18} className={cn(isSyncing && "animate-spin")} />
            Sync Charges
          </button>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            Add Record
          </button>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <div className="w-full lg:w-64 flex-shrink-0 space-y-1">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-bold transition-all",
                activeTab === item.id 
                  ? "bg-emerald-500 text-zinc-50 shadow-lg shadow-emerald-500/20" 
                  : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
              )}
            >
              <item.icon size={18} />
              {item.label}
            </button>
          ))}
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-w-0">
          {activeTab === 'overview' && (
            <div className="space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                {stats.map((stat) => (
                  <div key={stat.label} className={cn("border border-zinc-800 p-6 rounded-2xl", stat.bg)}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-zinc-400 text-sm font-medium">{stat.label}</span>
                      <stat.icon className={stat.color} size={20} />
                    </div>
                    <div className="text-2xl font-bold text-zinc-50">{stat.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-zinc-50 mb-6 flex items-center gap-2">
                    <PieChart size={18} className="text-emerald-500" />
                    Income vs Expense
                  </h3>
                  <div className="h-[250px] w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#27272a" vertical={false} />
                        <XAxis dataKey="name" stroke="#71717a" fontSize={10} axisLine={false} tickLine={false} />
                        <YAxis hide />
                        <Tooltip 
                          cursor={{ fill: 'transparent' }}
                          contentStyle={{ backgroundColor: '#18181b', border: '1px solid #27272a', borderRadius: '8px' }}
                        />
                        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                          {chartData.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
                  <h3 className="font-bold text-zinc-50 mb-6 flex items-center gap-2">
                    <BarChart3 size={18} className="text-amber-500" />
                    Revenue by Category
                  </h3>
                  <div className="space-y-4">
                    {categories.income.map(cat => {
                      const amount = records
                        .filter(r => r.type === 'income' && r.category === cat)
                        .reduce((acc, r) => acc + r.amount, 0);
                      const percentage = totalIncome > 0 ? (amount / totalIncome) * 100 : 0;
                      if (amount === 0) return null;
                      return (
                        <div key={cat} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-zinc-400">{cat}</span>
                            <span className="text-zinc-50 font-bold">{formatCurrency(amount, currency, exchangeRate)}</span>
                          </div>
                          <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: `${percentage}%` }}
                              className="h-full bg-amber-500"
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'transactions' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex flex-col gap-4">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <h3 className="font-bold text-zinc-50">Transaction History</h3>
                    <div className="flex items-center gap-1 bg-zinc-950 p-1 rounded-lg border border-zinc-800">
                      {(['all', 'income', 'expense'] as const).map((type) => (
                        <button
                          key={type}
                          onClick={() => setFilterType(type)}
                          className={cn(
                            "px-3 py-1 rounded-md text-xs font-medium capitalize transition-all",
                            filterType === type ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
                          )}
                        >
                          {type}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="relative w-full md:w-64">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
                    <input
                      type="text"
                      placeholder="Search transactions..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <Filter size={14} className="text-zinc-500" />
                    <select
                      value={categoryFilter}
                      onChange={(e) => setCategoryFilter(e.target.value)}
                      className="bg-transparent text-xs text-zinc-400 focus:outline-none"
                    >
                      <option value="all">All Categories</option>
                      {[...categories.income, ...categories.expense].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <CreditCard size={14} className="text-zinc-500" />
                    <select
                      value={methodFilter}
                      onChange={(e) => setMethodFilter(e.target.value)}
                      className="bg-transparent text-xs text-zinc-400 focus:outline-none"
                    >
                      <option value="all">All Methods</option>
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="transfer">Bank Transfer</option>
                    </select>
                  </div>

                  <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
                    <Calendar size={14} className="text-zinc-500" />
                    <select
                      value={timeRange}
                      onChange={(e) => setTimeRange(e.target.value as any)}
                      className="bg-transparent text-xs text-zinc-400 focus:outline-none"
                    >
                      <option value="today">Today</option>
                      <option value="month">This Month</option>
                      <option value="all">All Time</option>
                      <option value="custom">Custom Range</option>
                    </select>
                  </div>

                  {timeRange === 'custom' && (
                    <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1">
                      <input 
                        type="date"
                        className="bg-transparent text-[10px] text-zinc-50 focus:outline-none"
                        value={customDateRange.start}
                        onChange={(e) => setCustomDateRange({ ...customDateRange, start: e.target.value })}
                      />
                      <span className="text-zinc-500 text-[10px]">-</span>
                      <input 
                        type="date"
                        className="bg-transparent text-[10px] text-zinc-50 focus:outline-none"
                        value={customDateRange.end}
                        onChange={(e) => setCustomDateRange({ ...customDateRange, end: e.target.value })}
                      />
                    </div>
                  )}
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Date</th>
                      <th className="px-6 py-4">Description</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4">Method</th>
                      <th className="px-6 py-4 text-right">Amount</th>
                      {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                        <th className="px-6 py-4 text-right">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {filteredRecords.map((record) => (
                      <tr key={record.id} className="hover:bg-zinc-800/50 transition-colors">
                        <td className="px-6 py-4">
                          <div className="text-sm text-zinc-50">{new Date(record.timestamp).toLocaleDateString()}</div>
                          <div className="text-[10px] text-zinc-500">{new Date(record.timestamp).toLocaleTimeString()}</div>
                        </td>
                        <td className="px-6 py-4 text-sm text-zinc-50">{record.description}</td>
                        <td className="px-6 py-4">
                          <span className="px-2 py-1 bg-zinc-800 rounded text-[10px] font-medium text-zinc-400">{record.category}</span>
                        </td>
                        <td className="px-6 py-4 text-xs text-zinc-500 capitalize">{record.paymentMethod}</td>
                        <td className={cn("px-6 py-4 text-right font-bold text-sm", record.type === 'income' ? "text-emerald-500" : "text-red-500")}>
                          {record.type === 'income' ? '+' : '-'}{formatCurrency(record.amount, currency, exchangeRate)}
                        </td>
                        {(profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                          <td className="px-6 py-4 text-right">
                            <button
                              onClick={() => handleDeleteTransaction(record.id, record.description, record.amount)}
                              className="p-2 hover:bg-red-500/10 text-zinc-500 hover:text-red-500 rounded-lg transition-colors"
                              title="Delete Transaction"
                            >
                              <Trash2 size={16} />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'ledger' && (
            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800">
                  <h3 className="font-bold text-zinc-50">Guest Accounts (City Ledger)</h3>
                  <p className="text-xs text-zinc-500">Manage outstanding balances and credits for individual guests</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        <th className="px-6 py-4">Guest</th>
                        <th className="px-6 py-4">Contact</th>
                        <th className="px-6 py-4 text-right">Balance</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {filteredLedger.length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic">No guests with outstanding balances</td></tr>
                      ) : (
                        filteredLedger.map((guest) => (
                          <tr key={guest.id} className="hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 text-sm text-zinc-50 font-medium">{guest.name}</td>
                            <td className="px-6 py-4">
                              <div className="text-xs text-zinc-400">{guest.email}</div>
                              <div className="text-[10px] text-zinc-500">{guest.phone}</div>
                            </td>
                            <td className={cn("px-6 py-4 text-right font-bold text-sm", (guest.ledgerBalance || 0) < 0 ? "text-red-500" : "text-emerald-500")}>
                              {formatCurrency(guest.ledgerBalance || 0, currency, exchangeRate)}
                            </td>
                            <td className="px-6 py-4 text-right space-x-3">
                              <button
                                onClick={() => {
                                  setShowSettleModal(guest);
                                  setSettleData({ ...settleData, amount: Math.abs(guest.ledgerBalance || 0) });
                                }}
                                className="text-xs font-bold text-emerald-500 hover:text-emerald-400"
                              >
                                Settle
                              </button>
                              <button
                                onClick={() => {
                                  // Find the active reservation for this guest to open folio
                                  const activeRes = reservations.find(r => r.guestId === guest.id && (r.status === 'checked_in' || r.status === 'pending'));
                                  if (activeRes) {
                                    setSelectedReservation(activeRes);
                                    setShowFolio(true);
                                  } else {
                                    toast.error('No active reservation found for this guest');
                                  }
                                }}
                                className="text-xs font-bold text-zinc-400 hover:text-zinc-200"
                              >
                                Folio
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800">
                  <h3 className="font-bold text-zinc-50">Corporate Accounts</h3>
                  <p className="text-xs text-zinc-500">Manage outstanding balances and credits for corporate partners</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                        <th className="px-6 py-4">Company</th>
                        <th className="px-6 py-4">Contact</th>
                        <th className="px-6 py-4 text-right">Balance</th>
                        <th className="px-6 py-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {corporateAccounts.filter(c => c.currentBalance !== 0).length === 0 ? (
                        <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic">No corporate accounts with outstanding balances</td></tr>
                      ) : (
                        corporateAccounts.filter(c => c.currentBalance !== 0).map((corp) => (
                          <tr key={corp.id} className="hover:bg-zinc-800/50 transition-colors">
                            <td className="px-6 py-4 text-sm text-zinc-50 font-medium">{corp.name}</td>
                            <td className="px-6 py-4">
                              <div className="text-xs text-zinc-400">{corp.contactPerson}</div>
                              <div className="text-[10px] text-zinc-500">{corp.email}</div>
                            </td>
                            <td className={cn("px-6 py-4 text-right font-bold text-sm", (corp.currentBalance || 0) < 0 ? "text-red-500" : "text-emerald-500")}>
                              {formatCurrency(corp.currentBalance || 0, currency, exchangeRate)}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => {
                                  setShowSettleModal(corp);
                                  setSettleData({ ...settleData, amount: Math.abs(corp.currentBalance || 0) });
                                }}
                                className="text-xs font-bold text-emerald-500 hover:text-emerald-400"
                              >
                                Settle
                              </button>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'city_ledger' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 rounded-2xl bg-red-500/10 text-red-500">
                      <TrendingDown size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500 uppercase">Total Receivables</p>
                      <h3 className="text-2xl font-bold text-zinc-50">
                        {formatCurrency(
                          guests.reduce((acc, g) => acc + (g.ledgerBalance < 0 ? Math.abs(g.ledgerBalance) : 0), 0) +
                          corporateAccounts.reduce((acc, c) => acc + (c.currentBalance < 0 ? Math.abs(c.currentBalance) : 0), 0),
                          currency, exchangeRate
                        )}
                      </h3>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 rounded-2xl bg-amber-500/10 text-amber-500">
                      <AlertCircle size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500 uppercase">Overdue (&gt;30 Days)</p>
                      <h3 className="text-2xl font-bold text-zinc-50">
                        {/* Simplified calculation for now */}
                        {formatCurrency(
                          guests.reduce((acc, g) => acc + (g.ledgerBalance < -100000 ? Math.abs(g.ledgerBalance) : 0), 0),
                          currency, exchangeRate
                        )}
                      </h3>
                    </div>
                  </div>
                </div>
                <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl">
                  <div className="flex items-center gap-4 mb-4">
                    <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <p className="text-xs font-bold text-zinc-500 uppercase">Credit Available</p>
                      <h3 className="text-2xl font-bold text-zinc-50">
                        {formatCurrency(
                          guests.reduce((acc, g) => acc + (g.ledgerBalance > 0 ? g.ledgerBalance : 0), 0) +
                          corporateAccounts.reduce((acc, c) => acc + (c.currentBalance > 0 ? c.currentBalance : 0), 0),
                          currency, exchangeRate
                        )}
                      </h3>
                    </div>
                  </div>
                </div>
              </div>

              <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
                <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="font-bold text-zinc-50">Aging Report (Accounts Receivable)</h3>
                  <button 
                    onClick={() => exportToCSV(
                      [...guests, ...corporateAccounts]
                        .filter(a => ('ledgerBalance' in a ? a.ledgerBalance : a.currentBalance) < 0)
                        .map(a => ({
                          Name: a.name,
                          Type: 'ledgerBalance' in a ? 'Individual' : 'Corporate',
                          Balance: 'ledgerBalance' in a ? a.ledgerBalance : a.currentBalance,
                          CreditLimit: a.creditLimit || 0,
                          Terms: 'paymentTerms' in a ? a.paymentTerms : 'N/A'
                        })),
                      'aging_report'
                    )}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-xl text-xs font-bold transition-all"
                  >
                    <Download size={14} /> Export Aging
                  </button>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-left">
                    <thead>
                      <tr className="bg-zinc-950/50 border-b border-zinc-800">
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Entity</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Type</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider text-right">Balance</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider text-right">Credit Limit</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Terms</th>
                        <th className="px-6 py-4 text-[10px] font-bold text-zinc-500 uppercase tracking-wider text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800">
                      {[...guests, ...corporateAccounts]
                        .filter(a => ('ledgerBalance' in a ? a.ledgerBalance : a.currentBalance) !== 0)
                        .sort((a, b) => ('ledgerBalance' in a ? a.ledgerBalance : a.currentBalance) - ('ledgerBalance' in b ? b.ledgerBalance : b.currentBalance))
                        .map((account) => {
                          const balance = 'ledgerBalance' in account ? account.ledgerBalance : account.currentBalance;
                          return (
                            <tr key={account.id} className="hover:bg-zinc-800/50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="text-sm font-bold text-zinc-50">{account.name}</div>
                                <div className="text-[10px] text-zinc-500">{account.email}</div>
                              </td>
                              <td className="px-6 py-4">
                                <span className={cn(
                                  "px-2 py-1 rounded text-[10px] font-bold uppercase",
                                  'ledgerBalance' in account ? "bg-blue-500/10 text-blue-500" : "bg-purple-500/10 text-purple-500"
                                )}>
                                  {'ledgerBalance' in account ? 'Individual' : 'Corporate'}
                                </span>
                              </td>
                              <td className={cn(
                                "px-6 py-4 text-right font-bold",
                                balance < 0 ? "text-red-500" : "text-emerald-500"
                              )}>
                                {formatCurrency(balance, currency, exchangeRate)}
                              </td>
                              <td className="px-6 py-4 text-right text-sm text-zinc-400">
                                {formatCurrency(account.creditLimit || 0, currency, exchangeRate)}
                              </td>
                              <td className="px-6 py-4 text-xs text-zinc-500">
                                {'paymentTerms' in account ? account.paymentTerms || 'N/A' : 'N/A'}
                              </td>
                              <td className="px-6 py-4 text-right">
                                <button 
                                  onClick={() => setShowSettleModal(account)}
                                  className="px-3 py-1.5 bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-zinc-50 rounded-lg text-[10px] font-bold transition-all"
                                >
                                  Settle
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'suppliers' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-zinc-50">Supplier Accounts</h3>
                  <p className="text-xs text-zinc-500">Manage vendor balances and payments</p>
                </div>
                <button 
                  onClick={() => setShowAddSupplierModal(true)}
                  className="bg-emerald-500 text-zinc-50 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                >
                  Add Supplier
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Supplier</th>
                      <th className="px-6 py-4">Category</th>
                      <th className="px-6 py-4 text-right">Balance</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {suppliers.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic">No suppliers found</td></tr>
                    ) : (
                      suppliers.map((s) => (
                        <tr key={s.id} className="hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-zinc-50 font-medium">{s.name}</td>
                          <td className="px-6 py-4 text-xs text-zinc-400">{s.category}</td>
                          <td className="px-6 py-4 text-right font-bold text-red-500">{formatCurrency(s.balance, currency, exchangeRate)}</td>
                          <td className="px-6 py-4 text-right">
                            <button 
                              onClick={() => {
                                setShowPaySupplierModal(s);
                                setPayData({ ...payData, amount: s.balance });
                              }}
                              className="text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
                            >
                              Pay
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'accounts' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-zinc-50">Chart of Accounts</h3>
                  <p className="text-xs text-zinc-500">Financial structure and balances</p>
                </div>
                <button 
                  onClick={() => setShowAddAccountModal(true)}
                  className="bg-emerald-500 text-zinc-50 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                >
                  New Account
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Code</th>
                      <th className="px-6 py-4">Account Name</th>
                      <th className="px-6 py-4">Type</th>
                      <th className="px-6 py-4 text-right">Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {accounts.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic">No accounts defined</td></tr>
                    ) : (
                      accounts.map((a) => (
                        <tr key={a.id} className="hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4 text-xs text-zinc-500 font-mono">{a.code}</td>
                          <td className="px-6 py-4 text-sm text-zinc-50 font-medium">{a.name}</td>
                          <td className="px-6 py-4 text-xs text-zinc-400 capitalize">{a.type}</td>
                          <td className="px-6 py-4 text-right font-bold text-zinc-50">{formatCurrency(a.balance, currency, exchangeRate)}</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'pos' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800 flex justify-between items-center">
                <div>
                  <h3 className="font-bold text-zinc-50">Purchase Orders</h3>
                  <p className="text-xs text-zinc-500">Manage inventory procurement</p>
                </div>
                <button 
                  onClick={() => setShowAddPOModal(true)}
                  className="bg-emerald-500 text-zinc-50 px-4 py-2 rounded-xl text-sm font-bold transition-all active:scale-95"
                >
                  Create PO
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">PO #</th>
                      <th className="px-6 py-4">Supplier</th>
                      <th className="px-6 py-4">Status</th>
                      <th className="px-6 py-4 text-right">Total</th>
                      <th className="px-6 py-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {purchaseOrders.length === 0 ? (
                      <tr><td colSpan={5} className="px-6 py-12 text-center text-zinc-500 italic">No purchase orders found</td></tr>
                    ) : (
                      purchaseOrders.map((po) => (
                        <tr key={po.id} className="hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4 text-xs text-zinc-50 font-mono">{po.id.slice(0, 8)}</td>
                          <td className="px-6 py-4 text-sm text-zinc-400">{suppliers.find(s => s.id === po.supplierId)?.name || 'Unknown'}</td>
                          <td className="px-6 py-4">
                            <div className="flex flex-col gap-1">
                              <span className={cn(
                                "px-2 py-1 rounded text-[10px] font-bold uppercase w-fit",
                                po.status === 'received' ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                              )}>{po.status}</span>
                              <span className={cn(
                                "px-2 py-1 rounded text-[10px] font-bold uppercase w-fit",
                                po.paymentStatus === 'paid' ? "bg-blue-500/10 text-blue-500" : "bg-red-500/10 text-red-500"
                              )}>{po.paymentStatus}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-right font-bold text-zinc-50">{formatCurrency(po.totalAmount, currency, exchangeRate)}</td>
                          <td className="px-6 py-4 text-right">
                            <div className="flex justify-end gap-2">
                              {po.status !== 'received' && (
                                <button 
                                  onClick={() => handleReceivePO(po)}
                                  disabled={isSaving}
                                  className="text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors disabled:opacity-50"
                                >
                                  Receive
                                </button>
                              )}
                              {po.paymentStatus !== 'paid' && (
                                <button 
                                  onClick={() => handlePayPO(po)}
                                  disabled={isSaving}
                                  className="text-xs font-bold text-blue-500 hover:text-blue-400 transition-colors disabled:opacity-50"
                                >
                                  Pay
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'commissions' && (
            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
              <div className="p-6 border-b border-zinc-800">
                <h3 className="font-bold text-zinc-50">Agent Commissions</h3>
                <p className="text-xs text-zinc-500">Track and pay commissions to booking agents</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
                      <th className="px-6 py-4">Agent</th>
                      <th className="px-6 py-4">Reservation</th>
                      <th className="px-6 py-4 text-right">Amount</th>
                      <th className="px-6 py-4 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {commissions.length === 0 ? (
                      <tr><td colSpan={4} className="px-6 py-12 text-center text-zinc-500 italic">No commissions found</td></tr>
                    ) : (
                      commissions.map((c) => (
                        <tr key={c.id} className="hover:bg-zinc-800/50 transition-colors">
                          <td className="px-6 py-4 text-sm text-zinc-50 font-medium">{c.agentName}</td>
                          <td className="px-6 py-4 text-xs text-zinc-400">{c.reservationId}</td>
                          <td className="px-6 py-4 text-right font-bold text-zinc-50">{formatCurrency(c.amount, currency, exchangeRate)}</td>
                          <td className="px-6 py-4 text-right">
                            <span className={cn(
                              "px-2 py-1 rounded text-[10px] font-bold uppercase",
                              c.status === 'paid' ? "bg-emerald-500/10 text-emerald-500" : "bg-amber-500/10 text-amber-500"
                            )}>{c.status}</span>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'reports' && (
            <div className="space-y-6">
              <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="font-bold text-zinc-50">Report Parameters</h3>
                  <p className="text-xs text-zinc-500">Select date range and filters for your reports</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Category</label>
                    <select
                      value={reportFilter.category}
                      onChange={(e) => setReportFilter({ ...reportFilter, category: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="all">All Categories</option>
                      {[...categories.income, ...categories.expense].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Start Date</label>
                    <input
                      type="date"
                      value={reportFilter.startDate}
                      onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">End Date</label>
                    <input
                      type="date"
                      value={reportFilter.endDate}
                      onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
                      className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[
                  { title: 'Expense Type Report', icon: TrendingDown, desc: 'Breakdown of expenses by category' },
                  { title: 'Net Income Report', icon: BarChart3, desc: 'Profit and loss statement' },
                  { title: 'Transaction Report', icon: History, desc: 'Detailed list of all financial movements' },
                  { title: 'Balance Sheet', icon: Wallet, desc: 'Assets, liabilities, and equity' },
                  { title: 'Inventory Value', icon: LayoutDashboard, desc: 'Current value of stock on hand' },
                  { title: 'Store Balance', icon: Receipt, desc: 'Financial status of different store points' },
                ].map((report) => (
                  <button 
                    key={report.title} 
                    onClick={() => handleDownloadReport(report.title)}
                    className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl text-left hover:border-emerald-500/50 transition-all group"
                  >
                    <div className="p-3 rounded-xl bg-zinc-950 w-fit mb-4 group-hover:bg-emerald-500/10 transition-colors">
                      <report.icon className="text-zinc-400 group-hover:text-emerald-500" size={24} />
                    </div>
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-zinc-50 mb-1">{report.title}</h4>
                      <Download size={14} className="text-zinc-600 group-hover:text-emerald-500" />
                    </div>
                    <p className="text-xs text-zinc-500">{report.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">Add Financial Record</h2>
            </div>
            <form onSubmit={handleAddRecord}>
              <div className="p-6 space-y-4">
                <div className="flex p-1 bg-zinc-950 rounded-xl border border-zinc-800">
                  <button
                    type="button"
                    onClick={() => setNewRecord({ ...newRecord, type: 'income', category: categories.income[0] })}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                      newRecord.type === 'income' ? "bg-emerald-500 text-zinc-50" : "text-zinc-500"
                    )}
                  >
                    Income
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewRecord({ ...newRecord, type: 'expense', category: categories.expense[0] })}
                    className={cn(
                      "flex-1 py-2 rounded-lg text-sm font-bold transition-all",
                      newRecord.type === 'expense' ? "bg-red-500 text-zinc-50" : "text-zinc-500"
                    )}
                  >
                    Expense
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Amount ({currency})</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{currency === 'NGN' ? '₦' : '$'}</span>
                      <input
                        required
                        type="number"
                        value={currency === 'USD' ? (newRecord.amount / exchangeRate) || '' : newRecord.amount || ''}
                        onChange={(e) => {
                          const val = parseFloat(e.target.value);
                          setNewRecord({ ...newRecord, amount: currency === 'USD' ? val * exchangeRate : val });
                        }}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        placeholder="0.00"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                    <select
                      value={newRecord.category}
                      onChange={(e) => setNewRecord({ ...newRecord, category: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      {categories[newRecord.type].map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                  <select
                    value={newRecord.paymentMethod}
                    onChange={(e) => setNewRecord({ ...newRecord, paymentMethod: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Description</label>
                  <input
                    required
                    type="text"
                    value={newRecord.description}
                    onChange={(e) => setNewRecord({ ...newRecord, description: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. Room 102 stay payment"
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
                  disabled={!newRecord.amount || !newRecord.description}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  Save Record
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {showSettleModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            {(() => {
              const balance = 'ledgerBalance' in showSettleModal ? showSettleModal.ledgerBalance : showSettleModal.currentBalance;
              return (
                <>
                  <div className="p-6 border-b border-zinc-800">
                    <h2 className="text-xl font-bold text-zinc-50">
                      {balance < 0 ? 'Settle Outstanding Debt' : 'Settle Overpayment/Credit'}
                    </h2>
                    <p className="text-sm text-zinc-500 mt-1">
                      {'ledgerBalance' in showSettleModal ? 'Guest' : 'Corporate'}: {showSettleModal.name}
                    </p>
                  </div>
                  <form onSubmit={handleSettleBalance}>
                    <div className="p-6 space-y-4">
                      <div className={cn(
                        "p-4 rounded-2xl border flex items-center gap-4",
                        balance < 0 ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"
                      )}>
                        <div className={cn(
                          "w-10 h-10 rounded-full flex items-center justify-center",
                          balance < 0 ? "bg-red-500/20 text-red-500" : "bg-emerald-500/20 text-emerald-500"
                        )}>
                          <AlertCircle size={20} />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-zinc-500 uppercase">Current Balance</p>
                          <p className={cn(
                            "text-lg font-bold",
                            balance < 0 ? "text-red-500" : "text-emerald-500"
                          )}>
                            {formatCurrency(balance, currency, exchangeRate)}
                          </p>
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Settlement Amount ({currency})</label>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{currency === 'NGN' ? '₦' : '$'}</span>
                          <input
                            required
                            type="number"
                            value={currency === 'USD' ? (settleData.amount / exchangeRate) || '' : settleData.amount || ''}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setSettleData({ ...settleData, amount: currency === 'USD' ? val * exchangeRate : val });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                            placeholder="0.00"
                          />
                        </div>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                        <select
                          value={settleData.method}
                          onChange={(e) => setSettleData({ ...settleData, method: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="cash">Cash</option>
                          <option value="card">Card</option>
                          <option value="transfer">Bank Transfer</option>
                        </select>
                      </div>

                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase">Notes</label>
                        <textarea
                          value={settleData.notes}
                          onChange={(e) => setSettleData({ ...settleData, notes: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 min-h-[80px]"
                          placeholder="e.g. Guest paid cash at front desk"
                        />
                      </div>
                    </div>
                    <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                      <button
                        type="button"
                        onClick={() => setShowSettleModal(null)}
                        className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={!settleData.amount || isSaving}
                        className={cn(
                          "flex-1 px-4 py-2 text-zinc-50 rounded-xl font-bold transition-all active:scale-95 disabled:opacity-50",
                          balance < 0 ? "bg-emerald-500 hover:bg-emerald-600" : "bg-red-500 hover:bg-red-600"
                        )}
                      >
                        {isSaving ? 'Processing...' : balance < 0 ? 'Post Payment' : 'Post Refund'}
                      </button>
                    </div>
                  </form>
                </>
              );
            })()}
          </motion.div>
        </div>
      )}

      {showPaySupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">Pay Supplier</h2>
              <p className="text-sm text-zinc-500 mt-1">Supplier: {showPaySupplierModal.name}</p>
            </div>
            <form onSubmit={handlePaySupplier}>
              <div className="p-6 space-y-4">
                <div className="p-4 rounded-2xl bg-red-500/5 border border-red-500/20 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-red-500/20 text-red-500 flex items-center justify-center">
                    <AlertCircle size={20} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-500 uppercase">Outstanding Balance</p>
                    <p className="text-lg font-bold text-red-500">
                      {formatCurrency(showPaySupplierModal.balance, currency, exchangeRate)}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Payment Amount ({currency})</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500">{currency === 'NGN' ? '₦' : '$'}</span>
                    <input
                      required
                      type="number"
                      value={currency === 'USD' ? (payData.amount / exchangeRate) || '' : payData.amount || ''}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value);
                        setPayData({ ...payData, amount: currency === 'USD' ? val * exchangeRate : val });
                      }}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="0.00"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Payment Method</label>
                  <select
                    value={payData.method}
                    onChange={(e) => setPayData({ ...payData, method: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="transfer">Bank Transfer</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Notes</label>
                  <textarea
                    value={payData.notes}
                    onChange={(e) => setPayData({ ...payData, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 min-h-[80px]"
                    placeholder="e.g. Payment for invoice #123"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowPaySupplierModal(null)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!payData.amount || isSaving}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? 'Processing...' : 'Post Payment'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">Add New Supplier</h2>
            </div>
            <form onSubmit={handleAddSupplier}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Supplier Name</label>
                  <input
                    required
                    type="text"
                    value={newSupplier.name}
                    onChange={(e) => setNewSupplier({ ...newSupplier, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. Fresh Foods Ltd"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                    <input
                      required
                      type="text"
                      value={newSupplier.category}
                      onChange={(e) => setNewSupplier({ ...newSupplier, category: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g. Food"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Phone</label>
                    <input
                      type="text"
                      value={newSupplier.phone}
                      onChange={(e) => setNewSupplier({ ...newSupplier, phone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Email</label>
                  <input
                    type="email"
                    value={newSupplier.email}
                    onChange={(e) => setNewSupplier({ ...newSupplier, email: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddSupplierModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? 'Saving...' : 'Add Supplier'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddAccountModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">Create New Account</h2>
            </div>
            <form onSubmit={handleCreateAccount}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Code</label>
                    <input
                      required
                      type="text"
                      value={newAccount.code}
                      onChange={(e) => setNewAccount({ ...newAccount, code: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 font-mono"
                      placeholder="1001"
                    />
                  </div>
                  <div className="col-span-2 space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Account Name</label>
                    <input
                      required
                      type="text"
                      value={newAccount.name}
                      onChange={(e) => setNewAccount({ ...newAccount, name: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g. Cash at Hand"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Account Type</label>
                  <select
                    value={newAccount.type}
                    onChange={(e) => setNewAccount({ ...newAccount, type: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="asset">Asset</option>
                    <option value="liability">Liability</option>
                    <option value="equity">Equity</option>
                    <option value="revenue">Revenue</option>
                    <option value="expense">Expense</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Initial Balance</label>
                  <input
                    type="number"
                    value={newAccount.balance}
                    onChange={(e) => setNewAccount({ ...newAccount, balance: parseFloat(e.target.value) })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddAccountModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                >
                  {isSaving ? 'Creating...' : 'Create Account'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {showAddPOModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-2xl overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-zinc-50">Create Purchase Order</h2>
            </div>
            <form onSubmit={handleCreatePO}>
              <div className="p-6 space-y-6 max-h-[60vh] overflow-y-auto">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Supplier</label>
                    <select
                      required
                      value={newPO.supplierId}
                      onChange={(e) => setNewPO({ ...newPO, supplierId: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select Supplier</option>
                      {suppliers.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Due Date</label>
                    <div className="relative">
                      <input
                        required
                        type="date"
                        value={newPO.dueDate}
                        onChange={(e) => setNewPO({ ...newPO, dueDate: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 appearance-none"
                        style={{ colorScheme: 'dark' }}
                      />
                      <Calendar className="absolute right-3 top-1/2 -translate-y-1/2 text-emerald-500 pointer-events-none" size={18} />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Items</label>
                    <button
                      type="button"
                      onClick={() => {
                        setNewPO({
                          ...newPO,
                          items: [...newPO.items, { itemId: '', quantity: 1, unitPrice: 0, receivedQuantity: 0, total: 0 }]
                        });
                      }}
                      className="text-xs font-bold text-emerald-500 flex items-center gap-1"
                    >
                      <Plus size={14} /> Add Item
                    </button>
                  </div>
                  
                  <div className="space-y-3">
                    {newPO.items.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-3 items-end bg-zinc-950/50 p-3 rounded-xl border border-zinc-800">
                        <div className="col-span-5 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Inventory Item</label>
                          <select
                            required
                            value={item.itemId}
                            onChange={(e) => {
                              const items = [...newPO.items];
                              items[index].itemId = e.target.value;
                              setNewPO({ ...newPO, items });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                          >
                            <option value="">Select Item</option>
                            {inventoryItems.map(i => (
                              <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>
                            ))}
                          </select>
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Qty</label>
                          <input
                            required
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => {
                              const items = [...newPO.items];
                              items[index].quantity = parseFloat(e.target.value);
                              items[index].total = items[index].quantity * items[index].unitPrice;
                              const totalAmount = items.reduce((acc, curr) => acc + curr.total, 0);
                              setNewPO({ ...newPO, items, totalAmount });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Price</label>
                          <input
                            required
                            type="number"
                            min="0"
                            value={item.unitPrice}
                            onChange={(e) => {
                              const items = [...newPO.items];
                              items[index].unitPrice = parseFloat(e.target.value);
                              items[index].total = items[index].quantity * items[index].unitPrice;
                              const totalAmount = items.reduce((acc, curr) => acc + curr.total, 0);
                              setNewPO({ ...newPO, items, totalAmount });
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                          />
                        </div>
                        <div className="col-span-2 text-right pb-2">
                          <div className="text-[10px] font-bold text-zinc-600 uppercase mb-1">Total</div>
                          <div className="text-sm font-bold text-zinc-50">{formatCurrency(item.total, currency, exchangeRate)}</div>
                        </div>
                        <div className="col-span-1 pb-1">
                          <button
                            type="button"
                            onClick={() => {
                              const items = newPO.items.filter((_, i) => i !== index);
                              const totalAmount = items.reduce((acc, curr) => acc + curr.total, 0);
                              setNewPO({ ...newPO, items, totalAmount });
                            }}
                            className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                          >
                            <TrendingDown size={16} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                <div>
                  <p className="text-xs text-zinc-500 uppercase font-bold">Total Amount</p>
                  <p className="text-2xl font-bold text-emerald-500">{formatCurrency(newPO.totalAmount, currency, exchangeRate)}</p>
                </div>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => setShowAddPOModal(false)}
                    className="px-6 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving || !newPO.supplierId || newPO.items.length === 0}
                    className="px-6 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95 disabled:opacity-50"
                  >
                    {isSaving ? 'Creating...' : 'Create PO'}
                  </button>
                </div>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {showFolio && selectedReservation && (
        <GuestFolio 
          reservation={selectedReservation} 
          onClose={() => {
            setShowFolio(false);
            setSelectedReservation(null);
          }} 
        />
      )}
    </div>
  );
}
