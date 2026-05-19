import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, onSnapshot, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { Room, OperationType, UserProfile, Reservation } from '../types';
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
  Square,
  Calendar,
  User as UserIcon
} from 'lucide-react';
import { cn, exportToCSV } from '../utils';
import { hasPermission } from '../utils/permissions';
import { canUpdateRoomStatus } from '../utils/policyUtils';
import { format, isWithinInterval, parseISO } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';

export function Housekeeping() {
  const { hotel, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [filter, setFilter] = useState<'all' | 'dirty' | 'clean' | 'maintenance' | 'out_of_service' | 'cleaning'>('all');
  const [roomTypeFilter, setRoomTypeFilter] = useState<string>('all');
  const [staffFilter, setStaffFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'roomNumber' | 'status' | 'floor'>('roomNumber');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [isLoading, setIsLoading] = useState(true);
  const [dateRange, setDateRange] = useState<{ start: string; end: string }>({ start: '', end: '' });
  const [roomNotes, setRoomNotes] = useState<Record<string, string>>({});
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [assignStaffId, setAssignStaffId] = useState<string>('');
  const [showBulkAssign, setShowBulkAssign] = useState(false);

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    setIsLoading(true);
    const q = query(collection(db, 'hotels', hotel.id, 'rooms'));
    
    const unsub = onSnapshot(q, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      setIsLoading(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/rooms`);
      if (error.code === 'permission-denied') {
        setHasPermissionError(true);
      }
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    const q = query(collection(db, 'users'), where('hotelId', '==', hotel.id));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(
      collection(db, 'hotels', hotel.id, 'reservations'),
      where('status', '==', 'checked_in')
    );
    
    const unsub = onSnapshot(q, (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  const updateRoomStatus = async (roomId: string, status: Room['status'], assignedTo?: string) => {
    if (!hotel?.id || !profile) return;
    const room = rooms.find(r => r.id === roomId);
    if (!room) return;

    // Check generic status update permission from settings
    const canUpdate = hotel.settings?.housekeeping?.allowStatusUpdates ?? true;
    if (!canUpdate && !hasPermission(profile, 'manage_rooms')) {
      toast.error('Room status updates are currently disabled by administrator.');
      return;
    }

    const policy = canUpdateRoomStatus(hotel, profile, room, status);
    if (!policy.allowed) {
      toast.error(policy.message || 'Action denied by hotel policy');
      return;
    }

    const notes = roomNotes[roomId] ?? room?.notes ?? '';
    const now = new Date().toISOString();
    
    try {
      const updateData: any = { 
        status,
        notes 
      };

      if (assignedTo !== undefined) updateData.assignedTo = assignedTo;
      if (status === 'clean') updateData.lastCleanedAt = now;
      if (status === 'maintenance' || status === 'dirty' || status === 'out_of_service') updateData.lastFlaggedAt = now;

      await database.safeSet(doc(db, 'hotels', hotel.id, 'rooms', roomId), updateData, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_UPDATE',
        details: `Updated room ${room?.roomNumber || roomId} status to ${status}`
      });

      // Log action for UI visibility
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: now,
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'HOUSEKEEPING_UPDATE',
        resource: `Room ${room?.roomNumber || roomId}: ${status}${notes ? ` (Note: ${notes})` : ''}${assignedTo ? ` (Assigned to: ${staff.find(s => s.uid === assignedTo)?.displayName || assignedTo})` : ''}`,
        hotelId: hotel.id,
        module: 'Housekeeping'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Housekeeping update activity'
      });
      toast.success(`Room ${room?.roomNumber} updated`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
      toast.error('Failed to update room');
    }
  };

  const handleBulkUpdate = async (status: Room['status']) => {
    if (!hotel?.id || selectedRoomIds.length === 0) return;
    
    const loadingToast = toast.loading(`Updating ${selectedRoomIds.length} rooms...`);
    const now = new Date().toISOString();

    try {
      const batch = writeBatch(db);
      
      for (const roomId of selectedRoomIds) {
        const room = rooms.find(r => r.id === roomId);
        if (!room) continue;

        const policy = canUpdateRoomStatus(hotel, profile, room, status);
        if (!policy.allowed) {
          toast.error(`Policy violation for Room ${room.roomNumber}: ${policy.message}`);
          setSelectedRoomIds([]); // Unselect to prevent partial batch if desired, or skip this room
          return; // Stop bulk update if any room fails policy
        }

        const notes = roomNotes[roomId] ?? room?.notes ?? '';
        
        const updateData: any = { 
          status, 
          notes,
          updatedAt: now
        };
        if (status === 'clean') updateData.lastCleanedAt = now;
        if (status === 'maintenance' || status === 'dirty' || status === 'out_of_service') updateData.lastFlaggedAt = now;

        batch.update(doc(db, 'hotels', hotel.id!, 'rooms', roomId), updateData);
      }

      await database.commitBatch(hotel.id, batch, {
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_BULK_UPDATE',
        details: `Bulk updated ${selectedRoomIds.length} rooms to ${status}`
      });

      // Log the bulk action for UI visibility
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: now,
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'HOUSEKEEPING_BULK_UPDATE',
        resource: `${selectedRoomIds.length} rooms updated to ${status}`,
        hotelId: hotel.id,
        module: 'Housekeeping'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Bulk housekeeping update activity'
      });

      toast.dismiss(loadingToast);
      toast.success(`Successfully updated ${selectedRoomIds.length} rooms to ${status.replace('_', ' ')}`);
      setSelectedRoomIds([]);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk`);
      toast.error('Failed to update rooms');
    }
  };

  const handleBulkAssign = async () => {
    if (!hotel?.id || selectedRoomIds.length === 0 || !assignStaffId) return;
    
    const loadingToast = toast.loading(`Assigning ${selectedRoomIds.length} rooms...`);
    const now = new Date().toISOString();
    const staffMember = staff.find(s => s.uid === assignStaffId);

    try {
      const batch = writeBatch(db);
      
      selectedRoomIds.forEach(roomId => {
        batch.update(doc(db, 'hotels', hotel.id!, 'rooms', roomId), { 
          assignedTo: assignStaffId,
          updatedAt: now
        });
      });

      await database.commitBatch(hotel.id, batch, {
        module: 'Housekeeping',
        action: 'HOUSEKEEPING_BULK_ASSIGN',
        details: `Assigned ${selectedRoomIds.length} rooms to ${staffMember?.displayName || assignStaffId}`
      });

      // Log the bulk action for UI visibility
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: now,
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'HOUSEKEEPING_ASSIGN',
        resource: `${selectedRoomIds.length} rooms assigned to ${staffMember?.displayName || staffMember?.email || assignStaffId}`,
        hotelId: hotel.id,
        module: 'Housekeeping'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Bulk housekeeping assignment activity'
      });

      toast.dismiss(loadingToast);
      toast.success(`Successfully assigned ${selectedRoomIds.length} rooms to ${staffMember?.displayName || staffMember?.email}`);
      setSelectedRoomIds([]);
      setAssignStaffId('');
      setShowBulkAssign(false);
    } catch (err) {
      toast.dismiss(loadingToast);
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk-assign`);
      toast.error('Failed to assign rooms');
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

    // Staff Filter
    if (staffFilter !== 'all' && r.assignedTo !== staffFilter) return false;

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

  const sortedRooms = [...filteredRooms].sort((a, b) => {
    let result = 0;
    if (sortBy === 'status') {
      result = a.status.localeCompare(b.status);
    } else if (sortBy === 'floor') {
      result = Number(a.floor || 0) - Number(b.floor || 0);
    } else {
      result = a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true });
    }
    return sortOrder === 'desc' ? -result : result;
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
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">Housekeeping</h1>
          <p className="text-zinc-400">Manage room cleaning and maintenance status</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
            <input 
              type="text"
              placeholder="Search rooms, status, or notes..."
              className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
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
            value={`${sortBy}-${sortOrder}`}
            onChange={(e) => {
              const [newSort, newOrder] = e.target.value.split('-') as [any, any];
              setSortBy(newSort);
              setSortOrder(newOrder);
            }}
          >
            <option value="roomNumber-asc">Room Number (Asc)</option>
            <option value="roomNumber-desc">Room Number (Desc)</option>
            <option value="status-asc">Status (A-Z)</option>
            <option value="status-desc">Status (Z-A)</option>
            <option value="floor-asc">Floor (Low-High)</option>
            <option value="floor-desc">Floor (High-Low)</option>
          </select>

          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="all">All Statuses</option>
            <option value="clean">Clean</option>
            <option value="cleaning">Cleaning</option>
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

          <select 
            className="bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5 text-xs text-white outline-none focus:border-emerald-500"
            value={staffFilter}
            onChange={(e) => setStaffFilter(e.target.value)}
          >
            <option value="all">All Staff</option>
            <option value="">Unassigned</option>
            {staff.map(s => (
              <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
            ))}
          </select>

          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-1.5">
            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-emerald-500" />
              <span className="text-[10px] font-bold text-zinc-500 uppercase">From:</span>
              <input 
                type="date"
                className="bg-transparent text-xs text-white outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
                value={dateRange.start}
                onChange={(e) => setDateRange(prev => ({ ...prev, start: e.target.value }))}
              />
            </div>
            <div className="w-px h-3 bg-zinc-800" />
            <div className="flex items-center gap-1.5">
              <Calendar size={14} className="text-emerald-500" />
              <span className="text-[10px] font-bold text-zinc-500 uppercase">To:</span>
              <input 
                type="date"
                className="bg-transparent text-xs text-white outline-none appearance-none"
                style={{ colorScheme: 'dark' }}
                value={dateRange.end}
                onChange={(e) => setDateRange(prev => ({ ...prev, end: e.target.value }))}
              />
            </div>
            {(dateRange.start || dateRange.end) && (
              <button 
                onClick={() => setDateRange({ start: '', end: '' })}
                className="text-zinc-500 hover:text-zinc-50 transition-colors"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 relative">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
            Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 h-64 animate-pulse space-y-4">
                <div className="flex justify-between items-center">
                  <div className="w-24 h-6 bg-zinc-800 rounded" />
                  <div className="w-16 h-4 bg-zinc-800 rounded" />
                </div>
                <div className="w-32 h-4 bg-zinc-800 rounded" />
                <div className="w-full h-20 bg-zinc-800 rounded-xl" />
                <div className="grid grid-cols-2 gap-2">
                  <div className="h-8 bg-zinc-800 rounded" />
                  <div className="h-8 bg-zinc-800 rounded" />
                </div>
              </div>
            ))
          ) : sortedRooms.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <p>No rooms found matching your filters</p>
            </div>
          ) : (
            sortedRooms.map(room => {
          const statusColor = hotel?.branding?.statusColors?.[room.status] || 
            (room.status === 'clean' ? '#10b981' : 
             room.status === 'dirty' ? '#ef4444' : 
             room.status === 'occupied' ? '#3b82f6' : 
             room.status === 'cleaning' ? '#8b5cf6' : 
             room.status === 'maintenance' ? '#f59e0b' : '#71717a');

          const isSelected = selectedRoomIds.includes(room.id);
          const activeReservation = reservations.find(res => res.roomId === room.id);

          return (
            <div 
              key={room.id} 
              className={cn(
                "bg-zinc-900 border rounded-xl p-4 space-y-3 flex flex-col transition-all relative group shadow-lg shadow-black/20",
                isSelected ? "border-emerald-500 ring-1 ring-emerald-500/10" : "border-zinc-800"
              )}
            >
              <button 
                onClick={() => toggleRoomSelection(room.id)}
                className="absolute top-3 right-3 text-zinc-700 hover:text-emerald-500 transition-colors"
              >
                {isSelected ? <CheckSquare size={18} className="text-emerald-500" /> : <Square size={18} />}
              </button>

          <div className="flex items-center justify-between pr-6">
            <span className="text-xl font-bold text-zinc-50">Room {room.roomNumber}</span>
            <div className="flex flex-col items-end gap-1">
              <span 
                style={{ 
                  backgroundColor: `${statusColor}1a`,
                  color: statusColor
                }}
                className="px-1.5 py-0.5 rounded text-[8px] font-black uppercase tracking-widest border border-[currentColor]/10"
              >
                {room.status.replace(/_/g, ' ')}
              </span>
              {room.assignedTo && (
                <div className="flex items-center gap-1 text-[8px] text-emerald-500 font-bold uppercase tracking-tighter">
                  <UserIcon size={10} />
                  {staff.find(s => s.uid === room.assignedTo)?.displayName?.split(' ')[0] || 'Assigned'}
                </div>
              )}
            </div>
          </div>
              
          <div className="text-[9px] text-zinc-500 uppercase font-black tracking-widest bg-zinc-950 px-2 py-0.5 rounded-md self-start">
            {room.type} • Floor {room.floor}
          </div>

          {activeReservation && (
            <div className="bg-blue-500/5 border border-blue-500/10 rounded-lg p-2.5 space-y-0.5">
              <div className="flex items-center gap-2 text-[8px] text-blue-500 font-black uppercase tracking-widest">
                <UserIcon size={10} />
                Current Guest
              </div>
              <p className="text-xs font-bold text-zinc-100">{activeReservation.guestName}</p>
              <p className="text-[9px] text-zinc-600 font-medium">Stay: {format(new Date(activeReservation.checkIn), 'MMM d')} - {format(new Date(activeReservation.checkOut), 'MMM d')}</p>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[8px] text-zinc-500 font-black uppercase tracking-widest">Assignment</label>
            <select
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-2 py-1.5 text-[11px] text-zinc-400 focus:border-emerald-500 outline-none transition-all"
              value={room.assignedTo || ''}
              onChange={(e) => updateRoomStatus(room.id, room.status, e.target.value)}
            >
              <option value="">Unassigned</option>
              {staff.map(s => (
                <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
              ))}
            </select>
          </div>

          <div className="flex-1 space-y-1.5">
            <label className="text-[8px] text-zinc-500 font-black uppercase tracking-widest">Notes</label>
            <textarea
              className="w-full bg-zinc-950 border border-zinc-800 rounded-lg p-2.5 text-[11px] text-zinc-400 focus:border-emerald-500 outline-none resize-none h-16 transition-all"
              placeholder="Maintenance items..."
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

          <div className="pt-3 border-t border-zinc-800 grid grid-cols-2 gap-2">
            <button 
              onClick={() => updateRoomStatus(room.id, 'clean')}
              disabled={room.status === 'clean'}
              className="flex items-center justify-center gap-1.5 bg-emerald-500/5 text-emerald-500 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/10 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
            >
              <CheckCircle2 size={12} />
              Clean
            </button>
            <button 
              onClick={() => updateRoomStatus(room.id, 'cleaning')}
              disabled={room.status === 'cleaning'}
              className="flex items-center justify-center gap-1.5 bg-purple-500/5 text-purple-500 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-purple-500/10 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
            >
              <Clock size={12} />
              Loading
            </button>
            <button 
              onClick={() => updateRoomStatus(room.id, 'dirty')}
              disabled={room.status === 'dirty'}
              className="flex items-center justify-center gap-1.5 bg-red-500/5 text-red-500 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-red-500/10 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
            >
              <AlertCircle size={12} />
              Dirty
            </button>
            <button 
              onClick={() => updateRoomStatus(room.id, 'maintenance')}
              disabled={room.status === 'maintenance'}
              className="flex items-center justify-center gap-1.5 bg-amber-500/5 text-amber-500 py-1.5 rounded-lg text-[9px] font-black uppercase tracking-widest hover:bg-amber-500/10 transition-all active:scale-95 disabled:opacity-20 disabled:grayscale"
            >
              <RefreshCw size={12} />
              Repair
            </button>
          </div>
        </div>
          );
            })
          )}
        </AnimatePresence>
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
                <p className="text-zinc-50 font-bold text-sm leading-none">Rooms Selected</p>
                <button 
                  onClick={() => setSelectedRoomIds([])}
                  className="text-zinc-500 text-[10px] font-bold uppercase tracking-widest hover:text-zinc-50 transition-colors"
                >
                  Clear Selection
                </button>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="h-8 w-px bg-zinc-800 mx-2" />
              
              <div className="flex items-center gap-2">
                <select
                  className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-50 focus:border-emerald-500 outline-none transition-all w-40"
                  value={assignStaffId}
                  onChange={(e) => setAssignStaffId(e.target.value)}
                >
                  <option value="">Select Staff...</option>
                  {staff.map(s => (
                    <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                  ))}
                </select>
                <button 
                  onClick={handleBulkAssign}
                  disabled={!assignStaffId}
                  className="px-4 py-2 bg-zinc-800 text-zinc-50 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-all active:scale-95 flex items-center gap-2 disabled:opacity-50"
                >
                  <UserIcon size={14} />
                  Assign Staff
                </button>
              </div>

              <div className="h-8 w-px bg-zinc-800 mx-2" />

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
