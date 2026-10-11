import React, { useState, useEffect } from 'react';
import { HousekeepingLostAndFoundItem, Room, UserProfile } from '../../types';
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
  Briefcase, 
  Plus, 
  Search, 
  CheckCircle2, 
  Clock, 
  RotateCcw, 
  X, 
  MapPin, 
  User, 
  Download,
  Calendar,
  AlertCircle,
  Archive,
  ArrowRight
} from 'lucide-react';
import { cn, exportToCSV } from '../../utils';
import { format, parseISO } from 'date-fns';
import { toast } from 'sonner';

interface HousekeepingLostAndFoundProps {
  rooms: Room[];
  staff: UserProfile[];
}

export function HousekeepingLostAndFound({ rooms, staff }: HousekeepingLostAndFoundProps) {
  const { hotel, profile } = useAuth();
  
  const [items, setItems] = useState<HousekeepingLostAndFoundItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  
  // Filter & Search
  const [statusFilter, setStatusFilter] = useState<'all' | 'stored' | 'claimed' | 'returned' | 'unclaimed'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [showLogModal, setShowLogModal] = useState(false);
  const [returnItemTarget, setReturnItemTarget] = useState<HousekeepingLostAndFoundItem | null>(null);

  // Forms
  const [logForm, setLogForm] = useState({
    item: '',
    roomLocation: '',
    dateFound: format(new Date(), 'yyyy-MM-dd'),
    timeFound: format(new Date(), 'HH:mm'),
    foundBy: '',
    description: '',
    guestName: '',
    storageLocation: 'Housekeeping Office Safe Box 2',
    status: 'stored' as HousekeepingLostAndFoundItem['status']
  });

  const [returnForm, setReturnForm] = useState({
    dateReturned: format(new Date(), 'yyyy-MM-dd'),
    receivedBy: '',
    notes: 'ID verified and handover signed'
  });

  // Live Snapshot
  useEffect(() => {
    if (!hotel?.id) return;
    setIsLoading(true);

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_lost_and_found'),
      orderBy('timestamp', 'desc'),
      limit(100)
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingLostAndFoundItem));
      setItems(docs);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, 'list' as any, `hotels/${hotel.id}/housekeeping_lost_and_found`);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Log Item
  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile || !logForm.item.trim()) return;

    const now = new Date().toISOString();
    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_lost_and_found'), {
        item: logForm.item.trim(),
        roomLocation: logForm.roomLocation.trim() || 'General Area',
        dateFound: logForm.dateFound,
        timeFound: logForm.timeFound,
        foundBy: logForm.foundBy.trim() || (profile.displayName || profile.email),
        description: logForm.description.trim(),
        guestName: logForm.guestName.trim() || undefined,
        storageLocation: logForm.storageLocation.trim() || 'Housekeeping Office',
        status: logForm.status,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'LOG_LOST_FOUND',
        details: `Logged lost item ${logForm.item} from ${logForm.roomLocation}`
      });

      toast.success(`Lost item "${logForm.item}" recorded in register!`);
      setShowLogModal(false);
      setLogForm({
        item: '',
        roomLocation: '',
        dateFound: format(new Date(), 'yyyy-MM-dd'),
        timeFound: format(new Date(), 'HH:mm'),
        foundBy: '',
        description: '',
        guestName: '',
        storageLocation: 'Housekeeping Office Safe Box 2',
        status: 'stored'
      });
    } catch (err) {
      toast.error('Failed to log lost item');
    }
  };

  // Return to Guest
  const handleConfirmReturn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !returnItemTarget || !returnForm.receivedBy.trim()) return;

    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_lost_and_found', returnItemTarget.id), {
        status: 'returned',
        dateReturned: returnForm.dateReturned,
        receivedBy: returnForm.receivedBy.trim()
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'RETURN_LOST_FOUND',
        details: `Returned item ${returnItemTarget.item} to ${returnForm.receivedBy}`
      });

      toast.success(`Item "${returnItemTarget.item}" marked as returned to guest!`);
      setReturnItemTarget(null);
    } catch (err) {
      toast.error('Failed to record return');
    }
  };

  // Change Status Quick Action
  const handleQuickStatusChange = async (itemId: string, newStatus: HousekeepingLostAndFoundItem['status']) => {
    if (!hotel?.id) return;
    try {
      await database.safeSet(doc(db, 'hotels', hotel.id, 'housekeeping_lost_and_found', itemId), {
        status: newStatus
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'UPDATE_LOST_FOUND_STATUS',
        details: `Updated status to ${newStatus}`
      });
      toast.success(`Status updated to ${newStatus}`);
    } catch (err) {
      toast.error('Failed to update status');
    }
  };

  // Filtered Items
  const filteredItems = items.filter(item => {
    const matchesSearch = item.item.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.roomLocation.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          (item.guestName && item.guestName.toLowerCase().includes(searchQuery.toLowerCase())) ||
                          item.foundBy.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesStatus = statusFilter === 'all' || item.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  // Metrics
  const storedCount = items.filter(i => i.status === 'stored').length;
  const claimedCount = items.filter(i => i.status === 'claimed').length;
  const returnedCount = items.filter(i => i.status === 'returned').length;
  const unclaimedCount = items.filter(i => i.status === 'unclaimed').length;

  // Export
  const handleExportCSV = () => {
    const data = items.map(i => ({
      Item: i.item,
      LocationFound: i.roomLocation,
      DateFound: i.dateFound,
      TimeFound: i.timeFound,
      FoundBy: i.foundBy,
      Description: i.description,
      GuestName: i.guestName || 'Unknown',
      StorageLocation: i.storageLocation,
      Status: i.status.toUpperCase(),
      DateReturned: i.dateReturned || '-',
      ReceivedBy: i.receivedBy || '-'
    }));
    exportToCSV(data, `lost-and-found-${format(new Date(), 'yyyy-MM-dd')}`);
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Briefcase size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Hotel Lost & Found Register</h2>
            <p className="text-xs text-zinc-400">Track guest belongings left behind, secure storage locations, and guest return receipts</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLogModal(true)}
            className="px-3.5 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
          >
            <Plus size={14} />
            <span>Log Found Item</span>
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

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Safely Stored</span>
            <span className="text-xl font-black text-white mt-0.5 block">{storedCount}</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center">
            <Archive size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Claimed (Pending Pickup)</span>
            <span className="text-xl font-black text-amber-400 mt-0.5 block">{claimedCount}</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <Clock size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Returned to Guest</span>
            <span className="text-xl font-black text-emerald-400 mt-0.5 block">{returnedCount}</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <CheckCircle2 size={16} />
          </div>
        </div>

        <div className="bg-zinc-900 border border-zinc-800 p-3.5 rounded-2xl flex items-center justify-between">
          <div>
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Unclaimed (&gt; 90 Days)</span>
            <span className="text-xl font-black text-zinc-400 mt-0.5 block">{unclaimedCount}</span>
          </div>
          <div className="w-8 h-8 rounded-xl bg-zinc-800 text-zinc-400 flex items-center justify-center">
            <RotateCcw size={16} />
          </div>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-3 sm:p-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto pb-2 custom-scrollbar">
          {[
            { id: 'all', label: 'All Items' },
            { id: 'stored', label: 'Stored in Safe', count: storedCount },
            { id: 'claimed', label: 'Claimed', count: claimedCount },
            { id: 'returned', label: 'Returned', count: returnedCount },
            { id: 'unclaimed', label: 'Unclaimed', count: unclaimedCount }
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id as any)}
              className={cn(
                "px-3 py-1.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap flex items-center gap-1.5",
                statusFilter === tab.id
                  ? "bg-emerald-500 text-black shadow-md shadow-emerald-500/20"
                  : "bg-zinc-950 text-zinc-400 hover:text-white"
              )}
            >
              <span>{tab.label}</span>
              {tab.count !== undefined && (
                <span className="text-[10px] font-mono px-1 rounded bg-black/20">{tab.count}</span>
              )}
            </button>
          ))}
        </div>

        <div className="relative flex-1 sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search items, rooms, guests..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Item Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredItems.map(item => {
          return (
            <div key={item.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-3.5 flex flex-col justify-between">
              <div className="space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-base font-bold text-white leading-tight">{item.item}</h3>
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider shrink-0",
                    item.status === 'stored' ? "bg-blue-500/20 text-blue-400 border border-blue-500/30" :
                    item.status === 'claimed' ? "bg-amber-500/20 text-amber-400 border border-amber-500/30" :
                    item.status === 'returned' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                    "bg-zinc-800 text-zinc-400 border border-zinc-700"
                  )}>
                    {item.status}
                  </span>
                </div>

                <p className="text-xs text-zinc-300 line-clamp-2">{item.description}</p>

                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <MapPin size={12} className="text-amber-400" />
                      Location Found:
                    </span>
                    <span className="font-bold text-white">{item.roomLocation}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <Calendar size={12} className="text-purple-400" />
                      Date & Time:
                    </span>
                    <span className="font-mono text-zinc-200">{item.dateFound} @ {item.timeFound}</span>
                  </div>
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <User size={12} className="text-emerald-400" />
                      Found By:
                    </span>
                    <span className="text-zinc-200">{item.foundBy}</span>
                  </div>
                  {item.guestName && (
                    <div className="flex items-center justify-between text-zinc-400">
                      <span>Guest Name:</span>
                      <span className="font-bold text-emerald-400">{item.guestName}</span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-zinc-400 pt-1 border-t border-zinc-900">
                    <span>Safe Storage:</span>
                    <span className="text-zinc-300 font-mono text-[11px]">{item.storageLocation}</span>
                  </div>
                  {item.status === 'returned' && item.receivedBy && (
                    <div className="pt-1 border-t border-zinc-900 text-emerald-400 font-medium">
                      Returned to {item.receivedBy} on {item.dateReturned}
                    </div>
                  )}
                </div>
              </div>

              {/* Action Buttons */}
              <div className="pt-2 border-t border-zinc-800 flex items-center justify-between gap-2">
                {item.status !== 'returned' ? (
                  <>
                    <button
                      onClick={() => setReturnItemTarget(item)}
                      className="flex-1 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                    >
                      <CheckCircle2 size={13} />
                      <span>Return to Guest</span>
                    </button>
                    {item.status === 'stored' && (
                      <button
                        onClick={() => handleQuickStatusChange(item.id, 'claimed')}
                        className="px-2.5 py-2 bg-zinc-800 hover:bg-zinc-700 text-amber-400 text-xs font-bold rounded-xl"
                        title="Mark Claimed"
                      >
                        Claim
                      </button>
                    )}
                  </>
                ) : (
                  <div className="text-[11px] text-zinc-500 italic py-1 flex items-center gap-1">
                    <CheckCircle2 size={13} className="text-emerald-400" />
                    Handover verified & completed
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {filteredItems.length === 0 && !isLoading && (
          <div className="col-span-full py-12 text-center text-zinc-500 text-xs italic">
            No lost and found items matching filter. Click "Log Found Item" to record one.
          </div>
        )}
      </div>

      {/* --- MODAL 1: LOG FOUND ITEM --- */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveItem} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-purple-400">
                <Briefcase size={18} />
                <h3 className="text-lg font-bold text-white">Log Found Belonging</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Item Title</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Black Leather Wallet / iPhone Charger"
                value={logForm.item}
                onChange={(e) => setLogForm(prev => ({ ...prev, item: e.target.value }))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Room / Location Found</label>
                <input
                  required
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  placeholder="e.g. Room 204 or Lobby"
                  value={logForm.roomLocation}
                  onChange={(e) => setLogForm(prev => ({ ...prev, roomLocation: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Guest Name (if known)</label>
                <input
                  type="text"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  placeholder="e.g. John Doe"
                  value={logForm.guestName}
                  onChange={(e) => setLogForm(prev => ({ ...prev, guestName: e.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Date Found</label>
                <input
                  required
                  type="date"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={logForm.dateFound}
                  onChange={(e) => setLogForm(prev => ({ ...prev, dateFound: e.target.value }))}
                />
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Time Found</label>
                <input
                  required
                  type="time"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={logForm.timeFound}
                  onChange={(e) => setLogForm(prev => ({ ...prev, timeFound: e.target.value }))}
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Found By (Staff Name)</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Mary (Housekeeper)"
                value={logForm.foundBy}
                onChange={(e) => setLogForm(prev => ({ ...prev, foundBy: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Description / Identifying Marks</label>
              <textarea
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-18"
                placeholder="Details such as brand, colour, contents, or serial number..."
                value={logForm.description}
                onChange={(e) => setLogForm(prev => ({ ...prev, description: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Safe Storage Location</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Housekeeping Office Cupboard B"
                value={logForm.storageLocation}
                onChange={(e) => setLogForm(prev => ({ ...prev, storageLocation: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Log Item
              </button>
            </div>
          </form>
        </div>
      )}

      {/* --- MODAL 2: RETURN TO GUEST --- */}
      {returnItemTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleConfirmReturn} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-md w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <CheckCircle2 size={18} />
                <h3 className="text-lg font-bold text-white">Record Guest Return</h3>
              </div>
              <button
                type="button"
                onClick={() => setReturnItemTarget(null)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-xs">
              <span className="text-zinc-500">Item: </span>
              <span className="font-bold text-white">{returnItemTarget.item}</span>
              <p className="text-zinc-400 mt-1">Found in {returnItemTarget.roomLocation} on {returnItemTarget.dateFound}</p>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Received By (Guest / Authorized Rep)</label>
              <input
                required
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="Full name of person collecting"
                value={returnForm.receivedBy}
                onChange={(e) => setReturnForm(prev => ({ ...prev, receivedBy: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Date Returned</label>
              <input
                required
                type="date"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                value={returnForm.dateReturned}
                onChange={(e) => setReturnForm(prev => ({ ...prev, dateReturned: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">Handover Notes / Verification</label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="e.g. Identity card verified, signed receipt filed"
                value={returnForm.notes}
                onChange={(e) => setReturnForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setReturnItemTarget(null)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold"
              >
                Confirm Return
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
