import React, { useEffect, useState } from 'react';
import { collection, getDocs, query, where, orderBy, limit, doc, writeBatch } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { useAuth } from '../contexts/AuthContext';
import { OperationType } from '../types';
import { useNavigate } from 'react-router-dom';
import { 
  Bell, 
  Check, 
  Info, 
  AlertTriangle, 
  AlertCircle,
  X,
  Clock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, safeStringify } from '../utils';
import { errorService, ErrorSeverity } from '../services/errorService';
import { format } from 'date-fns';
import { safeFormatDate } from '../utils/dateUtils';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
  read: boolean;
  timestamp: string;
  userId?: string;
  route?: string;
  link?: string;
}

export function Notifications() {
  const { hotel, profile } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (!hotel?.id || !profile) return;

    const q = query(
      collection(db, 'hotels', hotel.id, 'notifications'),
      where('userId', 'in', [profile.uid, 'all']),
      limit(50)
    );

    getDocs(q).then(
      (snap) => {
        const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as Notification));
        // Sort client-side to avoid index error
        setNotifications(docs.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()));
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, `hotels/${hotel.id}/notifications`);
      }
    );

    return () => {};
  }, [hotel?.id, profile?.uid]);

  const markAsRead = async (id: string) => {
    if (!hotel?.id) return;
    try {
      await database.safeUpdate(doc(db, 'hotels', hotel.id, 'notifications', id), { read: true }, {
        hotelId: hotel.id,
        module: 'Notifications',
        action: 'MARK_READ',
        details: `Marked notification ${id} as read`
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `hotels/${hotel.id}/notifications/${id}`);
    }
  };

  const markAllAsRead = async () => {
    if (!hotel?.id) return;
    const unread = notifications.filter(n => !n.read);
    const batch = writeBatch(db);
    try {
      unread.forEach(n => {
        batch.update(doc(db, 'hotels', hotel.id!, 'notifications', n.id), { read: true });
      });
      await database.commitBatch(hotel.id, batch, {
        module: 'Notifications',
        action: 'MARK_ALL_READ',
        details: `Marked ${unread.length} notifications as read`
      });
    } catch (err: any) {
      errorService.handleError(err, { module: 'Notifications', severity: ErrorSeverity.MEDIUM });
    }
  };

  const getNotificationRoute = (n: Notification): string => {
    if (n.route) return n.route;
    if (n.link) return n.link;

    const text = `${n.title} ${n.message}`.toLowerCase();
    if (text.includes('f & b') || text.includes('f&b') || text.includes('food') || text.includes('order') || text.includes('kitchen') || text.includes('dish') || text.includes('bar')) {
      return '/f-and-b';
    }
    if (text.includes('reservation') || text.includes('booking') || text.includes('check-in') || text.includes('check in') || text.includes('check-out') || text.includes('check out') || text.includes('overdue') || text.includes('grace period') || text.includes('stay')) {
      return '/operations';
    }
    if (text.includes('clean') || text.includes('housekeep') || text.includes('maid') || text.includes('linen')) {
      return '/housekeeping';
    }
    if (text.includes('maintenance') || text.includes('repair') || text.includes('fix') || text.includes('damage') || text.includes('leak')) {
      return '/maintenance';
    }
    if (text.includes('payment') || text.includes('revenue') || text.includes('invoice') || text.includes('finance') || text.includes('transaction')) {
      return '/finance';
    }
    if (text.includes('debt') || text.includes('debtor') || text.includes('ledger') || text.includes('owing') || text.includes('balance') || text.includes('settle')) {
      return '/debt-ledger';
    }
    if (text.includes('room') && (text.includes('dirty') || text.includes('status') || text.includes('occupied'))) {
      return '/room-status';
    }
    if (text.includes('inventory') || text.includes('stock')) {
      return '/inventory';
    }
    return '/activity-logs';
  };

  const handleNotificationClick = async (notification: Notification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    setIsOpen(false);
    const targetRoute = getNotificationRoute(notification);
    navigate(targetRoute);
  };

  const unreadCount = notifications.filter(n => !n.read).length;

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-zinc-400 hover:text-zinc-50 hover:bg-zinc-800 rounded-xl transition-all active:scale-95 cursor-pointer"
        title="Notifications"
        aria-label="View notifications"
      >
        <Bell size={20} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-zinc-50 text-[10px] font-bold flex items-center justify-center rounded-full border-2 border-zinc-950">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => setIsOpen(false)} 
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute right-0 mt-2 w-80 bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl z-50 overflow-hidden"
            >
              <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950/50">
                <h3 className="text-sm font-bold text-zinc-50">Notifications</h3>
                {unreadCount > 0 && (
                  <button 
                    type="button"
                    onClick={markAllAsRead}
                    className="text-[10px] font-bold text-emerald-500 hover:underline uppercase tracking-wider cursor-pointer"
                  >
                    Mark all as read
                  </button>
                )}
              </div>

              <div className="max-h-[400px] overflow-y-auto custom-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-8 text-center text-zinc-500">
                    <Bell size={32} className="mx-auto mb-2 opacity-20" />
                    <p className="text-xs">No notifications yet</p>
                  </div>
                ) : (
                  <div className="divide-y divide-zinc-800">
                    {notifications.map((notification) => (
                      <div 
                        key={notification.id}
                        className={cn(
                          "p-4 transition-colors hover:bg-zinc-800/50 flex gap-3 cursor-pointer group",
                          !notification.read && "bg-emerald-500/5"
                        )}
                        onClick={() => handleNotificationClick(notification)}
                      >
                        <div className={cn(
                          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform",
                          notification.type === 'info' ? "bg-blue-500/10 text-blue-500" :
                          notification.type === 'warning' ? "bg-amber-500/10 text-amber-500" :
                          notification.type === 'error' ? "bg-red-500/10 text-red-500" :
                          "bg-emerald-500/10 text-emerald-500"
                        )}>
                          {notification.type === 'info' && <Info size={16} />}
                          {notification.type === 'warning' && <AlertTriangle size={16} />}
                          {notification.type === 'error' && <AlertCircle size={16} />}
                          {notification.type === 'success' && <Check size={16} />}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 mb-1">
                            <h4 className="text-xs font-bold text-zinc-50 group-hover:text-emerald-400 transition-colors truncate">
                              {notification.title}
                            </h4>
                            <span className="text-[10px] text-zinc-500 whitespace-nowrap">
                              {safeFormatDate(notification.timestamp, 'HH:mm')}
                            </span>
                          </div>
                          <p className="text-xs text-zinc-400 line-clamp-2 leading-relaxed">
                            {notification.message}
                          </p>
                        </div>
                        {!notification.read && (
                          <div className="w-2 h-2 bg-emerald-500 rounded-full mt-1.5 shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="p-3 bg-zinc-950/50 border-t border-zinc-800 text-center">
                <button 
                  type="button"
                  onClick={() => {
                    setIsOpen(false);
                    navigate('/activity-logs');
                  }}
                  className="text-[10px] font-bold text-zinc-400 hover:text-emerald-400 uppercase tracking-wider cursor-pointer transition-colors"
                >
                  View all activity →
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

export async function createNotification(hotelId: string, notification: Omit<Notification, 'id' | 'read' | 'timestamp'>) {
  try {
    await database.safeAdd(collection(db, 'hotels', hotelId, 'notifications'), {
      ...notification,
      read: false,
      timestamp: new Date().toISOString()
    }, {
      hotelId,
      module: 'Notifications',
      action: 'NOTIFICATION_CREATE',
      details: `Created notification: ${notification.title}`
    });
  } catch (err: any) {
    errorService.handleError(err, { module: 'Notifications', severity: ErrorSeverity.MEDIUM });
  }
}
