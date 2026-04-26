import React, { useState } from 'react';
import { 
  ShoppingCart, Users, FileText, Plus, Search, 
  Filter, MoreHorizontal, Edit2, Trash2, 
  CheckCircle2, XCircle, Clock, Truck, 
  DollarSign, Calendar, Building2, ChevronRight,
  Package, AlertCircle, Download
} from 'lucide-react';
import { InventoryVendor, PurchaseOrder, InventoryItem, OperationType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../../utils';
import { format } from 'date-fns';
import { db, handleFirestoreError, serverTimestamp, safeWrite, safeAdd } from '../../firebase';
import { collection, doc, increment } from 'firebase/firestore';
import { toast } from 'sonner';

interface ProcurementProps {
  vendors: InventoryVendor[];
  purchaseOrders: PurchaseOrder[];
  items: InventoryItem[];
}

export function Procurement({ vendors, purchaseOrders, items }: ProcurementProps) {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [activeTab, setActiveTab] = useState<'po' | 'vendors'>('po');
  const [showAddVendor, setShowAddVendor] = useState(false);
  const [showAddPO, setShowAddPO] = useState(false);
  const [loading, setLoading] = useState(false);

  // Vendor Form State
  const [vendorForm, setVendorForm] = useState({
    name: '',
    email: '',
    phone: '',
    address: '',
    category: '',
    pricingAgreements: '',
    status: 'active' as InventoryVendor['status']
  });

  // PO Form State
  const [poForm, setPoForm] = useState({
    supplierId: '',
    items: [] as { itemId: string; quantity: number; unitPrice: number; total: number }[],
    dueDate: format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd'),
    notes: ''
  });

  const handleSaveVendor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;
    setLoading(true);
    try {
      await safeAdd(collection(db, 'hotels', hotel.id, 'inventory_vendors'), {
        ...vendorForm,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      }, hotel.id, 'CREATE_INVENTORY_VENDOR');
      toast.success('Vendor added successfully');
      setShowAddVendor(false);
      setVendorForm({ name: '', email: '', phone: '', address: '', category: '', pricingAgreements: '', status: 'active' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/inventory_vendors`);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePO = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    if (poForm.items.length === 0) {
      toast.error('Please add at least one item to the PO');
      return;
    }

    setLoading(true);
    try {
      const totalAmount = poForm.items.reduce((acc, item) => acc + item.total, 0);
      const poNumber = `PO-${Date.now().toString().slice(-6)}`;

      await safeAdd(collection(db, 'hotels', hotel.id, 'purchase_orders'), {
        poNumber,
        supplierId: poForm.supplierId,
        items: poForm.items.map(i => ({ ...i, receivedQuantity: 0 })),
        totalAmount,
        status: 'pending',
        paymentStatus: 'unpaid',
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        dueDate: poForm.dueDate,
        notes: poForm.notes,
        createdBy: profile.uid
      }, hotel.id, 'CREATE_INVENTORY_PO');

      toast.success('Purchase Order created successfully');
      setShowAddPO(false);
      setPoForm({ supplierId: '', items: [], dueDate: format(new Date(Date.now() + 7 * 86400000), 'yyyy-MM-dd'), notes: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/purchase_orders`);
    } finally {
      setLoading(false);
    }
  };

  const updatePOStatus = async (po: PurchaseOrder, newStatus: PurchaseOrder['status']) => {
    if (!hotel?.id) return;
    try {
      await safeWrite(doc(db, 'hotels', hotel.id, 'purchase_orders', po.id), {
        status: newStatus,
        approvedBy: newStatus === 'approved' ? profile?.uid : undefined,
        updatedAt: serverTimestamp()
      }, hotel.id, 'UPDATE_INVENTORY_PO_STATUS');
      toast.success(`PO status updated to ${newStatus}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/purchase_orders/${po.id}`);
    }
  };

  const receivePO = async (po: PurchaseOrder) => {
    if (!hotel?.id || !profile) return;
    try {
      // In a real app, this would be a GRN (Goods Receipt Note)
      // For simplicity, we'll just update the inventory quantities directly
      for (const item of po.items) {
        const invDoc = doc(db, 'hotels', hotel.id, 'inventory', item.itemId);
        await safeWrite(invDoc, {
          quantity: increment(item.quantity),
          lastUpdated: serverTimestamp(),
          updatedAt: serverTimestamp()
        }, hotel.id, 'RECEIVE_PO_ITEM_UPDATE');

        // Log transaction
        await safeAdd(collection(db, 'hotels', hotel.id, 'inventory_transactions'), {
          type: 'stock_in',
          itemId: item.itemId,
          quantity: item.quantity,
          userId: profile.uid,
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          referenceId: po.id,
          reason: `Received from PO: ${po.poNumber}`
        }, hotel.id, 'RECEIVE_PO_TRANSACTION');
      }

      await safeWrite(doc(db, 'hotels', hotel.id, 'purchase_orders', po.id), {
        status: 'received',
        items: po.items.map(i => ({ ...i, receivedQuantity: i.quantity })),
        updatedAt: serverTimestamp()
      }, hotel.id, 'RECEIVE_PO_STATUS_COMPLETE');

      toast.success('Inventory updated and PO marked as received');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/purchase_orders/${po.id}`);
    }
  };

  return (
    <div className="space-y-6">
      {/* Tabs */}
      <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-2xl w-fit">
        <button
          onClick={() => setActiveTab('po')}
          className={cn(
            "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
            activeTab === 'po' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <ShoppingCart size={18} />
          Purchase Orders
        </button>
        <button
          onClick={() => setActiveTab('vendors')}
          className={cn(
            "px-6 py-2.5 rounded-xl text-sm font-bold transition-all flex items-center gap-2",
            activeTab === 'vendors' ? "bg-zinc-800 text-white shadow-lg" : "text-zinc-500 hover:text-zinc-300"
          )}
        >
          <Users size={18} />
          Vendors
        </button>
      </div>

      {activeTab === 'po' ? (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-white">Purchase Orders</h3>
            <button
              onClick={() => setShowAddPO(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-2.5 rounded-xl font-bold transition-all active:scale-95"
            >
              <Plus size={18} />
              New PO
            </button>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {purchaseOrders.map((po) => {
              const vendor = vendors.find(v => v.id === po.supplierId);
              return (
                <div key={po.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-zinc-700 transition-all group">
                  <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div className={cn(
                        "w-12 h-12 rounded-2xl flex items-center justify-center",
                        po.status === 'received' ? "bg-emerald-500/10 text-emerald-500" :
                        po.status === 'pending' ? "bg-amber-500/10 text-amber-500" :
                        "bg-blue-500/10 text-blue-500"
                      )}>
                        <FileText size={24} />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="text-lg font-bold text-white">{po.poNumber}</span>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                            po.status === 'received' ? "bg-emerald-500/10 text-emerald-500" :
                            po.status === 'pending' ? "bg-amber-500/10 text-amber-500" :
                            "bg-blue-500/10 text-blue-500"
                          )}>
                            {po.status}
                          </span>
                        </div>
                        <div className="text-sm text-zinc-500 font-medium mt-0.5">
                          {vendor?.name || 'Unknown Vendor'} • {format(new Date(po.timestamp), 'MMM d, yyyy')}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-8 items-center">
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Items</div>
                        <div className="text-sm font-bold text-white">{po.items.length} SKUs</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Total Amount</div>
                        <div className="text-sm font-bold text-emerald-500">{formatCurrency(po.totalAmount, currency, exchangeRate)}</div>
                      </div>
                      <div className="text-center">
                        <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Due Date</div>
                        <div className="text-sm font-bold text-zinc-300">{po.dueDate ? format(new Date(po.dueDate), 'MMM d') : '-'}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 w-full lg:w-auto">
                      {po.status === 'pending' && (
                        <button
                          onClick={() => updatePOStatus(po, 'approved')}
                          className="flex-1 lg:flex-none px-4 py-2 bg-blue-500 text-black rounded-xl font-bold text-sm hover:bg-blue-400 transition-all"
                        >
                          Approve
                        </button>
                      )}
                      {po.status === 'approved' && (
                        <button
                          onClick={() => receivePO(po)}
                          className="flex-1 lg:flex-none px-4 py-2 bg-emerald-500 text-black rounded-xl font-bold text-sm hover:bg-emerald-400 transition-all"
                        >
                          Receive Goods
                        </button>
                      )}
                      <button className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-xl transition-all">
                        <MoreHorizontal size={20} />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h3 className="text-xl font-bold text-white">Inventory Vendors</h3>
            <button
              onClick={() => setShowAddVendor(true)}
              className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-2.5 rounded-xl font-bold transition-all active:scale-95"
            >
              <Plus size={18} />
              Add Vendor
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {vendors.map((vendor) => (
              <div key={vendor.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-zinc-700 transition-all">
                <div className="flex items-start justify-between mb-6">
                  <div className="w-12 h-12 bg-zinc-800 rounded-2xl flex items-center justify-center text-zinc-400">
                    <Building2 size={24} />
                  </div>
                  <span className={cn(
                    "px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider",
                    vendor.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                  )}>
                    {vendor.status}
                  </span>
                </div>
                <h4 className="text-lg font-bold text-white mb-1">{vendor.name}</h4>
                <p className="text-sm text-zinc-500 mb-4">{vendor.category || 'General Supplier'}</p>
                
                <div className="space-y-3 mb-6">
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <FileText size={14} className="text-zinc-600" />
                    {vendor.email || 'No email'}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-zinc-400">
                    <Truck size={14} className="text-zinc-600" />
                    {vendor.phone || 'No phone'}
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-xs font-bold text-zinc-500 uppercase tracking-widest">Performance</div>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map(star => (
                      <div key={star} className={cn(
                        "w-1.5 h-1.5 rounded-full",
                        star <= (vendor.rating || 0) ? "bg-amber-500" : "bg-zinc-800"
                      )} />
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Add Vendor Modal */}
      <AnimatePresence>
        {showAddVendor && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Add Vendor</h2>
                <button onClick={() => setShowAddVendor(false)} className="p-2 text-zinc-500 hover:text-white transition-colors">
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleSaveVendor} className="p-8 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Vendor Name</label>
                  <input
                    required
                    type="text"
                    value={vendorForm.name}
                    onChange={(e) => setVendorForm({ ...vendorForm, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Email</label>
                    <input
                      type="email"
                      value={vendorForm.email}
                      onChange={(e) => setVendorForm({ ...vendorForm, email: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Phone</label>
                    <input
                      type="text"
                      value={vendorForm.phone}
                      onChange={(e) => setVendorForm({ ...vendorForm, phone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Category</label>
                  <input
                    type="text"
                    value={vendorForm.category}
                    onChange={(e) => setVendorForm({ ...vendorForm, category: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="e.g. Food & Beverage, Linen"
                  />
                </div>
                <div className="pt-4 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowAddVendor(false)}
                    className="flex-1 py-4 bg-zinc-800 text-zinc-400 rounded-2xl font-bold hover:bg-zinc-700 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
                  >
                    Save Vendor
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Add PO Modal */}
      <AnimatePresence>
        {showAddPO && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Create Purchase Order</h2>
                <button onClick={() => setShowAddPO(false)} className="p-2 text-zinc-500 hover:text-white transition-colors">
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleSavePO} className="flex-1 overflow-y-auto p-8 space-y-6">
                <div className="grid grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Select Vendor</label>
                    <select
                      required
                      value={poForm.supplierId}
                      onChange={(e) => setPoForm({ ...poForm, supplierId: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select Vendor</option>
                      {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Expected Delivery Date</label>
                    <input
                      required
                      type="date"
                      value={poForm.dueDate}
                      onChange={(e) => setPoForm({ ...poForm, dueDate: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-zinc-500 uppercase tracking-widest">Order Items</h3>
                    <button
                      type="button"
                      onClick={() => setPoForm({
                        ...poForm,
                        items: [...poForm.items, { itemId: '', quantity: 1, unitPrice: 0, total: 0 }]
                      })}
                      className="text-xs font-bold text-emerald-500 hover:underline"
                    >
                      + Add Item
                    </button>
                  </div>

                  <div className="space-y-3">
                    {poForm.items.map((item, index) => (
                      <div key={index} className="grid grid-cols-12 gap-3 items-end bg-zinc-950 p-4 rounded-2xl border border-zinc-800">
                        <div className="col-span-5 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Item</label>
                          <select
                            required
                            value={item.itemId}
                            onChange={(e) => {
                              const selectedItem = items.find(i => i.id === e.target.value);
                              const newItems = [...poForm.items];
                              newItems[index] = { 
                                ...item, 
                                itemId: e.target.value,
                                unitPrice: selectedItem?.price || 0,
                                total: (selectedItem?.price || 0) * item.quantity
                              };
                              setPoForm({ ...poForm, items: newItems });
                            }}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                          >
                            <option value="">Select Item</option>
                            {items.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
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
                              const qty = parseInt(e.target.value);
                              const newItems = [...poForm.items];
                              newItems[index] = { ...item, quantity: qty, total: qty * item.unitPrice };
                              setPoForm({ ...poForm, items: newItems });
                            }}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Price</label>
                          <input
                            required
                            type="number"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => {
                              const price = parseFloat(e.target.value);
                              const newItems = [...poForm.items];
                              newItems[index] = { ...item, unitPrice: price, total: price * item.quantity };
                              setPoForm({ ...poForm, items: newItems });
                            }}
                            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none"
                          />
                        </div>
                        <div className="col-span-2 space-y-1">
                          <label className="text-[10px] font-bold text-zinc-600 uppercase">Total</label>
                          <div className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-zinc-400">
                            {formatCurrency(item.total, currency, exchangeRate)}
                          </div>
                        </div>
                        <div className="col-span-1">
                          <button
                            type="button"
                            onClick={() => {
                              const newItems = poForm.items.filter((_, i) => i !== index);
                              setPoForm({ ...poForm, items: newItems });
                            }}
                            className="p-2 text-zinc-600 hover:text-red-500 transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Notes / Special Instructions</label>
                  <textarea
                    value={poForm.notes}
                    onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]"
                    placeholder="Enter any specific delivery instructions..."
                  />
                </div>
              </form>
              <div className="p-8 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                <div>
                  <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Grand Total</div>
                  <div className="text-2xl font-bold text-emerald-500">
                    {formatCurrency(poForm.items.reduce((acc, i) => acc + i.total, 0), currency, exchangeRate)}
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowAddPO(false)}
                    className="px-8 py-4 bg-zinc-900 text-zinc-400 rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSavePO}
                    disabled={loading}
                    className="px-8 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <CheckCircle2 size={20} />}
                    Create Order
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
