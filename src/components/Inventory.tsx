import React, { useState, useEffect } from 'react';
import { 
  Package, Search, Filter, Plus, MoreHorizontal, 
  Edit2, Trash2, AlertTriangle, CheckCircle2, 
  TrendingUp, TrendingDown, History, ShoppingCart,
  Users, ClipboardCheck, BarChart3, LayoutDashboard,
  Box, Layers, ArrowRight, Download
} from 'lucide-react';
import { 
  InventoryItem, InventoryTransaction, InventoryCategory, 
  InventoryLocation, InventoryVendor, PurchaseOrder, InventoryAudit,
  OperationType
} from '../types';
import { formatCurrency } from '../utils';
import { useAuth } from '../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import { db, handleFirestoreError } from '../firebase';
import { collection, onSnapshot, query, orderBy } from 'firebase/firestore';
import { format } from 'date-fns';

// Sub-modules
import { InventoryDashboard } from './inventory/InventoryDashboard';
import { ItemMaster } from './inventory/ItemMaster';
import { Procurement } from './inventory/Procurement';
import { StockMovements } from './inventory/StockMovements';
import { InventoryAuditing } from './inventory/InventoryAuditing';
import { InventoryReports } from './inventory/InventoryReports';

type InventoryTab = 'dashboard' | 'items' | 'procurement' | 'movements' | 'auditing' | 'reports';

