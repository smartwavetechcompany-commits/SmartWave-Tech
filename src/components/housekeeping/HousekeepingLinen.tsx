import React, { useState, useEffect } from 'react';
import { HousekeepingLinenItem } from '../../types';
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
  Sparkles, 
  Plus, 
  ArrowRight, 
  RotateCcw, 
  AlertTriangle, 
  CheckCircle2, 
  History, 
  Download,
  X,
  Layers,
  Shirt,
  Truck,
  ShieldCheck,
  Percent
} from 'lucide-react';
import { cn, exportToCSV } from '../../utils';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

const DEFAULT_LINEN_ITEMS: Omit<HousekeepingLinenItem, 'id' | 'lastUpdated'>[] = [
  { name: 'Bed Sheets (King/Queen)', cleanStock: 75, issued: 45, used: 45, inLaundry: 30, damagedMissing: 2, totalPar: 150 },
  { name: 'Pillowcases', cleanStock: 160, issued: 90, used: 90, inLaundry: 60, damagedMissing: 4, totalPar: 310 },
  { name: 'Bath Towels (Large)', cleanStock: 110, issued: 60, used: 60, inLaundry: 45, damagedMissing: 3, totalPar: 215 },
  { name: 'Hand Towels', cleanStock: 90, issued: 50, used: 50, inLaundry: 35, damagedMissing: 1, totalPar: 175 },
  { name: 'Face Towels', cleanStock: 120, issued: 70, used: 70, inLaundry: 40, damagedMissing: 2, totalPar: 230 },
  { name: 'Bath Mats', cleanStock: 50, issued: 30, used: 30, inLaundry: 20, damagedMissing: 1, totalPar: 100 },
  { name: 'Duvet Covers', cleanStock: 60, issued: 35, used: 35, inLaundry: 25, damagedMissing: 2, totalPar: 120 }
];

