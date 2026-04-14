import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, addDoc, doc, setDoc, deleteDoc, onSnapshot, writeBatch, increment } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { ConfirmModal } from './ConfirmModal';
import { GuestFolio } from './GuestFolio';
import { useAuth } from '../contexts/AuthContext';
import { Room, OperationType, RoomType, Reservation, UserProfile, RoomBlocking, RateConfiguration, InventoryConsumptionRule, InventoryItem } from '../types';
import { 
  Plus, 
  Search, 
  Filter, 
  LayoutGrid, 
  List,
  Bed,
  CheckCircle2,
  AlertCircle,
  Wrench,
  XCircle,
  Settings2,
  Trash2,
  Edit2,
  Download,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Info,
  LogOut,
  LogIn,
  FileText,
  X,
  MoreVertical,
  TrendingUp,
  Package
} from 'lucide-react';
import { cn, formatCurrency, exportToCSV } from '../utils';
import { motion, AnimatePresence } from 'motion/react';
import { toast } from 'sonner';
import { addDays, subDays, startOfDay, isWithinInterval, parseISO, eachDayOfInterval, isSameDay, format, isAfter, isBefore } from 'date-fns';
import { roomService } from '../services/roomService';

export function Rooms() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [editingRoomType, setEditingRoomType] = useState<RoomType | null>(null);
  const [newRoomType, setNewRoomType] = useState({
    name: '',
    description: '',
    basePrice: 0,
    capacity: 2,
    capacityAdults: 2,
    capacityChildren: 0,
    amenities: [] as string[],
  });
  const [isManagingBlockings, setIsManagingBlockings] = useState(false);
  const [isManagingRates, setIsManagingRates] = useState(false);
  const [isManagingConsumptionRules, setIsManagingConsumptionRules] = useState(false);
  const [blockings, setBlockings] = useState<RoomBlocking[]>([]);
  const [rateConfigs, setRateConfigs] = useState<RateConfiguration[]>([]);
  const [consumptionRules, setConsumptionRules] = useState<InventoryConsumptionRule[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [capacityFilter, setCapacityFilter] = useState<string>('all');
  const [reportFilter, setReportFilter] = useState({
    status: 'all',
    type: 'all',
    capacity: 'all'
  });
  const [view, setView] = useState<'grid' | 'list' | 'calendar'>('grid');
  const [sortBy, setSortBy] = useState<'roomNumber' | 'type' | 'status' | 'price' | 'floor'>('roomNumber');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [calendarStartDate, setCalendarStartDate] = useState(startOfDay(new Date()));
  const [selectedRooms, setSelectedRooms] = useState<string[]>([]);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({
    roomNumber: '',
    name: '',
    type: '',
    price: 0,
    floor: '1',
    building: '',
    wing: '',
    capacity: 0,
    amenities: [] as string[],
    description: '',
  });

  useEffect(() => {
    if (roomTypes.length > 0 && !newRoom.type) {
      const firstType = roomTypes[0];
      setNewRoom(prev => ({
        ...prev,
        type: firstType.name,
        price: firstType.basePrice,
        capacity: firstType.capacity,
        amenities: firstType.amenities || []
      }));
    }
  }, [roomTypes, newRoom.type]);

  const amenitiesOptions = [
    'WiFi', 'AC', 'TV', 'Mini Bar', 'Safe', 'Balcony', 'Sea View', 'Bathtub'
  ];

  const toggleAmenity = (amenity: string) => {
    setNewRoom(prev => ({
      ...prev,
      amenities: prev.amenities.includes(amenity)
        ? prev.amenities.filter(a => a !== amenity)
        : [...prev.amenities, amenity]
    }));
  };

  const [selectedReservation, setSelectedReservation] = useState<Reservation | null>(null);
  const [showQuickActionMenu, setShowQuickActionMenu] = useState(false);
  const [showFolio, setShowFolio] = useState(false);

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');
    
    const unsub = onSnapshot(roomsRef, (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
      if (err.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const typesRef = collection(db, 'hotels', hotel.id, 'room_types');
    
    const unsub = onSnapshot(typesRef, (snap) => {
      setRoomTypes(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomType)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/room_types`);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const reservationsRef = collection(db, 'hotels', hotel.id, 'reservations');
    
    const unsub = onSnapshot(reservationsRef, (snap) => {
      setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/reservations`);
    });

    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const blockingsRef = collection(db, 'hotels', hotel.id, 'room_blockings');
    const unsub = onSnapshot(blockingsRef, (snap) => {
      setBlockings(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RoomBlocking)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const ratesRef = collection(db, 'hotels', hotel.id, 'rate_configurations');
    const unsub = onSnapshot(ratesRef, (snap) => {
      setRateConfigs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as RateConfiguration)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const rulesRef = collection(db, 'hotels', hotel.id, 'inventory_consumption_rules');
    const unsub = onSnapshot(rulesRef, (snap) => {
      setConsumptionRules(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryConsumptionRule)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const invRef = collection(db, 'hotels', hotel.id, 'inventory');
    const unsub = onSnapshot(invRef, (snap) => {
      setInventoryItems(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as InventoryItem)));
    });
    return () => unsub();
  }, [hotel?.id, profile?.uid]);

  const addRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;
    try {
      const selectedType = roomTypes.find(t => t.name === newRoom.type);
      await addDoc(collection(db, 'hotels', hotel.id, 'rooms'), {
        ...newRoom,
        roomTypeId: selectedType?.id,
        capacity: selectedType?.capacity || newRoom.capacity,
        price: selectedType?.basePrice || newRoom.price,
        amenities: selectedType?.amenities || newRoom.amenities,
        status: 'vacant',
        createdAt: new Date().toISOString()
      });
      setIsAddingRoom(false);
      toast.success('Room added successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms`);
    }
  };

  const addRoomType = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;
    try {
      if (editingRoomType) {
        await setDoc(doc(db, 'hotels', hotel.id, 'room_types', editingRoomType.id), {
          ...newRoomType,
          updatedAt: new Date().toISOString()
        }, { merge: true });
        toast.success('Room type updated successfully');
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'room_types'), {
          ...newRoomType,
          createdAt: new Date().toISOString()
        });
        toast.success('Room type added successfully');
      }
      setNewRoomType({
        name: '',
        description: '',
        basePrice: 0,
        capacity: 2,
        capacityAdults: 2,
        capacityChildren: 0,
        amenities: [],
      });
      setEditingRoomType(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/room_types`);
    }
  };

  const updateRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !editingRoom) return;
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', editingRoom.id), {
        ...editingRoom,
        updatedAt: new Date().toISOString()
      }, { merge: true });
      toast.success('Room updated successfully');
      setEditingRoom(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${editingRoom.id}`);
    }
  };

  const [showConfirmDelete, setShowConfirmDelete] = useState<string | null>(null);
  const [showConfirmDeleteRoom, setShowConfirmDeleteRoom] = useState<string | null>(null);

  const deleteRoomType = async (id: string) => {
    if (!hotel?.id) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'room_types', id));
      toast.success('Room type deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/room_types/${id}`);
    }
  };

  const deleteRoom = async (id: string) => {
    if (!hotel?.id) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'rooms', id));
      toast.success('Room deleted successfully');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/rooms/${id}`);
    }
  };

  const updateStatus = async (roomId: string, status: Room['status']) => {
    if (!hotel?.id) return;
    const room = rooms.find(r => r.id === roomId);
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', roomId), { status }, { merge: true });

      // Log the action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'UPDATE_ROOM_STATUS',
        resource: `Room ${room?.roomNumber || roomId}: ${status}`,
        hotelId: hotel.id,
        module: 'Rooms'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
    }
  };

  const toggleRoomSelection = (roomId: string) => {
    setSelectedRooms(prev => 
      prev.includes(roomId) 
        ? prev.filter(id => id !== roomId) 
        : [...prev, roomId]
    );
  };

  const selectAllRooms = () => {
    if (selectedRooms.length === filteredRooms.length) {
      setSelectedRooms([]);
    } else {
      setSelectedRooms(filteredRooms.map(r => r.id));
    }
  };

  const bulkUpdateStatus = async (status: Room['status']) => {
    if (!hotel?.id || selectedRooms.length === 0) return;
    
    const loadingToast = toast.loading(`Updating ${selectedRooms.length} rooms...`);
    
    try {
      const promises = selectedRooms.map(roomId => 
        setDoc(doc(db, 'hotels', hotel.id!, 'rooms', roomId), { status }, { merge: true })
      );
      
      await Promise.all(promises);

      // Log the action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'BULK_UPDATE_ROOM_STATUS',
        resource: `${selectedRooms.length} rooms set to ${status}`,
        hotelId: hotel.id,
        module: 'Rooms'
      });

      toast.success(`Successfully updated ${selectedRooms.length} rooms`, { id: loadingToast });
      setSelectedRooms([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/bulk`);
      toast.error('Failed to update rooms', { id: loadingToast });
    }
  };

  const statusColors = {
    clean: 'border-emerald-500 text-emerald-500 bg-emerald-500/5',
    dirty: 'border-red-500 text-red-500 bg-red-500/5',
    occupied: 'border-blue-500 text-blue-500 bg-blue-500/5',
    maintenance: 'border-amber-500 text-amber-500 bg-amber-500/5',
    vacant: 'border-zinc-500 text-zinc-500 bg-zinc-500/5',
    out_of_service: 'border-zinc-800 text-zinc-800 bg-zinc-800/5',
  };

  const filteredRooms = rooms.filter(room => {
    const query = searchQuery.toLowerCase();
    const matchesSearch = (
      (room.roomNumber?.toLowerCase() || '').includes(query) ||
      (room.type?.toLowerCase() || '').includes(query) ||
      (room.status?.toLowerCase() || '').includes(query) ||
      (room.status?.replace('_', ' ').toLowerCase() || '').includes(query) ||
      (room.notes?.toLowerCase() || '').includes(query) ||
      (room.description?.toLowerCase() || '').includes(query)
    );
    
    const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
    const matchesType = typeFilter === 'all' || room.type === typeFilter;
    const matchesCapacity = capacityFilter === 'all' || room.capacity === Number(capacityFilter);
    
    return matchesSearch && matchesStatus && matchesType && matchesCapacity;
  }).sort((a, b) => {
    const factor = sortOrder === 'asc' ? 1 : -1;
    if (sortBy === 'roomNumber') {
      // Natural sort for room numbers
      return factor * a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true, sensitivity: 'base' });
    }
    if (sortBy === 'type') return factor * (a.type || '').localeCompare(b.type || '');
    if (sortBy === 'status') return factor * (a.status || '').localeCompare(b.status || '');
    if (sortBy === 'price') return factor * (a.price - b.price);
    if (sortBy === 'floor') return factor * (a.floor || '').localeCompare(b.floor || '');
    return 0;
  });

  const handleExport = () => {
    const dataToExport = rooms
      .filter(room => {
        const matchesStatus = reportFilter.status === 'all' || room.status === reportFilter.status;
        const matchesType = reportFilter.type === 'all' || room.type === reportFilter.type;
        const matchesCapacity = reportFilter.capacity === 'all' || room.capacity === Number(reportFilter.capacity);
        return matchesStatus && matchesType && matchesCapacity;
      })
      .map(r => {
        const assignedStaff = staff.find(s => s.uid === r.assignedTo);
        return {
          Room: r.roomNumber,
          Type: r.type,
          Price: r.price,
          Status: r.status,
          Floor: r.floor,
          Capacity: r.capacity,
          'Assigned Staff': assignedStaff ? (assignedStaff.displayName || assignedStaff.email) : 'Unassigned',
          Amenities: (r.amenities || []).join(', ')
        };
      });

    if (dataToExport.length === 0) {
      toast.info('No rooms found for the selected report filters');
      return;
    }

    exportToCSV(dataToExport, `rooms_report_${new Date().toISOString().split('T')[0]}.csv`);
    toast.success('Rooms report exported successfully');
  };

  const updateReservationStatus = async (res: Reservation, status: Reservation['status']) => {
    if (!hotel?.id || !profile) return;
    try {
      const batch = writeBatch(db);
      const resRef = doc(db, 'hotels', hotel.id, 'reservations', res.id);
      
      batch.update(resRef, { status });
      
      if (status === 'checked_in') {
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'occupied' });
      } else if (status === 'checked_out') {
        batch.update(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'dirty' });
      }

      await batch.commit();
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'RESERVATION_STATUS_UPDATE',
        resource: `Reservation for ${res.guestName} updated to ${status}`,
        hotelId: hotel.id,
        module: 'Rooms'
      });

      toast.success(`Reservation updated to ${status.replace('_', ' ')}`);
      setShowQuickActionMenu(false);
      setSelectedReservation(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/reservations/${res.id}`);
      toast.error('Failed to update reservation');
    }
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">Rooms</h1>
          <p className="text-zinc-400">Manage room inventory and status</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <select
              value={reportFilter.status}
              onChange={(e) => setReportFilter({ ...reportFilter, status: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="clean">Clean</option>
              <option value="dirty">Dirty</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
              <option value="vacant">Vacant</option>
              <option value="out_of_service">Out of Service</option>
            </select>
            <div className="w-px h-4 bg-zinc-800" />
            <select
              value={reportFilter.type}
              onChange={(e) => setReportFilter({ ...reportFilter, type: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Types</option>
              {roomTypes.map(type => (
                <option key={type.id} value={type.name}>{type.name}</option>
              ))}
            </select>
            <div className="w-px h-4 bg-zinc-800" />
            <select
              value={reportFilter.capacity}
              onChange={(e) => setReportFilter({ ...reportFilter, capacity: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Cap.</option>
              <option value="1">1 Pax</option>
              <option value="2">2 Pax</option>
              <option value="3">3 Pax</option>
              <option value="4">4 Pax</option>
              <option value="5">5+ Pax</option>
            </select>
          </div>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                type="text"
                placeholder="Search number, type..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select 
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 text-sm outline-none focus:border-emerald-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="clean">Clean</option>
              <option value="dirty">Dirty</option>
              <option value="occupied">Occupied</option>
              <option value="maintenance">Maintenance</option>
              <option value="vacant">Vacant</option>
              <option value="out_of_service">Out of Service</option>
            </select>
            <select 
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 text-sm outline-none focus:border-emerald-500"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              {roomTypes.map(type => (
                <option key={type.id} value={type.name}>{type.name}</option>
              ))}
            </select>
            <select 
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-50 text-sm outline-none focus:border-emerald-500"
              value={capacityFilter}
              onChange={(e) => setCapacityFilter(e.target.value)}
            >
              <option value="all">All Capacities</option>
              <option value="1">1 Person</option>
              <option value="2">2 Persons</option>
              <option value="3">3 Persons</option>
              <option value="4">4 Persons</option>
              <option value="5">5+ Persons</option>
            </select>
          </div>
          <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-1 justify-center">
            <button 
              onClick={() => setView('grid')}
              className={cn("flex-1 sm:flex-none p-1.5 rounded-md transition-all active:scale-90", view === 'grid' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-50")}
              title="Grid View"
            >
              <LayoutGrid size={18} className="mx-auto" />
            </button>
            <button 
              onClick={() => setView('list')}
              className={cn("flex-1 sm:flex-none p-1.5 rounded-md transition-all active:scale-90", view === 'list' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-50")}
              title="List View"
            >
              <List size={18} className="mx-auto" />
            </button>
            <button 
              onClick={() => setView('calendar')}
              className={cn("flex-1 sm:flex-none p-1.5 rounded-md transition-all active:scale-90", view === 'calendar' ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-50")}
              title="Availability Calendar"
            >
              <Calendar size={18} className="mx-auto" />
            </button>
          </div>

          {view !== 'calendar' && (
            <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-1.5">
              <span className="text-[10px] font-bold text-zinc-500 uppercase whitespace-nowrap">Sort:</span>
              <select 
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="bg-transparent text-xs text-zinc-300 focus:outline-none cursor-pointer"
              >
                <option value="roomNumber">Room #</option>
                <option value="type">Type</option>
                <option value="status">Status</option>
                <option value="price">Price</option>
                <option value="floor">Floor</option>
              </select>
              <button 
                onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                className="p-1 text-zinc-500 hover:text-emerald-500 transition-colors"
              >
                <TrendingUp size={14} className={cn("transition-transform", sortOrder === 'desc' && "rotate-180")} />
              </button>
            </div>
          )}
          <button 
            onClick={handleExport}
            className="w-full sm:w-auto bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export Report</span>
            <span className="sm:hidden">Export</span>
          </button>
          <button 
            onClick={() => setIsAddingRoom(true)}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <Plus size={18} />
            Add Room
          </button>
          <button 
            onClick={() => setIsManagingTypes(true)}
            className="w-full sm:w-auto bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Settings2 size={18} />
            Types
          </button>
          <button 
            onClick={() => setIsManagingBlockings(true)}
            className="w-full sm:w-auto bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <XCircle size={18} />
            Blockings
          </button>
          <button 
            onClick={() => setIsManagingRates(true)}
            className="w-full sm:w-auto bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <TrendingUp size={18} />
            Rates
          </button>
          <button 
            onClick={() => setIsManagingConsumptionRules(true)}
            className="w-full sm:w-auto bg-zinc-800 text-zinc-50 px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Package size={18} />
            Inv Sync
          </button>
        </div>
      </header>

      {/* Room Status Legend */}
      <div className="flex flex-wrap items-center gap-6 px-6 py-4 bg-zinc-900/30 border border-zinc-800/50 rounded-2xl">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.3)]" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Clean / Vacant</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Occupied</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.3)]" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Maintenance</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.3)]" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Dirty</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-zinc-500 shadow-[0_0_10px_rgba(113,113,122,0.3)]" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Vacant (Unready)</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-zinc-800" />
          <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">Out of Service</span>
        </div>
      </div>

      {/* Bulk Actions Bar */}
      {selectedRooms.length > 0 && (
        <motion.div 
          initial={{ y: 50, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-40 bg-zinc-900 border border-emerald-500/30 shadow-2xl shadow-emerald-500/10 px-6 py-4 rounded-2xl flex items-center gap-6 backdrop-blur-xl"
        >
          <div className="flex items-center gap-3 pr-6 border-r border-zinc-800">
            <div className="w-8 h-8 rounded-full bg-emerald-500 text-black flex items-center justify-center font-bold text-sm">
              {selectedRooms.length}
            </div>
            <span className="text-sm font-bold text-zinc-50 whitespace-nowrap">Rooms Selected</span>
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest mr-2">Set Status:</span>
            <button 
              onClick={() => bulkUpdateStatus('clean')}
              className="px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-xs font-bold hover:bg-emerald-500 hover:text-black transition-all"
            >
              Clean
            </button>
            <button 
              onClick={() => bulkUpdateStatus('dirty')}
              className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-500 border border-red-500/20 text-xs font-bold hover:bg-red-500 hover:text-white transition-all"
            >
              Dirty
            </button>
            <button 
              onClick={() => bulkUpdateStatus('maintenance')}
              className="px-3 py-1.5 rounded-lg bg-amber-500/10 text-amber-500 border border-amber-500/20 text-xs font-bold hover:bg-amber-500 hover:text-white transition-all"
            >
              Maintenance
            </button>
            <button 
              onClick={() => bulkUpdateStatus('out_of_service')}
              className="px-3 py-1.5 rounded-lg bg-zinc-800 text-zinc-400 border border-zinc-700 text-xs font-bold hover:bg-zinc-700 hover:text-white transition-all"
            >
              Out of Service
            </button>
          </div>

          <button 
            onClick={() => setSelectedRooms([])}
            className="ml-4 p-2 text-zinc-500 hover:text-white transition-colors"
          >
            <XCircle size={20} />
          </button>
        </motion.div>
      )}

      {isAddingRoom && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-6">Add New Room</h3>
            <form onSubmit={addRoom} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room Number</label>
                <input 
                  required
                  type="text" 
                  placeholder="e.g. 101, 204A"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newRoom.roomNumber}
                  onChange={(e) => setNewRoom({ ...newRoom, roomNumber: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type</label>
                  <select 
                    required
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.type}
                    onChange={(e) => {
                      const type = roomTypes.find(t => t.name === e.target.value);
                      setNewRoom({ 
                        ...newRoom, 
                        type: e.target.value,
                        price: type?.basePrice || 0,
                        capacity: type?.capacity || 0,
                        amenities: type?.amenities || []
                      });
                    }}
                  >
                    <option value="" disabled>Select Type</option>
                    {roomTypes.map(type => (
                      <option key={type.id} value={type.name}>{type.name}</option>
                    ))}
                  </select>
                  {roomTypes.length === 0 && (
                    <p className="text-[10px] text-amber-500 mt-1">Please add a room type first using the "Types" button.</p>
                  )}
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Floor</label>
                  <input 
                    type="text" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.floor}
                    onChange={(e) => setNewRoom({ ...newRoom, floor: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Building</label>
                  <input 
                    type="text" 
                    placeholder="e.g. Main, Annex"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.building}
                    onChange={(e) => setNewRoom({ ...newRoom, building: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Wing</label>
                  <input 
                    type="text" 
                    placeholder="e.g. East, West"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.wing}
                    onChange={(e) => setNewRoom({ ...newRoom, wing: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Capacity</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.capacity}
                    onChange={(e) => setNewRoom({ ...newRoom, capacity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Price per Night</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                    value={newRoom.price}
                    onChange={(e) => setNewRoom({ ...newRoom, price: Number(e.target.value) })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amenities</label>
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {amenitiesOptions.map(amenity => (
                    <button
                      key={amenity}
                      type="button"
                      onClick={() => toggleAmenity(amenity)}
                      className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold border transition-all",
                        newRoom.amenities.includes(amenity)
                          ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                          : "bg-zinc-950 border-zinc-800 text-zinc-500"
                      )}
                    >
                      {amenity}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Description</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                  value={newRoom.description}
                  onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                />
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAddingRoom(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={roomTypes.length === 0 || !newRoom.type}
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Create Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {isManagingBlockings && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-zinc-50">Room Blockings</h3>
              <button onClick={() => setIsManagingBlockings(false)} className="text-zinc-500 hover:text-zinc-50">
                <XCircle size={24} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">New Blocking</h4>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const roomId = formData.get('roomId') as string;
                  const startDate = formData.get('startDate') as string;
                  const endDate = formData.get('endDate') as string;
                  const reason = formData.get('reason') as any;
                  const notes = formData.get('notes') as string;

                  if (!hotel?.id || !profile?.uid) return;
                  try {
                    await roomService.blockRoom(hotel.id, {
                      roomId,
                      startDate,
                      endDate,
                      reason,
                      notes,
                      blockedBy: profile.uid
                    });
                    toast.success('Room blocked successfully');
                    e.currentTarget.reset();
                  } catch (err) {
                    toast.error('Failed to block room');
                  }
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room</label>
                    <select name="roomId" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNumber} - {r.type}</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Start Date</label>
                      <input name="startDate" type="date" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">End Date</label>
                      <input name="endDate" type="date" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Reason</label>
                    <select name="reason" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                      <option value="maintenance">Maintenance</option>
                      <option value="vip">VIP Guest</option>
                      <option value="event">Event</option>
                      <option value="temporary">Temporary</option>
                      <option value="permanent">Permanent</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                    <textarea name="notes" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20" />
                  </div>
                  <button type="submit" className="w-full bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95">
                    Block Room
                  </button>
                </form>
              </div>
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Active Blockings</h4>
                <div className="space-y-3">
                  {blockings.map(b => (
                    <div key={b.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="font-bold text-zinc-50">Room {rooms.find(r => r.id === b.roomId)?.roomNumber}</div>
                        <div className="text-xs text-zinc-500">{format(new Date(b.startDate), 'MMM dd')} - {format(new Date(b.endDate), 'MMM dd')}</div>
                        <div className="text-[10px] text-emerald-500 font-bold uppercase mt-1">{b.reason}</div>
                      </div>
                      <button 
                        onClick={() => hotel?.id && roomService.unblockRoom(hotel.id, b.id, b.roomId)}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isManagingRates && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-zinc-50">Rate Configuration</h3>
              <button onClick={() => setIsManagingRates(false)} className="text-zinc-500 hover:text-zinc-50">
                <XCircle size={24} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">New Rate Rule</h4>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const roomTypeId = formData.get('roomTypeId') as string;
                  const baseRate = Number(formData.get('baseRate'));
                  const weekendRate = Number(formData.get('weekendRate'));
                  const weekdayRate = Number(formData.get('weekdayRate'));

                  if (!hotel?.id) return;
                  try {
                    await addDoc(collection(db, 'hotels', hotel.id, 'rate_configurations'), {
                      roomTypeId,
                      baseRate,
                      weekendRate,
                      weekdayRate,
                      timestamp: new Date().toISOString()
                    });
                    toast.success('Rate rule added');
                    e.currentTarget.reset();
                  } catch (err) {
                    toast.error('Failed to add rate rule');
                  }
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room Type</label>
                    <select name="roomTypeId" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                      {roomTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Base Rate</label>
                    <input name="baseRate" type="number" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Weekend Rate</label>
                      <input name="weekendRate" type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Weekday Rate</label>
                      <input name="weekdayRate" type="number" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95">
                    Save Rate Rule
                  </button>
                </form>
              </div>
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Configured Rates</h4>
                <div className="space-y-3">
                  {rateConfigs.map(c => (
                    <div key={c.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="font-bold text-zinc-50">{roomTypes.find(t => t.id === c.roomTypeId)?.name}</div>
                        <div className="text-xs text-zinc-500">Base: {formatCurrency(c.baseRate, currency, exchangeRate)}</div>
                        <div className="flex gap-2 mt-1">
                          {c.weekendRate && <span className="text-[8px] px-1 bg-emerald-500/10 text-emerald-500 rounded border border-emerald-500/20">WE: {formatCurrency(c.weekendRate, currency, exchangeRate)}</span>}
                          {c.weekdayRate && <span className="text-[8px] px-1 bg-blue-500/10 text-blue-500 rounded border border-blue-500/20">WD: {formatCurrency(c.weekdayRate, currency, exchangeRate)}</span>}
                        </div>
                      </div>
                      <button 
                        onClick={() => hotel?.id && deleteDoc(doc(db, 'hotels', hotel.id, 'rate_configurations', c.id))}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isManagingConsumptionRules && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-zinc-50">Inventory Sync Rules</h3>
              <button onClick={() => setIsManagingConsumptionRules(false)} className="text-zinc-500 hover:text-zinc-50">
                <XCircle size={24} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">New Consumption Rule</h4>
                <form onSubmit={async (e) => {
                  e.preventDefault();
                  const formData = new FormData(e.currentTarget);
                  const roomTypeId = formData.get('roomTypeId') as string;
                  const itemId = formData.get('itemId') as string;
                  const quantity = Number(formData.get('quantity'));
                  const trigger = formData.get('trigger') as any;

                  if (!hotel?.id) return;
                  try {
                    await addDoc(collection(db, 'hotels', hotel.id, 'inventory_consumption_rules'), {
                      roomTypeId: roomTypeId === 'all' ? null : roomTypeId,
                      itemId,
                      quantity,
                      trigger,
                      timestamp: new Date().toISOString()
                    });
                    toast.success('Consumption rule added');
                    e.currentTarget.reset();
                  } catch (err) {
                    toast.error('Failed to add rule');
                  }
                }} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room Type</label>
                    <select name="roomTypeId" className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                      <option value="all">All Room Types</option>
                      {roomTypes.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Inventory Item</label>
                    <select name="itemId" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                      {inventoryItems.map(i => <option key={i.id} value={i.id}>{i.name} ({i.quantity} {i.unit})</option>)}
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Quantity</label>
                      <input name="quantity" type="number" step="0.01" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Trigger</label>
                      <select name="trigger" required className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none">
                        <option value="check_in">Check-in</option>
                        <option value="check_out">Check-out</option>
                        <option value="daily_cleaning">Daily Cleaning</option>
                        <option value="deep_cleaning">Deep Cleaning</option>
                      </select>
                    </div>
                  </div>
                  <button type="submit" className="w-full bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95">
                    Add Sync Rule
                  </button>
                </form>
              </div>
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Active Rules</h4>
                <div className="space-y-3">
                  {consumptionRules.map(r => (
                    <div key={r.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center justify-between">
                      <div>
                        <div className="font-bold text-zinc-50">{inventoryItems.find(i => i.id === r.itemId)?.name}</div>
                        <div className="text-xs text-zinc-500">{r.quantity} units on {r.trigger.replace('_', ' ')}</div>
                        <div className="text-[10px] text-zinc-600 mt-1">
                          Applies to: {r.roomTypeId ? roomTypes.find(t => t.id === r.roomTypeId)?.name : 'All Rooms'}
                        </div>
                      </div>
                      <button 
                        onClick={() => hotel?.id && deleteDoc(doc(db, 'hotels', hotel.id, 'inventory_consumption_rules', r.id))}
                        className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {isManagingTypes && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-zinc-50">Manage Room Types</h3>
              <button onClick={() => setIsManagingTypes(false)} className="text-zinc-500 hover:text-zinc-50">
                <XCircle size={24} />
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 overflow-y-auto">
              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">{editingRoomType ? 'Edit Type' : 'Add New Type'}</h4>
                <form onSubmit={addRoomType} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type Name</label>
                    <input 
                      required
                      type="text" 
                      placeholder="e.g. Executive Suite"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={newRoomType.name}
                      onChange={(e) => setNewRoomType({ ...newRoomType, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Total Capacity</label>
                      <input 
                        type="number" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={newRoomType.capacity}
                        onChange={(e) => setNewRoomType({ ...newRoomType, capacity: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Adults</label>
                      <input 
                        type="number" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={newRoomType.capacityAdults}
                        onChange={(e) => setNewRoomType({ ...newRoomType, capacityAdults: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Children</label>
                      <input 
                        type="number" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                        value={newRoomType.capacityChildren}
                        onChange={(e) => setNewRoomType({ ...newRoomType, capacityChildren: Number(e.target.value) })}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Base Price</label>
                    <input 
                      type="number" 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                      value={newRoomType.basePrice}
                      onChange={(e) => setNewRoomType({ ...newRoomType, basePrice: Number(e.target.value) })}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Amenities</label>
                    <div className="grid grid-cols-3 gap-2 mt-1">
                      {amenitiesOptions.map(amenity => (
                        <button
                          key={amenity}
                          type="button"
                          onClick={() => {
                            setNewRoomType(prev => ({
                              ...prev,
                              amenities: prev.amenities.includes(amenity)
                                ? prev.amenities.filter(a => a !== amenity)
                                : [...prev.amenities, amenity]
                            }));
                          }}
                          className={cn(
                            "px-2 py-1 rounded text-[10px] font-bold border transition-all",
                            newRoomType.amenities.includes(amenity)
                              ? "bg-emerald-500/10 border-emerald-500 text-emerald-500"
                              : "bg-zinc-950 border-zinc-800 text-zinc-500"
                          )}
                        >
                          {amenity}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Description</label>
                    <textarea 
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none resize-none h-20"
                      value={newRoomType.description}
                      onChange={(e) => setNewRoomType({ ...newRoomType, description: e.target.value })}
                    />
                  </div>
                  <div className="flex gap-2">
                    {editingRoomType && (
                      <button 
                        type="button"
                        onClick={() => {
                          setEditingRoomType(null);
                          setNewRoomType({
                            name: '',
                            description: '',
                            basePrice: 0,
                            capacity: 2,
                            capacityAdults: 2,
                            capacityChildren: 0,
                            amenities: [],
                          });
                        }}
                        className="flex-1 bg-zinc-800 text-zinc-50 font-bold py-2 rounded-lg hover:bg-zinc-700 transition-all active:scale-95"
                      >
                        Cancel
                      </button>
                    )}
                    <button 
                      type="submit"
                      className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                    >
                      {editingRoomType ? 'Update Type' : 'Add Type'}
                    </button>
                  </div>
                </form>
              </div>

              <div className="space-y-6">
                <h4 className="text-sm font-bold text-zinc-400 uppercase tracking-wider">Existing Types</h4>
                <div className="space-y-3">
                  {roomTypes.map(type => (
                    <div key={type.id} className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl flex items-center justify-between group">
                      <div>
                        <div className="font-bold text-zinc-50 flex items-center gap-2">
                          {type.name}
                          {type.description && (
                            <div className="group/info relative">
                              <Info size={12} className="text-zinc-500 cursor-help" />
                              <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-zinc-900 border border-zinc-800 rounded-xl shadow-2xl opacity-0 group-hover/info:opacity-100 pointer-events-none transition-opacity z-50">
                                <p className="text-[10px] text-zinc-400 normal-case font-normal leading-relaxed">
                                  {type.description}
                                </p>
                              </div>
                            </div>
                          )}
                        </div>
                        <div className="text-xs text-zinc-500">{type.capacity} Pax • {formatCurrency(type.basePrice, currency, exchangeRate)}</div>
                        {type.amenities && type.amenities.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1">
                            {type.amenities.map(a => (
                              <span key={a} className="text-[8px] px-1 bg-zinc-900 text-zinc-500 rounded border border-zinc-800">{a}</span>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => {
                            setEditingRoomType(type);
                            setNewRoomType({
                              name: type.name,
                              description: type.description || '',
                              basePrice: type.basePrice,
                              capacity: type.capacity,
                              capacityAdults: type.capacityAdults || 2,
                              capacityChildren: type.capacityChildren || 0,
                              amenities: type.amenities || [],
                            });
                          }}
                          className="p-2 text-zinc-400 hover:text-emerald-500 transition-colors"
                        >
                          <Edit2 size={18} />
                        </button>
                        <button 
                          onClick={() => setShowConfirmDelete(type.id)}
                          className="p-2 text-zinc-400 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                    </div>
                  ))}
                  {roomTypes.length === 0 && (
                    <div className="text-center py-8 text-zinc-600 border border-dashed border-zinc-800 rounded-xl">
                      No custom room types defined yet.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!showConfirmDelete}
        title="Delete Room Type"
        message="Are you sure you want to delete this room type? This action cannot be undone."
        onConfirm={() => showConfirmDelete && deleteRoomType(showConfirmDelete)}
        onCancel={() => setShowConfirmDelete(null)}
        type="danger"
        confirmText="Delete"
      />

      <ConfirmModal
        isOpen={!!showConfirmDeleteRoom}
        title="Delete Room"
        message="Are you sure you want to delete this room? This action cannot be undone."
        onConfirm={() => showConfirmDeleteRoom && deleteRoom(showConfirmDeleteRoom)}
        onCancel={() => setShowConfirmDeleteRoom(null)}
        type="danger"
        confirmText="Delete"
      />

      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {filteredRooms.length === 0 ? (
            <div className="col-span-full py-20 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <Bed size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No rooms found matching your filters</p>
            </div>
          ) : (
            filteredRooms.map((room) => (
            <motion.div
              layout
              key={room.id}
              onClick={() => toggleRoomSelection(room.id)}
              className={cn(
                "aspect-square rounded-xl border-2 p-4 flex flex-col justify-between transition-all group relative overflow-hidden cursor-pointer",
                room.status ? statusColors[room.status] : 'border-zinc-800 text-zinc-500 bg-zinc-800/5',
                selectedRooms.includes(room.id) && "ring-2 ring-emerald-500 ring-offset-4 ring-offset-zinc-950 scale-[0.98]"
              )}
            >
              {selectedRooms.includes(room.id) && (
                <div className="absolute top-2 right-2 bg-emerald-500 text-black rounded-full p-0.5 z-10">
                  <CheckCircle2 size={12} />
                </div>
              )}
              <div className="flex justify-between items-start">
                <div className="flex flex-col">
                  <span className="text-lg font-bold">{room.roomNumber}</span>
                  <span className="text-[10px] font-bold uppercase tracking-wider opacity-60">{room.type}</span>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                  <button 
                    onClick={(e) => { e.stopPropagation(); setEditingRoom(room); }} 
                    className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors"
                    title="Edit Room Details"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button onClick={(e) => { e.stopPropagation(); updateStatus(room.id, 'clean'); }} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors" title="Mark Clean"><CheckCircle2 size={14} /></button>
                  <button onClick={(e) => { e.stopPropagation(); updateStatus(room.id, 'dirty'); }} className="p-1.5 bg-white/10 hover:bg-white/20 rounded-lg transition-colors" title="Mark Dirty"><AlertCircle size={14} /></button>
                </div>
              </div>
              
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className={cn(
                    "px-2 py-0.5 rounded text-[8px] font-bold uppercase tracking-widest border",
                    room.status === 'clean' ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400" :
                    room.status === 'dirty' ? "bg-red-500/20 border-red-500/30 text-red-400" :
                    room.status === 'maintenance' ? "bg-amber-500/20 border-amber-500/30 text-amber-400" :
                    room.status === 'occupied' ? "bg-blue-500/20 border-blue-500/30 text-blue-400" :
                    "bg-zinc-800 border-zinc-700 text-zinc-400"
                  )}>
                    {room.status.replace('_', ' ')}
                  </div>
                  <div className="text-[10px] font-bold opacity-60">{room.capacity} Pax</div>
                </div>

                {room.notes && (
                  <div className="bg-black/20 p-2 rounded-lg border border-white/5">
                    <div className="flex items-center gap-1 text-[8px] font-bold uppercase tracking-wider opacity-50 mb-0.5">
                      <FileText size={8} />
                      Notes
                    </div>
                    <p className="text-[9px] leading-tight line-clamp-2 opacity-80 italic">
                      {room.notes}
                    </p>
                  </div>
                )}
              </div>
            </motion.div>
          )))}
        </div>
      ) : view === 'list' ? (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">
                  <input 
                    type="checkbox" 
                    className="rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                    checked={selectedRooms.length === filteredRooms.length && filteredRooms.length > 0}
                    onChange={selectAllRooms}
                  />
                </th>
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4 text-right">Price</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Assigned Staff</th>
                <th className="px-6 py-4">Floor</th>
                <th className="px-6 py-4">Capacity</th>
                <th className="px-6 py-4">Amenities</th>
                <th className="px-6 py-4">Notes</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredRooms.map((room) => (
                <tr key={room.id} className="hover:bg-zinc-800/50 transition-colors group">
                  <td className="px-6 py-4">
                    <input 
                      type="checkbox" 
                      className="rounded border-zinc-800 bg-zinc-950 text-emerald-500 focus:ring-emerald-500"
                      checked={selectedRooms.includes(room.id)}
                      onChange={() => toggleRoomSelection(room.id)}
                    />
                  </td>
                  <td className="px-6 py-4 font-bold text-zinc-50">{room.roomNumber}</td>
                  <td className="px-6 py-4 text-zinc-400 text-sm">{room.type}</td>
                  <td className="px-6 py-4 text-right text-zinc-50 font-medium">{formatCurrency(room.price, currency, exchangeRate)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border",
                      statusColors[room.status]
                    )}>
                      {room.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    {room.assignedTo ? (
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 bg-zinc-800 rounded-full flex items-center justify-center text-[10px] text-zinc-400 font-bold">
                          {(staff.find(s => s.uid === room.assignedTo)?.displayName || staff.find(s => s.uid === room.assignedTo)?.email || '?')[0].toUpperCase()}
                        </div>
                        <span className="text-xs text-zinc-400">
                          {staff.find(s => s.uid === room.assignedTo)?.displayName || staff.find(s => s.uid === room.assignedTo)?.email}
                        </span>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600 italic">Unassigned</span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-zinc-400 text-sm">{room.floor}</td>
                  <td className="px-6 py-4 text-zinc-400 text-sm">{room.capacity} Pax</td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(room.amenities || []).map(a => (
                        <span key={a} className="text-[8px] px-1 bg-zinc-800 text-zinc-500 rounded border border-zinc-700">{a}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-xs text-zinc-500 max-w-[150px] truncate" title={room.notes}>
                      {room.notes || '-'}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => setEditingRoom(room)} className="p-1 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded" title="Edit Room"><Edit2 size={16} /></button>
                      <button onClick={() => updateStatus(room.id, 'clean')} className="p-1 text-emerald-500 hover:bg-emerald-500/10 rounded" title="Mark Clean"><CheckCircle2 size={16} /></button>
                      <button onClick={() => updateStatus(room.id, 'dirty')} className="p-1 text-red-500 hover:bg-red-500/10 rounded" title="Mark Dirty"><AlertCircle size={16} /></button>
                      <button onClick={() => updateStatus(room.id, 'maintenance')} className="p-1 text-amber-500 hover:bg-amber-500/10 rounded" title="Maintenance"><Wrench size={16} /></button>
                      <button onClick={() => setShowConfirmDeleteRoom(room.id)} className="p-1 text-zinc-500 hover:text-red-500 hover:bg-red-500/10 rounded" title="Delete Room"><Trash2 size={16} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col">
          <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => setCalendarStartDate(subDays(calendarStartDate, 7))}
                className="p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all"
              >
                <ChevronLeft size={20} />
              </button>
              <h3 className="text-sm font-bold text-zinc-50 uppercase tracking-widest">
                {format(calendarStartDate, 'MMMM yyyy')}
              </h3>
              <button 
                onClick={() => setCalendarStartDate(addDays(calendarStartDate, 7))}
                className="p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all"
              >
                <ChevronRight size={20} />
              </button>
            </div>
            <button 
              onClick={() => setCalendarStartDate(startOfDay(new Date()))}
              className="text-xs font-bold text-emerald-500 hover:text-emerald-400 transition-colors"
            >
              Today
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="sticky left-0 z-20 bg-zinc-900 border-r border-b border-zinc-800 p-4 text-left min-w-[150px]">
                    <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Room</span>
                  </th>
                  {eachDayOfInterval({
                    start: calendarStartDate,
                    end: addDays(calendarStartDate, 13)
                  }).map(day => (
                    <th key={day.toISOString()} className={cn(
                      "border-b border-r border-zinc-800 p-2 min-w-[80px] text-center",
                      isSameDay(day, new Date()) ? "bg-emerald-500/5" : "bg-zinc-900/30"
                    )}>
                      <div className="text-[10px] font-bold text-zinc-500 uppercase">{format(day, 'EEE')}</div>
                      <div className={cn(
                        "text-sm font-bold",
                        isSameDay(day, new Date()) ? "text-emerald-500" : "text-zinc-50"
                      )}>{format(day, 'dd')}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredRooms.map(room => (
                  <tr key={room.id} className="group">
                    <td className="sticky left-0 z-10 bg-zinc-900 border-r border-b border-zinc-800 p-4 font-bold text-zinc-50 group-hover:bg-zinc-800 transition-colors">
                      <div className="flex flex-col">
                        <span>{room.roomNumber}</span>
                        <span className="text-[8px] text-zinc-500 font-normal uppercase tracking-tighter">{room.type}</span>
                      </div>
                    </td>
                    {eachDayOfInterval({
                      start: calendarStartDate,
                      end: addDays(calendarStartDate, 13)
                    }).map(day => {
                      const reservation = reservations.find(res => 
                        res.roomId === room.id && 
                        res.status !== 'cancelled' &&
                        res.status !== 'no_show' &&
                        isWithinInterval(day, {
                          start: startOfDay(parseISO(res.checkIn)),
                          end: subDays(startOfDay(parseISO(res.checkOut)), 1)
                        })
                      );

                      const checkoutToday = reservations.find(res =>
                        res.roomId === room.id &&
                        res.status !== 'cancelled' &&
                        res.status !== 'no_show' &&
                        isSameDay(day, parseISO(res.checkOut))
                      );

                      const checkinToday = reservations.find(res =>
                        res.roomId === room.id &&
                        res.status !== 'cancelled' &&
                        res.status !== 'no_show' &&
                        isSameDay(day, parseISO(res.checkIn))
                      );

                      return (
                        <td key={day.toISOString()} className={cn(
                          "border-r border-b border-zinc-800 p-1 min-w-[80px] h-16 relative group/cell transition-colors",
                          isSameDay(day, new Date()) ? "bg-emerald-500/5" : "bg-zinc-950/20",
                          !reservation && room.status === 'dirty' && "bg-red-500/5",
                          !reservation && room.status === 'maintenance' && "bg-amber-500/5"
                        )}>
                          {reservation ? (
                            <button 
                              onClick={() => {
                                setSelectedReservation(reservation);
                                setShowQuickActionMenu(true);
                              }}
                              className={cn(
                                "absolute inset-1 rounded-md p-1 text-[8px] font-bold overflow-hidden shadow-lg border text-left transition-all hover:scale-[1.02] active:scale-95 z-10",
                                reservation.status === 'checked_in' ? "bg-blue-500/20 border-blue-500/30 text-blue-400" : "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                              )}
                              title={`${reservation.guestName} (${format(parseISO(reservation.checkIn), 'MMM dd')} - ${format(parseISO(reservation.checkOut), 'MMM dd')})`}
                            >
                              <div className="truncate">{reservation.guestName}</div>
                              <div className="opacity-60 flex items-center justify-between">
                                <span>{reservation.status.replace('_', ' ')}</span>
                                {reservation.status === 'checked_in' && <div className="w-1 h-1 rounded-full bg-blue-400 animate-pulse" />}
                              </div>
                            </button>
                          ) : checkoutToday ? (
                            <button
                              onClick={() => {
                                setSelectedReservation(checkoutToday);
                                setShowQuickActionMenu(true);
                              }}
                              className="absolute inset-x-1 top-1 h-1/2 bg-zinc-800/50 border border-zinc-700 rounded-t-md p-1 text-[6px] font-bold text-zinc-500 overflow-hidden hover:bg-zinc-700 transition-colors z-10"
                            >
                              <div className="truncate">Out: {checkoutToday.guestName}</div>
                            </button>
                          ) : (
                            <div className="w-full h-full flex items-center justify-center opacity-0 group-hover/cell:opacity-100 transition-opacity">
                              <Plus size={14} className="text-zinc-700" />
                            </div>
                          )}
                          
                          {/* If someone is checking in today and it's not already occupied by a stay night */}
                          {!reservation && checkinToday && !checkoutToday && (
                            <div className="absolute inset-x-1 bottom-1 h-1/2 bg-emerald-500/5 border border-emerald-500/10 rounded-b-md p-1 flex items-end">
                              <span className="text-[6px] font-bold text-emerald-500/50 uppercase">In: {checkinToday.guestName}</span>
                            </div>
                          )}

                          {!reservation && !checkoutToday && isSameDay(day, new Date()) && (
                            <div className={cn(
                              "absolute top-1 right-1 w-1.5 h-1.5 rounded-full",
                              room.status === 'clean' ? "bg-emerald-500" :
                              room.status === 'dirty' ? "bg-red-500" :
                              room.status === 'maintenance' ? "bg-amber-500" : "bg-zinc-500"
                            )} title={`Room is ${room.status}`} />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="p-4 bg-zinc-900/50 border-t border-zinc-800 flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-emerald-500/20 border border-emerald-500/30"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Confirmed</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-blue-500/20 border border-blue-500/30"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">In-House</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-3 h-3 rounded bg-zinc-950/20 border border-zinc-800"></div>
              <span className="text-[10px] font-bold text-zinc-500 uppercase">Available</span>
            </div>
          </div>
        </div>
      )}

      {/* Quick Action Menu */}
      <AnimatePresence>
        {showQuickActionMenu && selectedReservation && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-sm overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div>
                  <h2 className="text-lg font-bold text-zinc-50">{selectedReservation.guestName}</h2>
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Room {selectedReservation.roomNumber}</p>
                </div>
                <button 
                  onClick={() => setShowQuickActionMenu(false)}
                  className="p-2 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="p-6 space-y-3">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-800">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Check-In</div>
                    <div className="text-xs font-bold text-zinc-50">{format(parseISO(selectedReservation.checkIn), 'MMM dd, yyyy')}</div>
                  </div>
                  <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-800">
                    <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Check-Out</div>
                    <div className="text-xs font-bold text-zinc-50">{format(parseISO(selectedReservation.checkOut), 'MMM dd, yyyy')}</div>
                  </div>
                </div>

                {selectedReservation.status === 'pending' && (
                  <button 
                    onClick={() => updateReservationStatus(selectedReservation, 'checked_in')}
                    className="w-full flex items-center gap-3 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 p-4 rounded-2xl font-bold transition-all active:scale-95"
                  >
                    <LogIn size={20} />
                    Check-In Guest
                  </button>
                )}

                {selectedReservation.status === 'checked_in' && (
                  <button 
                    onClick={() => updateReservationStatus(selectedReservation, 'checked_out')}
                    className="w-full flex items-center gap-3 bg-blue-500 hover:bg-blue-600 text-zinc-50 p-4 rounded-2xl font-bold transition-all active:scale-95"
                  >
                    <LogOut size={20} />
                    Check-Out Guest
                  </button>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => {
                      setShowFolio(true);
                      setShowQuickActionMenu(false);
                    }}
                    className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 p-3 rounded-2xl text-xs font-bold transition-all active:scale-95"
                  >
                    <FileText size={16} />
                    View Folio
                  </button>
                  <button 
                    onClick={() => setShowQuickActionMenu(false)}
                    className="flex items-center justify-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 p-3 rounded-2xl text-xs font-bold transition-all active:scale-95"
                  >
                    <Info size={16} />
                    Details
                  </button>
                </div>

                {(selectedReservation.status === 'pending' || selectedReservation.status === 'no_show') && (
                  <button 
                    onClick={() => updateReservationStatus(selectedReservation, 'cancelled')}
                    className="w-full flex items-center justify-center gap-2 text-red-500 hover:bg-red-500/10 p-3 rounded-2xl text-xs font-bold transition-all"
                  >
                    <XCircle size={16} />
                    Cancel Reservation
                  </button>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {showFolio && selectedReservation && (
        <GuestFolio 
          reservation={selectedReservation}
          onClose={() => {
            setShowFolio(false);
            setSelectedReservation(null);
          }}
        />
      )}

      {/* Edit Room Modal */}
      <AnimatePresence>
        {editingRoom && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-lg overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div>
                  <h2 className="text-xl font-bold text-zinc-50">Room {editingRoom.roomNumber}</h2>
                  <p className="text-xs text-zinc-500 uppercase tracking-widest font-bold">Edit Room Details</p>
                </div>
                <button 
                  onClick={() => setEditingRoom(null)}
                  className="p-2 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all"
                >
                  <X size={20} />
                </button>
              </div>

              <form onSubmit={updateRoom} className="p-6 space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Room Number</label>
                    <input
                      type="text"
                      required
                      value={editingRoom.roomNumber}
                      onChange={(e) => setEditingRoom({ ...editingRoom, roomNumber: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Status</label>
                    <select
                      value={editingRoom.status}
                      onChange={(e) => setEditingRoom({ ...editingRoom, status: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="clean">Clean</option>
                      <option value="dirty">Dirty</option>
                      <option value="occupied">Occupied</option>
                      <option value="maintenance">Maintenance</option>
                      <option value="vacant">Vacant</option>
                      <option value="out_of_service">Out of Service</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Room Notes</label>
                  <textarea
                    value={editingRoom.notes || ''}
                    onChange={(e) => setEditingRoom({ ...editingRoom, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-white focus:outline-none focus:border-emerald-500/50 h-32 resize-none"
                    placeholder="Add notes about repairs, special requests, or room condition..."
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Floor</label>
                    <input
                      type="text"
                      value={editingRoom.floor}
                      onChange={(e) => setEditingRoom({ ...editingRoom, floor: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider">Price per Night</label>
                    <input
                      type="number"
                      value={editingRoom.price}
                      onChange={(e) => setEditingRoom({ ...editingRoom, price: Number(e.target.value) })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-sm text-white focus:outline-none focus:border-emerald-500/50"
                    />
                  </div>
                </div>

                <div className="flex gap-3 pt-4">
                  <button
                    type="button"
                    onClick={() => setEditingRoom(null)}
                    className="flex-1 px-6 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 rounded-xl font-bold transition-all active:scale-95"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="flex-1 px-6 py-3 bg-emerald-500 hover:bg-emerald-600 text-black rounded-xl font-bold transition-all active:scale-95"
                  >
                    Save Changes
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
