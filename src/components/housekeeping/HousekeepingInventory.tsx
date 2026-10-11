import React, { useState, useEffect } from 'react';
import { 
  HousekeepingInventoryItem, 
  HousekeepingStockIssue, 
  HousekeepingStockReceipt, 
  UserProfile 
} from '../../types';
import { 
  collection, 
  query, 
  doc, 
  onSnapshot, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { db, handleFirestoreError } from '../../firebase';
import { database } from '../../utils/database';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Package, 
  Plus, 
  ArrowUpRight, 
  ArrowDownLeft, 
  Search, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  Sparkles, 
  Download,
  X,
  Layers,
  Calendar,
  User,
  Filter,
  Check
} from 'lucide-react';
import { cn, exportToCSV } from '../../utils';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

// Standard Blueprint Items to initialize if collection is empty
const DEFAULT_BLUEPRINT_ITEMS: Omit<HousekeepingInventoryItem, 'id' | 'lastUpdated'>[] = [
  { name: 'Creamer', category: 'Beverages', openingStock: 100, received: 50, issued: 40, used: 40, damaged: 0, balance: 110, minStockLevel: 25, unit: 'packets' },
  { name: '3in1 Nescafé', category: 'Beverages', openingStock: 120, received: 80, issued: 60, used: 60, damaged: 0, balance: 140, minStockLevel: 30, unit: 'sachets' },
  { name: 'Coffee Seeds', category: 'Beverages', openingStock: 20, received: 10, issued: 5, used: 5, damaged: 0, balance: 25, minStockLevel: 5, unit: 'kg' },
  { name: 'Drinking Water Bottles (500ml)', category: 'Beverages', openingStock: 200, received: 150, issued: 120, used: 120, damaged: 2, balance: 228, minStockLevel: 50, unit: 'bottles' },
  { name: 'Brown Sugar', category: 'Beverages', openingStock: 150, received: 50, issued: 70, used: 70, damaged: 0, balance: 130, minStockLevel: 30, unit: 'packets' },
  { name: 'White Sugar', category: 'Beverages', openingStock: 150, received: 50, issued: 75, used: 75, damaged: 0, balance: 125, minStockLevel: 30, unit: 'packets' },
  { name: 'Black Tea', category: 'Beverages', openingStock: 100, received: 50, issued: 70, used: 70, damaged: 0, balance: 80, minStockLevel: 25, unit: 'packs' },
  { name: 'Facial Tissue Box', category: 'Paper Goods', openingStock: 80, received: 40, issued: 30, used: 30, damaged: 0, balance: 90, minStockLevel: 20, unit: 'boxes' },
  { name: 'Soap Bars', category: 'Toiletries', openingStock: 120, received: 100, issued: 85, used: 85, damaged: 0, balance: 135, minStockLevel: 35, unit: 'bars' },
  { name: 'Shampoo (30ml)', category: 'Toiletries', openingStock: 150, received: 100, issued: 90, used: 90, damaged: 1, balance: 159, minStockLevel: 40, unit: 'bottles' },
  { name: 'Body Lotion (30ml)', category: 'Toiletries', openingStock: 100, received: 50, issued: 60, used: 60, damaged: 0, balance: 90, minStockLevel: 25, unit: 'bottles' },
  { name: 'Toothbrush & Paste Kit', category: 'Toiletries', openingStock: 100, received: 50, issued: 65, used: 65, damaged: 0, balance: 85, minStockLevel: 25, unit: 'sets' },
  { name: 'Bath Towels', category: 'Linen', openingStock: 80, received: 20, issued: 25, used: 25, damaged: 2, balance: 73, minStockLevel: 20, unit: 'pcs' },
  { name: 'Bed Sheets (King/Queen)', category: 'Linen', openingStock: 60, received: 20, issued: 20, used: 20, damaged: 1, balance: 59, minStockLevel: 15, unit: 'pcs' },
  { name: 'Pillowcases', category: 'Linen', openingStock: 120, received: 40, issued: 40, used: 40, damaged: 0, balance: 120, minStockLevel: 30, unit: 'pcs' },
  { name: 'Duvet Covers', category: 'Linen', openingStock: 50, received: 15, issued: 15, used: 15, damaged: 0, balance: 50, minStockLevel: 12, unit: 'pcs' },
  { name: 'Cleaning Chemicals (All-Purpose)', category: 'Cleaning Supplies', openingStock: 25, received: 10, issued: 8, used: 8, damaged: 0, balance: 27, minStockLevel: 8, unit: 'liters' },
  { name: 'Rubber Gloves', category: 'Cleaning Supplies', openingStock: 40, received: 20, issued: 15, used: 15, damaged: 2, balance: 43, minStockLevel: 10, unit: 'pairs' },
  { name: 'Heavy-Duty Garbage Bags', category: 'Cleaning Supplies', openingStock: 200, received: 100, issued: 120, used: 120, damaged: 0, balance: 180, minStockLevel: 50, unit: 'rolls' }
];

