import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, addDoc, doc, setDoc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { Room, OperationType, RoomType } from '../types';
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
  Edit2
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { motion } from 'motion/react';
import { toast } from 'sonner';

export function Rooms() {
  const { hotel, profile, currency, exchangeRate } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [roomTypes, setRoomTypes] = useState<RoomType[]>([]);
  const [isManagingTypes, setIsManagingTypes] = useState(false);
  const [editingRoomType, setEditingRoomType] = useState<RoomType | null>(null);
  const [newRoomType, setNewRoomType] = useState({
    name: '',
    description: '',
    basePrice: 0,
    capacity: 0,
    amenities: [] as string[],
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [capacityFilter, setCapacityFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({
    roomNumber: '',
    type: '',
    price: 0,
    floor: '1',
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
        status: 'clean',
      });
      setIsAddingRoom(false);
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
        capacity: 0,
        amenities: [],
      });
      setEditingRoomType(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/room_types`);
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
        user: profile?.email || profile?.uid || 'Unknown',
        action: 'UPDATE_ROOM_STATUS',
        module: `Room ${room?.roomNumber || roomId}: ${status}`
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
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
      (room.status?.replace('_', ' ').toLowerCase() || '').includes(query)
    );
    
    const matchesStatus = statusFilter === 'all' || room.status === statusFilter;
    const matchesType = typeFilter === 'all' || room.type === typeFilter;
    const matchesCapacity = capacityFilter === 'all' || room.capacity === Number(capacityFilter);
    
    return matchesSearch && matchesStatus && matchesType && matchesCapacity;
  });

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Rooms</h1>
          <p className="text-zinc-400">Manage room inventory and status</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1 sm:min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
              <input 
                type="text"
                placeholder="Search number, type..."
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-10 pr-4 py-2 text-white focus:border-emerald-500 outline-none transition-all text-sm"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <select 
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
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
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
            >
              <option value="all">All Types</option>
              {roomTypes.map(type => (
                <option key={type.id} value={type.name}>{type.name}</option>
              ))}
            </select>
            <select 
              className="bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-white text-sm outline-none focus:border-emerald-500"
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
              className={cn("flex-1 sm:flex-none p-1.5 rounded-md transition-all active:scale-90", view === 'grid' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white")}
            >
              <LayoutGrid size={18} className="mx-auto" />
            </button>
            <button 
              onClick={() => setView('list')}
              className={cn("flex-1 sm:flex-none p-1.5 rounded-md transition-all active:scale-90", view === 'list' ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-white")}
            >
              <List size={18} className="mx-auto" />
            </button>
          </div>
          <button 
            onClick={() => setIsAddingRoom(true)}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <Plus size={18} />
            Add Room
          </button>
          <button 
            onClick={() => setIsManagingTypes(true)}
            className="w-full sm:w-auto bg-zinc-800 text-white px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-zinc-700 transition-all active:scale-95"
          >
            <Settings2 size={18} />
            Types
          </button>
        </div>
      </header>

      {isAddingRoom && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">Add New Room</h3>
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newRoom.floor}
                    onChange={(e) => setNewRoom({ ...newRoom, floor: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Capacity</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newRoom.capacity}
                    onChange={(e) => setNewRoom({ ...newRoom, capacity: Number(e.target.value) })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Price per Night</label>
                  <input 
                    type="number" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
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
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
                  value={newRoom.description}
                  onChange={(e) => setNewRoom({ ...newRoom, description: e.target.value })}
                />
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAddingRoom(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
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

      {isManagingTypes && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-xl font-bold text-white">Manage Room Types</h3>
              <button onClick={() => setIsManagingTypes(false)} className="text-zinc-500 hover:text-white">
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
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                      value={newRoomType.name}
                      onChange={(e) => setNewRoomType({ ...newRoomType, name: e.target.value })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Base Capacity</label>
                      <input 
                        type="number" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                        value={newRoomType.capacity}
                        onChange={(e) => setNewRoomType({ ...newRoomType, capacity: Number(e.target.value) })}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Base Price</label>
                      <input 
                        type="number" 
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                        value={newRoomType.basePrice}
                        onChange={(e) => setNewRoomType({ ...newRoomType, basePrice: Number(e.target.value) })}
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
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
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
                            amenities: [],
                          });
                        }}
                        className="flex-1 bg-zinc-800 text-white font-bold py-2 rounded-lg hover:bg-zinc-700 transition-all active:scale-95"
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
                        <div className="font-bold text-white">{type.name}</div>
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
              className={cn(
                "aspect-square rounded-xl border-2 p-4 flex flex-col justify-between transition-all group relative overflow-hidden",
                room.status ? statusColors[room.status] : 'border-zinc-800 text-zinc-500 bg-zinc-800/5'
              )}
            >
              <div className="flex justify-between items-start">
                <span className="text-lg font-bold">{room.roomNumber}</span>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                  <button onClick={() => updateStatus(room.id, 'clean')} className="p-1 hover:bg-white/10 rounded"><CheckCircle2 size={14} /></button>
                  <button onClick={() => updateStatus(room.id, 'dirty')} className="p-1 hover:bg-white/10 rounded"><AlertCircle size={14} /></button>
                  <button onClick={() => updateStatus(room.id, 'maintenance')} className="p-1 hover:bg-white/10 rounded"><Wrench size={14} /></button>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">{room.type} • {room.capacity} Pax</div>
                <div className="text-xs font-medium">{(room.status || 'unknown').replace('_', ' ')}</div>
              </div>
            </motion.div>
          )))}
        </div>
      ) : (
        <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Type</th>
                <th className="px-6 py-4">Capacity</th>
                <th className="px-6 py-4">Floor</th>
                <th className="px-6 py-4">Price</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredRooms.map(room => (
                <tr key={room.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4 font-bold text-white">{room.roomNumber}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.type}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.capacity} Pax</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.floor}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{formatCurrency(room.price, currency, exchangeRate)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border",
                      room.status ? statusColors[room.status] : 'border-zinc-800 text-zinc-500 bg-zinc-800/5'
                    )}>
                      {(room.status || 'unknown').replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={() => setShowConfirmDeleteRoom(room.id)}
                      className="text-zinc-600 hover:text-red-500 transition-colors"
                    >
                      <XCircle size={18} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
