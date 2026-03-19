import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, orderBy, addDoc, updateDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { MaintenanceRequest, OperationType } from '../types';
import { 
  Wrench, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Plus, 
  Search, 
  Filter,
  User,
  MessageSquare,
  Calendar,
  ChevronRight,
  AlertCircle
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import { format } from 'date-fns';

export function Maintenance() {
  const { hotel, profile } = useAuth();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'urgent'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [newRequest, setNewRequest] = useState({
    roomNumber: '',
    issue: '',
    priority: 'medium' as MaintenanceRequest['priority'],
    notes: ''
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    const q = query(collection(db, 'hotels', hotel.id, 'maintenance'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceRequest)));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/maintenance`);
        if (error.code === 'permission-denied') setHasPermissionError(true);
      }
    );
    return () => unsubscribe();
  }, [hotel?.id, profile?.uid]);

  const handleAddRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    try {
      await addDoc(collection(db, 'hotels', hotel.id, 'maintenance'), {
        ...newRequest,
        status: 'pending',
        reportedBy: profile.email,
        timestamp: new Date().toISOString()
      });

      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile.uid,
        userEmail: profile.email,
        action: 'MAINTENANCE_REQUEST_CREATED',
        resource: `Room ${newRequest.roomNumber}: ${newRequest.issue}`,
        hotelId: hotel.id,
        module: 'Maintenance'
      });

      setShowAddModal(false);
      setNewRequest({ roomNumber: '', issue: '', priority: 'medium', notes: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/maintenance`);
    }
  };

  const updateRequestStatus = async (requestId: string, status: MaintenanceRequest['status']) => {
    if (!hotel?.id) return;
    const updates: any = { status };
    if (status === 'completed') updates.completedAt = new Date().toISOString();

    try {
      await updateDoc(doc(db, 'hotels', hotel.id, 'maintenance', requestId), updates);
      
      // Log action
      await addDoc(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        action: 'MAINTENANCE_STATUS_UPDATE',
        resource: `Request ${requestId}: ${status}`,
        hotelId: hotel.id,
        module: 'Maintenance'
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/maintenance/${requestId}`);
    }
  };

  const filteredRequests = requests.filter(r => {
    const matchesStatus = filter === 'all' || r.status === filter;
    const matchesPriority = priorityFilter === 'all' || r.priority === priorityFilter;
    const matchesSearch = r.roomNumber.includes(searchQuery) || r.issue.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesPriority && matchesSearch;
  });

  const stats = [
    { label: 'Pending', count: requests.filter(r => r.status === 'pending').length, color: 'text-amber-500' },
    { label: 'In Progress', count: requests.filter(r => r.status === 'in_progress').length, color: 'text-blue-500' },
    { label: 'Urgent', count: requests.filter(r => r.priority === 'urgent' && r.status !== 'completed').length, color: 'text-red-500' },
  ];

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Maintenance</h1>
          <p className="text-zinc-400">Track and manage room repairs and facility maintenance</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
        >
          <Plus size={18} />
          New Request
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {stats.map((stat) => (
          <div key={stat.label} className="bg-zinc-900 border border-zinc-800 p-6 rounded-2xl">
            <div className="text-zinc-400 text-sm font-medium mb-1">{stat.label}</div>
            <div className={cn("text-2xl font-bold", stat.color)}>{stat.count}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col md:flex-row items-center gap-4 mb-6">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={18} />
          <input
            type="text"
            placeholder="Search by room or issue..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl overflow-x-auto w-full md:w-auto">
          {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                filter === f ? "bg-zinc-800 text-white" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {filteredRequests.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <Wrench size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No maintenance requests found</p>
            </div>
          ) : (
            filteredRequests.map((request) => (
              <motion.div
                key={request.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col"
              >
                <div className="p-5 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className="w-10 h-10 bg-zinc-800 rounded-xl flex items-center justify-center text-white font-bold">
                        {request.roomNumber}
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Room</div>
                        <div className="text-xs text-zinc-400 flex items-center gap-1">
                          <Calendar size={10} />
                          {format(new Date(request.timestamp), 'MMM d, HH:mm')}
                        </div>
                      </div>
                    </div>
                    <div className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      request.priority === 'urgent' ? "bg-red-500 text-white" :
                      request.priority === 'high' ? "bg-orange-500/10 text-orange-500" :
                      request.priority === 'medium' ? "bg-blue-500/10 text-blue-500" :
                      "bg-zinc-800 text-zinc-500"
                    )}>
                      {request.priority}
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-white leading-tight">{request.issue}</h3>
                    {request.notes && (
                      <p className="text-xs text-zinc-400 italic bg-zinc-950 p-2 rounded-lg border border-zinc-800">
                        {request.notes}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <User size={12} />
                      <span>Reported by: {request.reportedBy.split('@')[0]}</span>
                    </div>
                  </div>
                </div>

                <div className="p-3 bg-zinc-950 border-t border-zinc-800 flex gap-2">
                  {request.status === 'pending' && (
                    <button
                      onClick={() => updateRequestStatus(request.id, 'in_progress')}
                      className="flex-1 flex items-center justify-center gap-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-500 py-2 rounded-xl text-xs font-bold transition-colors"
                    >
                      <Clock size={14} />
                      Start Repair
                    </button>
                  )}
                  {request.status === 'in_progress' && (
                    <button
                      onClick={() => updateRequestStatus(request.id, 'completed')}
                      className="flex-1 flex items-center justify-center gap-2 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 py-2 rounded-xl text-xs font-bold transition-colors"
                    >
                      <CheckCircle2 size={14} />
                      Mark Completed
                    </button>
                  )}
                  {request.status === 'completed' && (
                    <div className="flex-1 flex items-center justify-center gap-2 text-zinc-500 py-2 text-xs font-bold">
                      <CheckCircle2 size={14} />
                      Completed {request.completedAt && format(new Date(request.completedAt), 'MMM d')}
                    </div>
                  )}
                </div>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      {/* Add Request Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden"
          >
            <div className="p-6 border-b border-zinc-800">
              <h2 className="text-xl font-bold text-white">New Maintenance Request</h2>
            </div>
            <form onSubmit={handleAddRequest}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Room Number</label>
                    <input
                      required
                      type="text"
                      value={newRequest.roomNumber}
                      onChange={(e) => setNewRequest({ ...newRequest, roomNumber: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                      placeholder="e.g. 101"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Priority</label>
                    <select
                      value={newRequest.priority}
                      onChange={(e) => setNewRequest({ ...newRequest, priority: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Issue Description</label>
                  <textarea
                    required
                    value={newRequest.issue}
                    onChange={(e) => setNewRequest({ ...newRequest, issue: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50 h-24 resize-none"
                    placeholder="Describe the problem..."
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Additional Notes</label>
                  <input
                    type="text"
                    value={newRequest.notes}
                    onChange={(e) => setNewRequest({ ...newRequest, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-white focus:outline-none focus:border-emerald-500/50"
                    placeholder="Any extra details..."
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
                  Create Request
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
