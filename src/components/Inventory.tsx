import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, addDoc, updateDoc, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { InventoryItem, OperationType } from '../types';
import { Package, Plus, Search, Filter, AlertTriangle, History, ArrowUp, ArrowDown, Trash2, Edit2, MoreHorizontal, ChevronRight, Box, ShoppingCart, Download } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, exportToCSV } from '../utils';
import { format } from 'date-fns';
import { createNotification } from './Notifications';
import { toast } from 'sonner';

export function Inventory() {
  const { hotel, profile } = useAuth();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<'all' | 'food' | 'drink' | 'cleaning' | 'other'>('all');
  const [newItem, setNewItem] = useState({
    name: '',
    category: 'food' as InventoryItem['category'],
    quantity: 0,
    unit: 'pcs',
    minThreshold: 5
  });

  const [showConfirmDelete, setShowConfirmDelete] = useState<InventoryItem | null>(null);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = collection(db, 'hotels', hotel.id, 'inventory');
    
    const unsub = onSnapshot(q, (snap) => {
      const newItems = snap.docs
        .map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem))
        .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setItems(newItems);

      // Check for low stock and notify
      newItems.forEach(item => {
        if (item.quantity <= item.minThreshold) {
          createNotification(hotel.id, {
            title: 'Low Stock Alert',
            message: `${item.name} is low on stock (${item.quantity} ${item.unit} remaining).`,
            type: 'warning',
            userId: 'all'
          });
        }
      });
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/inventory`);
      if (error.code === 'permission-denied') setHasPermissionError(true);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    try {
      if (editingItem) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'inventory', editingItem.id), {
          ...newItem,
          lastUpdated: new Date().toISOString()
        });
        toast.success('Inventory item updated');
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'inventory'), {
          ...newItem,
          lastUpdated: new Date().toISOString()
        });
        toast.success('Inventory item created');
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: editingItem ? 'INVENTORY_ITEM_UPDATED' : 'INVENTORY_ITEM_CREATED',
        resource: `${newItem.name} (${newItem.quantity} ${newItem.unit})`,
        hotelId: hotel.id,
        module: 'Inventory'
      });

      setShowAddModal(false);
      setEditingItem(null);
      setNewItem({ name: '', category: 'food', quantity: 0, unit: 'pcs', minThreshold: 5 });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/inventory`);
      toast.error('Failed to save item');
    }
  };

  const adjustQuantity = async (item: InventoryItem, amount: number) => {
    if (!hotel?.id) return;
    const newQty = Math.max(0, item.quantity + amount);
    try {
      await updateDoc(doc(db, 'hotels', hotel.id, 'inventory', item.id), {
        quantity: newQty,
        lastUpdated: new Date().toISOString()
      });
      toast.success(`Quantity adjusted for ${item.name}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/inventory/${item.id}`);
      toast.error('Failed to adjust quantity');
    }
  };

  const deleteItem = async (itemId: string) => {
    if (!hotel?.id) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'inventory', itemId));
      toast.success('Item deleted');
      setShowConfirmDelete(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/inventory/${itemId}`);
      toast.error('Failed to delete item');
    }
  };

  const filteredItems = items.filter(item => {
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    const matchesSearch = (item.name?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    return matchesCategory && matchesSearch;
  });

  const lowStockItems = items.filter(i => i.quantity <= i.minThreshold);

  const handleExport = () => {
    const dataToExport = items.map(item => ({
      Name: item.name,
      Category: item.category,
      Quantity: item.quantity,
      Unit: item.unit,
      MinThreshold: item.minThreshold,
      LastUpdated: item.lastUpdated ? format(new Date(item.lastUpdated), 'yyyy-MM-dd HH:mm') : 'N/A'
    }));
    exportToCSV(dataToExport, `inventory_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Inventory exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <ConfirmModal
        isOpen={!!showConfirmDelete}
        title="Delete Inventory Item"
        message={`Are you sure you want to delete ${showConfirmDelete?.name}? This action cannot be undone.`}
        onConfirm={() => showConfirmDelete && deleteItem(showConfirmDelete.id)}
        onCancel={() => setShowConfirmDelete(null)}
        type="danger"
        confirmText="Delete Item"
      />

      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Inventory Management</h1>
          <p className="text-zinc-400">Manage supplies, food, and beverage stock</p>
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
            onClick={() => {
              setEditingItem(null);
              setNewItem({ name: '', category: 'food', quantity: 0, unit: 'pcs', minThreshold: 5 });
              setShowAddModal(true);
            }}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            Add Item
          </button>
        </div>
      </div>

      {lowStockItems.length > 0 && (
        <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-2xl flex items-center gap-4">
          <div className="w-10 h-10 bg-red-500/20 rounded-xl flex items-center justify-center text-red-500">
            <AlertTriangle size={20} />
          </div>
          <div>
            <h3 className="text-sm font-bold text-red-500">Low Stock Alert</h3>
            <p className="text-xs text-red-500/70">{lowStockItems.length} items are below their minimum threshold.</p>
          </div>
          <button className="ml-auto text-xs font-bold text-red-500 hover:underline">View Items</button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Items</div>
          <div className="text-2xl font-bold text-white">{items.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Low Stock</div>
          <div className="text-2xl font-bold text-red-500">{lowStockItems.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Food & Bev</div>
          <div className="text-2xl font-bold text-blue-500">{items.filter(i => i.category === 'food' || i.category === 'drink').length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Cleaning Supplies</div>
          <div className="text-2xl font-bold text-emerald-500">{items.filter(i => i.category === 'cleaning').length}</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search inventory..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl w-full md:w-auto overflow-x-auto">
          {(['all', 'food', 'drink', 'cleaning', 'other'] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCategoryFilter(c)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                categoryFilter === c ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <table className="w-full text-left">
          <thead>
            <tr className="bg-zinc-950 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              <th className="px-6 py-4">Item Name</th>
              <th className="px-6 py-4">Category</th>
              <th className="px-6 py-4">Quantity</th>
              <th className="px-6 py-4">Status</th>
              <th className="px-6 py-4">Last Updated</th>
              <th className="px-6 py-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-800">
            {filteredItems.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-6 py-12 text-center text-zinc-500">
                  <Package size={48} className="mx-auto text-zinc-700 mb-4" />
                  <p>No items found</p>
                </td>
              </tr>
            ) : (
              filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-800/50 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-white">{item.name}</div>
                  </td>
                  <td className="px-6 py-4">
                    <span className="px-2 py-1 bg-zinc-800 rounded text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      {item.category}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={() => adjustQuantity(item, -1)}
                        className="p-1 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-all"
                      >
                        <ArrowDown size={14} />
                      </button>
                      <div className="text-sm font-bold text-white w-12 text-center">
                        {item.quantity} <span className="text-[10px] text-zinc-500 font-normal">{item.unit}</span>
                      </div>
                      <button 
                        onClick={() => adjustQuantity(item, 1)}
                        className="p-1 text-zinc-500 hover:text-emerald-500 hover:bg-emerald-500/10 rounded transition-all"
                      >
                        <ArrowUp size={14} />
                      </button>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    {item.quantity <= item.minThreshold ? (
                      <span className="flex items-center gap-1 text-[10px] font-bold text-red-500 uppercase tracking-wider">
                        <AlertTriangle size={12} />
                        Low Stock
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">
                        In Stock
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-xs text-zinc-500">
                    {format(new Date(item.lastUpdated), 'MMM d, HH:mm')}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          setNewItem({ ...item });
                          setShowAddModal(true);
                        }}
                        className="p-2 text-zinc-500 hover:text-white rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => setShowConfirmDelete(item)}
                        className="p-2 text-zinc-500 hover:text-red-500 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">{editingItem ? 'Edit Item' : 'Add Inventory Item'}</h2>
            </div>
            <form onSubmit={handleSaveItem}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Item Name</label>
                  <input
                    required
                    type="text"
                    value={newItem.name}
                    onChange={(e) => setNewItem({ ...newItem, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. Bed Sheets"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Category</label>
                    <select
                      value={newItem.category}
                      onChange={(e) => setNewItem({ ...newItem, category: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="food">Food</option>
                      <option value="drink">Drink</option>
                      <option value="cleaning">Cleaning</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Unit</label>
                    <input
                      required
                      type="text"
                      value={newItem.unit}
                      onChange={(e) => setNewItem({ ...newItem, unit: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g. pcs, kg, liters"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Initial Quantity</label>
                    <input
                      required
                      type="number"
                      value={newItem.quantity}
                      onChange={(e) => setNewItem({ ...newItem, quantity: parseInt(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Min Threshold</label>
                    <input
                      required
                      type="number"
                      value={newItem.minThreshold}
                      onChange={(e) => setNewItem({ ...newItem, minThreshold: parseInt(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
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
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
                >
                  {editingItem ? 'Update Item' : 'Add Item'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
