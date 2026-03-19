import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { Guest, OperationType } from '../types';
import { 
  Users, 
  Plus, 
  Search, 
  Filter, 
  Mail, 
  Phone, 
  MapPin, 
  CreditCard, 
  History, 
  Star, 
  MoreVertical, 
  Edit2, 
  Trash2,
  ChevronRight,
  UserCheck,
  Calendar
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatCurrency } from '../utils';
import { format } from 'date-fns';

export function GuestManagement() {
  const { hotel, profile } = useAuth();
  const [guests, setGuests] = useState<Guest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingGuest, setEditingGuest] = useState<Guest | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [newGuest, setNewGuest] = useState({
    name: '',
    email: '',
    phone: '',
    idType: 'Passport',
    idNumber: '',
    address: '',
    notes: ''
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'guests'), orderBy('name', 'asc'));
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setGuests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Guest)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/guests`);
        if (error.code === 'permission-denied') setHasPermissionError(true);
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid]);

  const handleSaveGuest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    try {
      if (editingGuest) {
        await updateDoc(doc(db, 'hotels', hotel.id, 'guests', editingGuest.id), {
          ...newGuest
        });
      } else {
        await addDoc(collection(db, 'hotels', hotel.id, 'guests'), {
          ...newGuest,
          totalStays: 0,
          totalSpent: 0,
          createdAt: new Date().toISOString()
        });
      }

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: editingGuest ? 'GUEST_UPDATED' : 'GUEST_CREATED',
        resource: `${newGuest.name} (${newGuest.email})`,
        hotelId: hotel.id,
        module: 'Guests'
      });

      setShowAddModal(false);
      setEditingGuest(null);
      setNewGuest({ name: '', email: '', phone: '', idType: 'Passport', idNumber: '', address: '', notes: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/guests`);
    }
  };

  const deleteGuest = async (guestId: string) => {
    if (!hotel?.id || !window.confirm('Delete this guest profile?')) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'guests', guestId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/guests/${guestId}`);
    }
  };

  const filteredGuests = guests.filter(guest => {
    const query = searchQuery.toLowerCase();
    return guest.name.toLowerCase().includes(query) || 
           guest.email.toLowerCase().includes(query) || 
           guest.phone.includes(query);
  });

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Guest Management</h1>
          <p className="text-zinc-400">Manage guest profiles, history, and loyalty</p>
        </div>
        <button
          onClick={() => {
            setEditingGuest(null);
            setNewGuest({ name: '', email: '', phone: '', idType: 'Passport', idNumber: '', address: '', notes: '' });
            setShowAddModal(true);
          }}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
        >
          <Plus size={18} />
          Add Guest
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 mb-8">
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Guests</div>
          <div className="text-2xl font-bold text-white">{guests.length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Repeat Guests</div>
          <div className="text-2xl font-bold text-emerald-500">{guests.filter(g => g.totalStays > 1).length}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Total Revenue</div>
          <div className="text-2xl font-bold text-blue-500">{formatCurrency(guests.reduce((acc, g) => acc + g.totalSpent, 0))}</div>
        </div>
        <div className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
          <div className="text-zinc-400 text-sm font-medium mb-1">Loyalty Points</div>
          <div className="text-2xl font-bold text-amber-500">{(guests.reduce((acc, g) => acc + g.totalStays, 0) * 100).toLocaleString()}</div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredGuests.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <Users size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No guest profiles found</p>
            </div>
          ) : (
            filteredGuests.map((guest) => (
              <motion.div
                key={guest.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col group"
              >
                <div className="p-6 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 bg-zinc-800 rounded-full flex items-center justify-center text-emerald-500 font-bold text-lg">
                        {guest.name.charAt(0)}
                      </div>
                      <div>
                        <h3 className="text-white font-bold">{guest.name}</h3>
                        <div className="flex items-center gap-1 text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                          <Star size={10} className={cn(guest.totalStays > 5 ? "text-amber-500" : "text-zinc-600")} />
                          {guest.totalStays > 5 ? 'VIP Guest' : 'Standard'}
                        </div>
                      </div>
                    </div>
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button 
                        onClick={() => {
                          setEditingGuest(guest);
                          setNewGuest({
                            name: guest.name,
                            email: guest.email,
                            phone: guest.phone,
                            idType: guest.idType || 'Passport',
                            idNumber: guest.idNumber || '',
                            address: guest.address || '',
                            notes: guest.notes || ''
                          });
                          setShowAddModal(true);
                        }}
                        className="p-2 text-zinc-500 hover:text-white rounded-lg transition-all"
                      >
                        <Edit2 size={16} />
                      </button>
                      <button 
                        onClick={() => deleteGuest(guest.id)}
                        className="p-2 text-zinc-500 hover:text-red-500 rounded-lg transition-all"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Mail size={14} className="text-zinc-600" />
                      {guest.email}
                    </div>
                    <div className="flex items-center gap-2 text-sm text-zinc-400">
                      <Phone size={14} className="text-zinc-600" />
                      {guest.phone}
                    </div>
                    <div className="grid grid-cols-2 gap-3 pt-4">
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Total Stays</div>
                        <div className="text-lg font-bold text-white">{guest.totalStays}</div>
                      </div>
                      <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800">
                        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider mb-1">Spent</div>
                        <div className="text-lg font-bold text-emerald-500">{formatCurrency(guest.totalSpent)}</div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="px-6 py-3 bg-zinc-950 border-t border-zinc-800 flex items-center justify-between">
                  <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
                    Last Stay: {guest.lastStay ? format(new Date(guest.lastStay), 'MMM d, yyyy') : 'Never'}
                  </div>
                  <ChevronRight size={14} className="text-zinc-700" />
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Add/Edit Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">{editingGuest ? 'Edit Guest Profile' : 'Add New Guest'}</h2>
            </div>
            <form onSubmit={handleSaveGuest}>
              <div className="p-6 space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Full Name</label>
                  <input
                    required
                    type="text"
                    value={newGuest.name}
                    onChange={(e) => setNewGuest({ ...newGuest, name: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="John Doe"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Email Address</label>
                    <input
                      required
                      type="email"
                      value={newGuest.email}
                      onChange={(e) => setNewGuest({ ...newGuest, email: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="john@example.com"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Phone Number</label>
                    <input
                      required
                      type="tel"
                      value={newGuest.phone}
                      onChange={(e) => setNewGuest({ ...newGuest, phone: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="+1 234 567 890"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">ID Type</label>
                    <select
                      value={newGuest.idType}
                      onChange={(e) => setNewGuest({ ...newGuest, idType: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="Passport">Passport</option>
                      <option value="National ID">National ID</option>
                      <option value="Driver License">Driver License</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">ID Number</label>
                    <input
                      type="text"
                      value={newGuest.idNumber}
                      onChange={(e) => setNewGuest({ ...newGuest, idNumber: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="ID Number"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Address</label>
                  <input
                    type="text"
                    value={newGuest.address}
                    onChange={(e) => setNewGuest({ ...newGuest, address: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="Home or Business address"
                  />
                </div>
              </div>
              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-3">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-2 bg-zinc-800 text-zinc-400 rounded-xl font-bold hover:bg-zinc-700 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
                >
                  {editingGuest ? 'Update Guest' : 'Add Guest'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