export function Inventory() {
  const { hotel, currency, exchangeRate, profile } = useAuth();
  const [activeTab, setActiveTab] = useState<InventoryTab>('dashboard');
  
  // Data State
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [locations, setLocations] = useState<InventoryLocation[]>([]);
  const [vendors, setVendors] = useState<InventoryVendor[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [audits, setAudits] = useState<InventoryAudit[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('All');
  const [showAddModal, setShowAddModal] = useState(false);

  useEffect(() => {
    if (!hotel?.id) {
      setLoading(false);
      return;
    }

    const unsubscribers = [
      onSnapshot(query(collection(db, 'hotels', hotel.id, 'inventory'), orderBy('name')), (snapshot) => {
        setItems(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
        setLoading(false);
      }, (error) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory`);
        setLoading(false);
      }),
      onSnapshot(query(collection(db, 'hotels', hotel.id, 'inventory_transactions'), orderBy('timestamp', 'desc')), (snapshot) => {
        setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryTransaction)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_transactions`)),
      onSnapshot(collection(db, 'hotels', hotel.id, 'inventory_categories'), (snapshot) => {
        setCategories(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryCategory)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_categories`)),
      onSnapshot(collection(db, 'hotels', hotel.id, 'inventory_locations'), (snapshot) => {
        setLocations(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryLocation)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_locations`)),
      onSnapshot(collection(db, 'hotels', hotel.id, 'inventory_vendors'), (snapshot) => {
        setVendors(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryVendor)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_vendors`)),
      onSnapshot(query(collection(db, 'hotels', hotel.id, 'purchase_orders'), orderBy('timestamp', 'desc')), (snapshot) => {
        setPurchaseOrders(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as PurchaseOrder)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/purchase_orders`)),
      onSnapshot(query(collection(db, 'hotels', hotel.id, 'inventory_audits'), orderBy('timestamp', 'desc')), (snapshot) => {
        setAudits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryAudit)));
      }, (error) => handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory_audits`))
    ];

    return () => unsubscribers.forEach(unsub => unsub());
  }, [hotel?.id]);

  const stats = [
    { label: 'Total Items', value: items.length, color: 'text-blue-500' },
    { label: 'Low Stock', value: items.filter(i => i.quantity <= i.minThreshold).length, color: 'text-red-500' },
    { label: 'Total Value', value: formatCurrency(items.reduce((acc, i) => acc + (i.quantity * i.price), 0), currency, exchangeRate), color: 'text-emerald-500' },
    { label: 'Categories', value: new Set(items.map(i => i.category)).size, color: 'text-blue-500' },
    { label: 'Total Items', value: items.length, color: 'text-blue-500' },
    { label: 'Low Stock', value: items.filter(i => i.quantity <= i.minThreshold).length, color: 'text-red-500' },
    { label: 'Food & Bev', value: items.filter(i => i.category.toLowerCase().includes('food') || i.category.toLowerCase().includes('bev')).length, color: 'text-blue-500' },
    { label: 'Cleaning Supplies', value: items.filter(i => i.category.toLowerCase().includes('clean')).length, color: 'text-emerald-500' },
  ];

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = filterCategory === 'All' || item.category === filterCategory;
    return matchesSearch && matchesCategory;
  });

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="w-12 h-12 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!hotel?.id) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center space-y-4">
        <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center text-zinc-500">
          <Package size={32} />
        </div>
        <div>
          <h2 className="text-xl font-bold text-white">No Hotel Selected</h2>
          <p className="text-zinc-500 max-w-xs mx-auto">
            Please select a hotel from the Super Admin dashboard to manage its inventory.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-8">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Inventory Management</h1>
          <p className="text-zinc-500">Manage supplies, food, and beverage stock</p>
        </div>
        
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs text-zinc-400">
            <input type="date" className="bg-transparent outline-none" defaultValue="2026-04-01" />
            <span>to</span>
            <input type="date" className="bg-transparent outline-none" defaultValue="2026-04-12" />
          </div>
          <select className="bg-zinc-900 border border-zinc-800 px-3 py-1.5 rounded-lg text-xs text-zinc-400 outline-none">
            <option>All Categories</option>
          </select>
          <button className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all">
            <Download size={16} />
            Export Report
          </button>
          <button 
            onClick={() => setActiveTab('items')}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-4 py-2 rounded-lg text-sm font-bold transition-all"
          >
            <Plus size={16} />
            Add Item
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((stat, i) => (
          <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl">
            <div className="text-zinc-500 text-xs font-bold uppercase mb-2">{stat.label}</div>
            <div className={cn("text-2xl font-bold", stat.color)}>{stat.value}</div>
          </div>
        ))}
      </div>

      {/* Search & Filter */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search inventory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-12 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex items-center gap-2">
          {['All', 'Food', 'Drink', 'Cleaning', 'Other'].map(cat => (
            <button
              key={cat}
              onClick={() => setFilterCategory(cat)}
              className={cn(
                "px-4 py-2 rounded-lg text-xs font-bold transition-all",
                filterCategory === cat ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
              <th className="px-6 py-4">Item Name</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4 text-center">Quantity</th>
              <th className="px-6 py-4 text-center">Status</th>
              <th className="px-6 py-4">Last Updated</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredItems.map(item => (
              <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors">
                <td className="px-6 py-4 font-bold text-white text-sm">{item.name}</td>
                <td className="px-6 py-4 text-zinc-400 text-sm">{item.category}</td>
                <td className="px-6 py-4 text-center text-white text-sm font-bold">{item.quantity}</td>
                <td className="px-6 py-4 text-center">
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase",
                    item.quantity <= item.minThreshold ? "bg-red-500/10 text-red-500" : "bg-emerald-500/10 text-emerald-500"
                  )}>
                    {item.quantity <= item.minThreshold ? 'Low Stock' : 'In Stock'}
                  </span>
                </td>
                <td className="px-6 py-4 text-zinc-500 text-sm">
                  {item.lastUpdated ? format(new Date(item.lastUpdated), 'dd/MM/yyyy') : '-'}
                </td>
                <td className="px-6 py-4 text-right">
                  <button className="text-zinc-500 hover:text-white transition-colors">
                    <MoreHorizontal size={18} />
                  </button>
                </td>
              </tr>
            ))}
            {filteredItems.length === 0 && (
              <tr>
                <td colSpan={6} className="px-6 py-20 text-center">
                  <div className="flex flex-col items-center gap-4 text-zinc-500">
                    <Package size={48} className="opacity-20" />
                    <p className="font-bold">No items found</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Keep the tabbed view for advanced features if needed, but default to this dashboard */}
      <div className="pt-12 border-t border-zinc-800">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-bold text-white">Advanced Inventory Modules</h2>
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            {['dashboard', 'items', 'procurement', 'movements', 'auditing', 'reports'].map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab as InventoryTab)}
                className={cn(
                  "px-4 py-2 rounded-lg text-xs font-bold transition-all capitalize",
                  activeTab === tab ? "bg-emerald-500 text-black" : "text-zinc-500 hover:text-white"
                )}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>
        
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="min-h-[40vh]"
        >
          {activeTab === 'dashboard' && <InventoryDashboard items={items} transactions={transactions} />}
          {activeTab === 'items' && <ItemMaster items={items} categories={categories} />}
          {activeTab === 'procurement' && <Procurement vendors={vendors} purchaseOrders={purchaseOrders} items={items} />}
          {activeTab === 'movements' && <StockMovements items={items} transactions={transactions} locations={locations} />}
          {activeTab === 'auditing' && <InventoryAuditing items={items} audits={audits} locations={locations} />}
          {activeTab === 'reports' && <InventoryReports items={items} transactions={transactions} />}
        </motion.div>
      </div>
    </div>
  );
}
