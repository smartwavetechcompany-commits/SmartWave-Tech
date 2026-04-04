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
  Download
} from 'lucide-react';
import { cn, exportToCSV } from '../utils';
import { format } from 'date-fns';
import { toast } from 'sonner';

export function Housekeeping() {
  const { hotel, profile } = useAuth();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [filter, setFilter] = useState<'all' | 'dirty' | 'clean'>('all');

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
    try {
      await setDoc(doc(db, 'hotels', hotel.id, 'rooms', roomId), { status }, { merge: true });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        user: profile?.email || profile?.uid || 'Unknown',
        action: 'HOUSEKEEPING_UPDATE',
        module: `Room ${room?.roomNumber || roomId}: ${status}`
      });
      toast.success(`Room ${room?.roomNumber} marked as ${status}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/rooms/${roomId}`);
      toast.error('Failed to update room status');
    }
  };

  const filteredRooms = rooms.filter(r => {
    if (filter === 'dirty') return r.status === 'dirty';
    if (filter === 'clean') return r.status === 'clean';
    return true;
  });

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
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight">Housekeeping</h1>
          <p className="text-zinc-400">Manage room cleaning and maintenance status</p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button 
            onClick={() => setFilter('all')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              filter === 'all' ? "bg-emerald-500 text-black" : "bg-zinc-900 text-zinc-400 border border-zinc-800"
            )}
          >
            All Rooms
          </button>
          <button 
            onClick={() => setFilter('dirty')}
            className={cn(
              "px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95",
              filter === 'dirty' ? "bg-red-500 text-white" : "bg-zinc-900 text-zinc-400 border border-zinc-800"
            )}
          >
            Dirty
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
        {filteredRooms.map(room => (
          <div key={room.id} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-2xl font-bold text-white">Room {room.roomNumber}</span>
              <span className={cn(
                "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                room.status === 'clean' ? "bg-emerald-500/10 text-emerald-500" :
                room.status === 'dirty' ? "bg-red-500/10 text-red-500" :
                room.status === 'occupied' ? "bg-blue-500/10 text-blue-500" : "bg-amber-500/10 text-amber-500"
              )}>
                {room.status}
              </span>
            </div>
            
            <div className="text-xs text-zinc-500 uppercase font-bold tracking-widest">
              {room.type} • Floor {room.floor}
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
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
