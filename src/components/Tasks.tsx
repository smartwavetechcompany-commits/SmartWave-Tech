import React, { useEffect, useState, useRef } from 'react';
import { collection, query, orderBy, onSnapshot, where, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { Task, OperationType, UserProfile } from '../types';
import { 
  CheckCircle2, 
  Circle, 
  Clock, 
  Plus, 
  Search, 
  Filter,
  User,
  Calendar,
  AlertCircle,
  Bell,
  Trash2,
  Tag,
  CheckCircle,
  Menu,
  ChevronRight,
  Strikethrough,
  MoreVertical,
  XSquare,
  ChevronUp,
  ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../utils';
import { format, isAfter, startOfDay, parseISO, isSameDay } from 'date-fns';
import { toast } from 'sonner';
import { ConfirmModal } from './ConfirmModal';

export function Tasks() {
  const { hotel, profile } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<'all' | 'pending' | 'in_progress' | 'completed'>('all');
  const [priorityFilter, setPriorityFilter] = useState<'all' | 'low' | 'medium' | 'high' | 'urgent'>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [deleteConfirm, setDeleteConfirm] = useState<{ isOpen: boolean; taskId: string }>({ isOpen: false, taskId: '' });
  
  const [newTask, setNewTask] = useState({
    title: '',
    description: '',
    priority: 'medium' as Task['priority'],
    category: 'general' as Task['category'],
    assignedTo: '',
    dueDate: '',
    reminderAt: ''
  });

  const remindsRef = useRef<Set<string>>(new Set());

  // Task Reminders Checker
  useEffect(() => {
    if (tasks.length === 0) return;

    const interval = setInterval(() => {
      const now = new Date();
      const nowTime = format(now, 'HH:mm');
      const today = format(now, 'yyyy-MM-dd');

      tasks.forEach(task => {
        if (task.status !== 'completed' && task.reminderAt && task.reminderAt === nowTime) {
          // If due date is today or no due date
          const isTaskToday = !task.dueDate || isSameDay(new Date(task.dueDate), now);
          
          const reminderKey = `${task.id}-${today}-${task.reminderAt}`;
          if (isTaskToday && !remindsRef.current.has(reminderKey)) {
            toast.info(`Reminder: ${task.title}`, {
              description: task.description || 'Task reminder triggered',
              duration: 10000,
              icon: <Bell className="text-emerald-500 animate-bounce" />
            });
            remindsRef.current.add(reminderKey);
          }
        }
      });
    }, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [tasks]);

  useEffect(() => {
    if (!hotel?.id || !profile) return;
    
    setIsLoading(true);
    const q = query(collection(db, 'hotels', hotel.id, 'tasks'), orderBy('timestamp', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      setTasks(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Task)));
      setIsLoading(false);
    }, (error: any) => {
      handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/tasks`);
      setIsLoading(false);
    });

    const unsubStaff = onSnapshot(query(collection(db, 'users'), where('hotelId', '==', hotel.id)), (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    });

    return () => {
      unsub();
      unsubStaff();
    };
  }, [hotel?.id, profile?.uid]);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;
    if (!newTask.title.trim()) {
      toast.error('Task title is required');
      return;
    }

    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'tasks'), {
        ...newTask,
        status: 'pending',
        hotelId: hotel.id,
        createdBy: profile.uid,
        timestamp: new Date().toISOString()
      }, {
        hotelId: hotel.id,
        module: 'Tasks',
        action: 'TASK_CREATED',
        details: `Created task: ${newTask.title}`
      });

      toast.success('Task created successfully');
      setShowAddModal(false);
      setNewTask({ title: '', description: '', priority: 'medium', category: 'general', assignedTo: '', dueDate: '', reminderAt: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `hotels/${hotel.id}/tasks`);
      toast.error('Failed to create task');
    }
  };

  const updateTaskStatus = async (taskId: string, status: Task['status']) => {
    if (!hotel?.id) return;
    const updates: any = { status };
    if (status === 'completed') updates.completedAt = new Date().toISOString();

    try {
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'tasks', taskId), updates, {
        hotelId: hotel.id,
        module: 'Tasks',
        action: 'TASK_STATUS_UPDATE',
        details: `Task ${taskId} set to ${status}`
      });
      if (status === 'completed') toast.success('Task marked as completed');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/tasks/${taskId}`);
      toast.error('Failed to update task');
    }
  };

  const handleDeleteTask = async (taskId: string) => {
    if (!hotel?.id) return;
    try {
      await deleteDoc(doc(db, 'hotels', hotel.id, 'tasks', taskId));
      toast.success('Task deleted');
      setDeleteConfirm({ isOpen: false, taskId: '' });
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `hotels/${hotel.id}/tasks/${taskId}`);
      toast.error('Failed to delete task');
    }
  };

  const filteredTasks = tasks.filter(t => {
    const matchesStatus = filter === 'all' || t.status === filter;
    const matchesPriority = priorityFilter === 'all' || t.priority === priorityFilter;
    const matchesCategory = categoryFilter === 'all' || t.category === categoryFilter;
    const matchesSearch = (t.title || '').toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (t.description || '').toLowerCase().includes(searchQuery.toLowerCase());
    return matchesStatus && matchesPriority && matchesSearch && matchesCategory;
  });

  return (
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 sm:space-y-8 h-full flex flex-col">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-zinc-50 tracking-tight">Tasks & Reminders</h1>
          <p className="text-xs sm:text-sm text-zinc-500">Collaborate and track operations</p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-black px-5 py-2.5 rounded-xl font-bold transition-all active:scale-95 shadow-lg shadow-emerald-500/10 text-xs sm:text-sm"
        >
          <Plus size={18} />
          Add Task
        </button>
      </header>

      {/* Filters */}
      <div className="bg-zinc-900/30 border border-zinc-800/80 p-3 rounded-2xl flex flex-wrap items-center gap-3 sm:gap-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
          <input 
            type="text"
            placeholder="Search tasks..."
            className="w-full bg-zinc-950/50 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs sm:text-sm text-zinc-50 focus:border-emerald-500/50 outline-none transition-all placeholder:text-zinc-600"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <select 
            className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-3 py-1.5 text-[10px] sm:text-xs text-zinc-300 outline-none focus:border-emerald-500/50"
            value={filter}
            onChange={(e) => setFilter(e.target.value as any)}
          >
            <option value="all">Status: All</option>
            <option value="pending">Pending</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>

          <select 
            className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-3 py-1.5 text-[10px] sm:text-xs text-zinc-300 outline-none focus:border-emerald-500/50"
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value as any)}
          >
            <option value="all">Priority: All</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="medium">Medium</option>
            <option value="low">Low</option>
          </select>

          <select 
            className="bg-zinc-950/50 border border-zinc-800 rounded-xl px-3 py-1.5 text-[10px] sm:text-xs text-zinc-300 outline-none focus:border-emerald-500/50"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
          >
            <option value="all">Category: All</option>
            <option value="frontDesk">Front Desk</option>
            <option value="housekeeping">Housekeeping</option>
            <option value="finance">Finance</option>
            <option value="general">General</option>
            <option value="f&b">F & B</option>
            <option value="other">Other</option>
          </select>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto space-y-4 custom-scrollbar pr-2">
        <AnimatePresence mode="popLayout">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-2xl animate-pulse flex items-center gap-4">
                <div className="w-6 h-6 rounded-full bg-zinc-800" />
                <div className="flex-1 space-y-2">
                  <div className="w-1/3 h-4 bg-zinc-800 rounded" />
                  <div className="w-1/2 h-3 bg-zinc-800 rounded" />
                </div>
              </div>
            ))
          ) : filteredTasks.length === 0 ? (
            <div className="py-20 text-center text-zinc-500 bg-zinc-900/50 border border-dashed border-zinc-800 rounded-3xl">
              <CheckCircle size={48} className="mx-auto mb-4 opacity-20" />
              <p className="text-lg">No tasks found</p>
              <p className="text-sm">Create a new task to get started</p>
            </div>
          ) : (
            filteredTasks.map(task => {
              const priorityColor = 
                task.priority === 'urgent' ? 'text-red-500 bg-red-500/10 border-red-500/20' :
                task.priority === 'high' ? 'text-orange-500 bg-orange-500/10 border-orange-500/20' :
                task.priority === 'medium' ? 'text-blue-500 bg-blue-500/10 border-blue-500/20' :
                'text-zinc-500 bg-zinc-500/10 border-zinc-500/20';

              const isOverdue = task.dueDate && isAfter(new Date(), new Date(task.dueDate)) && task.status !== 'completed';

              return (
                <motion.div
                  key={task.id}
                  layout
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ 
                    opacity: task.status === 'completed' ? 0.6 : 1,
                    scale: 1,
                    backgroundColor: task.status === 'completed' ? 'rgba(24, 24, 27, 0.4)' : 'rgba(24, 24, 27, 1)'
                  }}
                  className={cn(
                    "group p-4 sm:p-6 border border-zinc-800 rounded-2xl transition-all duration-500 flex items-start gap-4",
                    task.status === 'completed' ? "border-emerald-500/20" : "hover:border-zinc-700"
                  )}
                >
                  <button 
                    onClick={() => updateTaskStatus(task.id, task.status === 'completed' ? 'pending' : 'completed')}
                    className={cn(
                      "mt-1 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all animate-in zoom-in duration-300",
                      task.status === 'completed' ? "bg-emerald-500 border-emerald-500 text-black" : "border-zinc-700 hover:border-emerald-500/50"
                    )}
                  >
                    {task.status === 'completed' && <CheckCircle2 size={16} />}
                  </button>

                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className={cn(
                        "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider border",
                        priorityColor
                      )}>
                        {task.priority}
                      </span>
                      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest bg-zinc-950 px-2 py-0.5 rounded border border-zinc-800">
                        {task.category}
                      </span>
                      {task.status === 'completed' && (
                        <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">
                          Completed
                        </span>
                      )}
                    </div>
                    
                    <h3 className={cn(
                      "text-base sm:text-lg font-bold transition-all duration-700",
                      task.status === 'completed' ? "text-zinc-600 opacity-50" : "text-zinc-50"
                    )}>
                      <span className="relative inline-block group/text">
                        {task.title}
                        {task.status === 'completed' && (
                          <motion.span 
                            initial={{ width: 0 }}
                            animate={{ width: '105%' }}
                            transition={{ duration: 0.5, ease: "easeInOut" }}
                            className="absolute left-[-2.5%] top-1/2 h-[2px] bg-zinc-500 rounded-full"
                          />
                        )}
                      </span>
                    </h3>
                    
                    {task.description && (
                      <p className={cn(
                        "text-sm mt-1 mb-3 line-clamp-2",
                        task.status === 'completed' ? "text-zinc-600" : "text-zinc-400"
                      )}>
                        {task.description}
                      </p>
                    )}

                    <div className="flex flex-wrap items-center gap-y-2 gap-x-4 mt-3">
                      {task.dueDate && (
                        <div className={cn(
                          "flex items-center gap-1.5 text-xs font-bold",
                          isOverdue ? "text-red-500" : "text-zinc-500"
                        )}>
                          <Calendar size={14} />
                          Due {format(new Date(task.dueDate), 'MMM d, yyyy')}
                        </div>
                      )}
                      {task.reminderAt && task.status !== 'completed' && (
                        <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-500">
                          <Bell size={14} className="animate-bounce" />
                          Reminder at {format(new Date(task.reminderAt), 'HH:mm')}
                        </div>
                      )}
                      {task.assignedTo && (
                        <div className="flex items-center gap-1.5 text-xs text-zinc-500 font-medium">
                          <User size={14} />
                          {staff.find(s => s.uid === task.assignedTo)?.displayName || 'Assigned Staff'}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button 
                      onClick={() => setDeleteConfirm({ isOpen: true, taskId: task.id })}
                      className="p-2 text-zinc-600 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"
                      title="Delete Task"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </AnimatePresence>
      </div>

      {/* Modals */}
      <ConfirmModal 
        isOpen={deleteConfirm.isOpen}
        title="Delete Task"
        message="Are you sure you want to delete this task? This action cannot be undone."
        type="danger"
        confirmText="Delete Task"
        onConfirm={() => handleDeleteTask(deleteConfirm.taskId)}
        onCancel={() => setDeleteConfirm({ isOpen: false, taskId: '' })}
      />

      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
          >
            <div className="p-6 border-b border-zinc-800 bg-zinc-900/50">
              <h2 className="text-xl font-bold text-zinc-50">Create New Task</h2>
              <p className="text-xs text-zinc-500 mt-1 uppercase tracking-widest font-bold">Project & Operations Tracker</p>
            </div>
            
            <form onSubmit={handleAddTask}>
              <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto custom-scrollbar">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Task Title</label>
                  <input
                    required
                    type="text"
                    placeholder="What needs to be done?"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:border-emerald-500 outline-none transition-all placeholder:text-zinc-700"
                    value={newTask.title}
                    onChange={(e) => setNewTask({ ...newTask, title: e.target.value })}
                  />
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Description (Optional)</label>
                  <textarea
                    placeholder="Add more details about this task..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-3 text-zinc-50 focus:border-emerald-500 outline-none h-24 resize-none transition-all placeholder:text-zinc-700"
                    value={newTask.description}
                    onChange={(e) => setNewTask({ ...newTask, description: e.target.value })}
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Priority</label>
                    <select
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
                      value={newTask.priority}
                      onChange={(e) => setNewTask({ ...newTask, priority: e.target.value as any })}
                    >
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Category</label>
                    <select
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
                      value={newTask.category}
                      onChange={(e) => setNewTask({ ...newTask, category: e.target.value as any })}
                    >
                      <option value="general">General</option>
                      <option value="frontDesk">Front Desk</option>
                      <option value="housekeeping">Housekeeping</option>
                      <option value="finance">Finance</option>
                      <option value="f&b">F & B</option>
                      <option value="other">Other</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Assign to Staff</label>
                  <select
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
                    value={newTask.assignedTo}
                    onChange={(e) => setNewTask({ ...newTask, assignedTo: e.target.value })}
                  >
                    <option value="">Unassigned</option>
                    {staff.map(member => (
                      <option key={member.uid} value={member.uid}>{member.displayName || member.email}</option>
                    ))}
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Due Date</label>
                    <input
                      type="date"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
                      style={{ colorScheme: 'dark' }}
                      value={newTask.dueDate}
                      onChange={(e) => setNewTask({ ...newTask, dueDate: e.target.value })}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-zinc-500 uppercase tracking-widest">Reminder Time</label>
                    <input
                      type="time"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none transition-all"
                      style={{ colorScheme: 'dark' }}
                      value={newTask.reminderAt}
                      onChange={(e) => setNewTask({ ...newTask, reminderAt: e.target.value })}
                    />
                  </div>
                </div>
              </div>

              <div className="p-6 bg-zinc-950 border-t border-zinc-800 flex gap-4">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="flex-1 px-4 py-3 bg-zinc-900 text-zinc-500 rounded-xl font-bold hover:bg-zinc-800 transition-all uppercase tracking-widest text-[10px]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 px-4 py-3 bg-emerald-500 text-black rounded-xl font-bold hover:bg-emerald-400 transition-all uppercase tracking-widest text-[10px] shadow-lg shadow-emerald-500/20 active:scale-95"
                >
                  Create Task
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
