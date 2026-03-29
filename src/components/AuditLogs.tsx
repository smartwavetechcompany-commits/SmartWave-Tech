import React, { useEffect, useState, useCallback } from 'react';
import { collection, getDocs, query, orderBy, limit, where, onSnapshot, collectionGroup } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, OperationType } from '../types';
import { format, isValid } from 'date-fns';
import { ClipboardList, User, Clock, Tag, RefreshCw, Building2 } from 'lucide-react';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);

  const { hotel, profile } = useAuth();

  const safeFormat = (date: any, formatStr: string) => {
    try {
      const d = new Date(date);
      if (!isValid(d)) return 'N/A';
      return format(d, formatStr);
    } catch (e) {
      return 'N/A';
    }
  };

  useEffect(() => {
    if (!profile || hasPermissionError) return;
    if (profile.role !== 'superAdmin' && profile.role !== 'hotelAdmin') return;
    if (profile.role === 'hotelAdmin' && !hotel?.id) return;

    setLoading(true);
    let unsub: () => void = () => {};

    try {
      if (profile.role === 'superAdmin') {
        // Fetch without orderBy to avoid index requirement
        const q = collectionGroup(db, 'activityLogs');
        unsub = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => ({ 
            id: doc.id, 
            ...doc.data(),
            hotelId: (doc.data() as any).hotelId || (doc.ref.parent.parent?.id)
          } as any));

          // Client-side sorting and limiting
          const sortedLogs = allLogs
            .sort((a, b) => {
              const getTime = (ts: any) => {
                if (!ts) return 0;
                if (ts.toMillis) return ts.toMillis();
                if (ts.seconds) return ts.seconds * 1000;
                return new Date(ts).getTime() || 0;
              };
              return getTime(b.timestamp) - getTime(a.timestamp);
            })
            .slice(0, 100);

          setLogs(sortedLogs);
          setLoading(false);
        }, (err: any) => {
          handleFirestoreError(err, OperationType.LIST, 'collectionGroup/activityLogs');
          if (err.code === 'permission-denied') setHasPermissionError(true);
          setLoading(false);
        });
      } else if (hotel?.id) {
        // Fetch without orderBy to avoid index requirement
        const q = collection(db, 'hotels', hotel.id, 'activityLogs');
        unsub = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
          
          // Client-side sorting and limiting
          const sortedLogs = allLogs
            .sort((a, b) => {
              const getTime = (ts: any) => {
                if (!ts) return 0;
                if (ts.toMillis) return ts.toMillis();
                if (ts.seconds) return ts.seconds * 1000;
                return new Date(ts).getTime() || 0;
              };
              return getTime(b.timestamp) - getTime(a.timestamp);
            })
            .slice(0, 50);

          setLogs(sortedLogs);
          setLoading(false);
        }, (err: any) => {
          handleFirestoreError(err, OperationType.LIST, `hotels/${hotel.id}/activityLogs`);
          if (err.code === 'permission-denied') setHasPermissionError(true);
          setLoading(false);
        });
      }
    } catch (err: any) {
      handleFirestoreError(err, OperationType.LIST, 'activityLogs');
      setLoading(false);
    }

    return () => unsub();
  }, [hotel?.id, profile?.uid, profile?.role, hasPermissionError]);

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="font-bold text-white flex items-center gap-2">
          <ClipboardList size={18} className="text-emerald-500" />
          System Activity Logs
        </h3>
        <button 
          onClick={() => {}}
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
                  {safeFormat(log.timestamp, 'MMM d, HH:mm:ss')}
                </div>
              </div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Tag size={12} className="text-emerald-500" />
                <span className="font-semibold text-emerald-500/80 uppercase tracking-wider">{log.action}</span>
                <span>on</span>
                <span className="text-zinc-300">{(log as any).target || (log as any).resource || (log as any).module || 'System'}</span>
                {profile.role === 'superAdmin' && (log as any).hotelId && (
                  <>
                    <span className="text-zinc-600">•</span>
                    <span className="flex items-center gap-1 text-blue-400">
                      <Building2 size={10} />
                      {(log as any).hotelId}
                    </span>
                  </>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
