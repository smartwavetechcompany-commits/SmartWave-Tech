import React, { useEffect, useState, useCallback } from 'react';
import { collection, getDocs, query, orderBy, limit, where, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, OperationType } from '../types';
import { format } from 'date-fns';
import { ClipboardList, User, Clock, Tag, RefreshCw } from 'lucide-react';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const { hotel, profile } = useAuth();

  const fetchLogs = useCallback(() => {
    if (!profile || hasPermissionError) return () => {};
    if (profile.role !== 'superAdmin' && profile.role !== 'hotelAdmin') return () => {};
    if (profile.role === 'hotelAdmin' && !hotel?.id) return () => {};

    setLoading(true);
    let q;
    if (profile.role === 'superAdmin') {
      q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(50));
    } else {
      q = query(collection(db, 'hotels', hotel?.id || '', 'activityLogs'), orderBy('timestamp', 'desc'), limit(50));
    }

    const unsubscribe = onSnapshot(q, 
      (snap) => {
        setLogs(snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any)));
        setLoading(false);
      },
      (err) => {
        const path = profile.role === 'superAdmin' ? 'auditLogs' : `hotels/${hotel?.id}/activityLogs`;
        handleFirestoreError(err, OperationType.LIST, path);
        if (err.code === 'permission-denied') {
          setHasPermissionError(true);
        }
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [hotel?.id, profile?.role, hasPermissionError]);

  useEffect(() => {
    setHasPermissionError(false);
    const unsubscribe = fetchLogs();
    return () => {
      if (typeof unsubscribe === 'function') unsubscribe();
    };
  }, [profile?.uid, hotel?.id, fetchLogs]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="font-bold text-white flex items-center gap-2">
          <ClipboardList size={18} className="text-emerald-500" />
          System Activity Logs
        </h3>
        <button 
          onClick={() => fetchLogs()}
          disabled={loading}
          className="p-2 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
          title="Refresh Logs"
        >
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <div className="divide-y divide-zinc-800 max-h-[400px] overflow-y-auto">
        {loading && logs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">Loading logs...</div>
        ) : logs.length === 0 ? (
          <div className="p-8 text-center text-zinc-500 text-sm">No activity logs found</div>
        ) : (
          logs.map(log => (
            <div key={log.id} className="p-4 hover:bg-zinc-800/50 transition-colors">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <User size={14} className="text-zinc-500" />
                  {(log as any).actor || (log as any).user || (log as any).userEmail || 'Unknown'}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-500 uppercase font-bold">
                  <Clock size={12} />
                  {format(new Date(log.timestamp), 'MMM d, HH:mm:ss')}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Tag size={12} className="text-emerald-500" />
                <span className="font-semibold text-emerald-500/80 uppercase tracking-wider">{log.action}</span>
                <span>on</span>
                <span className="text-zinc-300">{(log as any).target || (log as any).resource || (log as any).module || 'System'}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
