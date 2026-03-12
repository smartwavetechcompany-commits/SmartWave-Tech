import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, addDoc, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Room, OperationType } from '../types';
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
  XCircle
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { motion } from 'motion/react';

export function Rooms() {
  const { hotel, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [capacityFilter, setCapacityFilter] = useState<string>('all');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [isAddingRoom, setIsAddingRoom] = useState(false);
  const [newRoom, setNewRoom] = useState({
    number: '',
    type: 'Standard',
    price: 100,
    floor: '1',
    capacity: 2,
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  useEffect(() => {
    if (!hotel?.id || !profile || hasPermissionError) return;
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');
    const unsubscribe = onSnapshot(roomsRef, 
      (snap) => {
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/rooms`);
        if (err.code === 'permission-denied') {
          setHasPermissionError(true);
        }
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid, hasPermissionError]);

  const addRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id) return;
    try {
      await addDoc(collection(db, 'hotels', hotel.id, 'rooms'), {
        ...newRoom,
        status: 'clean',
      });
      setIsAddingRoom(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms`);
    }
  };

  const updateStatus = async (roomId: string, status: Room['status']) => {
    if (!hotel?.id) return;
    const room = rooms.find(r => r.id === roomId);
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', roomId), { status }, { merge: true });

      // Log the action
      await addDoc(collection(db, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        action: 'UPDATE_ROOM_STATUS',
        resource: `Room ${room?.number}: ${status}`,
        hotelId: hotel.id
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
      room.number.toLowerCase().includes(query) ||
      room.type.toLowerCase().includes(query) ||
      room.status.toLowerCase().includes(query) ||
      room.status.replace('_', ' ').toLowerCase().includes(query)
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
              <option value="Standard">Standard</option>
              <option value="Deluxe">Deluxe</option>
              <option value="Suite">Suite</option>
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
                  value={newRoom.number}
                  onChange={(e) => setNewRoom({ ...newRoom, number: e.target.value })}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Type</label>
                  <select 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newRoom.type}
                    onChange={(e) => setNewRoom({ ...newRoom, type: e.target.value })}
                  >
                    <option>Standard</option>
                    <option>Deluxe</option>
                    <option>Suite</option>
                  </select>
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
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Create Room
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {view === 'grid' ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {filteredRooms.map((room) => (
            <motion.div
              layout
              key={room.id}
              className={cn(
                "aspect-square rounded-xl border-2 p-4 flex flex-col justify-between transition-all group relative overflow-hidden",
                statusColors[room.status]
              )}
            >
              <div className="flex justify-between items-start">
                <span className="text-lg font-bold">{room.number}</span>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex flex-col gap-1">
                  <button onClick={() => updateStatus(room.id, 'clean')} className="p-1 hover:bg-white/10 rounded"><CheckCircle2 size={14} /></button>
                  <button onClick={() => updateStatus(room.id, 'dirty')} className="p-1 hover:bg-white/10 rounded"><AlertCircle size={14} /></button>
                  <button onClick={() => updateStatus(room.id, 'maintenance')} className="p-1 hover:bg-white/10 rounded"><Wrench size={14} /></button>
                </div>
              </div>
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider opacity-60">{room.type} • {room.capacity} Pax</div>
                <div className="text-xs font-medium">{room.status.replace('_', ' ')}</div>
              </div>
            </motion.div>
          ))}
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
                  <td className="px-6 py-4 font-bold text-white">{room.number}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.type}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.capacity} Pax</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{room.floor}</td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{formatCurrency(room.price)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border",
                      statusColors[room.status]
                    )}>
                      {room.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button 
                      onClick={async () => {
                        try {
                          await deleteDoc(doc(db, 'hotels', hotel!.id, 'rooms', room.id));
                        } catch (err) {
                          handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel!.id}/rooms/${room.id}`);
                        }
                      }}
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
