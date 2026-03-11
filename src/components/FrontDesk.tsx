import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, query, orderBy, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room } from '../types';
import { 
  Plus, 
  Search, 
  Calendar,
  User,
  CreditCard,
  CheckCircle2,
  XCircle,
  Clock,
  LogOut,
  RefreshCw
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format } from 'date-fns';

export function FrontDesk() {
  const { hotel, profile } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [isBooking, setIsBooking] = useState(false);
  const [newBooking, setNewBooking] = useState({
    guestName: '',
    roomId: '',
    checkIn: format(new Date(), 'yyyy-MM-dd'),
    checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
    totalAmount: 0,
  });

  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const fetchData = React.useCallback(async () => {
    if (!hotel?.id || !profile || hasPermissionError) return;

    setLoading(true);
    try {
      const resRef = collection(db, 'hotels', hotel.id, 'reservations');
      const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');

      const [resSnap, roomsSnap] = await Promise.all([
        getDocs(query(resRef, orderBy('checkIn', 'desc'))),
        getDocs(roomsRef)
      ]);

      setReservations(resSnap.docs.map(doc => {
        const data = doc.data() as Record<string, any>;
        return { id: doc.id, ...data } as Reservation;
      }));
      setRooms(roomsSnap.docs.map(doc => {
        const data = doc.data() as Record<string, any>;
        return { id: doc.id, ...data } as Room;
      }));
    } catch (err: any) {
      if (err.code === 'permission-denied') {
        setHasPermissionError(true);
      } else {
        console.error("FrontDesk data fetch error:", err);
      }
    } finally {
      setLoading(false);
    }
  }, [hotel?.id, profile, hasPermissionError]);

  useEffect(() => {
    setHasPermissionError(false);
    fetchData();
  }, [profile?.uid, hotel?.id, fetchData]);

  const handleBooking = async () => {
    if (!hotel?.id) return;
    const selectedRoom = rooms.find(r => r.id === newBooking.roomId);
    if (!selectedRoom) return;

    const resRef = await addDoc(collection(db, 'hotels', hotel.id, 'reservations'), {
      ...newBooking,
      roomNumber: selectedRoom.number,
      status: 'pending',
      paidAmount: 0,
    });

    // Log the action
    await addDoc(collection(db, 'activityLogs'), {
      timestamp: new Date().toISOString(),
      userId: profile?.uid,
      userEmail: profile?.email,
      action: 'CREATE_BOOKING',
      resource: `Booking for ${newBooking.guestName} (Room ${selectedRoom.number})`,
      hotelId: hotel.id
    });

    setIsBooking(false);
  };

  const updateReservationStatus = async (res: Reservation, status: Reservation['status']) => {
    if (!hotel?.id) return;
    await setDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), { status }, { merge: true });
    
    // If checking in, mark room as occupied
    if (status === 'checked_in') {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'occupied' }, { merge: true });
    } else if (status === 'checked_out') {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'dirty' }, { merge: true });
    }
  };

  return (
    <div className="p-8 space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Front Desk</h1>
          <p className="text-zinc-400">Manage bookings and guest check-ins</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => fetchData()}
            disabled={loading}
            className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Refresh Data"
          >
            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
          </button>
          <button 
            onClick={() => setIsBooking(true)}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <Plus size={18} />
            New Booking
          </button>
        </div>
      </header>

      {isBooking && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-white mb-6">New Reservation</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Guest Name</label>
                <input 
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.guestName}
                  onChange={(e) => setNewBooking({ ...newBooking, guestName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Room</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.roomId}
                  onChange={(e) => {
                    const room = rooms.find(r => r.id === e.target.value);
                    setNewBooking({ ...newBooking, roomId: e.target.value, totalAmount: room?.price || 0 });
                  }}
                >
                  <option value="">Select a room</option>
                  {rooms.filter(r => r.status === 'clean').map(room => (
                    <option key={room.id} value={room.id}>Room {room.number} ({room.type} - {formatCurrency(room.price)})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check In</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.checkIn}
                    onChange={(e) => setNewBooking({ ...newBooking, checkIn: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Check Out</label>
                  <input 
                    type="date" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.checkOut}
                    onChange={(e) => setNewBooking({ ...newBooking, checkOut: e.target.value })}
                  />
                </div>
              </div>
            </div>
            <div className="flex gap-4 mt-8">
              <button 
                onClick={() => setIsBooking(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-white transition-all active:scale-95"
              >
                Cancel
              </button>
              <button 
                onClick={handleBooking}
                className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
              >
                Confirm Booking
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-white">Active Reservations</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input 
              type="text" 
              placeholder="Search guests..."
              className="bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-white focus:outline-none focus:border-emerald-500"
            />
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Guest</th>
                <th className="px-6 py-4">Room</th>
                <th className="px-6 py-4">Dates</th>
                <th className="px-6 py-4">Amount</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {reservations.map(res => (
                <tr key={res.id} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-500">
                        <User size={14} />
                      </div>
                      <div className="text-sm font-medium text-white">{res.guestName}</div>
                    </div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-400">Room {res.roomNumber}</td>
                  <td className="px-6 py-4 text-xs text-zinc-400">
                    <div className="flex items-center gap-1"><Clock size={12} /> {res.checkIn}</div>
                    <div className="flex items-center gap-1 opacity-50"><Clock size={12} /> {res.checkOut}</div>
                  </td>
                  <td className="px-6 py-4 text-sm text-zinc-400">{formatCurrency(res.totalAmount)}</td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      res.status === 'checked_in' ? "bg-emerald-500/10 text-emerald-500" :
                      res.status === 'pending' ? "bg-blue-500/10 text-blue-500" :
                      res.status === 'checked_out' ? "bg-zinc-800 text-zinc-400" : "bg-red-500/10 text-red-500"
                    )}>
                      {res.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {res.status === 'pending' && (
                        <button 
                          onClick={() => updateReservationStatus(res, 'checked_in')}
                          className="p-2 text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-all active:scale-90"
                          title="Check In"
                        >
                          <CheckCircle2 size={18} />
                        </button>
                      )}
                      {res.status === 'checked_in' && (
                        <button 
                          onClick={() => updateReservationStatus(res, 'checked_out')}
                          className="p-2 text-blue-500 hover:bg-blue-500/10 rounded-lg transition-all active:scale-90"
                          title="Check Out"
                        >
                          <LogOut size={18} />
                        </button>
                      )}
                      {res.status === 'pending' && (
                        <button 
                          onClick={() => updateReservationStatus(res, 'cancelled')}
                          className="p-2 text-red-500 hover:bg-red-500/10 rounded-lg transition-all active:scale-90"
                          title="Cancel"
                        >
                          <XCircle size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
