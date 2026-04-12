import React, { useState } from 'react';
import { 
  Plus, Search, Filter, MoreHorizontal, Edit2, Trash2, 
  Package, Tag, Barcode, Layers, Building2, 
  AlertTriangle, CheckCircle2, XCircle, ChevronRight,
  Download, Upload, QrCode, TrendingUp
} from 'lucide-react';
import { InventoryItem, InventoryCategory, OperationType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../../utils';
import { format } from 'date-fns';
import { db, handleFirestoreError } from '../../firebase';
import { collection, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { toast } from 'sonner';

interface ItemMasterProps {
  items: InventoryItem[];
  categories: InventoryCategory[];
  defaultShowAddModal?: boolean;
  onModalClose?: () => void;
}

export function ItemMaster({ items, categories, defaultShowAddModal, onModalClose }: ItemMasterProps) {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [showAddModal, setShowAddModal] = useState(defaultShowAddModal || false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [loading, setLoading] = useState(false);

  // Sync modal state with prop
  React.useEffect(() => {
    if (defaultShowAddModal) {
      setShowAddModal(true);
    }
  }, [defaultShowAddModal]);

  const handleCloseModal = () => {
    setShowAddModal(false);
    setEditingItem(null);
    if (onModalClose) onModalClose();
  };

  const [formData, setFormData] = useState({
    sku: '',
    name: '',
    description: '',
    category: '',
    subcategory: '',
    unit: 'pcs',
    barcode: '',
    type: 'consumable' as InventoryItem['type'],
    department: '',
    quantity: 0,
    minThreshold: 5,
    maxThreshold: 100,
    price: 0,
    valuationMethod: 'WAC' as InventoryItem['valuationMethod'],
    status: 'active' as InventoryItem['status']
  });

  const filteredItems = items.filter(item => {
    const matchesSearch = item.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                         item.sku.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || item.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const generateSKU = () => {
    const prefix = formData.category.slice(0, 3).toUpperCase() || 'INV';
    const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
    setFormData(prev => ({ ...prev, sku: `${prefix}-${random}` }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    setLoading(true);

    try {
      const itemData = {
        ...formData,
        lastUpdated: new Date().toISOString()
      };

      if (editingItem) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'inventory', editingItem.id), itemData);
        toast.success('Item updated successfully');
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'inventory'), itemData);
        toast.success('Item created successfully');
      }

      handleCloseModal();
      setFormData({
        sku: '', name: '', description: '', category: '', subcategory: '',
        unit: 'pcs', barcode: '', type: 'consumable', department: '',
        quantity: 0, minThreshold: 5, maxThreshold: 100, price: 0,
        valuationMethod: 'WAC', status: 'active'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/inventory`);
      toast.error('Failed to save item');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!hotel?.id || !window.confirm('Are you sure you want to delete this item?')) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'inventory', id));
      toast.success('Item deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/inventory/${id}`);
      toast.error('Failed to delete item');
    }
  };

  return (
    <div className="space-y-6">
      {/* Actions Bar */}
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-zinc-900/50 p-4 rounded-3xl border border-zinc-800">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search by name or SKU..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-12 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 transition-all"
          />
        </div>
        <div className="flex items-center gap-3 w-full md:w-auto">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50"
          >
            <option value="all">All Categories</option>
            {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
          </select>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-3 rounded-2xl font-bold transition-all active:scale-95 whitespace-nowrap"
          >
            <Plus size={20} />
            Add New Item
          </button>
        </div>
      </div>

      {/* Items Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-950/50 text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Item Details</th>
                <th className="px-6 py-4">Category & Type</th>
                <th className="px-6 py-4">Stock Levels</th>
                <th className="px-6 py-4">Valuation</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredItems.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-800/30 transition-colors group">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400 group-hover:text-emerald-500 transition-colors">
                        <Package size={24} />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-white">{item.name}</div>
                        <div className="text-[10px] font-mono text-zinc-500 mt-0.5">SKU: {item.sku}</div>
                        {item.barcode && (
                          <div className="flex items-center gap-1 text-[10px] text-zinc-600 mt-1">
                            <Barcode size={12} />
                            {item.barcode}
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 bg-blue-500/10 text-blue-500 text-[10px] font-bold rounded uppercase">
                          {item.category}
                        </span>
                        {item.subcategory && (
                          <span className="text-zinc-600 text-[10px] font-bold uppercase">
                            / {item.subcategory}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-zinc-500 font-medium">
                        <Tag size={12} />
                        <span className="capitalize">{item.type}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-2">
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-sm font-bold",
                          item.quantity <= item.minThreshold ? "text-red-500" : "text-emerald-500"
                        )}>
                          {item.quantity}
                        </span>
                        <span className="text-[10px] text-zinc-500 font-medium uppercase">{item.unit}</span>
                      </div>
                      <div className="w-24 h-1 bg-zinc-800 rounded-full overflow-hidden">
                        <div 
                          className={cn(
                            "h-full rounded-full transition-all duration-500",
                            item.quantity <= item.minThreshold ? "bg-red-500" : "bg-emerald-500"
                          )}
                          style={{ width: `${Math.min(100, (item.quantity / (item.maxThreshold || 100)) * 100)}%` }}
                        />
                      </div>
                      <div className="text-[10px] text-zinc-600 font-bold uppercase tracking-tighter">
                        Min: {item.minThreshold} / Max: {item.maxThreshold || '-'}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="space-y-1">
                      <div className="text-sm font-bold text-white">
                        {formatCurrency(item.price, currency, exchangeRate)}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-medium uppercase">
                        Method: {item.valuationMethod}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5",
                      item.status === 'active' ? "bg-emerald-500/10 text-emerald-500" :
                      item.status === 'discontinued' ? "bg-red-500/10 text-red-500" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      {item.status === 'active' ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                      {item.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      <button 
                        onClick={() => {
                          setEditingItem(item);
                          setFormData({
                            sku: item.sku,
                            name: item.name,
                            description: item.description || '',
                            category: item.category,
                            subcategory: item.subcategory || '',
                            unit: item.unit,
                            barcode: item.barcode || '',
                            type: item.type,
                            department: item.department || '',
                            quantity: item.quantity,
                            minThreshold: item.minThreshold,
                            maxThreshold: item.maxThreshold,
                            price: item.price,
                            valuationMethod: item.valuationMethod,
                            status: item.status
                          });
                          setShowAddModal(true);
                        }}
                        className="p-2 text-zinc-400 hover:text-white hover:bg-zinc-800 rounded-xl transition-all"
                      >
                        <Edit2 size={18} />
                      </button>
                      <button 
                        onClick={() => handleDelete(item.id)}
                        className="p-2 text-zinc-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
                    <Package size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">{editingItem ? 'Edit Item' : 'Create New Item'}</h2>
                    <p className="text-sm text-zinc-500">Define item master details and stock parameters</p>
                  </div>
                </div>
                <button onClick={handleCloseModal} className="p-2 text-zinc-500 hover:text-white transition-colors">
                  <XCircle size={24} />
                </button>
              </div>

              <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-8">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  {/* Basic Info */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-emerald-500 mb-2">
                      <Layers size={18} />
                      <h3 className="text-sm font-bold uppercase tracking-widest">Basic Information</h3>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">SKU / Item ID</label>
                        <div className="relative">
                          <input
                            required
                            type="text"
                            value={formData.sku}
                            onChange={(e) => setFormData({ ...formData, sku: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                            placeholder="SKU-001"
                          />
                          <button
                            type="button"
                            onClick={generateSKU}
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-zinc-500 hover:text-emerald-500 transition-colors"
                            title="Generate SKU"
                          >
                            <QrCode size={18} />
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Barcode</label>
                        <div className="relative">
                          <Barcode className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                          <input
                            type="text"
                            value={formData.barcode}
                            onChange={(e) => setFormData({ ...formData, barcode: e.target.value })}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                            placeholder="EAN-13"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Item Name</label>
                      <input
                        required
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        placeholder="e.g. Luxury Bath Towel"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Category</label>
                        <select
                          required
                          value={formData.category}
                          onChange={(e) => setFormData({ ...formData, category: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="">Select Category</option>
                          {categories.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Subcategory</label>
                        <input
                          type="text"
                          value={formData.subcategory}
                          onChange={(e) => setFormData({ ...formData, subcategory: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                          placeholder="e.g. Linen"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Item Type</label>
                        <select
                          value={formData.type}
                          onChange={(e) => setFormData({ ...formData, type: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="consumable">Consumable</option>
                          <option value="non-consumable">Non-Consumable</option>
                          <option value="perishable">Perishable</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Unit of Measure</label>
                        <input
                          required
                          type="text"
                          value={formData.unit}
                          onChange={(e) => setFormData({ ...formData, unit: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                          placeholder="pcs, kg, liters"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Stock & Costing */}
                  <div className="space-y-6">
                    <div className="flex items-center gap-3 text-blue-500 mb-2">
                      <TrendingUp size={18} />
                      <h3 className="text-sm font-bold uppercase tracking-widest">Stock & Costing</h3>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Initial Quantity</label>
                        <input
                          required
                          type="number"
                          value={formData.quantity}
                          onChange={(e) => setFormData({ ...formData, quantity: parseInt(e.target.value) })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Unit Cost ({currency})</label>
                        <input
                          required
                          type="number"
                          step="0.01"
                          value={formData.price}
                          onChange={(e) => setFormData({ ...formData, price: parseFloat(e.target.value) })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Min Threshold (Reorder)</label>
                        <input
                          required
                          type="number"
                          value={formData.minThreshold}
                          onChange={(e) => setFormData({ ...formData, minThreshold: parseInt(e.target.value) })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Max Threshold</label>
                        <input
                          type="number"
                          value={formData.maxThreshold}
                          onChange={(e) => setFormData({ ...formData, maxThreshold: parseInt(e.target.value) })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Valuation Method</label>
                        <select
                          value={formData.valuationMethod}
                          onChange={(e) => setFormData({ ...formData, valuationMethod: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="WAC">Weighted Average (WAC)</option>
                          <option value="FIFO">First In First Out (FIFO)</option>
                          <option value="LIFO">Last In First Out (LIFO)</option>
                        </select>
                      </div>
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Status</label>
                        <select
                          value={formData.status}
                          onChange={(e) => setFormData({ ...formData, status: e.target.value as any })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                        >
                          <option value="active">Active</option>
                          <option value="discontinued">Discontinued</option>
                          <option value="out_of_stock">Out of Stock</option>
                        </select>
                      </div>
                    </div>

                    <div className="space-y-2">
                      <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Department</label>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                        <input
                          type="text"
                          value={formData.department}
                          onChange={(e) => setFormData({ ...formData, department: e.target.value })}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl pl-10 pr-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                          placeholder="e.g. Housekeeping, Kitchen"
                        />
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-8 space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Description</label>
                  <textarea
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-3xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 min-h-[100px]"
                    placeholder="Enter item description, usage instructions, or storage requirements..."
                  />
                </div>
              </form>

              <div className="p-8 bg-zinc-950 border-t border-zinc-800 flex gap-4">
                <button
                  type="button"
                  onClick={handleCloseModal}
                  className="flex-1 px-6 py-4 bg-zinc-900 text-zinc-400 rounded-2xl font-bold hover:bg-zinc-800 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="flex-[2] px-6 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:scale-100 flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  ) : (
                    <CheckCircle2 size={20} />
                  )}
                  {editingItem ? 'Update Item Master' : 'Create Item Master'}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
