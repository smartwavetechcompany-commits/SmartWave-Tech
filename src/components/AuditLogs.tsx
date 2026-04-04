import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, collectionGroup } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, OperationType } from '../types';
import { format, isValid } from 'date-fns';
import { 
  ClipboardList, 
  User, 
  Clock, 
  Tag, 
  RefreshCw, 
  Building2, 
  Lock,
  Search,
  ChevronUp,
  ChevronDown,
  Filter,
  Download
} from 'lucide-react';
import { cn, exportToCSV } from '../utils';
import { toast } from 'sonner';

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortConfig, setSortConfig] = useState<{ key: keyof AuditLog | 'actor' | 'target' | 'hotelId'; direction: 'asc' | 'desc' }>({
    key: 'timestamp',
    direction: 'desc'
  });

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
        const q = collectionGroup(db, 'activityLogs');
        unsub = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => {
            const data = doc.data();
            return { 
              id: doc.id, 
              ...data,
              actor: data.actor || data.user || data.userEmail || 'Unknown',
              target: data.target || data.resource || data.module || 'System',
              hotelId: data.hotelId || (doc.ref.parent.parent?.id)
            } as any;
          });
          setLogs(allLogs);
          setLoading(false);
        }, (err: any) => {
          handleFirestoreError(err, OperationType.LIST, 'collectionGroup/activityLogs');
          if (err.code === 'permission-denied') setHasPermissionError(true);
          setLoading(false);
        });
      } else if (hotel?.id) {
        const q = collection(db, 'hotels', hotel.id, 'activityLogs');
        unsub = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => {
            const data = doc.data();
            return { 
              id: doc.id, 
              ...data,
              actor: data.actor || data.user || data.userEmail || 'Unknown',
              target: data.target || data.resource || data.module || 'System'
            } as any;
          });
          setLogs(allLogs);
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

  const handleSort = (key: typeof sortConfig.key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  const filteredAndSortedLogs = useMemo(() => {
    let result = [...logs];

    // Filter out superAdmin logs for hotelAdmin
    if (profile?.role === 'hotelAdmin') {
      result = result.filter(log => (log as any).userRole !== 'superAdmin');
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      result = result.filter(log => 
        (log as any).actor?.toLowerCase().includes(query) ||
        log.action?.toLowerCase().includes(query) ||
        (log as any).target?.toLowerCase().includes(query) ||
        log.details?.toLowerCase().includes(query)
      );
    }

    result.sort((a, b) => {
      const aValue = (a as any)[sortConfig.key];
      const bValue = (b as any)[sortConfig.key];

      if (sortConfig.key === 'timestamp') {
        const getTime = (ts: any) => {
          if (!ts) return 0;
          if (ts.toMillis) return ts.toMillis();
          if (ts.seconds) return ts.seconds * 1000;
          return new Date(ts).getTime() || 0;
        };
        return sortConfig.direction === 'desc' 
          ? getTime(bValue) - getTime(aValue)
          : getTime(aValue) - getTime(bValue);
      }

      const strA = String(aValue || '').toLowerCase();
      const strB = String(bValue || '').toLowerCase();

      if (sortConfig.direction === 'desc') {
        return strB.localeCompare(strA);
      }
      return strA.localeCompare(strB);
    });

    return result;
  }, [logs, searchQuery, sortConfig]);

  if (profile?.role !== 'superAdmin' && profile?.role !== 'hotelAdmin') {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
        <Lock size={48} className="mx-auto text-zinc-700 mb-4" />
        <h3 className="text-lg font-bold text-white mb-2">Access Restricted</h3>
        <p className="text-zinc-400 text-sm">You do not have permission to view system activity logs.</p>
      </div>
    );
  }

  const SortIcon = ({ column }: { column: typeof sortConfig.key }) => {
    if (sortConfig.key !== column) return <Filter size={12} className="opacity-20" />;
    return sortConfig.direction === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />;
  };

  const handleExport = () => {
    const dataToExport = filteredAndSortedLogs.map(log => ({
      Timestamp: safeFormat(log.timestamp, 'yyyy-MM-dd HH:mm:ss'),
      Actor: (log as any).actor || log.userEmail || 'Unknown',
      Action: log.action,
      Target: (log as any).target || 'System',
      HotelID: log.hotelId || 'N/A'
    }));
    exportToCSV(dataToExport, `audit_logs_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    toast.success('Audit logs exported successfully');
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden flex flex-col h-full">
      <div className="p-3 sm:p-6 border-b border-zinc-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-center gap-2">
          <ClipboardList size={16} className="text-emerald-500 sm:size-[18px]" />
          <h3 className="font-bold text-white text-xs sm:text-base">System Activity Logs</h3>
        </div>
        
        <div className="flex items-center gap-2 sm:gap-3">
          <button 
            onClick={handleExport}
            className="flex items-center gap-1.5 sm:gap-2 bg-zinc-800 hover:bg-zinc-700 text-white px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[10px] sm:text-sm font-medium transition-all active:scale-95"
          >
            <Download size={12} className="sm:size-[18px]" />
            <span className="hidden xs:inline">Export CSV</span>
            <span className="xs:hidden">Export</span>
          </button>
          <div className="relative flex-1 sm:flex-none">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={12} />
            <input 
              type="text"
              placeholder="Search..."
              className="bg-zinc-950 border border-zinc-800 rounded-lg pl-8 pr-3 py-1.5 text-[10px] sm:text-sm text-white focus:border-emerald-500 outline-none transition-all w-full sm:w-48 md:w-64"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          <button 
            onClick={() => {}}
            disabled={loading}
            className="p-1.5 text-zinc-500 hover:text-white hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Refresh Logs"
          >
            <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <div className="min-w-[600px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-zinc-900 z-10 shadow-sm">
              <tr className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-2">
                    Date & Time
                    <SortIcon column="timestamp" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('actor')}>
                  <div className="flex items-center gap-2">
                    Actor
                    <SortIcon column="actor" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-white transition-colors" onClick={() => handleSort('action')}>
                  <div className="flex items-center gap-2">
                    Action
                    <SortIcon column="action" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-white transition-colors hidden md:table-cell" onClick={() => handleSort('target')}>
                  <div className="flex items-center gap-2">
                    Target
                    <SortIcon column="target" />
                  </div>
                </th>
                {profile.role === 'superAdmin' && (
                  <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-white transition-colors hidden lg:table-cell" onClick={() => handleSort('hotelId')}>
                    <div className="flex items-center gap-2">
                      Hotel
                      <SortIcon column="hotelId" />
                    </div>
                  </th>
                )}
                <th className="px-4 sm:px-6 py-3 sm:py-4">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading && filteredAndSortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 sm:p-12 text-center text-zinc-500 text-xs sm:text-sm italic">Loading activity logs...</td>
                </tr>
              ) : filteredAndSortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 sm:p-12 text-center text-zinc-500 text-xs sm:text-sm italic">No activity logs found matching your search</td>
                </tr>
              ) : (
                filteredAndSortedLogs.map(log => (
                  <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors group">
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-[10px] sm:text-xs text-white font-medium">{safeFormat(log.timestamp, 'MMM d, yyyy')}</span>
                        <span className="text-[9px] sm:text-[10px] text-zinc-500">{safeFormat(log.timestamp, 'HH:mm:ss')}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <div className="flex items-center gap-2 text-[10px] sm:text-xs text-zinc-300">
                        <div className="w-5 h-5 sm:w-6 sm:h-6 rounded-full bg-zinc-800 flex items-center justify-center text-[9px] sm:text-[10px] font-bold text-zinc-500">
                          {(log as any).actor?.charAt(0).toUpperCase()}
                        </div>
                        <span className="truncate max-w-[100px] sm:max-w-none">{(log as any).actor}</span>
                      </div>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 hidden md:table-cell">
                      <div className="flex items-center gap-2 text-[10px] sm:text-xs text-zinc-400">
                        <Tag size={10} className="text-zinc-600" />
                        <span className="truncate max-w-[120px]">{(log as any).target}</span>
                      </div>
                    </td>
                    {profile.role === 'superAdmin' && (
                      <td className="px-4 sm:px-6 py-3 sm:py-4 hidden lg:table-cell">
                        <div className="flex items-center gap-1 text-[9px] sm:text-[10px] text-blue-400 font-bold uppercase tracking-tight">
                          <Building2 size={10} />
                          {(log as any).hotelId || 'N/A'}
                        </div>
                      </td>
                    )}
                    <td className="px-4 sm:px-6 py-3 sm:py-4 max-w-[150px] sm:max-w-xs">
                      <p className="text-[9px] sm:text-[10px] text-zinc-500 font-mono line-clamp-2 italic group-hover:line-clamp-none transition-all">
                        {log.details || 'No additional details'}
                      </p>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex items-center justify-between text-[10px] text-zinc-500 font-bold uppercase tracking-widest">
        <span>Showing {filteredAndSortedLogs.length} logs</span>
        {logs.length >= 100 && <span>Limited to latest 100 entries</span>}
      </div>
    </div>
  );
}
