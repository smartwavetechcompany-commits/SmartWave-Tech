import React, { useState, useEffect } from 'react';
import { HousekeepingChemicalItem } from '../../types';
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
  FlaskConical, 
  Plus, 
  AlertTriangle, 
  CheckCircle2, 
  Download, 
  X, 
  Search, 
  ShieldAlert, 
  Sparkles,
  Calendar,
  Layers,
  MapPin,
  HelpCircle
} from 'lucide-react';
import { cn, exportToCSV } from '../../utils';
import { format, parseISO, isPast, isBefore, addDays } from 'date-fns';
import { toast } from 'sonner';

const DEFAULT_CHEMICALS: Omit<HousekeepingChemicalItem, 'id' | 'timestamp'>[] = [
  {
    name: 'Multi-Surface Disinfectant Concentrate',
    quantity: 18,
    unit: 'Liters',
    dateReceived: format(addDays(new Date(), -30), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
    storageLocation: 'Chemical Storage Locker A (Ground Floor)',
    minimumLevel: 5,
    usage: 'General hard surface sanitation, door handles, tables, bedside furniture',
    safetyNotes: 'Wear latex/nitrile gloves. Dilute 1:20 with cold water. Avoid eye contact.'
  },
  {
    name: 'Bathroom Acid Descaler & Limescale Remover',
    quantity: 8,
    unit: 'Liters',
    dateReceived: format(addDays(new Date(), -20), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 280), 'yyyy-MM-dd'),
    storageLocation: 'Chemical Storage Locker B (Ventilated)',
    minimumLevel: 4,
    usage: 'Shower glass scale, tile grout, chrome faucet polishing, ceramic descaling',
    safetyNotes: 'DANGER: Corrosive. Wear safety goggles and heavy gloves. NEVER mix with chlorine bleach.'
  },
  {
    name: 'Commercial Glass & Mirror Sparkle Cleaner',
    quantity: 14,
    unit: 'Bottles (750ml)',
    dateReceived: format(addDays(new Date(), -15), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 400), 'yyyy-MM-dd'),
    storageLocation: 'Floor Housekeeping Trolleys',
    minimumLevel: 5,
    usage: 'Windows, vanity mirrors, glass partitions, and polished stainless steel',
    safetyNotes: 'Flammable aerosol. Keep away from heat and open flames. Wipe with clean microfiber.'
  },
  {
    name: 'Heavy-Duty Floor Stripper & Neutral Degreaser',
    quantity: 12,
    unit: 'Liters',
    dateReceived: format(addDays(new Date(), -45), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 300), 'yyyy-MM-dd'),
    storageLocation: 'Janitorial Utility Store',
    minimumLevel: 4,
    usage: 'Tile, marble and terrazzo flooring scrub-downs during deep cleaning turnaround',
    safetyNotes: 'Slip hazard when wet. Ensure wet floor warning cones are positioned.'
  },
  {
    name: 'Toilet Bowl Thick Disinfecting Gel',
    quantity: 24,
    unit: 'Bottles (1L)',
    dateReceived: format(addDays(new Date(), -10), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
    storageLocation: 'Floor Housekeeping Pantries',
    minimumLevel: 8,
    usage: 'Sanitary porcelain toilet rim and bowl disinfection and stain removal',
    safetyNotes: 'Flush thoroughly after 10-minute contact time. Flush with abundant water.'
  },
  {
    name: 'Botanical Room Odour Neutralizer Concentrate',
    quantity: 6,
    unit: 'Liters',
    dateReceived: format(addDays(new Date(), -5), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 500), 'yyyy-MM-dd'),
    storageLocation: 'Housekeeping Dispensing Cabinet',
    minimumLevel: 2,
    usage: 'Air freshening, tobacco odor removal, fabric refresh across guest rooms',
    safetyNotes: 'Non-corrosive, non-staining. Mist sparingly at 45-degree angle.'
  }
];

