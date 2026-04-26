import React, { useEffect, useState } from 'react';
import { collection, query, orderBy, addDoc, updateDoc, doc, onSnapshot, where } from 'firebase/firestore';
import { db, handleFirestoreError, serverTimestamp, safeWrite, safeAdd, safeDelete } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { MaintenanceRequest, OperationType, Room, UserProfile } from '../types';
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
  AlertCircle,
  Download,
  UserPlus,
  Trash2
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, exportToCSV, safeToDate } from '../utils';
import { format, isWithinInterval, startOfDay, endOfDay, startOfMonth } from 'date-fns';
import { toast } from 'sonner';

export function Maintenance() {
  const { hotel, profile } = useAuth();
  const [requests, setRequests] = useState<MaintenanceRequest[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'urgent'>('all');
  const [reportFilter, setReportFilter] = useState({
    startDate: format(startOfMonth(new Date()), 'yyyy-MM-dd'),
    endDate: format(new Date(), 'yyyy-MM-dd'),
    status: 'all',
    priority: 'all'
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'dueDate' | 'priority' | 'timestamp'>('timestamp');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [isLoading, setIsLoading] = useState(true);
  const [newRequest, setNewRequest] = useState({
    roomNumber: '',
    issue: '',
    priority: 'medium' as MaintenanceRequest['priority'],
    notes: '',
    assignedTo: '',
    dueDate: format(new Date(), 'yyyy-MM-dd')
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!newRequest.roomNumber) errors.roomNumber = 'Select a room';
    if (!newRequest.issue || newRequest.issue.trim().length < 5) errors.issue = 'Minimum 5 characters required';
    if (!newRequest.dueDate) errors.dueDate = 'Due date is required';
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    setIsLoading(true);
    const q = query(collection(db, 'hotels', hotel.id, 'maintenance'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setRequests(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as MaintenanceRequest)));
      setIsLoading(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/maintenance`);
      if (error.code === 'permission-denied') setHasPermissionError(true);
      setIsLoading(false);
    });

    const unsubRooms = onSnapshot(collection(db, 'hotels', hotel.id, 'rooms'), (snap) => {
      setRooms(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Room)));
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/rooms`);
    });

    const unsubStaff = onSnapshot(query(collection(db, 'users'), where('hotelId', '==', hotel.id)), (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    return () => {
      unsub();
      unsubRooms();
      unsubStaff();
    };
  }, [hotel?.id, profile?.uid]);

  const handleAddRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    if (!validateForm()) return;

    try {
      const timestamp = serverTimestamp();
      await safeAdd(collection(db, 'hotels', hotel.id, 'maintenance'), {
        ...newRequest,
        status: 'pending',
        reportedBy: profile.email,
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp
      }, hotel.id, 'CREATE_MAINTENANCE_REQUEST');

      // Log action
      await safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'MAINTENANCE_REQUEST_CREATED',
        resource: `Room ${newRequest.roomNumber}: ${newRequest.issue}`,
        hotelId: hotel.id,
        module: 'Maintenance'
      }, hotel.id, 'LOG_MAINTENANCE_REQUEST_CREATED');

      toast.success('Maintenance request created');
      setShowAddModal(false);
      setFormErrors({});
      setNewRequest({ roomNumber: '', issue: '', priority: 'medium', notes: '', assignedTo: '', dueDate: format(new Date(), 'yyyy-MM-dd') });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/maintenance`);
      toast.error('Failed to create request');
    }
  };

  const updateRequestStatus = async (requestId: string, status: MaintenanceRequest['status'], assignedTo?: string) => {
    if (!hotel?.id) return;
    const timestamp = serverTimestamp();
    const updates: any = { status, updatedAt: timestamp };
    if (status === 'completed') updates.completedAt = timestamp;
    if (assignedTo !== undefined) updates.assignedTo = assignedTo;

    try {
      await safeWrite(doc(db, 'hotels', hotel.id, 'maintenance', requestId), updates, hotel.id, 'UPDATE_MAINTENANCE_STATUS');
      
      // Log action
      await safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'MAINTENANCE_STATUS_UPDATE',
        resource: `Request ${requestId}: ${status}${assignedTo ? ` (Assigned to: ${staff.find(s => s.uid === assignedTo)?.displayName || assignedTo})` : ''}`,
        hotelId: hotel.id,
        module: 'Maintenance'
      }, hotel.id, 'LOG_MAINTENANCE_STATUS_UPDATE');
      toast.success(`Request status updated to ${status.replace('_', ' ')}`);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/maintenance/${requestId}`);
      toast.error('Failed to update request status');
    }
  };

  const handleDeleteRequest = async (requestId: string) => {
    if (!hotel?.id || !profile) return;
    
    if (!window.confirm('Are you sure you want to delete this maintenance request? This action cannot be undone.')) {
      return;
    }

    try {
      await safeDelete(doc(db, 'hotels', hotel.id, 'maintenance', requestId), hotel.id, 'DELETE_MAINTENANCE_REQUEST');
      
      // Log action
      await safeAdd(collection(db, 'hotels', hotel.id, 'activityLogs'), {
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        userId: profile.uid,
        userEmail: profile.email,
        userRole: profile.role,
        action: 'MAINTENANCE_REQUEST_DELETED',
        resource: `Request ${requestId}`,
        hotelId: hotel.id,
        module: 'Maintenance'
      }, hotel.id, 'LOG_MAINTENANCE_REQUEST_DELETED');
      toast.success('Maintenance request deleted');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/maintenance/${requestId}`);
      toast.error('Failed to delete request');
    }
  };

  const filteredRequests = requests.filter(r => {
    const matchesStatus = filter === 'all' || r.status === filter;
    const matchesPriority = priorityFilter === 'all' || r.priority === priorityFilter;
    const matchesSearch = (r.roomNumber || '').includes(searchQuery) || (r.issue?.toLowerCase() || '').includes(searchQuery.toLowerCase());
    
    // Date filter (if applicable)
    let matchesDate = true;
    if (reportFilter.startDate) {
      const targetDate = startOfDay(safeToDate(reportFilter.startDate));
      const taskDate = r.dueDate ? startOfDay(safeToDate(r.dueDate)) : startOfDay(safeToDate(r.timestamp));
      matchesDate = taskDate >= targetDate;
    }

    return matchesStatus && matchesPriority && matchesSearch && matchesDate;
  });

  const priorityWeights = { urgent: 4, high: 3, medium: 2, low: 1 };

  const sortedRequests = [...filteredRequests].sort((a, b) => {
    let result = 0;
    if (sortBy === 'priority') {
      result = (priorityWeights[a.priority] || 0) - (priorityWeights[b.priority] || 0);
    } else if (sortBy === 'dueDate') {
      const dateA = a.dueDate ? safeToDate(a.dueDate).getTime() : 0;
      const dateB = b.dueDate ? safeToDate(b.dueDate).getTime() : 0;
      result = dateA - dateB;
    } else {
      result = safeToDate(a.timestamp).getTime() - safeToDate(b.timestamp).getTime();
    }
    return sortOrder === 'desc' ? -result : result;
  });

  const stats = [
    { label: 'Pending', count: requests.filter(r => r.status === 'pending').length, color: 'text-amber-500' },
    { label: 'In Progress', count: requests.filter(r => r.status === 'in_progress').length, color: 'text-blue-500' },
    { label: 'Urgent', count: requests.filter(r => r.priority === 'urgent' && r.status !== 'completed').length, color: 'text-red-500' },
  ];

  const handleExport = () => {
    const dataToExport = requests
      .filter(req => {
        const matchesStatus = reportFilter.status === 'all' || req.status === reportFilter.status;
        const matchesPriority = reportFilter.priority === 'all' || req.priority === reportFilter.priority;
        
        const reqDate = safeToDate(req.timestamp);
        const matchesDate = isWithinInterval(reqDate, {
          start: startOfDay(safeToDate(reportFilter.startDate)),
          end: endOfDay(safeToDate(reportFilter.endDate))
        });

        return matchesStatus && matchesPriority && matchesDate;
      })
      .map(req => ({
        Timestamp: safeToDate(req.timestamp).toLocaleString(),
        Room: req.roomNumber,
        Issue: req.issue,
        Priority: req.priority,
        Status: req.status,
        ReportedBy: req.reportedBy,
        Notes: req.notes || '',
        CompletedAt: req.completedAt ? safeToDate(req.completedAt).toLocaleString() : 'N/A'
      }));

    if (dataToExport.length === 0) {
      toast.info('No maintenance requests found for the selected report filters');
      return;
    }

    exportToCSV(dataToExport, `maintenance_report_${reportFilter.startDate}_to_${reportFilter.endDate}.csv`);
    toast.success('Maintenance report exported successfully');
  };

  return (
    <div className="p-8 space-y-8">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 mb-2 tracking-tight">Maintenance</h1>
          <p className="text-zinc-400">Track and manage room repairs and facility maintenance</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="hidden lg:flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
            <input
              type="date"
              value={reportFilter.startDate}
              onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
            <span className="text-zinc-600 text-[10px]">to</span>
            <input
              type="date"
              value={reportFilter.endDate}
              onChange={(e) => setReportFilter({ ...reportFilter, endDate: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            />
            <div className="w-px h-4 bg-zinc-800" />
            <select
              value={reportFilter.status}
              onChange={(e) => setReportFilter({ ...reportFilter, status: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold px-2 py-1 focus:outline-none"
            >
              <option value="all">All Status</option>
              <option value="pending">Pending</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
            </select>
          </div>
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            <span className="hidden sm:inline">Export Report</span>
            <span className="sm:hidden">Export</span>
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Plus size={18} />
            New Request
          </button>
        </div>
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
            className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
          />
        </div>
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl overflow-x-auto w-full md:w-auto">
          <div className="flex items-center gap-1 px-2 border-r border-zinc-800 mr-1">
            <Filter size={14} className="text-zinc-500" />
            <select 
              value={`${sortBy}-${sortOrder}`}
              onChange={(e) => {
                const [newSort, newOrder] = e.target.value.split('-') as [any, any];
                setSortBy(newSort);
                setSortOrder(newOrder);
              }}
              className="bg-transparent text-[10px] text-zinc-400 font-bold focus:outline-none cursor-pointer"
            >
              <option value="timestamp-desc">Newest First</option>
              <option value="timestamp-asc">Oldest First</option>
              <option value="dueDate-asc">Due Soonest</option>
              <option value="dueDate-desc">Due Latest</option>
              <option value="priority-desc">Highest Priority</option>
              <option value="priority-asc">Lowest Priority</option>
            </select>
          </div>
          {(['all', 'pending', 'in_progress', 'completed'] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                filter === f ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {f.replace('_', ' ')}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          {(['all', 'low', 'medium', 'high', 'urgent'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPriorityFilter(p)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all whitespace-nowrap",
                priorityFilter === p ? "bg-zinc-800 text-zinc-50" : "text-zinc-500 hover:text-zinc-300"
              )}
            >
              {p}
            </button>
          ))}
          <div className="w-px h-4 bg-zinc-800 mx-1" />
          <div className="flex items-center gap-2 px-2">
            <Calendar size={14} className="text-zinc-500" />
            <input
              type="date"
              value={reportFilter.startDate}
              onChange={(e) => setReportFilter({ ...reportFilter, startDate: e.target.value })}
              className="bg-transparent text-[10px] text-zinc-400 font-bold focus:outline-none"
            />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
            Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="bg-zinc-900/50 border border-zinc-800 rounded-2xl p-5 h-48 animate-pulse space-y-4">
                <div className="flex justify-between">
                  <div className="flex gap-2">
                    <div className="w-10 h-10 bg-zinc-800 rounded-xl" />
                    <div className="space-y-2">
                      <div className="w-20 h-3 bg-zinc-800 rounded" />
                      <div className="w-32 h-2 bg-zinc-800 rounded" />
                    </div>
                  </div>
                  <div className="w-16 h-5 bg-zinc-800 rounded" />
                </div>
                <div className="w-full h-4 bg-zinc-800 rounded" />
                <div className="w-3/4 h-4 bg-zinc-800 rounded" />
              </div>
            ))
          ) : sortedRequests.length === 0 ? (
            <div className="col-span-full py-12 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-2xl">
              <Wrench size={48} className="mx-auto text-zinc-700 mb-4" />
              <p>No maintenance requests found</p>
            </div>
          ) : (
            sortedRequests.map((request) => (
              <motion.div
                key={request.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ 
                  opacity: request.status === 'completed' ? 0.7 : 1, 
                  scale: 1,
                  backgroundColor: request.status === 'completed' ? 'rgba(24, 24, 27, 0.5)' : 'rgba(24, 24, 27, 1)'
                }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  "bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col transition-all duration-500",
                  request.status === 'completed' ? "border-emerald-500/20 grayscale-[0.5]" : ""
                )}
              >
                <div className="p-5 flex-1">
                  <div className="flex items-center justify-between mb-4">
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "w-10 h-10 rounded-xl flex items-center justify-center text-zinc-50 font-bold transition-colors",
                        request.status === 'completed' ? "bg-emerald-500/20 text-emerald-500" : "bg-zinc-800"
                      )}>
                        {request.status === 'completed' ? <CheckCircle2 size={20} /> : request.roomNumber}
                      </div>
                      <div>
                        <div className="text-xs text-zinc-500 font-medium uppercase tracking-wider">Room {request.roomNumber}</div>
                        <div className="text-xs text-zinc-400 flex items-center gap-1">
                          <Calendar size={10} />
                          {format(safeToDate(request.timestamp), 'MMM d, HH:mm')}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={cn(
                        "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                        request.priority === 'urgent' ? "bg-red-500 text-zinc-50" :
                        request.priority === 'high' ? "bg-orange-500/10 text-orange-500" :
                        request.priority === 'medium' ? "bg-blue-500/10 text-blue-500" :
                        "bg-zinc-800 text-zinc-500"
                      )}>
                        {request.priority}
                      </div>
                      <button 
                        onClick={() => handleDeleteRequest(request.id)}
                        className="p-1.5 hover:bg-red-500/10 text-zinc-600 hover:text-red-500 rounded-lg transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <h3 className={cn(
                      "text-sm font-bold leading-tight transition-all",
                      request.status === 'completed' ? "text-zinc-500 line-through" : "text-zinc-50"
                    )}>{request.issue}</h3>
                    
                    {request.dueDate && (
                      <div className={cn(
                        "flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider",
                        safeToDate(request.dueDate) < new Date() && request.status !== 'completed' ? "text-red-500" : "text-zinc-500"
                      )}>
                        <Clock size={10} />
                        Due: {format(safeToDate(request.dueDate), 'MMM d, yyyy')}
                      </div>
                    )}

                    {request.notes && (
                      <p className="text-xs text-zinc-400 italic bg-zinc-950 p-2 rounded-lg border border-zinc-800">
                        {request.notes}
                      </p>
                    )}
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <User size={12} />
                      <span>Reported by: {request.reportedBy.split('@')[0]}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      <UserPlus size={12} className="text-zinc-500" />
                      <select
                        value={request.assignedTo || ''}
                        onChange={(e) => updateRequestStatus(request.id, request.status, e.target.value)}
                        className="bg-transparent text-zinc-400 focus:text-zinc-50 outline-none cursor-pointer hover:text-zinc-300 transition-colors"
                      >
                        <option value="">Unassigned</option>
                        {staff.map(s => (
                          <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                        ))}
                      </select>
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
                      Completed {request.completedAt && format(safeToDate(request.completedAt), 'MMM d')}
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
              <h2 className="text-xl font-bold text-zinc-50">New Maintenance Request</h2>
            </div>
            <form onSubmit={handleAddRequest}>
              <div className="p-6 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Room Number</label>
                    <select
                      required
                      value={newRequest.roomNumber}
                      onChange={(e) => {
                        setNewRequest({ ...newRequest, roomNumber: e.target.value });
                        if (formErrors.roomNumber) setFormErrors({ ...formErrors, roomNumber: '' });
                      }}
                      className={cn(
                        "w-full bg-zinc-950 border rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 transition-all",
                        formErrors.roomNumber ? "border-red-500/50" : "border-zinc-800"
                      )}
                    >
                      <option value="">Select Room</option>
                      {rooms.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber)).map(room => (
                        <option key={room.id} value={room.roomNumber}>
                          Room {room.roomNumber} ({room.type})
                        </option>
                      ))}
                    </select>
                    {formErrors.roomNumber && <p className="text-[10px] text-red-500 font-bold uppercase">{formErrors.roomNumber}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Priority</label>
                    <select
                      value={newRequest.priority}
                      onChange={(e) => setNewRequest({ ...newRequest, priority: e.target.value as any })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Due Date</label>
                    <input
                      type="date"
                      required
                      value={newRequest.dueDate}
                      onChange={(e) => {
                        setNewRequest({ ...newRequest, dueDate: e.target.value });
                        if (formErrors.dueDate) setFormErrors({ ...formErrors, dueDate: '' });
                      }}
                      className={cn(
                        "w-full bg-zinc-950 border rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 transition-all",
                        formErrors.dueDate ? "border-red-500/50" : "border-zinc-800"
                      )}
                    />
                    {formErrors.dueDate && <p className="text-[10px] text-red-500 font-bold uppercase">{formErrors.dueDate}</p>}
                  </div>
                  <div className="space-y-2">
                    <label className="text-xs font-bold text-zinc-500 uppercase">Assign To (Optional)</label>
                    <select
                      value={newRequest.assignedTo}
                      onChange={(e) => setNewRequest({ ...newRequest, assignedTo: e.target.value })}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
                    >
                      <option value="">Select Staff Member</option>
                      {staff.map(s => (
                        <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Issue Description</label>
                  <textarea
                    required
                    value={newRequest.issue}
                    onChange={(e) => {
                      setNewRequest({ ...newRequest, issue: e.target.value });
                      if (formErrors.issue && e.target.value.trim().length >= 5) setFormErrors({ ...formErrors, issue: '' });
                    }}
                    className={cn(
                      "w-full bg-zinc-950 border rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50 h-24 resize-none transition-all",
                      formErrors.issue ? "border-red-500/50" : "border-zinc-800"
                    )}
                    placeholder="Describe the problem..."
                  />
                  {formErrors.issue && <p className="text-[10px] text-red-500 font-bold uppercase">{formErrors.issue}</p>}
                </div>
                <div className="space-y-2">
                  <label className="text-xs font-bold text-zinc-500 uppercase">Additional Notes</label>
                  <input
                    type="text"
                    value={newRequest.notes}
                    onChange={(e) => setNewRequest({ ...newRequest, notes: e.target.value })}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:outline-none focus:border-emerald-500/50"
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
                  className="flex-1 px-4 py-2 bg-emerald-500 text-zinc-50 rounded-xl font-bold hover:bg-emerald-600 transition-all active:scale-95"
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