interface HousekeepingInventoryProps {
  staff: UserProfile[];
}

export function HousekeepingInventory({ staff }: HousekeepingInventoryProps) {
  const { hotel, profile } = useAuth();
  
  const [items, setItems] = useState<HousekeepingInventoryItem[]>([]);
  const [transactions, setTransactions] = useState<(HousekeepingStockIssue | HousekeepingStockReceipt)[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Filter & Search
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [filterLowStockOnly, setFilterLowStockOnly] = useState(false);
  const [viewMode, setViewMode] = useState<'inventory' | 'history'>('inventory');

  // Modals
  const [showAddItemModal, setShowAddItemModal] = useState(false);
  const [showIssueModal, setShowIssueModal] = useState(false);
  const [showReceiveModal, setShowReceiveModal] = useState(false);

  // Forms
  const [newItemForm, setNewItemForm] = useState({
    name: '',
    category: 'Toiletries',
    openingStock: 50,
    minStockLevel: 15,
    unit: 'pcs'
  });

  const [issueForm, setIssueForm] = useState({
    itemId: '',
    staffName: '',
    quantity: 10,
    purpose: 'Daily Room Cleaning & Turnaround',
    date: format(new Date(), 'yyyy-MM-dd')
  });

  const [receiveForm, setReceiveForm] = useState({
    itemId: '',
    supplier: 'Central Hospitality Supplies',
    quantity: 50,
    invoiceRef: '',
    remarks: 'Monthly restock consignment',
    date: format(new Date(), 'yyyy-MM-dd')
  });

  // 1. Live Snapshot for Housekeeping Inventory
  useEffect(() => {
    if (!hotel?.id) return;
    setIsLoading(true);

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_inventory'),
      orderBy('name', 'asc'),
      limit(150)
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingInventoryItem));
      setItems(docs);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, 'list' as any, `hotels/${hotel.id}/housekeeping_inventory`);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // 2. Live Snapshot for Stock Transactions (Issues & Receipts)
  useEffect(() => {
    if (!hotel?.id) return;

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_stock_transactions'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setTransactions(docs);
    }, () => {});

    return () => unsub();
  }, [hotel?.id]);

  // Auto-seed or Quick Seed button
  const handleSeedDefaults = async () => {
    if (!hotel?.id || !profile) return;
    try {
      const now = new Date().toISOString();
      for (const item of DEFAULT_BLUEPRINT_ITEMS) {
        await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_inventory'), {
          ...item,
          lastUpdated: now
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'SEED_INVENTORY',
          details: `Seeded ${item.name}`
        });
      }
      toast.success('Successfully loaded standard Housekeeping inventory catalog!');
    } catch (err) {
      toast.error('Failed to load standard inventory');
    }
  };

  // Add Custom New Item
  const handleCreateNewItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !newItemForm.name.trim()) return;

    const now = new Date().toISOString();
    const openingStock = Number(newItemForm.openingStock) || 0;
    const minStockLevel = Number(newItemForm.minStockLevel) || 5;

    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_inventory'), {
        name: newItemForm.name.trim(),
        category: newItemForm.category,
        openingStock,
        received: 0,
        issued: 0,
        used: 0,
        damaged: 0,
        balance: openingStock,
        minStockLevel,
        unit: newItemForm.unit.trim() || 'pcs',
        lastUpdated: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'CREATE_ITEM',
        details: `Created new housekeeping item ${newItemForm.name}`
      });

      toast.success(`Item "${newItemForm.name}" added to Housekeeping Inventory!`);
      setShowAddItemModal(false);
      setNewItemForm({
        name: '',
        category: 'Toiletries',
        openingStock: 50,
        minStockLevel: 15,
        unit: 'pcs'
      });
    } catch (err) {
      toast.error('Failed to create inventory item');
    }
  };

  // Stock Issue (Section 9)
  const handleIssueStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !issueForm.itemId) return;

    const targetItem = items.find(i => i.id === issueForm.itemId);
    if (!targetItem) return;

    const qty = Number(issueForm.quantity) || 1;
    if (qty <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }

    if (qty > targetItem.balance) {
      toast.warning(`Warning: Issuing ${qty} ${targetItem.unit} exceeds current balance (${targetItem.balance})`);
    }

    const now = new Date().toISOString();
    const newIssued = (targetItem.issued || 0) + qty;
    const newBalance = Math.max(0, (targetItem.balance || 0) - qty);

    try {
      // 1. Update item balance in Firestore
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_inventory', targetItem.id), {
        issued: newIssued,
        used: (targetItem.used || 0) + qty,
        balance: newBalance,
        lastUpdated: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'STOCK_ISSUE',
        details: `Issued ${qty} ${targetItem.unit} of ${targetItem.name} to ${issueForm.staffName}`
      });

      // 2. Append Transaction Log (audit record)
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_stock_transactions'), {
        type: 'issue',
        itemId: targetItem.id,
        itemName: targetItem.name,
        quantity: qty,
        unit: targetItem.unit,
        staffName: issueForm.staffName,
        issuedBy: profile.displayName || profile.email,
        purpose: issueForm.purpose,
        date: issueForm.date,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'TRANSACTION_RECORD',
        details: `Logged issue for ${targetItem.name}`
      });

      toast.success(`Issued ${qty} ${targetItem.unit} of ${targetItem.name} to ${issueForm.staffName}`);
      setShowIssueModal(false);
    } catch (err) {
      toast.error('Failed to issue stock');
    }
  };

  // Stock Receiving (Section 10)
  const handleReceiveStock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !receiveForm.itemId) return;

    const targetItem = items.find(i => i.id === receiveForm.itemId);
    if (!targetItem) return;

    const qty = Number(receiveForm.quantity) || 1;
    if (qty <= 0) {
      toast.error('Quantity must be greater than zero');
      return;
    }

    const now = new Date().toISOString();
    const newReceived = (targetItem.received || 0) + qty;
    const newBalance = (targetItem.balance || 0) + qty;

    try {
      // 1. Update item balance in Firestore
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_inventory', targetItem.id), {
        received: newReceived,
        balance: newBalance,
        lastUpdated: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'STOCK_RECEIVE',
        details: `Received ${qty} ${targetItem.unit} of ${targetItem.name} from ${receiveForm.supplier}`
      });

      // 2. Append Transaction Log (audit record)
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_stock_transactions'), {
        type: 'receive',
        itemId: targetItem.id,
        itemName: targetItem.name,
        quantity: qty,
        unit: targetItem.unit,
        supplier: receiveForm.supplier,
        receivedBy: profile.displayName || profile.email,
        invoiceRef: receiveForm.invoiceRef,
        remarks: receiveForm.remarks,
        date: receiveForm.date,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'TRANSACTION_RECORD',
        details: `Logged delivery for ${targetItem.name}`
      });

      toast.success(`Received ${qty} ${targetItem.unit} of ${targetItem.name} into inventory`);
      setShowReceiveModal(false);
    } catch (err) {
      toast.error('Failed to receive stock');
    }
  };

  // Filtered Items
  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.category && item.category.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesCategory = selectedCategory === 'all' || item.category === selectedCategory;
    const matchesLowStock = !filterLowStockOnly || (item.balance <= item.minStockLevel);
    return matchesSearch && matchesCategory && matchesLowStock;
  });

  // Categories list
  const categories = Array.from(new Set(items.map(i => i.category || 'General'))).sort();

  // Low stock counter
  const lowStockCount = items.filter(i => (i.balance || 0) <= (i.minStockLevel || 5)).length;

  // Export to CSV
  const handleExportInventoryCSV = () => {
    const data = items.map(item => ({
      Item: item.name,
      Category: item.category || 'General',
      Unit: item.unit,
      OpeningStock: item.openingStock,
      Received: item.received,
      Issued: item.issued,
      Used: item.used,
      Damaged: item.damaged,
      CurrentBalance: item.balance,
      MinStockLevel: item.minStockLevel,
      Status: item.balance <= item.minStockLevel ? 'LOW STOCK' : 'IN STOCK'
    }));
    exportToCSV(data, `housekeeping-inventory-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  return (
    <div className="space-y-5">
      {/* 1. Header & Actions */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Package size={18} />
            </div>
            <div>
              <h2 className="text-lg font-black text-white">Housekeeping Inventory & Stock Management</h2>
              <p className="text-xs text-zinc-400">Complete stock tracking, issues to staff, vendor receiving, and par levels</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {items.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              className="px-3.5 py-2 bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-bold rounded-xl hover:bg-emerald-500/30 transition-all flex items-center gap-1.5"
            >
              <Sparkles size={14} />
              Load Blueprint Catalog
            </button>
          )}

          <button
            onClick={() => setShowAddItemModal(true)}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
          >
            <Plus size={14} />
            <span>Add New Item</span>
          </button>

          <button
            onClick={() => {
              if (items.length > 0) setIssueForm(prev => ({ ...prev, itemId: items[0].id }));
              setShowIssueModal(true);
            }}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-400 border border-amber-500/20 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
          >
            <ArrowUpRight size={14} />
            <span>Issue Stock</span>
          </button>

          <button
            onClick={() => {
              if (items.length > 0) setReceiveForm(prev => ({ ...prev, itemId: items[0].id }));
              setShowReceiveModal(true);
            }}
            className="px-3.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 border border-emerald-500/20 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5"
          >
            <ArrowDownLeft size={14} />
            <span>Receive Stock</span>
          </button>

          <button
            onClick={handleExportInventoryCSV}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* 2. Low-Stock Alert Banner if any */}
      {lowStockCount > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
              <AlertTriangle size={18} />
            </div>
            <div>
              <h4 className="text-xs font-bold text-amber-300 uppercase tracking-wider">
                Low Stock Warning: {lowStockCount} items below threshold
              </h4>
              <p className="text-xs text-zinc-400">
                Supplies need immediate requisition to prevent disruption to room cleaning turnaround.
              </p>
            </div>
          </div>
          <button
            onClick={() => setFilterLowStockOnly(!filterLowStockOnly)}
            className="px-3 py-1.5 bg-amber-500 text-black text-xs font-bold rounded-xl hover:bg-amber-400 transition-all shrink-0"
          >
            {filterLowStockOnly ? 'Show All Items' : 'Filter Low Stock Only'}
          </button>
        </div>
      )}

      {/* 3. Controls & Filter Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode('inventory')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
              viewMode === 'inventory' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-300 hover:text-white"
            )}
          >
            <Layers size={14} />
            <span>Stock Ledger ({items.length})</span>
          </button>

          <button
            onClick={() => setViewMode('history')}
            className={cn(
              "px-3 py-1.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5",
              viewMode === 'history' ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-300 hover:text-white"
            )}
          >
            <History size={14} />
            <span>Transaction Logs ({transactions.length})</span>
          </button>
        </div>

        {viewMode === 'inventory' && (
          <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
            <div className="relative flex-1 sm:w-60">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
              <input
                type="text"
                placeholder="Search items..."
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <select
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {categories.map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* 4. Tab View: Stock Ledger (Section 7 & 8) */}
      {viewMode === 'inventory' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Item Name</th>
                  <th className="py-3 px-3">Category</th>
                  <th className="py-3 px-3 text-right">Opening</th>
                  <th className="py-3 px-3 text-right text-emerald-400">Received</th>
                  <th className="py-3 px-3 text-right text-amber-400">Issued</th>
                  <th className="py-3 px-3 text-right">Used</th>
                  <th className="py-3 px-3 text-right text-rose-400">Damaged</th>
                  <th className="py-3 px-4 text-right">Balance</th>
                  <th className="py-3 px-3 text-right">Min Level</th>
                  <th className="py-3 px-4 text-center">Status</th>
                  <th className="py-3 px-4 text-right">Quick Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {filteredItems.map(item => {
                  const isLow = (item.balance || 0) <= (item.minStockLevel || 5);
                  return (
                    <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4 font-bold text-white">
                        <div>{item.name}</div>
                        <span className="text-[10px] text-zinc-500 font-normal">{item.unit}</span>
                      </td>
                      <td className="py-3 px-3 text-zinc-400">
                        <span className="px-2 py-0.5 rounded-md bg-zinc-800 text-[10px] font-semibold">
                          {item.category || 'General'}
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-zinc-400">{item.openingStock || 0}</td>
                      <td className="py-3 px-3 text-right font-mono text-emerald-400">+{item.received || 0}</td>
                      <td className="py-3 px-3 text-right font-mono text-amber-400">-{item.issued || 0}</td>
                      <td className="py-3 px-3 text-right font-mono text-zinc-400">{item.used || 0}</td>
                      <td className="py-3 px-3 text-right font-mono text-rose-400">{item.damaged || 0}</td>
                      <td className="py-3 px-4 text-right font-mono font-black text-sm text-white">
                        {item.balance || 0}
                      </td>
                      <td className="py-3 px-3 text-right font-mono text-zinc-500">{item.minStockLevel || 0}</td>
                      <td className="py-3 px-4 text-center">
                        {isLow ? (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30 inline-flex items-center gap-1">
                            <AlertTriangle size={10} />
                            Low Stock
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                            Adequate
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => {
                              setIssueForm(prev => ({ ...prev, itemId: item.id }));
                              setShowIssueModal(true);
                            }}
                            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-amber-400 rounded-lg text-[11px] font-bold"
                            title="Issue to Staff"
                          >
                            Issue
                          </button>
                          <button
                            onClick={() => {
                              setReceiveForm(prev => ({ ...prev, itemId: item.id }));
                              setShowReceiveModal(true);
                            }}
                            className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-lg text-[11px] font-bold"
                            title="Receive from Vendor"
                          >
                            Receive
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {filteredItems.length === 0 && !isLoading && (
                  <tr>
                    <td colSpan={11} className="py-12 text-center text-zinc-500 text-xs italic">
                      No inventory items found. Click "Add New Item" or "Load Blueprint Catalog" to start.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 5. Tab View: Transaction Logs (Audit Trail) */}
      {viewMode === 'history' && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <History size={16} className="text-emerald-400" />
              Stock Issue & Delivery History
            </h3>
            <span className="text-xs text-zinc-400">{transactions.length} recorded events</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-3 px-4">Date / Time</th>
                  <th className="py-3 px-4">Type</th>
                  <th className="py-3 px-4">Item</th>
                  <th className="py-3 px-4 text-right">Qty</th>
                  <th className="py-3 px-4">Recipient / Supplier</th>
                  <th className="py-3 px-4">Authorized By</th>
                  <th className="py-3 px-4">Purpose / Remarks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {transactions.map((tx: any, idx) => {
                  const isIssue = tx.type === 'issue';
                  return (
                    <tr key={tx.id || idx} className="hover:bg-zinc-800/40 transition-colors">
                      <td className="py-3 px-4 font-mono text-zinc-400">
                        {tx.timestamp ? format(parseISO(tx.timestamp), 'MMM d, HH:mm') : tx.date}
                      </td>
                      <td className="py-3 px-4">
                        <span className={cn(
                          "px-2 py-0.5 rounded text-[10px] font-bold uppercase",
                          isIssue ? "bg-amber-500/20 text-amber-400" : "bg-emerald-500/20 text-emerald-400"
                        )}>
                          {isIssue ? 'Issued' : 'Received'}
                        </span>
                      </td>
                      <td className="py-3 px-4 font-bold text-white">{tx.itemName}</td>
                      <td className="py-3 px-4 text-right font-mono font-bold">
                        {isIssue ? `-${tx.quantity}` : `+${tx.quantity}`} {tx.unit || ''}
                      </td>
                      <td className="py-3 px-4 text-zinc-300">
                        {isIssue ? tx.staffName : tx.supplier}
                      </td>
                      <td className="py-3 px-4 text-zinc-400">
                        {isIssue ? tx.issuedBy : tx.receivedBy}
                      </td>
                      <td className="py-3 px-4 text-zinc-400 italic">
                        {isIssue ? tx.purpose : (tx.remarks || tx.invoiceRef || '-')}
                      </td>
                    </tr>
                  );
                })}
                {transactions.length === 0 && (
                  <tr>
                    <td colSpan={7} className="py-8 text-center text-zinc-500 text-xs italic">
                      No stock movement transactions recorded yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* --- MODAL 1: ADD NEW ITEM (Section 7) --- */}
      {showAddItemModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleCreateNewItem} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <Package size={18} />
                <h3 className="text-lg font-bold text-white">Add New Inventory Item</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Item Name</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Lavender Room Spray"
                value={newItemForm.name}
                onChange={(e) => setNewItemForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Category</label>
                <select
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={newItemForm.category}
                  onChange={(e) => setNewItemForm(prev => ({ ...prev, category: e.target.value }))}
                >
                  <option value="Toiletries">Toiletries</option>
                  <option value="Beverages">Beverages</option>
                  <option value="Linen">Linen</option>
                  <option value="Cleaning Supplies">Cleaning Supplies</option>
                  <option value="Paper Goods">Paper Goods</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Unit of Measure</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  placeholder="e.g. pcs, bottles, packs, kg"
                  value={newItemForm.unit}
                  onChange={(e) => setNewItemForm(prev => ({ ...prev, unit: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Opening Stock</label>
                <input
                  type="number"
                  min="0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={newItemForm.openingStock}
                  onChange={(e) => setNewItemForm(prev => ({ ...prev, openingStock: parseInt(e.target.value, 10) || 0 }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Min. Alert Level</label>
                <input
                  type="number"
                  min="1"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={newItemForm.minStockLevel}
                  onChange={(e) => setNewItemForm(prev => ({ ...prev, minStockLevel: parseInt(e.target.value, 10) || 1 }))}
                />
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAddItemModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20"
              >
                Add Item
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 2: ISSUE STOCK (Section 9) --- */}
      {showIssueModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleIssueStock} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <ArrowUpRight size={18} />
                <h3 className="text-lg font-bold text-white">Issue Stock to Housekeeper</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Select Supply Item</label>
              <select
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={issueForm.itemId}
                onChange={(e) => setIssueForm(prev => ({ ...prev, itemId: e.target.value }))}
              >
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} (Current Balance: {item.balance} {item.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Housekeeper Name</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Mary or select from staff"
                list="staff-names"
                value={issueForm.staffName}
                onChange={(e) => setIssueForm(prev => ({ ...prev, staffName: e.target.value }))}
              />
              <datalist id="staff-names">
                {staff.map(s => (
                  <option key={s.uid} value={s.displayName || s.email} />
                ))}
              </datalist>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Quantity</label>
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={issueForm.quantity}
                  onChange={(e) => setIssueForm(prev => ({ ...prev, quantity: parseInt(e.target.value, 10) || 1 }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Issue Date</label>
                <input
                  required
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={issueForm.date}
                  onChange={(e) => setIssueForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Purpose / Target Floor</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. 2nd Floor Room Refresh"
                value={issueForm.purpose}
                onChange={(e) => setIssueForm(prev => ({ ...prev, purpose: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowIssueModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-xs font-bold"
              >
                Confirm Issue
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 3: RECEIVE STOCK (Section 10) --- */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleReceiveStock} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <ArrowDownLeft size={18} />
                <h3 className="text-lg font-bold text-white">Receive Stock Delivery</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Select Supply Item</label>
              <select
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={receiveForm.itemId}
                onChange={(e) => setReceiveForm(prev => ({ ...prev, itemId: e.target.value }))}
              >
                {items.map(item => (
                  <option key={item.id} value={item.id}>
                    {item.name} (Current Balance: {item.balance} {item.unit})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Vendor / Supplier</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Apex Hospitality Supplies"
                value={receiveForm.supplier}
                onChange={(e) => setReceiveForm(prev => ({ ...prev, supplier: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Quantity Received</label>
                <input
                  required
                  type="number"
                  min="1"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={receiveForm.quantity}
                  onChange={(e) => setReceiveForm(prev => ({ ...prev, quantity: parseInt(e.target.value, 10) || 1 }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Receipt Date</label>
                <input
                  required
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={receiveForm.date}
                  onChange={(e) => setReceiveForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Invoice / Delivery Ref #</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. INV-2026-8819"
                value={receiveForm.invoiceRef}
                onChange={(e) => setReceiveForm(prev => ({ ...prev, invoiceRef: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowReceiveModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Confirm Delivery
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
