import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, addDoc, query, orderBy, doc, setDoc, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Reservation, Room, Guest } from '../types';
import { postToLedger } from '../services/ledgerService';
import { ReceiptGenerator } from './ReceiptGenerator';
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
  RefreshCw,
  Receipt
} from 'lucide-react';
import { cn, formatCurrency } from '../utils';
import { format } from 'date-fns';

export function FrontDesk() {
  const { hotel, profile } = useAuth();
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [isBooking, setIsBooking] = useState(false);
  const [showReceipt, setShowReceipt] = useState<{ res: Reservation; type: 'restaurant' | 'comprehensive' } | null>(null);
  const [newBooking, setNewBooking] = useState({
    guestId: '',
    guestName: '',
    guestEmail: '',
    guestPhone: '',
    roomId: '',
    checkIn: format(new Date(), 'yyyy-MM-dd'),
    checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
    totalAmount: 0,
    paidAmount: 0,
    paymentStatus: 'unpaid' as const,
    notes: '',
  });

  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;

    setLoading(true);
    const resRef = collection(db, 'hotels', hotel.id, 'reservations');
    const roomsRef = collection(db, 'hotels', hotel.id, 'rooms');

    const unsubscribeRes = onSnapshot(query(resRef, orderBy('checkIn', 'desc')), 
      (snap) => {
        setReservations(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Reservation)));
        setLoading(false);
      },
      (err) => {
        console.error("Reservations listener error:", err);
        if (err.code === 'permission-denied') setHasPermissionError(true);
      }
    );

    const unsubscribeRooms = onSnapshot(roomsRef, 
      (snap) => {
        setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
      },
      (err) => console.error("Rooms listener error:", err)
    );

    const unsubscribeGuests = onSnapshot(collection(db, 'hotels', hotel.id, 'guests'), 
      (snap) => {
        setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
      },
      (err) => console.error("Guests listener error:", err)
    );

    return () => {
      unsubscribeRes();
      unsubscribeRooms();
      unsubscribeGuests();
    };
  }, [hotel?.id, profile?.uid]);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotel?.id]);

  const handleBooking = async () => {
    if (!hotel?.id) return;
    const selectedRoom = rooms.find(r => r.id === newBooking.roomId);
    if (!selectedRoom) return;

    // Basic availability check (simplified for now)
    const isRoomTaken = reservations.some(res => 
      res.roomId === newBooking.roomId && 
      res.status !== 'cancelled' && 
      res.status !== 'checked_out' &&
      ((newBooking.checkIn >= res.checkIn && newBooking.checkIn < res.checkOut) ||
       (newBooking.checkOut > res.checkIn && newBooking.checkOut <= res.checkOut))
    );

    if (isRoomTaken) {
      alert("This room is already booked for the selected dates.");
      return;
    }

    try {
      const resData = {
        ...newBooking,
        roomNumber: selectedRoom.roomNumber,
        status: 'pending',
        ledgerEntries: [],
        createdAt: new Date().toISOString(),
      };

      const docRef = await addDoc(collection(db, 'hotels', hotel.id, 'reservations'), resData);

      // If guest is linked, we could post the initial room charge to ledger
      // But usually we do it on check-in or daily.
      // For now, let's just create the booking.

      // Log the action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        action: 'CREATE_BOOKING',
        resource: `Booking for ${newBooking.guestName}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });

      setIsBooking(false);
      setNewBooking({
        guestId: '',
        guestName: '',
        guestEmail: '',
        guestPhone: '',
        roomId: '',
        checkIn: format(new Date(), 'yyyy-MM-dd'),
        checkOut: format(new Date(Date.now() + 86400000), 'yyyy-MM-dd'),
        totalAmount: 0,
        paidAmount: 0,
        paymentStatus: 'unpaid',
        notes: '',
      });
    } catch (err) {
      console.error("Booking error:", err);
    }
  };

  const updateReservationStatus = async (res: Reservation, status: Reservation['status']) => {
    if (!hotel?.id) return;
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), { status }, { merge: true });
      
      // If checking in, mark room as occupied and post room charge to ledger if guest is linked
      if (status === 'checked_in') {
        await setDoc(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'occupied' }, { merge: true });
        
        if (res.guestId) {
          await postToLedger(hotel.id, res.guestId, res.id, {
            amount: res.totalAmount,
            type: 'debit',
            category: 'room',
            description: `Room Charge: ${res.roomNumber} (${res.checkIn} to ${res.checkOut})`,
            referenceId: res.id,
            postedBy: profile.uid
          }, profile.uid);
        }
      } else if (status === 'checked_out') {
        await setDoc(doc(db, 'hotels', hotel.id, 'rooms', res.roomId), { status: 'dirty' }, { merge: true });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        action: 'UPDATE_BOOKING_STATUS',
        resource: `Booking ${res.id}: ${status}`,
        hotelId: hotel.id,
        module: 'Front Desk'
      });
    } catch (err) {
      console.error("Update status error:", err);
    }
  };

  const updatePayment = async (res: Reservation, amount: number) => {
    if (!hotel?.id) return;
    const newPaidAmount = (res.paidAmount || 0) + amount;
    const paymentStatus = newPaidAmount >= res.totalAmount ? 'paid' : (newPaidAmount > 0 ? 'partial' : 'unpaid');
    
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'reservations', res.id), { 
        paidAmount: newPaidAmount,
        paymentStatus 
      }, { merge: true });

      // Add to finance records
      await addDoc(collection(db, 'hotels', hotel.id, 'finance'), {
        type: 'income',
        amount: amount,
        category: 'Room Revenue',
        description: `Payment for booking ${res.id} (${res.guestName})`,
        timestamp: new Date().toISOString(),
        paymentMethod: 'cash' // Default to cash for now
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        action: 'UPDATE_PAYMENT',
        resource: `Payment for ${res.guestName}: ${formatCurrency(amount)}`,
        hotelId: hotel.id,
        module: 'Finance'
      });
    } catch (err) {
      console.error("Payment update error:", err);
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
            onClick={() => window.location.reload()}
            disabled={loading}
            className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Refresh Page"
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
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Select Existing Guest</label>
                <select 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.guestId}
                  onChange={(e) => {
                    const guest = guests.find(g => g.id === e.target.value);
                    if (guest) {
                      setNewBooking({
                        ...newBooking,
                        guestId: guest.id,
                        guestName: guest.name,
                        guestEmail: guest.email,
                        guestPhone: guest.phone
                      });
                    } else {
                      setNewBooking({ ...newBooking, guestId: '', guestName: '', guestEmail: '', guestPhone: '' });
                    }
                  }}
                >
                  <option value="">New Guest</option>
                  {guests.map(g => (
                    <option key={g.id} value={g.id}>{g.name} ({g.phone})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-4">
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
                  <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Phone Number</label>
                  <input 
                    type="tel" 
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                    value={newBooking.guestPhone}
                    onChange={(e) => setNewBooking({ ...newBooking, guestPhone: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                <input 
                  type="email" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none"
                  value={newBooking.guestEmail}
                  onChange={(e) => setNewBooking({ ...newBooking, guestEmail: e.target.value })}
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
                    <option key={room.id} value={room.id}>Room {room.roomNumber} ({room.type} - {formatCurrency(room.price)})</option>
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
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Notes</label>
                <textarea 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-white focus:border-emerald-500 outline-none resize-none h-20"
                  value={newBooking.notes}
                  onChange={(e) => setNewBooking({ ...newBooking, notes: e.target.value })}
                />
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
                  <td className="px-6 py-4 text-sm text-zinc-400">
                    <div>{formatCurrency(res.totalAmount)}</div>
                    <div className={cn(
                      "text-[10px] font-bold uppercase",
                      res.paymentStatus === 'paid' ? "text-emerald-500" :
                      res.paymentStatus === 'partial' ? "text-amber-500" : "text-red-500"
                    )}>
                      {res.paymentStatus} ({formatCurrency(res.paidAmount || 0)})
                    </div>
                    {res.guestId && (
                      <div className="text-[10px] text-zinc-500 mt-1">
                        Ledger: {formatCurrency((res.ledgerEntries || []).reduce((acc, e) => acc + (e.type === 'debit' ? e.amount : -e.amount), 0))}
                      </div>
                    )}
                  </td>
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
                      {res.paymentStatus !== 'paid' && (
                        <button 
                          onClick={() => {
                            const amount = prompt(`Enter payment amount for ${res.guestName} (Total: ${formatCurrency(res.totalAmount)}):`, (res.totalAmount - (res.paidAmount || 0)).toString());
                            if (amount && !isNaN(Number(amount))) {
                              updatePayment(res, Number(amount));
                            }
                          }}
                          className="p-2 text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all active:scale-90"
                          title="Record Payment"
                        >
                          <CreditCard size={18} />
                        </button>
                      )}
                      <button 
                        onClick={() => setShowReceipt({ res, type: 'comprehensive' })}
                        className="p-2 text-zinc-400 hover:bg-zinc-800 rounded-lg transition-all active:scale-90"
                        title="Generate Receipt"
                      >
                        <Receipt size={18} />
                      </button>
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

      {showReceipt && hotel && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-sm z-[60] flex items-center justify-center p-4 overflow-y-auto">
          <div className="relative w-full max-w-lg my-8">
            <button 
              onClick={() => setShowReceipt(null)}
              className="absolute -top-12 right-0 text-white hover:text-zinc-400 font-bold flex items-center gap-2 print:hidden"
            >
              <XCircle size={20} />
              Close
            </button>
            <div className="bg-white rounded-2xl overflow-hidden">
              <ReceiptGenerator 
                hotel={hotel} 
                reservation={showReceipt.res} 
                type={showReceipt.type} 
                ledgerEntries={showReceipt.res.ledgerEntries || []}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
