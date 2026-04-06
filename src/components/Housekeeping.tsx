import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, setDoc, addDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Room, OperationType } from '../types';
import { 
  ClipboardList, 
  CheckCircle2, 
  AlertCircle, 
  Clock,
  RefreshCw,
  Search,
  Download,
  Filter,
  X,
  CheckSquare,
  Square
} from 'lucide-react';
import { cn, exportToCSV } from '../utils';
import { format, isWithinInterval, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export function Housekeeping() {
  const { hotel, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<'all' | 'dirty' | 'clean' | 'maintenance' | 'out_of_service'>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [roomNotes, setRoomNotes] = useState<Record<string, string>>({});
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    const q = query(collection(db, 'hotels', hotel.id, 'rooms'));
    
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/rooms`);
      if (error.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const updateRoomStatus = async (roomId: string, status: Room['status']) => {
    if (!hotel?.id) return;
    const room = rooms.find(r => r.id === roomId);
    const notes = roomNotes[roomId] ?? room?.notes ?? '';
    const now = new Date().toISOString();
    
    try {
      const updateData: any = { 
        status,
        notes 
      };

      if (status === 'clean') updateData.lastCleanedAt = now;
      if (status === 'maintenance' || status === 'dirty' || status === 'out_of_service') updateData.lastFlaggedAt = now;

      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', roomId), updateData, { merge: true });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: now,
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'HOUSEKEEPING_UPDATE',
        resource: `Room ${room?.roomNumber || roomId}: ${status}${notes ? ` (Note: ${notes})` : ''}`,
        hotelId: hotel.id,
        module: 'Housekeeping'
      });
      toast.success(`Room ${room?.roomNumber} marked as ${status.replace('_', ' ')}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
      toast.error('Failed to update room status');
    }
  };

  const handleBulkUpdate = async (status: Room['status']) => {
    if (!hotel?.id || selectedRoomIds.length === 0) return;
    
    const loadingToast = toast.loading(`Updating ${selectedRoomIds.length} rooms...`);
    const now = new Date().toISOString();

    try {
      await Promise.all(selectedRoomIds.map(async (roomId) => {
        const room = rooms.find(r => r.id === roomId);
        const notes = roomNotes[roomId] ?? room?.notes ?? '';
        
        const updateData: any = { status, notes };
        if (status === 'clean') updateData.lastCleanedAt = now;
        if (status === 'maintenance' || status === 'dirty' || status === 'out_of_service') updateData.lastFlaggedAt = now;

        await setDoc(doc(db, 'hotels', hotel.id, 'rooms', roomId), updateData, { merge: true });

        await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
          timestamp: now,
          userId: profile?.uid || 'system',
          userEmail: profile?.email || 'system',
          userRole: profile?.role || 'staff',
          action: 'HOUSEKEEPING_BULK_UPDATE',
          resource: `Room ${room?.roomNumber || roomId}: ${status}`,
          hotelId: hotel.id,
          module: 'Housekeeping'
        });
      }));

      toast.dismiss(loadingToast);
      toast.success(`Successfully updated ${selectedRoomIds.length} rooms to ${status.replace('_', ' ')}`);
      setSelectedRoomIds([]);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk`);
      toast.error('Failed to update rooms');
    }
  };

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRoomIds(prev => 
      prev.includes(roomId) ? prev.filter(id => id !== roomId) : [...prev, roomId]
    );
  };

  const filteredRooms = rooms.filter(r => {
    // Status Filter
    if (filter !== 'all' && r.status !== filter) return false;
    
    // Room Type Filter
    if (roomTypeFilter !== 'all' && r.type !== roomTypeFilter) return false;

    // Search Query (Number, Status, Notes)
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesNumber = r.roomNumber.toLowerCase().includes(query);
      const matchesStatus = r.status.toLowerCase().includes(query);
      const matchesNotes = (r.notes || '').toLowerCase().includes(query);
      const matchesType = r.type.toLowerCase().includes(query);
      if (!matchesNumber && !matchesStatus && !matchesNotes && !matchesType) return false;
    }

    // Date Range Filter (Last Cleaned or Last Flagged)
    if (dateRange.start || dateRange.end) {
      const startDate = dateRange.start ? parseISO(dateRange.start) : new Date(0);
      const endDate = dateRange.end ? parseISO(dateRange.end) : new Date();
      
      const lastCleaned = r.lastCleanedAt ? parseISO(r.lastCleanedAt) : null;
      const lastFlagged = r.lastFlaggedAt ? parseISO(r.lastFlaggedAt) : null;

      const cleanedInRange = lastCleaned && isWithinInterval(lastCleaned, { start: startDate, end: endDate });
      const flaggedInRange = lastFlagged && isWithinInterval(lastFlagged, { start: startDate, end: endDate });

      if (!cleanedInRange && !flaggedInRange) return false;
    }

    return true;
  });

  const roomTypes = Array.from(new Set(rooms.map(r => r.type)));

  const handleExport = () => {
    const dataToExport = filteredRooms.map(r => ({
      Room: r.roomNumber,
      Type: r.type,
      Status: r.status,
      Floor: r.floor
    }));
    exportToCSV(dataToExport, `housekeeping_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Housekeeping status exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Housekeeping</h1>
          <p className="text-zinc-400">Manage room cleaning and maintenance status</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input 
              type="text"
              placeholder="Search rooms, status, or notes..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:border-emerald-500 outline-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export
          </button>
        </div>
      </header>

      <div className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-4 flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-zinc-500" />
          <span className="text-xs font-bold text-zinc-500 uppercase tracking-wider">Filters:</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="all">All Statuses</option>
            <option value="clean">Clean</option>
            <option value="dirty">Dirty</option>
            <option value="maintenance">Maintenance</option>
            <option value="out_of_service">Out of Service</option>
          </select>

          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
            value={roomTypeFilter}
            onChange={(e) => setRoomTypeFilter(e.target.value)}
          >
            <option value="all">All Room Types</option>
            {roomTypes.map(type => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
            <span className="text-[10px] font-bold text-zinc-500 uppercase">From:</span>
            <input 
              type="date"
              className="bg-transparent text-xs text-white outline-none"
              value={dateRange.start}
              onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
            />
            <span className="text-[10px] font-bold text-zinc-500 uppercase">To:</span>
            <input 
              type="date"
              className="bg-transparent text-xs text-white outline-none"
              value={dateRange.end}
              onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
            />
            {(dateRange.start || dateRange.end) && (
              <button 
                onClick={() => setDateRange({ start: '', end: '' })}
                className="text-zinc-500 hover:text-white transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 relative">
        {filteredRooms.map(room => {
          const statusColor = hotel?.branding?.statusColors?.[room.status] || 
            (room.status === 'clean' ? '#10b981' : 
             room.status === 'dirty' ? '#ef4444' : 
             room.status === 'occupied' ? '#3b82f6' : 
             room.status === 'maintenance' ? '#f59e0b' : '#71717a');

          const isSelected = selectedRoomIds.includes(room.id);

          return (
            <div 
              key={room.id} 
              className={cn(
                "bg-zinc-900 border rounded-2xl p-6 space-y-4 flex flex-col transition-all relative group",
                isSelected ? "border-emerald-500 ring-1 ring-emerald-500/20" : "border-zinc-800"
              )}
            >
              <button 
                onClick={() => toggleRoomSelection(room.id)}
                className="absolute top-4 right-4 text-zinc-600 hover:text-emerald-500 transition-colors"
              >
                {isSelected ? <CheckSquare size={20} className="text-emerald-500" /> : <Square size={20} />}
              </button>

              <div className="flex items-center justify-between pr-8">
                <span className="text-2xl font-bold text-white">Room {room.roomNumber}</span>
                <span 
                  style={{ 
                    backgroundColor: `${statusColor}1a`,
                    color: statusColor
                  }}
                  className="px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider"
                >
                  {room.status.replace(/_/g, ' ')}
                </span>
              </div>
              
              <div className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
                {room.type} • Floor {room.floor}
              </div>

              <div className="flex-1 space-y-2">
                <label className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">Housekeeping Notes</label>
                <textarea
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-3 text-xs text-white focus:border-emerald-500 outline-none resize-none h-20 transition-all"
                  placeholder="Add notes (e.g. broken bulb, needs deep clean...)"
                  value={roomNotes[room.id] ?? room.notes ?? ''}
                  onChange={(e) => setRoomNotes(prev => ({ ...prev, [room.id]: e.target.value }))}
                  onBlur={() => {
                    const notes = roomNotes[room.id];
                    if (notes !== undefined && notes !== room.notes) {
                      updateRoomStatus(room.id, room.status);
                    }
                  }}
                />
              </div>

              <div className="pt-4 border-t border-zinc-800 grid grid-cols-2 gap-2">
                <button 
                  onClick={() => updateRoomStatus(room.id, 'clean')}
                  disabled={room.status === 'clean'}
                  className="flex items-center justify-center gap-2 bg-emerald-500/10 text-emerald-500 py-2 rounded-lg text-xs font-bold hover:bg-emerald-500/20 transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                >
                  <CheckCircle2 size={14} />
                  Mark Clean
                </button>
                <button 
                  onClick={() => updateRoomStatus(room.id, 'dirty')}
                  disabled={room.status === 'dirty'}
                  className="flex items-center justify-center gap-2 bg-red-500/10 text-red-500 py-2 rounded-lg text-xs font-bold hover:bg-red-500/20 transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                >
                  <AlertCircle size={14} />
                  Mark Dirty
                </button>
                <button 
                  onClick={() => updateRoomStatus(room.id, 'maintenance')}
                  disabled={room.status === 'maintenance'}
                  className="flex items-center justify-center gap-2 bg-amber-500/10 text-amber-500 py-2 rounded-lg text-xs font-bold hover:bg-amber-500/20 transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                >
                  <RefreshCw size={14} />
                  Maintenance
                </button>
                <button 
                  onClick={() => updateRoomStatus(room.id, 'out_of_service')}
                  disabled={room.status === 'out_of_service'}
                  className="flex items-center justify-center gap-2 bg-zinc-800 text-zinc-400 py-2 rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all active:scale-95 disabled:opacity-30 disabled:active:scale-100"
                >
                  <AlertCircle size={14} />
                  Out of Service
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <AnimatePresence>
        {selectedRoomIds.length > 0 && (
          <motion.div 
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-zinc-900 border border-emerald-500/30 shadow-2xl shadow-emerald-500/20 px-6 py-4 rounded-2xl flex items-center gap-8 backdrop-blur-xl"
          >
            <div className="flex items-center gap-4 border-r border-zinc-800 pr-8">
              <div className="w-10 h-10 rounded-full bg-emerald-500 text-black flex items-center justify-center font-black text-sm">
                {selectedRoomIds.length}
              </div>
              <div>
                <p className="text-white font-bold text-sm leading-none">Rooms Selected</p>
                <button 
                  onClick={() => setSelectedRoomIds([])}
                  className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest hover:text-white transition-colors"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button 
                onClick={() => handleBulkUpdate('clean')}
                className="px-4 py-2 bg-emerald-500 text-black rounded-xl text-xs font-bold hover:bg-emerald-400 transition-all active:scale-95 flex items-center gap-2"
              >
                <CheckCircle2 size={14} />
                Mark Clean
              </button>
              <button 
                onClick={() => handleBulkUpdate('dirty')}
                className="px-4 py-2 bg-red-500 text-white rounded-xl text-xs font-bold hover:bg-red-400 transition-all active:scale-95 flex items-center gap-2"
              >
                <AlertCircle size={14} />
                Mark Dirty
              </button>
              <button 
                onClick={() => handleBulkUpdate('maintenance')}
                className="px-4 py-2 bg-amber-500 text-white rounded-xl text-xs font-bold hover:bg-amber-400 transition-all active:scale-95 flex items-center gap-2"
              >
                <RefreshCw size={14} />
                Maintenance
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
