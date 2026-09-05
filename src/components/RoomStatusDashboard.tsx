import React, { useState, useEffect, useMemo } from 'react';
import { collection, onSnapshot, doc, updateDoc, addDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Room, Reservation, RoomType, OperationType, UserProfile } from '../types';
import { 
  Bed, 
  Search, 
  Filter, 
  CheckCircle2, 
  Clock, 
  AlertTriangle, 
  Wrench, 
  User, 
  Calendar, 
  FileText, 
  RefreshCw, 
  Sparkles, 
  X, 
  Plus, 
  Layers,
  ArrowRight,
  ShieldAlert
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format, parseISO, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { GuestFolio } from './GuestFolio';
import { toast } from 'sonner';
import { createAuditLog } from '../utils/database';

export type OperationalRoomStatus = 
  | 'occupied' 
  | 'vacant' 
  | 'reserved' 
  | 'out_of_order' 
  | 'dirty' 
  | 'clean' 
  | 'inspected' 
  | 'housekeeping_pending';

export function RoomStatusDashboard() {
  const { hotel, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedFloor, setSelectedFloor] = useState('all');
  const [selectedRoomType, setSelectedRoomType] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState<'all' | OperationalRoomStatus>('all');

  // Selected Room for Quick Action Modal
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [activeReservation, setActiveReservation] = useState<Reservation | null>(null);
  const [showFolio, setShowFolio] = useState(false);
  const [showWorkOrderModal, setShowWorkOrderModal] = useState(false);
  const [showStatusModal, setShowStatusModal] = useState(false);

  // Work order form
  const [workOrderForm, setWorkOrderForm] = useState({
    issue: '',
    priority: 'medium' as 'low' | 'medium' | 'high' | 'urgent',
    notes: '',
    assignedTo: ''
  });
  const [isSubmittingWorkOrder, setIsSubmittingWorkOrder] = useState(false);

  // 1. Live listener for Rooms
  useEffect(() => {
    if (!hotel?.id) return;
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');

    const unsub = onSnapshot(roomsRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Room));
      setRooms(data);
      setLoading(false);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
      setLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // 2. Live listener for Reservations
  useEffect(() => {
    if (!hotel?.id) return;
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');

    const unsub = onSnapshot(resRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as Reservation));
      setReservations(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
    });

    return () => unsub();
  }, [hotel?.id]);

  // 3. Live listener for Room Types
  useEffect(() => {
    if (!hotel?.id) return;
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');

    const unsub = onSnapshot(typesRef, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() } as RoomType));
      setRoomTypes(data);
    }, (err) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/room_types`);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Map active checked-in or upcoming reservations to rooms
  const activeReservationMap = useMemo(() => {
    const today = startOfDay(new Date());
    const map = new Map<string, { active?: Reservation; upcoming?: Reservation }>();

    for (const res of reservations) {
      if (res.status === 'cancelled' || res.status === 'no_show') continue;

      const checkIn = startOfDay(parseISO(res.checkIn));
      const checkOut = startOfDay(parseISO(res.checkOut));

      const roomKey = res.roomId || res.roomNumber;
      if (!roomKey) continue;

      const current = map.get(roomKey) || {};

      if (res.status === 'checked_in') {
        current.active = res;
      } else if (res.status === 'confirmed' || res.status === 'pending') {
        if (today <= checkIn) {
          if (!current.upcoming || parseISO(res.checkIn) < parseISO(current.upcoming.checkIn)) {
            current.upcoming = res;
          }
        }
      }

      map.set(roomKey, current);
      // Also map by roomNumber directly in case roomId differs
      if (res.roomNumber) {
        map.set(res.roomNumber, current);
      }
    }

    return map;
  }, [reservations]);

  // Compute operational status for each room based on live data
  const getOperationalStatus = (room: Room): OperationalRoomStatus => {
    const reservationInfo = activeReservationMap.get(room.id) || activeReservationMap.get(room.roomNumber);
    const hasActiveGuest = !!reservationInfo?.active;
    const hasUpcomingReservation = !!reservationInfo?.upcoming;

    // Room hardware/maintenance state takes precedence
    if (room.status === 'out_of_order' || room.status === 'out_of_service' || room.status === 'maintenance') {
      return 'out_of_order';
    }

    // Checked-in guest
    if (hasActiveGuest || room.status === 'occupied') {
      return 'occupied';
    }

    // Reserved upcoming
    if (hasUpcomingReservation || room.status === 'reserved') {
      return 'reserved';
    }

    // Housekeeping specific states
    if (room.status === 'dirty') {
      return 'dirty';
    }

    if (room.status === 'inspected') {
      return 'inspected';
    }

    if (room.status === 'cleaning') {
      return 'housekeeping_pending';
    }

    if (room.status === 'clean') {
      return 'clean';
    }

    return 'vacant';
  };

  // Distinct floors for filter
  const floors = useMemo(() => {
    const set = new Set<string>();
    rooms.forEach(r => {
      if (r.floor) set.add(r.floor.toString());
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  }, [rooms]);

  // Summary Metrics calculations
  const summaryMetrics = useMemo(() => {
    const counts: Record<OperationalRoomStatus, number> = {
      occupied: 0,
      vacant: 0,
      reserved: 0,
      out_of_order: 0,
      dirty: 0,
      clean: 0,
      inspected: 0,
      housekeeping_pending: 0
    };

    rooms.forEach(room => {
      const status = getOperationalStatus(room);
      counts[status] = (counts[status] || 0) + 1;
    });

    return counts;
  }, [rooms, activeReservationMap]);

  // Filtered rooms
  const filteredRooms = useMemo(() => {
    return rooms.filter(room => {
      // Search room number
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        const resInfo = activeReservationMap.get(room.id) || activeReservationMap.get(room.roomNumber);
        const guestName = resInfo?.active?.guestName || resInfo?.upcoming?.guestName || '';
        const match = 
          room.roomNumber.toLowerCase().includes(term) ||
          (room.type && room.type.toLowerCase().includes(term)) ||
          guestName.toLowerCase().includes(term);
        if (!match) return false;
      }

      // Filter floor
      if (selectedFloor !== 'all' && room.floor?.toString() !== selectedFloor) {
        return false;
      }

      // Filter room type
      if (selectedRoomType !== 'all' && room.type !== selectedRoomType) {
        return false;
      }

      // Filter status
      if (selectedStatus !== 'all') {
        const status = getOperationalStatus(room);
        if (status !== selectedStatus) return false;
      }

      return true;
    }).sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' }));
  }, [rooms, searchTerm, selectedFloor, selectedRoomType, selectedStatus, activeReservationMap]);

  // Room Card Color Definition strictly following prompt:
  // Occupied: Red
  // Vacant: Green
  // Reserved: Blue
  // Out of Order: Gray
  // Dirty: Orange
  // Clean: Green Variant (Mint / Teal Emerald)
  // Housekeeping Pending: Yellow
  const getStatusVisuals = (status: OperationalRoomStatus) => {
    switch (status) {
      case 'occupied':
        return {
          label: 'Occupied',
          cardBg: 'bg-red-950/20 hover:bg-red-950/30 border-red-500/50 hover:border-red-500',
          badgeBg: 'bg-red-500 text-white',
          textColor: 'text-red-400',
          dotColor: 'bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
        };
      case 'vacant':
        return {
          label: 'Vacant',
          cardBg: 'bg-emerald-950/20 hover:bg-emerald-950/30 border-emerald-500/50 hover:border-emerald-500',
          badgeBg: 'bg-emerald-500 text-black',
          textColor: 'text-emerald-400',
          dotColor: 'bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)]'
        };
      case 'reserved':
        return {
          label: 'Reserved',
          cardBg: 'bg-blue-950/20 hover:bg-blue-950/30 border-blue-500/50 hover:border-blue-500',
          badgeBg: 'bg-blue-500 text-white',
          textColor: 'text-blue-400',
          dotColor: 'bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]'
        };
      case 'out_of_order':
        return {
          label: 'Out of Order',
          cardBg: 'bg-zinc-900/60 hover:bg-zinc-900 border-zinc-600/60 hover:border-zinc-500',
          badgeBg: 'bg-zinc-600 text-zinc-100',
          textColor: 'text-zinc-400',
          dotColor: 'bg-zinc-500 shadow-[0_0_10px_rgba(113,113,122,0.5)]'
        };
      case 'dirty':
        return {
          label: 'Dirty',
          cardBg: 'bg-amber-950/20 hover:bg-amber-950/30 border-amber-600/50 hover:border-amber-500',
          badgeBg: 'bg-amber-600 text-white',
          textColor: 'text-amber-400',
          dotColor: 'bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.5)]'
        };
      case 'clean':
        return {
          label: 'Clean',
          cardBg: 'bg-teal-950/20 hover:bg-teal-950/30 border-teal-400/50 hover:border-teal-400',
          badgeBg: 'bg-teal-500 text-black',
          textColor: 'text-teal-300',
          dotColor: 'bg-teal-400 shadow-[0_0_10px_rgba(45,212,191,0.5)]'
        };
      case 'inspected':
        return {
          label: 'Inspected',
          cardBg: 'bg-emerald-950/30 hover:bg-emerald-950/40 border-emerald-400/50 hover:border-emerald-400',
          badgeBg: 'bg-emerald-600 text-white',
          textColor: 'text-emerald-300',
          dotColor: 'bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.5)]'
        };
      case 'housekeeping_pending':
        return {
          label: 'Housekeeping Pending',
          cardBg: 'bg-yellow-950/20 hover:bg-yellow-950/30 border-yellow-400/50 hover:border-yellow-400',
          badgeBg: 'bg-yellow-500 text-black',
          textColor: 'text-yellow-300',
          dotColor: 'bg-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.5)]'
        };
    }
  };

  // Open Room Quick Action Drawer
  const handleRoomClick = (room: Room) => {
    setActiveRoom(room);
    const resInfo = activeReservationMap.get(room.id) || activeReservationMap.get(room.roomNumber);
    setActiveReservation(resInfo?.active || resInfo?.upcoming || null);
  };

  // Quick Status Update
  const handleQuickStatusUpdate = async (newStatus: Room['status']) => {
    if (!hotel?.id || !activeRoom) return;
    try {
      const roomRef = doc(db, 'hotels', hotel.id, 'rooms', activeRoom.id);
      await updateDoc(roomRef, {
        status: newStatus,
        lastCleanedAt: newStatus === 'clean' ? new Date().toISOString() : undefined,
        lastFlaggedAt: new Date().toISOString()
      });

      await createAuditLog(
        hotel.id,
        'Housekeeping',
        'update_room_status',
        `Updated Room ${activeRoom.roomNumber} status to ${newStatus}`,
        'success',
        { roomId: activeRoom.id, roomNumber: activeRoom.roomNumber, newStatus },
        profile ? { uid: profile.uid, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(`Room ${activeRoom.roomNumber} updated to ${newStatus}`);
      setShowStatusModal(false);
    } catch (err: any) {
      toast.error('Failed to update room status');
    }
  };

  // Create Work Order
  const handleCreateWorkOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !activeRoom) return;

    if (!workOrderForm.issue.trim()) {
      toast.error('Please describe the maintenance issue');
      return;
    }

    setIsSubmittingWorkOrder(true);
    try {
      const maintenanceRef = collection(db, 'hotels', hotel.id, 'maintenance');
      await addDoc(maintenanceRef, {
        roomNumber: activeRoom.roomNumber,
        roomId: activeRoom.id,
        issue: workOrderForm.issue,
        priority: workOrderForm.priority,
        notes: workOrderForm.notes,
        assignedTo: workOrderForm.assignedTo,
        status: 'pending',
        timestamp: new Date().toISOString(),
        reportedBy: profile?.displayName || profile?.email || 'Staff'
      });

      // Optionally update room status to maintenance
      const roomRef = doc(db, 'hotels', hotel.id, 'rooms', activeRoom.id);
      await updateDoc(roomRef, {
        status: 'maintenance',
        lastFlaggedAt: new Date().toISOString()
      });

      await createAuditLog(
        hotel.id,
        'Maintenance',
        'create_work_order',
        `Created work order for Room ${activeRoom.roomNumber}: ${workOrderForm.issue} [${workOrderForm.priority.toUpperCase()}]`,
        'success',
        { roomId: activeRoom.id, roomNumber: activeRoom.roomNumber, issue: workOrderForm.issue },
        profile ? { uid: profile.uid, displayName: profile.displayName || profile.email } : undefined
      );

      toast.success(`Work order logged for Room ${activeRoom.roomNumber}`);
      setShowWorkOrderModal(false);
      setWorkOrderForm({ issue: '', priority: 'medium', notes: '', assignedTo: '' });
    } catch (err: any) {
      toast.error('Failed to log work order');
    } finally {
      setIsSubmittingWorkOrder(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 rounded-xl">
            <Bed size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-zinc-50 tracking-tight flex items-center gap-2">
              Real-Time Room Status Dashboard
              <span className="flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Live Feed
              </span>
            </h2>
            <p className="text-sm text-zinc-400">
              Instant multi-device room inventory synchronization. Zero refresh required.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500">
            Total Inventory: <strong className="text-zinc-200">{rooms.length} Rooms</strong>
          </span>
        </div>
      </div>

      {/* Live Room Statistics Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2.5">
        {/* Occupied: Red */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'occupied' ? 'all' : 'occupied')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'occupied' 
              ? "bg-red-500/20 border-red-500 ring-2 ring-red-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-red-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Occupied</span>
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]" />
          </div>
          <div className="text-2xl font-black text-red-400 mt-1">{summaryMetrics.occupied}</div>
        </button>

        {/* Vacant: Green */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'vacant' ? 'all' : 'vacant')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'vacant' 
              ? "bg-emerald-500/20 border-emerald-500 ring-2 ring-emerald-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-emerald-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Vacant</span>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]" />
          </div>
          <div className="text-2xl font-black text-emerald-400 mt-1">{summaryMetrics.vacant}</div>
        </button>

        {/* Reserved: Blue */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'reserved' ? 'all' : 'reserved')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'reserved' 
              ? "bg-blue-500/20 border-blue-500 ring-2 ring-blue-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-blue-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Reserved</span>
            <div className="w-2.5 h-2.5 rounded-full bg-blue-500 shadow-[0_0_8px_rgba(59,130,246,0.6)]" />
          </div>
          <div className="text-2xl font-black text-blue-400 mt-1">{summaryMetrics.reserved}</div>
        </button>

        {/* Out of Order: Gray */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'out_of_order' ? 'all' : 'out_of_order')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'out_of_order' 
              ? "bg-zinc-800 border-zinc-500 ring-2 ring-zinc-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-zinc-600"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Out of Order</span>
            <div className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
          </div>
          <div className="text-2xl font-black text-zinc-400 mt-1">{summaryMetrics.out_of_order}</div>
        </button>

        {/* Dirty: Orange */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'dirty' ? 'all' : 'dirty')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'dirty' 
              ? "bg-amber-500/20 border-amber-500 ring-2 ring-amber-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-amber-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Dirty</span>
            <div className="w-2.5 h-2.5 rounded-full bg-amber-500 shadow-[0_0_8px_rgba(245,158,11,0.6)]" />
          </div>
          <div className="text-2xl font-black text-amber-400 mt-1">{summaryMetrics.dirty}</div>
        </button>

        {/* Clean: Green Variant */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'clean' ? 'all' : 'clean')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'clean' 
              ? "bg-teal-500/20 border-teal-500 ring-2 ring-teal-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-teal-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Clean</span>
            <div className="w-2.5 h-2.5 rounded-full bg-teal-400 shadow-[0_0_8px_rgba(45,212,191,0.6)]" />
          </div>
          <div className="text-2xl font-black text-teal-300 mt-1">{summaryMetrics.clean}</div>
        </button>

        {/* Inspected: Cyan/Emerald Variant */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'inspected' ? 'all' : 'inspected')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'inspected' 
              ? "bg-emerald-500/20 border-emerald-500 ring-2 ring-emerald-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-emerald-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Inspected</span>
            <div className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.6)]" />
          </div>
          <div className="text-2xl font-black text-emerald-300 mt-1">{summaryMetrics.inspected}</div>
        </button>

        {/* Housekeeping Pending: Yellow */}
        <button
          onClick={() => setSelectedStatus(selectedStatus === 'housekeeping_pending' ? 'all' : 'housekeeping_pending')}
          className={cn(
            "p-3 rounded-xl border text-left transition-all",
            selectedStatus === 'housekeeping_pending' 
              ? "bg-yellow-500/20 border-yellow-500 ring-2 ring-yellow-500/30" 
              : "bg-zinc-900/60 border-zinc-800/80 hover:border-yellow-500/40"
          )}
        >
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Housekeeping</span>
            <div className="w-2.5 h-2.5 rounded-full bg-yellow-400 shadow-[0_0_8px_rgba(250,204,21,0.6)]" />
          </div>
          <div className="text-2xl font-black text-yellow-300 mt-1">{summaryMetrics.housekeeping_pending}</div>
        </button>
      </div>

      {/* Filter Toolbar */}
      <div className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        {/* Search by room number or guest */}
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search by room number, type, or guest name..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs text-zinc-100 placeholder-zinc-500 outline-none focus:border-emerald-500"
          />
        </div>

        {/* Dropdowns */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Floor filter */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Layers size={14} className="text-zinc-500" />
            <select
              value={selectedFloor}
              onChange={(e) => setSelectedFloor(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
            >
              <option value="all">All Floors</option>
              {floors.map(floor => (
                <option key={floor} value={floor}>Floor {floor}</option>
              ))}
            </select>
          </div>

          {/* Room Type filter */}
          <div className="flex items-center gap-1.5 text-xs text-zinc-400">
            <Filter size={14} className="text-zinc-500" />
            <select
              value={selectedRoomType}
              onChange={(e) => setSelectedRoomType(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
            >
              <option value="all">All Room Types</option>
              {roomTypes.map(t => (
                <option key={t.id} value={t.name}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Status filter dropdown */}
          <select
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as any)}
            className="bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5 text-xs text-zinc-200 outline-none focus:border-emerald-500"
          >
            <option value="all">All Statuses</option>
            <option value="occupied">Occupied (Red)</option>
            <option value="vacant">Vacant (Green)</option>
            <option value="reserved">Reserved (Blue)</option>
            <option value="out_of_order">Out of Order (Gray)</option>
            <option value="dirty">Dirty (Orange)</option>
            <option value="clean">Clean (Mint / Teal)</option>
            <option value="inspected">Inspected (Emerald)</option>
            <option value="housekeeping_pending">Housekeeping Pending (Yellow)</option>
          </select>

          {selectedStatus !== 'all' && (
            <button
              onClick={() => setSelectedStatus('all')}
              className="text-xs text-zinc-400 hover:text-zinc-200 underline"
            >
              Clear Filter
            </button>
          )}
        </div>
      </div>

      {/* VISUAL ROOM GRID */}
      {loading ? (
        <div className="py-20 text-center text-zinc-500">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-3 text-emerald-500" />
          Synchronizing live hotel room inventory...
        </div>
      ) : filteredRooms.length === 0 ? (
        <div className="py-16 text-center text-zinc-500 bg-zinc-900/40 rounded-2xl border border-zinc-800">
          <Bed className="w-10 h-10 mx-auto mb-2 text-zinc-600" />
          No rooms match the selected filters.
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
          {filteredRooms.map((room) => {
            const status = getOperationalStatus(room);
            const visuals = getStatusVisuals(status);
            const resInfo = activeReservationMap.get(room.id) || activeReservationMap.get(room.roomNumber);
            const activeRes = resInfo?.active || resInfo?.upcoming;

            const guestName = activeRes?.guestName || (status === 'vacant' ? 'No Guest' : 'Available');
            const roomType = room.type || 'Standard';
            const checkOutDate = activeRes?.checkOut ? format(parseISO(activeRes.checkOut), 'dd MMM') : '-';

            return (
              <div
                key={room.id}
                onClick={() => handleRoomClick(room)}
                className={cn(
                  "p-4 rounded-2xl border cursor-pointer transition-all flex flex-col justify-between relative group shadow-sm",
                  visuals.cardBg
                )}
              >
                {/* Top Row: Room Number and Status Badge */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-black text-zinc-50 tracking-tight">
                      Room {room.roomNumber}
                    </span>
                    {activeRes?.isPrincipalRoom && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300 font-bold">
                        Master
                      </span>
                    )}
                    {activeRes?.principalRoomNumber && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 font-bold">
                        L: {activeRes.principalRoomNumber}
                      </span>
                    )}
                  </div>
                  <span className={cn("text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider", visuals.badgeBg)}>
                    {visuals.label}
                  </span>
                </div>

                {/* Body: Guest Name, Room Type, Check-Out Date */}
                <div className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Guest:</span>
                    <strong className="text-zinc-100 font-semibold truncate max-w-[130px]" title={guestName}>
                      {guestName}
                    </strong>
                  </div>

                  <div className="flex items-center justify-between text-zinc-400">
                    <span>Room Type:</span>
                    <span className="text-zinc-300 truncate max-w-[130px]">{roomType}</span>
                  </div>

                  <div className="flex items-center justify-between text-zinc-400">
                    <span>{status === 'occupied' ? 'Check-Out:' : 'Next Available:'}</span>
                    <span className="font-mono text-zinc-300 font-medium">{checkOutDate}</span>
                  </div>
                </div>

                {/* Bottom interactive hover hint */}
                <div className="mt-3 pt-2 border-t border-zinc-800/60 flex items-center justify-between text-[10px] text-zinc-500 group-hover:text-zinc-300 transition-colors">
                  <span>Floor {room.floor || '1'}</span>
                  <span className="flex items-center gap-0.5">
                    Actions <ArrowRight size={10} />
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* QUICK ACTION MODAL FOR CLICKED ROOM */}
      {activeRoom && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl animate-in fade-in zoom-in-95">
            {/* Modal Header */}
            <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-zinc-800 rounded-xl text-emerald-400">
                  <Bed size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-zinc-50">
                    Room {activeRoom.roomNumber} - Quick Management
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Floor {activeRoom.floor || '1'} • {activeRoom.type} • {getStatusVisuals(getOperationalStatus(activeRoom)).label}
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setActiveRoom(null);
                  setActiveReservation(null);
                }}
                className="p-1.5 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 space-y-4">
              {/* Guest & Stay info */}
              {activeReservation ? (
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 space-y-2 text-xs">
                  <div className="flex items-center justify-between font-semibold">
                    <span className="text-zinc-400">Current / Scheduled Guest:</span>
                    <span className="text-zinc-100">{activeReservation.guestName}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Stay Dates:</span>
                    <span className="text-zinc-200">
                      {format(parseISO(activeReservation.checkIn), 'MMM dd, yyyy')} - {format(parseISO(activeReservation.checkOut), 'MMM dd, yyyy')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-zinc-400">Status:</span>
                    <span className="uppercase text-emerald-400 font-bold">{activeReservation.status}</span>
                  </div>
                  {activeReservation.isPrincipalRoom && (
                    <div className="text-[11px] text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20">
                      Principal (Master) Room • Linked Rooms: {activeReservation.linkedRoomNumbers?.join(', ') || 'None'}
                    </div>
                  )}
                  {activeReservation.principalRoomNumber && (
                    <div className="text-[11px] text-blue-400 bg-blue-500/10 p-2 rounded border border-blue-500/20">
                      Linked to Master Room {activeReservation.principalRoomNumber}
                    </div>
                  )}
                </div>
              ) : (
                <div className="bg-zinc-950 p-4 rounded-xl border border-zinc-800 text-xs text-zinc-400 text-center">
                  Room is currently vacant without active guest check-in.
                </div>
              )}

              {/* Action Buttons as requested:
                  - Open guest folio
                  - View reservation
                  - Create work order
                  - Update Room Status */}
              <div className="grid grid-cols-2 gap-3 pt-2">
                {activeReservation ? (
                  <button
                    onClick={() => setShowFolio(true)}
                    className="p-3 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-left transition-all"
                  >
                    <FileText size={18} className="text-emerald-400 mb-1" />
                    <div className="text-xs font-bold text-zinc-100">Open Guest Folio</div>
                    <div className="text-[10px] text-zinc-400">View charges & payments</div>
                  </button>
                ) : (
                  <button
                    disabled
                    className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-left opacity-50 cursor-not-allowed"
                  >
                    <FileText size={18} className="text-zinc-600 mb-1" />
                    <div className="text-xs font-bold text-zinc-500">No Active Folio</div>
                    <div className="text-[10px] text-zinc-600">Room is vacant</div>
                  </button>
                )}

                <button
                  onClick={() => setShowWorkOrderModal(true)}
                  className="p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-left transition-all"
                >
                  <Wrench size={18} className="text-amber-400 mb-1" />
                  <div className="text-xs font-bold text-zinc-100">Create Work Order</div>
                  <div className="text-[10px] text-zinc-400">Report issue / maintenance</div>
                </button>

                <button
                  onClick={() => setShowStatusModal(true)}
                  className="p-3 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 rounded-xl text-left transition-all col-span-2"
                >
                  <RefreshCw size={18} className="text-blue-400 mb-1" />
                  <div className="text-xs font-bold text-zinc-100">Change Room Status</div>
                  <div className="text-[10px] text-zinc-400">Set clean, dirty, inspected, out of order</div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* QUICK STATUS CHANGER MODAL */}
      {showStatusModal && activeRoom && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-sm overflow-hidden shadow-2xl p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="font-bold text-zinc-50">Update Room {activeRoom.roomNumber} Status</h3>
              <button onClick={() => setShowStatusModal(false)} className="text-zinc-400 hover:text-zinc-50">
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2">
              <button
                onClick={() => handleQuickStatusUpdate('clean')}
                className="p-2.5 rounded-xl text-left text-xs font-bold bg-teal-500/10 hover:bg-teal-500/20 text-teal-300 border border-teal-500/30 transition-all flex items-center justify-between"
              >
                <span>Clean</span>
                <span className="w-2.5 h-2.5 rounded-full bg-teal-400" />
              </button>

              <button
                onClick={() => handleQuickStatusUpdate('inspected')}
                className="p-2.5 rounded-xl text-left text-xs font-bold bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 transition-all flex items-center justify-between"
              >
                <span>Inspected (Ready for Check-In)</span>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
              </button>

              <button
                onClick={() => handleQuickStatusUpdate('dirty')}
                className="p-2.5 rounded-xl text-left text-xs font-bold bg-amber-500/10 hover:bg-amber-500/20 text-amber-300 border border-amber-500/30 transition-all flex items-center justify-between"
              >
                <span>Dirty (Needs Housekeeping)</span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
              </button>

              <button
                onClick={() => handleQuickStatusUpdate('out_of_order')}
                className="p-2.5 rounded-xl text-left text-xs font-bold bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-all flex items-center justify-between"
              >
                <span>Out of Order</span>
                <span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
              </button>

              <button
                onClick={() => handleQuickStatusUpdate('maintenance')}
                className="p-2.5 rounded-xl text-left text-xs font-bold bg-amber-950/40 hover:bg-amber-900/40 text-amber-400 border border-amber-500/40 transition-all flex items-center justify-between"
              >
                <span>Under Maintenance</span>
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* CREATE WORK ORDER MODAL */}
      {showWorkOrderModal && activeRoom && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-md overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3 mb-4">
              <h3 className="font-bold text-zinc-50">Log Work Order - Room {activeRoom.roomNumber}</h3>
              <button onClick={() => setShowWorkOrderModal(false)} className="text-zinc-400 hover:text-zinc-50">
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleCreateWorkOrder} className="space-y-4 text-xs">
              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Issue Description *</label>
                <input
                  type="text"
                  placeholder="e.g. AC leaking water, TV remote not working..."
                  value={workOrderForm.issue}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, issue: e.target.value })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Priority</label>
                <select
                  value={workOrderForm.priority}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, priority: e.target.value as any })}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-amber-500"
                >
                  <option value="low">Low Priority</option>
                  <option value="medium">Medium Priority</option>
                  <option value="high">High Priority</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 font-semibold mb-1">Additional Notes</label>
                <textarea
                  placeholder="Optional details or instructions..."
                  value={workOrderForm.notes}
                  onChange={(e) => setWorkOrderForm({ ...workOrderForm, notes: e.target.value })}
                  rows={3}
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-zinc-100 outline-none focus:border-amber-500 resize-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowWorkOrderModal(false)}
                  className="px-4 py-2 rounded-xl text-zinc-400 hover:text-zinc-100 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingWorkOrder}
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-black font-bold rounded-xl transition-all"
                >
                  {isSubmittingWorkOrder ? 'Logging...' : 'Submit Work Order'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* GUEST FOLIO MODAL */}
      {showFolio && activeReservation && (
        <GuestFolio
          reservation={activeReservation}
          onClose={() => {
            setShowFolio(false);
            setActiveRoom(null);
            setActiveReservation(null);
          }}
        />
      )}
    </div>
  );
}
