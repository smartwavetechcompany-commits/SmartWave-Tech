import React, { useState } from 'react';
import { 
  ArrowUpRight, ArrowDownRight, MoveHorizontal, 
  History, Search, Filter, Plus, 
  Package, Building2, User, Clock,
  CheckCircle2, XCircle, AlertCircle,
  TrendingUp, TrendingDown, RefreshCw
} from 'lucide-react';
import { InventoryItem, InventoryTransaction, InventoryLocation, OperationType } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../../utils';
import { format } from 'date-fns';
import { db, handleFirestoreError } from '../../firebase';
import { collection, addDoc, updateDoc, doc, increment } from 'firebase/firestore';
import { toast } from 'sonner';

interface StockMovementsProps {
  items: InventoryItem[];
  transactions: InventoryTransaction[];
  locations: InventoryLocation[];
}

export function StockMovements({ items, transactions, locations }: StockMovementsProps) {
  const { hotel, profile } = useAuth();
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  const [moveForm, setMoveForm] = useState({
    type: 'consumption' as InventoryTransaction['type'],
    itemId: '',
    quantity: 1,
    fromLocationId: '',
    toLocationId: '',
    department: '',
    reason: ''
  });

  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    
    const item = items.find(i => i.id === moveForm.itemId);
    if (!item) return;

    if (['stock_out', 'transfer', 'consumption'].includes(moveForm.type) && item.quantity < moveForm.quantity) {
      toast.error('Insufficient stock for this operation');
      return;
    }

    setLoading(true);
    try {
      const quantityChange = ['stock_in', 'return'].includes(moveForm.type) ? moveForm.quantity : -moveForm.quantity;

      // Update Item Quantity
      await updateDoc(doc(db, 'hotels', hotel.id, 'inventory', moveForm.itemId), {
        quantity: increment(quantityChange),
        lastUpdated: new Date().toISOString()
      });

      // Record Transaction
      await addDoc(collection(db, 'hotels', hotel.id, 'inventory_transactions'), {
        ...moveForm,
        userId: profile.uid,
        timestamp: new Date().toISOString()
      });

      toast.success('Stock movement recorded successfully');
      setShowMoveModal(false);
      setMoveForm({ type: 'consumption', itemId: '', quantity: 1, fromLocationId: '', toLocationId: '', department: '', reason: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/inventory_transactions`);
    } finally {
      setLoading(false);
    }
  };

  const filteredTransactions = transactions.filter(tx => {
    const item = items.find(i => i.id === tx.itemId);
    return item?.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
           tx.type.toLowerCase().includes(searchQuery.toLowerCase()) ||
           tx.department?.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">Stock Movements</h3>
          <p className="text-sm text-zinc-500">Track all inventory ins, outs, and transfers</p>
        </div>
        <button
          onClick={() => setShowMoveModal(true)}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-6 py-2.5 rounded-xl font-bold transition-all active:scale-95"
        >
          <Plus size={18} />
          Record Movement
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
          <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {transactions.filter(t => t.type === 'stock_in').length}
            </div>
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Total Stock-In</div>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
          <div className="w-12 h-12 bg-red-500/10 rounded-2xl flex items-center justify-center text-red-500">
            <TrendingDown size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {transactions.filter(t => t.type === 'consumption' || t.type === 'stock_out').length}
            </div>
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Total Consumption</div>
          </div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
          <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500">
            <RefreshCw size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">
              {transactions.filter(t => t.type === 'transfer').length}
            </div>
            <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest">Internal Transfers</div>
          </div>
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl overflow-hidden">
        <div className="p-4 border-b border-zinc-800 bg-zinc-950/50 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input
              type="text"
              placeholder="Filter transactions..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800 bg-zinc-950/30">
                <th className="px-6 py-4">Date & Time</th>
                <th className="px-6 py-4">Item</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Quantity</th>
                <th className="px-6 py-4">Dept / Reason</th>
                <th className="px-6 py-4">User</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredTransactions.map((tx) => {
                const item = items.find(i => i.id === tx.itemId);
                return (
                  <tr key={tx.id} className="hover:bg-zinc-800/30 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-xs text-zinc-400 font-medium">{format(new Date(tx.timestamp), 'MMM d, HH:mm')}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-sm font-bold text-white">{item?.name || 'Unknown Item'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider inline-flex items-center gap-1.5",
                        tx.type === 'stock_in' ? "bg-emerald-500/10 text-emerald-500" :
                        tx.type === 'stock_out' || tx.type === 'consumption' ? "bg-red-500/10 text-red-500" :
                        "bg-blue-500/10 text-blue-500"
                      )}>
                        {tx.type === 'stock_in' ? <ArrowUpRight size={12} /> : 
                         tx.type === 'stock_out' || tx.type === 'consumption' ? <ArrowDownRight size={12} /> : 
                         <MoveHorizontal size={12} />}
                        {tx.type.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className={cn(
                        "text-sm font-bold",
                        ['stock_in', 'return'].includes(tx.type) ? "text-emerald-500" : "text-red-500"
                      )}>
                        {['stock_in', 'return'].includes(tx.type) ? '+' : '-'}{tx.quantity}
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="text-xs text-zinc-300">{tx.department || '-'}</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">{tx.reason || 'No reason provided'}</div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <User size={12} />
                        {tx.userId.slice(-6)}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movement Modal */}
      <AnimatePresence>
        {showMoveModal && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-md overflow-hidden"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white">Record Movement</h2>
                <button onClick={() => setShowMoveModal(false)} className="p-2 text-zinc-500 hover:text-white transition-colors">
                  <XCircle size={24} />
                </button>
              </div>
              <form onSubmit={handleMove} className="p-8 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Movement Type</label>
                  <select
                    required
                    value={moveForm.type}
                    onChange={(e) => setMoveForm({ ...moveForm, type: e.target.value as any })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="consumption">Consumption (Usage)</option>
                    <option value="stock_out">Stock Out (Issue)</option>
                    <option value="stock_in">Stock In (Manual)</option>
                    <option value="transfer">Internal Transfer</option>
                    <option value="return">Return to Store</option>
                    <option value="adjustment">Adjustment</option>
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Select Item</label>
                  <select
                    required
                    value={moveForm.itemId}
                    onChange={(e) => setMoveForm({ ...moveForm, itemId: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                  >
                    <option value="">Select Item</option>
                    {items.map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit} available)</option>)}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Quantity</label>
                    <input
                      required
                      type="number"
                      min="1"
                      value={moveForm.quantity}
                      onChange={(e) => setMoveForm({ ...moveForm, quantity: parseInt(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Department</label>
                    <input
                      type="text"
                      value={moveForm.department}
                      onChange={(e) => setMoveForm({ ...moveForm, department: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g. Housekeeping"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase ml-1">Reason / Notes</label>
                  <textarea
                    required
                    value={moveForm.reason}
                    onChange={(e) => setMoveForm({ ...moveForm, reason: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-2xl px-4 py-3 text-white focus:outline-none focus:border-emerald-500/50 min-h-[80px]"
                    placeholder="Why is this movement being recorded?"
                  />
                </div>

                <div className="pt-4 flex gap-4">
                  <button
                    type="button"
                    onClick={() => setShowMoveModal(false)}
                    className="flex-1 py-4 bg-zinc-800 text-zinc-400 rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={loading}
                    className="flex-1 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
                  >
                    Record
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
