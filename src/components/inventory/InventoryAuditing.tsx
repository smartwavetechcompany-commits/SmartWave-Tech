import React, { useState } from 'react';
import { 
  ClipboardCheck, Search, Filter, Plus, 
  Package, User, Clock, CheckCircle2, 
  XCircle, AlertTriangle, Save, History,
  ArrowRight, FileText, Barcode
} from 'lucide-react';
import { InventoryItem, InventoryAudit, OperationType, InventoryLocation } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../utils';
import { format } from 'date-fns';
import { db, handleFirestoreError } from '../../firebase';
import { collection, addDoc, updateDoc, doc } from 'firebase/firestore';
import { toast } from 'sonner';

interface InventoryAuditingProps {
  items: InventoryItem[];
  audits: InventoryAudit[];
  locations: InventoryLocation[];
}

export function InventoryAuditing({ items, audits, locations }: InventoryAuditingProps) {
  const { hotel, profile } = useAuth();
  const [showAuditModal, setShowAuditModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeAudit, setActiveAudit] = useState<{
    locationId: string;
    items: { itemId: string; systemQty: number; physicalQty: number; reason: string }[];
  } | null>(null);

  const startNewAudit = (locationId: string) => {
    const auditItems = items.map(item => ({
      itemId: item.id,
      systemQty: item.quantity,
      physicalQty: item.quantity,
      reason: ''
    }));
    setActiveAudit({ locationId, items: auditItems });
    setShowAuditModal(true);
  };

  const handleSaveAudit = async () => {
    if (!hotel?.id || !profile || !activeAudit) return;
    setLoading(true);
    try {
      const auditData: Omit<InventoryAudit, 'id'> = {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        locationId: activeAudit.locationId,
        status: 'completed',
        items: activeAudit.items.map(i => ({
          ...i,
          variance: i.physicalQty - i.systemQty
        }))
      };

      // Record the audit
      await addDoc(collection(db, 'hotels', hotel.id, 'inventory_audits'), auditData);

      // Update inventory quantities based on audit
      for (const auditItem of activeAudit.items) {
        if (auditItem.physicalQty !== auditItem.systemQty) {
          await updateDoc(doc(db, 'hotels', hotel.id, 'inventory', auditItem.itemId), {
            quantity: auditItem.physicalQty,
            lastUpdated: new Date().toISOString()
          });

          // Record adjustment transaction
          await addDoc(collection(db, 'hotels', hotel.id, 'inventory_transactions'), {
            type: 'adjustment',
            itemId: auditItem.itemId,
            quantity: Math.abs(auditItem.physicalQty - auditItem.systemQty),
            userId: profile.uid,
            timestamp: new Date().toISOString(),
            reason: `Audit Adjustment: ${auditItem.reason || 'Variance found during physical count'}`
          });
        }
      }

      toast.success('Inventory audit completed and stock levels adjusted');
      setShowAuditModal(false);
      setActiveAudit(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/inventory_audits`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-xl font-bold text-white">Inventory Auditing</h3>
          <p className="text-sm text-zinc-500">Perform physical stock counts and track variances</p>
        </div>
        <div className="flex gap-3">
          <select
            onChange={(e) => e.target.value && startNewAudit(e.target.value)}
            className="bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
          >
            <option value="">Start New Audit...</option>
            {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            <option value="all">Full Store Audit</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {audits.map((audit) => {
          const location = locations.find(l => l.id === audit.locationId);
          const varianceCount = audit.items.filter(i => i.variance !== 0).length;
          return (
            <div key={audit.id} className="bg-zinc-900 border border-zinc-800 rounded-3xl p-6 hover:border-zinc-700 transition-all">
              <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-500/10 rounded-2xl flex items-center justify-center text-blue-500">
                    <ClipboardCheck size={24} />
                  </div>
                  <div>
                    <div className="text-lg font-bold text-white">
                      Audit: {location?.name || 'Full Inventory'}
                    </div>
                    <div className="text-sm text-zinc-500 font-medium mt-0.5">
                      Completed by {audit.userId.slice(-6)} • {format(new Date(audit.timestamp), 'MMM d, yyyy HH:mm')}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-8 items-center">
                  <div className="text-center">
                    <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Items Audited</div>
                    <div className="text-sm font-bold text-white">{audit.items.length}</div>
                  </div>
                  <div className="text-center">
                    <div className="text-xs text-zinc-500 font-bold uppercase tracking-widest mb-1">Variances</div>
                    <div className={cn(
                      "text-sm font-bold",
                      varianceCount > 0 ? "text-amber-500" : "text-emerald-500"
                    )}>
                      {varianceCount} Items
                    </div>
                  </div>
                </div>

                <button className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-xl transition-all">
                  <History size={20} />
                </button>
              </div>
            </div>
          );
        })}
        {audits.length === 0 && (
            <div className="text-center py-12 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-3xl text-zinc-500">
              <ClipboardCheck size={48} className="mx-auto mb-4 opacity-20" />
              <p>No audit history found. Start an audit to verify stock levels.</p>
            </div>
          )}
      </div>

      {/* Audit Modal */}
      <AnimatePresence>
        {showAuditModal && activeAudit && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              className="bg-zinc-900 border border-zinc-800 rounded-[2.5rem] w-full max-w-5xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center text-emerald-500">
                    <ClipboardCheck size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Physical Stock Count</h2>
                    <p className="text-sm text-zinc-500">Location: {locations.find(l => l.id === activeAudit.locationId)?.name || 'Full Inventory'}</p>
                  </div>
                </div>
                <button onClick={() => setShowAuditModal(false)} className="p-2 text-zinc-500 hover:text-white transition-colors">
                  <XCircle size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8">
                <table className="w-full text-left">
                  <thead>
                    <tr className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider border-b border-zinc-800">
                      <th className="px-4 py-3">Item Name</th>
                      <th className="px-4 py-3">System Qty</th>
                      <th className="px-4 py-3">Physical Qty</th>
                      <th className="px-4 py-3">Variance</th>
                      <th className="px-4 py-3">Reason for Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800">
                    {activeAudit.items.map((item, index) => {
                      const invItem = items.find(i => i.id === item.itemId);
                      const variance = item.physicalQty - item.systemQty;
                      return (
                        <tr key={item.itemId} className="hover:bg-zinc-800/30 transition-colors">
                          <td className="px-4 py-4">
                            <div className="text-sm font-bold text-white">{invItem?.name}</div>
                            <div className="text-[10px] text-zinc-500 uppercase font-bold tracking-tighter">SKU: {invItem?.sku}</div>
                          </td>
                          <td className="px-4 py-4">
                            <div className="text-sm font-bold text-zinc-400">{item.systemQty}</div>
                          </td>
                          <td className="px-4 py-4">
                            <input
                              type="number"
                              value={item.physicalQty}
                              onChange={(e) => {
                                const newItems = [...activeAudit.items];
                                newItems[index].physicalQty = parseInt(e.target.value) || 0;
                                setActiveAudit({ ...activeAudit, items: newItems });
                              }}
                              className="w-24 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                            />
                          </td>
                          <td className="px-4 py-4">
                            <div className={cn(
                              "text-sm font-bold",
                              variance === 0 ? "text-zinc-500" :
                              variance > 0 ? "text-emerald-500" : "text-red-500"
                            )}>
                              {variance > 0 ? '+' : ''}{variance}
                            </div>
                          </td>
                          <td className="px-4 py-4">
                            <input
                              type="text"
                              value={item.reason}
                              onChange={(e) => {
                                const newItems = [...activeAudit.items];
                                newItems[index].reason = e.target.value;
                                setActiveAudit({ ...activeAudit, items: newItems });
                              }}
                              placeholder="e.g. Damage, Miscount"
                              className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-emerald-500/50"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="p-8 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest mb-1">Total Variances</div>
                    <div className="text-xl font-bold text-amber-500">
                      {activeAudit.items.filter(i => i.physicalQty !== i.systemQty).length}
                    </div>
                  </div>
                </div>
                <div className="flex gap-4">
                  <button
                    onClick={() => setShowAuditModal(false)}
                    className="px-8 py-4 bg-zinc-900 text-zinc-400 rounded-2xl font-bold hover:bg-zinc-800 transition-all"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSaveAudit}
                    disabled={loading}
                    className="px-8 py-4 bg-emerald-500 text-black rounded-2xl font-bold hover:bg-emerald-400 transition-all disabled:opacity-50 flex items-center gap-2"
                  >
                    {loading ? <div className="w-5 h-5 border-2 border-black border-t-transparent rounded-full animate-spin" /> : <Save size={20} />}
                    Complete Audit & Adjust Stock
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