export function HousekeepingChemicals() {
  const { hotel, profile } = useAuth();

  const [chemicals, setChemicals] = useState<HousekeepingChemicalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showAddModal, setShowAddModal] = useState(false);
  const [activeUsageChemical, setActiveUsageChemical] = useState<HousekeepingChemicalItem | null>(null);
  const [useQuantity, setUseQuantity] = useState<number>(1);

  // Add Form
  const [form, setForm] = useState({
    name: '',
    quantity: 10,
    unit: 'Liters',
    dateReceived: format(new Date(), 'yyyy-MM-dd'),
    expiryDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
    storageLocation: 'Chemical Locker A',
    minimumLevel: 3,
    usage: 'Daily room sanitation',
    safetyNotes: 'Wear gloves, ensure good room ventilation'
  });

  // 1. Live Snapshot
  useEffect(() => {
    if (!hotel?.id) return;
    setIsLoading(true);

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_chemicals'),
      orderBy('name', 'asc')
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingChemicalItem));
      setChemicals(docs);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, 'list' as any, `hotels/${hotel.id}/housekeeping_chemicals`);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Seed default catalog
  const handleSeedDefaults = async () => {
    if (!hotel?.id || !profile) return;
    try {
      const now = new Date().toISOString();
      for (const item of DEFAULT_CHEMICALS) {
        await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_chemicals'), {
          ...item,
          timestamp: now
        }, {
          hotelId: hotel.id,
          module: 'Housekeeping',
          action: 'SEED_CHEMICALS',
          details: `Seeded ${item.name}`
        });
      }
      toast.success('Loaded standard housekeeping chemicals catalog!');
    } catch {
      toast.error('Failed to load standard chemicals');
    }
  };

  // Add Custom Chemical
  const handleCreateChemical = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !form.name.trim()) return;

    const now = new Date().toISOString();
    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_chemicals'), {
        name: form.name.trim(),
        quantity: Number(form.quantity) || 0,
        unit: form.unit.trim() || 'Liters',
        dateReceived: form.dateReceived,
        expiryDate: form.expiryDate,
        storageLocation: form.storageLocation.trim(),
        minimumLevel: Number(form.minimumLevel) || 1,
        usage: form.usage.trim(),
        safetyNotes: form.safetyNotes.trim(),
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'ADD_CHEMICAL',
        details: `Added chemical ${form.name}`
      });

      toast.success(`Chemical "${form.name}" added to register!`);
      setShowAddModal(false);
      setForm({
        name: '',
        quantity: 10,
        unit: 'Liters',
        dateReceived: format(new Date(), 'yyyy-MM-dd'),
        expiryDate: format(addDays(new Date(), 365), 'yyyy-MM-dd'),
        storageLocation: 'Chemical Locker A',
        minimumLevel: 3,
        usage: 'Daily room sanitation',
        safetyNotes: 'Wear gloves, ensure good room ventilation'
      });
    } catch {
      toast.error('Failed to add chemical');
    }
  };

  // Record Usage
  const handleDeductUsage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !activeUsageChemical) return;

    const qty = Number(useQuantity) || 1;
    const newQty = Math.max(0, (activeUsageChemical.quantity || 0) - qty);

    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_chemicals', activeUsageChemical.id), {
        quantity: newQty
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'RECORD_CHEMICAL_USAGE',
        details: `Used ${qty} ${activeUsageChemical.unit} of ${activeUsageChemical.name}`
      });

      toast.success(`Recorded usage: ${qty} ${activeUsageChemical.unit} of ${activeUsageChemical.name}`);
      setActiveUsageChemical(null);
      setUseQuantity(1);
    } catch {
      toast.error('Failed to update chemical stock');
    }
  };

  // Filter
  const filteredChemicals = chemicals.filter(c =>
    c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.storageLocation.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.usage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Export
  const handleExportCSV = () => {
    const data = chemicals.map(c => ({
      ChemicalName: c.name,
      CurrentQuantity: c.quantity,
      Unit: c.unit,
      DateReceived: c.dateReceived,
      ExpiryDate: c.expiryDate,
      StorageLocation: c.storageLocation,
      MinimumLevel: c.minimumLevel,
      ApplicationUsage: c.usage,
      SafetyAndPPENotes: c.safetyNotes
    }));
    exportToCSV(data, `housekeeping-chemicals-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
            <FlaskConical size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Housekeeping Chemical Safety & Stock Register</h2>
            <p className="text-xs text-zinc-400">
              Mandatory safety guidelines, PPE notes, dilution ratios, expiry dates, and par levels
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {chemicals.length === 0 && (
            <button
              onClick={handleSeedDefaults}
              className="px-3.5 py-2 bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-bold rounded-xl hover:bg-amber-500/30 transition-all flex items-center gap-1.5"
            >
              <Sparkles size={14} />
              Load Standard Catalog
            </button>
          )}

          <button
            onClick={() => setShowAddModal(true)}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
          >
            <Plus size={14} />
            <span>Add Chemical</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Safety Notice Banner */}
      <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-4 flex items-start gap-3">
        <ShieldAlert size={20} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs space-y-1">
          <h4 className="font-bold text-amber-300 uppercase tracking-wider">
            Mandatory COSHH / Occupational Health Protocol
          </h4>
          <p className="text-zinc-300">
            Housekeeping team members must strictly wear protective gloves and designated eye protection when diluting concentrates. Never mix acid descalers with bleach. Store all containers tightly sealed in designated ventilated lockers.
          </p>
        </div>
      </div>

      {/* Search Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex items-center justify-between gap-3">
        <div className="relative flex-1 sm:w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search chemical name, storage, safety notes..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <span className="text-xs text-zinc-400 font-mono">{filteredChemicals.length} registered chemicals</span>
      </div>

      {/* Chemicals Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredChemicals.map(c => {
          const isLow = (c.quantity || 0) <= (c.minimumLevel || 3);
          const isExpired = c.expiryDate && isPast(parseISO(c.expiryDate));

          return (
            <div key={c.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold text-white leading-tight">{c.name}</h3>
                  <div className="flex flex-col items-end gap-1">
                    {isLow && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/20 text-amber-400 border border-amber-500/30">
                        Low Stock
                      </span>
                    )}
                    {isExpired && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/20 text-rose-400 border border-rose-500/30">
                        Expired
                      </span>
                    )}
                  </div>
                </div>

                {/* Stock Level Card */}
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 flex items-center justify-between">
                  <div>
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Available Balance</span>
                    <div className="text-xl font-mono font-black text-white mt-0.5">
                      {c.quantity} <span className="text-xs font-normal text-zinc-400">{c.unit}</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Min. Level</span>
                    <div className="text-xs font-mono text-zinc-400 mt-1">
                      {c.minimumLevel} {c.unit}
                    </div>
                  </div>
                </div>

                <div className="text-xs space-y-1.5 text-zinc-300">
                  <p>
                    <strong className="text-zinc-500">Intended Usage:</strong> {c.usage}
                  </p>
                  <p className="flex items-center gap-1.5 text-zinc-400">
                    <MapPin size={12} className="text-emerald-400 shrink-0" />
                    <span>{c.storageLocation}</span>
                  </p>
                  <p className="flex items-center gap-1.5 text-zinc-400">
                    <Calendar size={12} className="text-purple-400 shrink-0" />
                    <span>Expires: {c.expiryDate}</span>
                  </p>
                </div>

                {/* Safety Notes Callout */}
                <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl p-2.5 text-[11px] text-amber-300/90 space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-amber-400">
                    <ShieldAlert size={12} />
                    <span>Safety & Dilution Protocol</span>
                  </div>
                  <p>{c.safetyNotes}</p>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-3 border-t border-zinc-800 flex items-center justify-between gap-2">
                <button
                  onClick={() => {
                    setActiveUsageChemical(c);
                    setUseQuantity(1);
                  }}
                  className="flex-1 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs font-bold rounded-xl transition-all"
                >
                  Record Consumption
                </button>
              </div>
            </div>
          );
        })}

        {filteredChemicals.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-zinc-500 text-xs italic">
            No chemicals recorded. Click "Add Chemical" or "Load Standard Catalog" to begin.
          </div>
        )}
      </div>

      {/* --- MODAL 1: ADD CHEMICAL --- */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleCreateChemical} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-amber-400">
                <FlaskConical size={18} />
                <h3 className="text-lg font-bold text-white">Add Housekeeping Chemical</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Chemical Name</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Chlorinated Sanitizer 5L"
                value={form.name}
                onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Stock Quantity</label>
                <input
                  required
                  type="number"
                  min="0"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500 font-mono"
                  value={form.quantity}
                  onChange={(e) => setForm(prev => ({ ...prev, quantity: parseFloat(e.target.value) || 0 }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Unit of Measure</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  placeholder="Liters, Bottles, Gallons"
                  value={form.unit}
                  onChange={(e) => setForm(prev => ({ ...prev, unit: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Date Received</label>
                <input
                  required
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={form.dateReceived}
                  onChange={(e) => setForm(prev => ({ ...prev, dateReceived: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Expiry Date</label>
                <input
                  required
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={form.expiryDate}
                  onChange={(e) => setForm(prev => ({ ...prev, expiryDate: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Safe Storage Location</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  placeholder="Locker A / Janitorial Room"
                  value={form.storageLocation}
                  onChange={(e) => setForm(prev => ({ ...prev, storageLocation: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Minimum Alert Level</label>
                <input
                  type="number"
                  min="1"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500 font-mono"
                  value={form.minimumLevel}
                  onChange={(e) => setForm(prev => ({ ...prev, minimumLevel: parseInt(e.target.value, 10) || 1 }))}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Usage Guidelines</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Bathroom tile and grout sanitizing"
                value={form.usage}
                onChange={(e) => setForm(prev => ({ ...prev, usage: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Safety Notes & PPE Requirements</label>
              <textarea
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-16"
                placeholder="Protective gloves, goggles, dilution ratios..."
                value={form.safetyNotes}
                onChange={(e) => setForm(prev => ({ ...prev, safetyNotes: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAddModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Save Chemical
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 2: RECORD CONSUMPTION --- */}
      {activeUsageChemical && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleDeductUsage} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-sm w-full p-5 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-base font-bold text-white">Record Chemical Consumption</h3>
              <button
                type="button"
                onClick={() => setActiveUsageChemical(null)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-xs">
              <span className="font-bold text-white block">{activeUsageChemical.name}</span>
              <span className="text-zinc-400">Current Balance: {activeUsageChemical.quantity} {activeUsageChemical.unit}</span>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Quantity Used ({activeUsageChemical.unit})
              </label>
              <input
                required
                type="number"
                step="any"
                min="0.1"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500 font-mono"
                value={useQuantity}
                onChange={(e) => setUseQuantity(parseFloat(e.target.value) || 1)}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveUsageChemical(null)}
                className="flex-1 py-2 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Confirm Usage
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