export function HousekeepingLinen() {
  const { hotel, profile } = useAuth();
  
  const [linens, setLinens] = useState<HousekeepingLinenItem[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modals
  const [selectedLinen, setSelectedLinen] = useState<HousekeepingLinenItem | null>(null);
  const [actionType, setActionType] = useState<'send_laundry' | 'return_laundry' | 'issue_rooms' | 'record_damage' | null>(null);
  const [quantity, setQuantity] = useState<number>(10);
  const [actionNotes, setActionNotes] = useState<string>('');

  // 1. Live Snapshot for Linens
  useEffect(() => {
    if (!hotel?.id) return;
    setIsLoading(true);

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_linens'),
      orderBy('name', 'asc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingLinenItem));
      setLinens(docs);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, 'list' as any, `hotels/${hotel.id}/housekeeping_linens`);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // 2. Live Snapshot for Linen Movements
  useEffect(() => {
    if (!hotel?.id) return;

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_linen_movements'),
      orderBy('timestamp', 'desc'),
      limit(50)
    );

    const unsub = onSnapshot(q, (snap) => {
      setMovements(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, () => {});

    return () => unsub();
  }, [hotel?.id]);

  // Seed default linens
  const handleSeedDefaults = async () => {
    if (!hotel?.id || !profile) return;
    try {
      const now = new Date().toISOString();
      for (const item of DEFAULT_LINEN_ITEMS) {
        await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_linens'), {
          ...item,
          lastUpdated: now
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'SEED_LINEN',
          details: `Seeded linen ${item.name}`
        });
      }
      toast.success('Loaded standard hotel linen catalog!');
    } catch {
      toast.error('Failed to load standard linens');
    }
  };

  // Perform Movement
  const handleExecuteAction = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !selectedLinen || !actionType) return;

    const qty = Number(quantity) || 1;
    if (qty <= 0) {
      toast.error('Please enter a valid quantity');
      return;
    }

    const now = new Date().toISOString();
    const updateData: Partial<HousekeepingLinenItem> = { lastUpdated: now };
    let movementLabel = '';

    if (actionType === 'send_laundry') {
      // Used / Soiled -> In Laundry
      const usedCurrent = selectedLinen.used || 0;
      updateData.used = Math.max(0, usedCurrent - qty);
      updateData.inLaundry = (selectedLinen.inLaundry || 0) + qty;
      movementLabel = `Sent ${qty} to Commercial Laundry`;
    } else if (actionType === 'return_laundry') {
      // In Laundry -> Clean Stock
      const laundryCurrent = selectedLinen.inLaundry || 0;
      updateData.inLaundry = Math.max(0, laundryCurrent - qty);
      updateData.cleanStock = (selectedLinen.cleanStock || 0) + qty;
      movementLabel = `Returned ${qty} clean from Laundry to Shelf`;
    } else if (actionType === 'issue_rooms') {
      // Clean Stock -> Issued (Rooms)
      const cleanCurrent = selectedLinen.cleanStock || 0;
      updateData.cleanStock = Math.max(0, cleanCurrent - qty);
      updateData.issued = (selectedLinen.issued || 0) + qty;
      updateData.used = (selectedLinen.used || 0) + qty;
      movementLabel = `Issued ${qty} to Floor Cleaning Trolleys`;
    } else if (actionType === 'record_damage') {
      // Mark as Damaged or Missing (reduces from clean or used)
      updateData.damagedMissing = (selectedLinen.damagedMissing || 0) + qty;
      updateData.cleanStock = Math.max(0, (selectedLinen.cleanStock || 0) - qty);
      movementLabel = `Recorded ${qty} damaged/stained or missing`;
    }

    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_linens', selectedLinen.id), updateData, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'UPDATE_LINEN',
        details: `${selectedLinen.name}: ${movementLabel}`
      });

      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_linen_movements'), {
        linenId: selectedLinen.id,
        linenName: selectedLinen.name,
        actionType,
        quantity: qty,
        details: movementLabel,
        notes: actionNotes,
        handledBy: profile.displayName || profile.email,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'LINEN_MOVEMENT_LOG',
        details: `Logged movement for ${selectedLinen.name}`
      });

      toast.success(`${selectedLinen.name}: ${movementLabel}`);
      setActionType(null);
      setSelectedLinen(null);
      setQuantity(10);
      setActionNotes('');
    } catch (err) {
      toast.error('Failed to update linen movement');
    }
  };

  // Export
  const handleExportCSV = () => {
    const data = linens.map(l => ({
      Linen: l.name,
      CleanStock: l.cleanStock,
      IssuedInRooms: l.issued,
      InCommercialLaundry: l.inLaundry,
      DamagedOrMissing: l.damagedMissing,
      TotalParCount: l.totalPar,
      ParAdequacy: `${Math.round(((l.cleanStock + l.issued + l.inLaundry) / (l.totalPar || 1)) * 100)}%`
    }));
    exportToCSV(data, `linen-inventory-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  // Metrics
  const totalClean = linens.reduce((acc, l) => acc + (l.cleanStock || 0), 0);
  const totalInLaundry = linens.reduce((acc, l) => acc + (l.inLaundry || 0), 0);
  const totalInRooms = linens.reduce((acc, l) => acc + (l.issued || 0), 0);
  const totalDamaged = linens.reduce((acc, l) => acc + (l.damagedMissing || 0), 0);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-center text-blue-400">
            <Shirt size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Linen Management & Laundry Flow</h2>
            <p className="text-xs text-zinc-400">
              Clean Stock → Issued → Used → Laundry → Returned → Stock movement pipeline
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {linens.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              className="px-3.5 py-2 bg-blue-500/20 text-blue-400 border border-blue-500/30 text-xs font-bold rounded-xl hover:bg-blue-500/30 transition-all flex items-center gap-1.5"
            >
              <Sparkles size={14} />
              Load Standard Linen Catalog
            </button>
          )}

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Pipeline Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-emerald-500/20 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider block">Clean on Shelf</span>
            <span className="text-xl font-black text-white mt-0.5 block">{totalClean} pcs</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <ShieldCheck size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-blue-500/20 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider block">Issued in Rooms</span>
            <span className="text-xl font-black text-blue-400 mt-0.5 block">{totalInRooms} pcs</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <Shirt size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-purple-500/20 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-purple-400 uppercase tracking-wider block">In Commercial Laundry</span>
            <span className="text-xl font-black text-purple-400 mt-0.5 block">{totalInLaundry} pcs</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Truck size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-rose-500/20 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider block">Damaged / Missing</span>
            <span className="text-xl font-black text-rose-400 mt-0.5 block">{totalDamaged} pcs</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <AlertTriangle size={16} />
          </div>
        </div>
      </div>

      {/* Linen Items Table */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
              <tr>
                <th className="py-3 px-4">Linen Item</th>
                <th className="py-3 px-3 text-right text-emerald-400">Clean Stock</th>
                <th className="py-3 px-3 text-right text-blue-400">In Rooms</th>
                <th className="py-3 px-3 text-right text-purple-400">In Laundry</th>
                <th className="py-3 px-3 text-right text-rose-400">Damaged</th>
                <th className="py-3 px-3 text-right">Total Par</th>
                <th className="py-3 px-4 text-center">Movement Flow Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {linens.map(item => {
                return (
                  <tr key={item.id} className="hover:bg-zinc-800/40 transition-colors">
                    <td className="py-3 px-4 font-bold text-white">
                      {item.name}
                    </td>
                    <td className="py-3 px-3 text-right font-mono font-bold text-emerald-400">
                      {item.cleanStock}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-blue-400">
                      {item.issued}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-purple-400">
                      {item.inLaundry}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-rose-400">
                      {item.damagedMissing}
                    </td>
                    <td className="py-3 px-3 text-right font-mono text-zinc-400">
                      {item.totalPar}
                    </td>
                    <td className="py-3 px-4 text-center">
                      <div className="flex items-center justify-center gap-1.5 flex-wrap">
                        <button
                          onClick={() => {
                            setSelectedLinen(item);
                            setActionType('issue_rooms');
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-blue-400 rounded-lg text-[11px] font-bold"
                          title="Issue clean linen to rooms"
                        >
                          Issue
                        </button>

                        <button
                          onClick={() => {
                            setSelectedLinen(item);
                            setActionType('send_laundry');
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-purple-400 rounded-lg text-[11px] font-bold"
                          title="Send to Laundry"
                        >
                          To Laundry
                        </button>

                        <button
                          onClick={() => {
                            setSelectedLinen(item);
                            setActionType('return_laundry');
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-emerald-400 rounded-lg text-[11px] font-bold"
                          title="Receive Fresh from Laundry"
                        >
                          From Laundry
                        </button>

                        <button
                          onClick={() => {
                            setSelectedLinen(item);
                            setActionType('record_damage');
                          }}
                          className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-rose-400 rounded-lg text-[11px] font-bold"
                          title="Record Damaged or Stained"
                        >
                          Damaged
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {linens.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={7} className="py-10 text-center text-zinc-500 text-xs italic">
                    No linen records available. Click "Load Standard Linen Catalog" to populate.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Movement History Log */}
      {movements.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <History size={16} className="text-emerald-400" />
            Recent Linen Dispatches & Laundry Turnaround Logs
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-950 text-zinc-400 uppercase font-black text-[10px] tracking-wider border-b border-zinc-800">
                <tr>
                  <th className="py-2.5 px-3">Time</th>
                  <th className="py-2.5 px-3">Linen</th>
                  <th className="py-2.5 px-3">Event</th>
                  <th className="py-2.5 px-3">Handled By</th>
                  <th className="py-2.5 px-3">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-800">
                {movements.slice(0, 10).map((m: any, i) => (
                  <tr key={m.id || i} className="hover:bg-zinc-800/40">
                    <td className="py-2.5 px-3 text-zinc-400 font-mono">
                      {m.timestamp ? format(parseISO(m.timestamp), 'MMM d, HH:mm') : ''}
                    </td>
                    <td className="py-2.5 px-3 font-bold text-white">{m.linenName}</td>
                    <td className="py-2.5 px-3 text-zinc-300">{m.details}</td>
                    <td className="py-2.5 px-3 text-zinc-400">{m.handledBy}</td>
                    <td className="py-2.5 px-3 text-zinc-400 italic">{m.notes || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ACTION DIALOG */}
      {selectedLinen && actionType && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleExecuteAction} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white capitalize">
                  {actionType === 'send_laundry' && 'Send Soiled Linen to Laundry'}
                  {actionType === 'return_laundry' && 'Receive Clean Linen from Laundry'}
                  {actionType === 'issue_rooms' && 'Issue Clean Linen to Floor / Rooms'}
                  {actionType === 'record_damage' && 'Record Damaged or Missing Linen'}
                </h3>
                <p className="text-xs text-zinc-400">{selectedLinen.name}</p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedLinen(null);
                  setActionType(null);
                }}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Quantity (Pieces)
              </label>
              <input
                required
                type="number"
                min="1"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500 font-mono"
                value={quantity}
                onChange={(e) => setQuantity(parseInt(e.target.value, 10) || 1)}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Notes / Handover Remarks
              </label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Dispatched via Laundry Truck A, Batch #4"
                value={actionNotes}
                onChange={(e) => setActionNotes(e.target.value)}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setSelectedLinen(null);
                  setActionType(null);
                }}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Confirm Movement
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
