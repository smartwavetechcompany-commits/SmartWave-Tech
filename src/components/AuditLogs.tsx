import React, { useEffect, useState, useMemo } from 'react';
import { collection, onSnapshot, collectionGroup } from 'firebase/firestore';
import { db, handleFirestoreError } from '../firebase';
import { useAuth } from '../contexts/AuthContext';
import { AuditLog, OperationType } from '../types';
import { format, isValid, subDays, startOfDay, endOfDay } from 'date-fns';
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
  Download,
  Calendar,
  Eye,
  X,
  ArrowRight
} from 'lucide-react';
import { cn, exportToCSV, formatCurrency, safeStringify } from '../utils';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

const renderPrettyValue = (value: any): React.ReactNode => {
  if (value === null || value === undefined) {
    return (
      <span className="text-zinc-600 text-[10px] bg-zinc-900 px-2 py-0.5 rounded font-mono uppercase">
        None
      </span>
    );
  }
  if (typeof value === 'boolean') {
    return (
      <span className={cn(
        "px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider",
        value 
          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
          : "bg-zinc-800/80 text-zinc-400 border border-zinc-700/50"
      )}>
        {value ? 'Enabled' : 'Disabled'}
      </span>
    );
  }
  if (typeof value === 'object') {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return (
          <span className="text-zinc-500 text-[10px] font-mono italic">
            Empty List
          </span>
        );
      }
      // Check if it's an array of objects (like taxes)
      const isArrayOfObjects = value.every(item => item && typeof item === 'object' && !Array.isArray(item));
      if (isArrayOfObjects) {
        return (
          <div className="space-y-4 font-sans text-left w-full mt-1">
            {value.map((item: any, idx: number) => {
              const displayName = item.name || item.title || item.label || `Item #${idx + 1}`;
              return (
                <div key={idx} className="bg-zinc-900 border border-zinc-800/80 p-4 rounded-2xl flex flex-col gap-2.5 shadow-md">
                  <div className="flex items-center justify-between border-b border-zinc-800/65 pb-2">
                    <span className="font-bold text-zinc-200 text-xs">{displayName}</span>
                    {item.status && (
                      <span className={cn(
                        "text-[8px] font-bold uppercase px-2 py-0.5 rounded-full tracking-wider",
                        item.status === 'active' || item.status === 'enabled'
                          ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20" 
                          : "bg-zinc-850 text-zinc-500 border border-zinc-800"
                      )}>
                        {item.status}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
                    {Object.entries(item)
                      .filter(([k]) => k !== 'id' && k !== 'name' && k !== 'status' && k !== 'label' && k !== 'title')
                      .map(([k, v]) => (
                        <div key={k} className="flex justify-between items-center gap-4 bg-zinc-950/20 px-2 py-1.5 rounded-lg border border-zinc-800/10">
                          <span className="text-zinc-500 font-medium capitalize">{k.replace(/([A-Z])/g, ' $1').trim()}:</span>
                          <span className="text-zinc-300 font-mono font-medium truncate max-w-[150px]" title={String(typeof v === 'object' ? safeStringify(v) : v)}>
                            {typeof v === 'boolean' 
                              ? (v ? 'Yes' : 'No') 
                              : typeof v === 'object' 
                                ? safeStringify(v) 
                                : String(v)}
                          </span>
                        </div>
                    ))}
                  </div>
                  {item.id && (
                    <div className="text-[8px] text-zinc-650 font-mono self-end opacity-50">
                      ID: {String(item.id).toUpperCase()}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      } else {
        // Simple array of primitives
        return (
          <div className="flex flex-wrap gap-2 text-left mt-1">
            {value.map((val, idx) => (
              <span key={idx} className="bg-zinc-905 border border-zinc-800 px-2.5 py-1 rounded-xl text-xs font-mono text-zinc-300">
                {String(val)}
              </span>
            ))}
          </div>
        );
      }
    } else {
      // Single object
      return (
        <div className="grid grid-cols-1 gap-2 font-sans text-left mt-1">
          {Object.entries(value).map(([k, v]) => (
            <div key={k} className="bg-zinc-900/60 border border-zinc-800/40 p-3 rounded-2xl flex items-center justify-between gap-4 text-xs font-sans">
              <span className="text-zinc-500 font-bold uppercase text-[9px] tracking-wider">{k.replace(/([A-Z])/g, ' $1').trim()}</span>
              <span className="text-zinc-200 font-mono font-medium break-all text-right max-w-[65%]">
                {typeof v === 'boolean' 
                  ? (v ? 'Yes' : 'No') 
                  : typeof v === 'object' 
                    ? safeStringify(v) 
                    : String(v)}
              </span>
            </div>
          ))}
        </div>
      );
    }
  }
  return <span className="text-zinc-200 font-mono break-all mt-1 block">{String(value)}</span>;
};

export function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [hotels, setHotels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [moduleFilter, setModuleFilter] = useState<string>('all');
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [metadataTab, setMetadataTab] = useState<'visual' | 'raw'>('visual');
  const [currentPage, setCurrentPage] = useState(1);
  const [logsPerPage] = useState(50);
  const [dateRange, setDateRange] = useState({
    start: format(subDays(new Date(), 7), "yyyy-MM-dd'T'00:00"),
    end: format(new Date(), "yyyy-MM-dd'T'23:59")
  });
  const [sortConfig, setSortConfig] = useState<{ key: keyof AuditLog | 'actor' | 'target' | 'hotelId' | 'module' | 'userRole'; direction: 'asc' | 'desc' }>({
    key: 'timestamp',
    direction: 'desc'
  });

  const { hotel, profile } = useAuth();

  const safeFormat = (date: any, formatStr: string) => {
    try {
      if (!date) return 'N/A';
      let d: Date;
      if (typeof date.toDate === 'function') {
        d = date.toDate();
      } else if (typeof date.seconds === 'number') {
        d = new Date(date.seconds * 1000);
      } else {
        d = new Date(date);
      }
      if (!isValid(d)) return 'N/A';
      return format(d, formatStr);
    } catch (e) {
      return 'N/A';
    }
  };

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, moduleFilter, dateRange]);

  useEffect(() => {
    if (!profile || hasPermissionError) return;
    if (profile.role !== 'superAdmin' && profile.role !== 'hotelAdmin') return;
    if (profile.role === 'hotelAdmin' && !hotel?.id) return;

    setLoading(true);
    let unsubLogs: () => void = () => {};
    let unsubHotels: () => void = () => {};

    try {
      if (profile.role === 'superAdmin') {
        // Fetch hotels to resolve names
        unsubHotels = onSnapshot(collection(db, 'hotels'), (snap) => {
          const hotelMap: Record<string, string> = {};
          snap.docs.forEach(doc => {
            hotelMap[doc.id] = doc.data().name;
          });
          setHotels(hotelMap);
        });

        const q = collectionGroup(db, 'activityLogs');
        unsubLogs = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => {
            const data = doc.data();
            return { 
              id: doc.id, 
              ...data,
              actor: data.actor || data.user || data.userEmail || data.userName || 'Unknown',
              userRole: data.userRole || 'staff',
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
        unsubLogs = onSnapshot(q, (snap) => {
          const allLogs = snap.docs.map(doc => {
            const data = doc.data();
            return { 
              id: doc.id, 
              ...data,
              actor: data.actor || data.user || data.userEmail || data.userName || 'Unknown',
              userRole: data.userRole || 'staff',
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

    return () => {
      unsubLogs();
      unsubHotels();
    };
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
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(log => 
        (log as any).actor?.toLowerCase().includes(q) ||
        (log.action || '').toLowerCase().includes(q) ||
        (log as any).target?.toLowerCase().includes(q) ||
        (log.details || '').toLowerCase().includes(q) ||
        (log.module || '').toLowerCase().includes(q) ||
        (log.hotelId || '').toLowerCase().includes(q) ||
        ((log as any).userRole || '').toLowerCase().includes(q)
      );
    }

    if (moduleFilter !== 'all') {
      result = result.filter(log => (log as any).module === moduleFilter);
    }

    if (dateRange.start && dateRange.end) {
      const start = new Date(dateRange.start).getTime();
      const end = new Date(dateRange.end).getTime();
      
      result = result.filter(log => {
        const ts = (log as any).timestamp;
        const getTime = (t: any) => {
          if (!t) return 0;
          if (t.toMillis) return t.toMillis();
          if (t.seconds) return t.seconds * 1000;
          return new Date(t).getTime() || 0;
        };
        const logTime = getTime(ts);
        return logTime >= start && logTime <= end;
      });
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

      // Handle actor sorting specifically since it might be a derived field
      let valA = aValue;
      let valB = bValue;
      
      if (sortConfig.key === 'actor') {
        valA = (a as any).actor || (a as any).user || (a as any).userEmail || 'Unknown';
        valB = (b as any).actor || (b as any).user || (b as any).userEmail || 'Unknown';
      }

      const strA = String(valA || '').toLowerCase();
      const strB = String(valB || '').toLowerCase();

      if (sortConfig.direction === 'desc') {
        return strB.localeCompare(strA);
      }
      return strA.localeCompare(strB);
    });

    return result;
  }, [logs, searchQuery, sortConfig, moduleFilter, dateRange, profile?.role]);

  const totalPages = Math.ceil(filteredAndSortedLogs.length / logsPerPage);
  const paginatedLogs = useMemo(() => {
    const startIndex = (currentPage - 1) * logsPerPage;
    return filteredAndSortedLogs.slice(startIndex, startIndex + logsPerPage);
  }, [filteredAndSortedLogs, currentPage, logsPerPage]);

  if (profile?.role !== 'superAdmin' && profile?.role !== 'hotelAdmin') {
    return (
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-12 text-center">
        <Lock size={48} className="mx-auto text-zinc-700 mb-4" />
        <h3 className="text-lg font-bold text-zinc-50 mb-2">Access Restricted</h3>
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
    <div className="p-4 sm:p-6 lg:p-8 space-y-6 flex flex-col h-full animate-in fade-in duration-500">
      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardList size={16} className="text-emerald-500 sm:size-[18px]" />
            <h3 className="font-bold text-zinc-50 text-xs sm:text-base">System Activity Logs</h3>
          </div>
          <button 
            onClick={() => window.location.reload()}
            disabled={loading}
            className="p-1.5 text-zinc-500 hover:text-zinc-50 hover:bg-zinc-800 rounded-lg transition-all disabled:opacity-50"
            title="Refresh Logs"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
        
        <div className="flex flex-wrap items-center gap-2 sm:gap-4">
          <div className="flex flex-wrap items-center gap-2 bg-zinc-800 border border-zinc-700 px-2 sm:px-3 py-1.5 rounded-xl flex-1 sm:flex-none">
            <Clock size={14} className="text-emerald-500" />
            <input 
              type="datetime-local" 
              value={dateRange.start}
              onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
              className="bg-transparent text-[10px] sm:text-xs text-zinc-50 outline-none border-none min-w-[130px]"
              style={{ colorScheme: 'dark' }}
            />
            <span className="text-zinc-600 text-[10px]">to</span>
            <input 
              type="datetime-local" 
              value={dateRange.end}
              onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
              className="bg-transparent text-[10px] sm:text-xs text-zinc-50 outline-none border-none min-w-[130px]"
              style={{ colorScheme: 'dark' }}
            />
            {(dateRange.start || dateRange.end || moduleFilter !== 'all' || searchQuery) && (
              <div className="flex items-center gap-1 ml-1 border-l border-zinc-700 pl-2">
                <button
                  onClick={() => {
                    setDateRange({
                      start: format(new Date(Date.now() - 24 * 60 * 60 * 1000), "yyyy-MM-dd'T'HH:mm"),
                      end: format(new Date(), "yyyy-MM-dd'T'HH:mm")
                    });
                  }}
                  className="px-1.5 py-0.5 hover:bg-emerald-500/10 text-emerald-500 rounded text-[9px] font-bold uppercase transition-all"
                  title="Last 24 Hours"
                >
                  24h
                </button>
                <button
                  onClick={() => {
                    setDateRange({
                      start: format(subDays(new Date(), 7), "yyyy-MM-dd'T'00:00"),
                      end: format(new Date(), "yyyy-MM-dd'T'23:59")
                    });
                    setModuleFilter('all');
                    setSearchQuery('');
                  }}
                  className="p-1 hover:bg-zinc-700 rounded-lg text-zinc-500 hover:text-zinc-50 transition-all"
                  title="Reset Filters"
                >
                  <X size={12} />
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 flex-1 sm:flex-none">
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value)}
              className="bg-zinc-800 border border-zinc-700 rounded-xl px-3 py-1.5 text-[10px] sm:text-xs text-zinc-50 focus:border-emerald-500 outline-none flex-1 sm:flex-none"
            >
              <option value="all">All Modules</option>
              {/* ... module options ... */}
              <option value="Front Desk">Front Desk</option>
              <option value="Guests">Guests</option>
              <option value="Corporate">Corporate</option>
              <option value="F & B">F & B</option>
              <option value="Rooms">Rooms</option>
              <option value="Finance">Finance</option>
              <option value="Settings">Settings</option>
              <option value="Housekeeping">Housekeeping</option>
              <option value="Staff">Staff</option>
              <option value="Maintenance">Maintenance</option>
              <option value="Inventory">Inventory</option>
            </select>
            
            <button 
              onClick={handleExport}
              className="flex items-center gap-1.5 sm:gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-2.5 py-1.5 sm:px-4 sm:py-2 rounded-xl text-[10px] sm:text-xs font-medium transition-all active:scale-95"
            >
              <Download size={14} />
              <span className="hidden xs:inline">Export CSV</span>
              <span className="xs:hidden">Export</span>
            </button>
          </div>

          <div className="relative flex-1 w-full sm:max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" size={14} />
            <input 
              type="text"
              placeholder="Search logs..."
              className="bg-zinc-950 border border-zinc-800 rounded-xl pl-8 pr-3 py-1.5 text-[10px] sm:text-xs text-zinc-50 focus:border-emerald-500 outline-none transition-all w-full"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-zinc-900/30 border border-zinc-800/80 rounded-2xl shadow-2xl">
        <div className="min-w-[600px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-zinc-900 z-10 shadow-sm">
              <tr className="text-[9px] sm:text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors" onClick={() => handleSort('timestamp')}>
                  <div className="flex items-center gap-2">
                    Date & Time
                    <SortIcon column="timestamp" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors group/header" onClick={() => handleSort('actor')}>
                  <div className="flex items-center gap-2">
                    Actor
                    <div className={cn("transition-opacity", sortConfig.key === 'actor' ? "opacity-100" : "opacity-0 group-hover/header:opacity-100")}>
                      <SortIcon column="actor" />
                    </div>
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors group/header" onClick={() => handleSort('userRole')}>
                  <div className="flex items-center gap-2">
                    Role
                    <div className={cn("transition-opacity", sortConfig.key === 'userRole' ? "opacity-100" : "opacity-0 group-hover/header:opacity-100")}>
                      <SortIcon column="userRole" />
                    </div>
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors" onClick={() => handleSort('action')}>
                  <div className="flex items-center gap-2">
                    Action
                    <SortIcon column="action" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors" onClick={() => handleSort('module')}>
                  <div className="flex items-center gap-2">
                    Module
                    <SortIcon column="module" />
                  </div>
                </th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors hidden md:table-cell" onClick={() => handleSort('target')}>
                  <div className="flex items-center gap-2">
                    Target
                    <SortIcon column="target" />
                  </div>
                </th>
                {profile.role === 'superAdmin' && (
                  <th className="px-4 sm:px-6 py-3 sm:py-4 cursor-pointer hover:text-zinc-50 transition-colors hidden lg:table-cell" onClick={() => handleSort('hotelId')}>
                    <div className="flex items-center gap-2">
                      Hotel Name
                      <SortIcon column="hotelId" />
                    </div>
                  </th>
                )}
                <th className="px-4 sm:px-6 py-3 sm:py-4">Details</th>
                <th className="px-4 sm:px-6 py-3 sm:py-4 text-right">View</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {loading && filteredAndSortedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 sm:p-12 text-center text-zinc-500 text-xs sm:text-sm italic">Loading activity logs...</td>
                </tr>
              ) : paginatedLogs.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 sm:p-12 text-center text-zinc-500 text-xs sm:text-sm italic">No activity logs found matching your search</td>
                </tr>
              ) : (
                paginatedLogs.map(log => (
                  <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors group">
                    <td className="px-4 sm:px-6 py-3 sm:py-4 whitespace-nowrap">
                      <div className="flex flex-col">
                        <span className="text-[10px] sm:text-xs text-zinc-50 font-medium">{safeFormat(log.timestamp, 'MMM d, yyyy')}</span>
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
                      <span className={cn(
                        "px-1.5 py-0.5 rounded text-[8px] sm:text-[9px] font-bold uppercase tracking-tight",
                        (log as any).userRole === 'superAdmin' ? "bg-purple-500/10 text-purple-400" :
                        (log as any).userRole === 'hotelAdmin' ? "bg-blue-500/10 text-blue-400" :
                        "bg-zinc-800 text-zinc-400"
                      )}>
                        {((log as any).userRole || 'staff').replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="px-1.5 py-0.5 rounded text-[9px] sm:text-[10px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                        {log.action}
                      </span>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4">
                      <span className="text-[10px] sm:text-xs text-zinc-400 font-medium">
                        {(log as any).module || 'System'}
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
                        <div className="flex flex-col gap-0.5">
                          <div className="flex items-center gap-1 text-[10px] sm:text-xs text-blue-400 font-bold uppercase tracking-tight">
                            <Building2 size={10} />
                            {hotels[log.hotelId || ''] || 'N/A'}
                          </div>
                          {log.hotelId && (
                            <span className="text-[8px] text-zinc-600 font-mono">{log.hotelId}</span>
                          )}
                        </div>
                      </td>
                    )}
                    <td className="px-4 sm:px-6 py-3 sm:py-4 max-w-[150px] sm:max-w-xs">
                      <p className="text-[9px] sm:text-[10px] text-zinc-500 font-mono line-clamp-2 italic group-hover:line-clamp-none transition-all">
                        {log.details || 'No additional details'}
                      </p>
                    </td>
                    <td className="px-4 sm:px-6 py-3 sm:py-4 text-right">
                      <button 
                        onClick={() => setSelectedLog(log)}
                        className="p-1 px-2 rounded-lg bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all active:scale-95 flex items-center justify-center ml-auto"
                        title="View Metadata"
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      
      <div className="p-4 border-t border-zinc-800 bg-zinc-900/50 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest flex items-center gap-4">
          <span>Showing {paginatedLogs.length} of {filteredAndSortedLogs.length} logs</span>
          {logs.length >= 500 && <span>Limited to latest 500 entries</span>}
        </div>

        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              disabled={currentPage === 1}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-50 disabled:opacity-50 transition-all"
            >
              <ChevronUp className="-rotate-90" size={16} />
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                let pageNum = currentPage;
                if (totalPages <= 5) pageNum = i + 1;
                else if (currentPage <= 3) pageNum = i + 1;
                else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                else pageNum = currentPage - 2 + i;

                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={cn(
                      "w-8 h-8 rounded-lg text-xs font-bold transition-all",
                      currentPage === pageNum ? "bg-emerald-500 text-black" : "bg-zinc-800 text-zinc-400 hover:text-zinc-50"
                    )}
                  >
                    {pageNum}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              disabled={currentPage === totalPages}
              className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-zinc-50 disabled:opacity-50 transition-all"
            >
              <ChevronDown className="-rotate-90" size={16} />
            </button>
          </div>
        )}
      </div>

      <AnimatePresence>
        {selectedLog && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-zinc-950/80 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-zinc-900 border border-zinc-800 rounded-3xl w-full max-w-4xl max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-2xl bg-emerald-500/10 text-emerald-500">
                    <ClipboardList size={24} />
                  </div>
                  <div>
                    <h3 className="text-xl font-bold text-zinc-50">Log Metadata</h3>
                    <p className="text-sm text-zinc-400">Detailed data changes and context</p>
                  </div>
                </div>
                <button 
                  onClick={() => setSelectedLog(null)}
                  className="p-2 hover:bg-zinc-800 rounded-xl transition-all text-zinc-400 hover:text-zinc-50"
                >
                  <X size={24} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-8 custom-scrollbar">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Basic Context</h4>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="bg-zinc-950/50 border border-zinc-800/50 p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Timestamp</span>
                        <span className="text-sm text-zinc-300 font-mono">{safeFormat(selectedLog.timestamp, 'yyyy-MM-dd HH:mm:ss.SSS')}</span>
                      </div>
                      <div className="bg-zinc-950/50 border border-zinc-800/50 p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Action</span>
                        <span className="text-sm text-emerald-500 font-bold uppercase tracking-wider">{selectedLog.action}</span>
                      </div>
                      <div className="bg-zinc-950/50 border border-zinc-800/50 p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Actor</span>
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-zinc-50 font-bold">{(selectedLog as any).actor}</span>
                          <span className="px-1.5 py-0.5 rounded text-[8px] font-bold uppercase bg-zinc-800 text-zinc-500">{(selectedLog as any).userRole}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Technical details</h4>
                    <div className="grid grid-cols-1 gap-3">
                      <div className="bg-zinc-950/50 border border-zinc-800/50 p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Resource Target</span>
                        <span className="text-sm text-zinc-400 font-mono">{(selectedLog as any).target}</span>
                      </div>
                      <div className="bg-zinc-950/50 border border-zinc-800/50 p-4 rounded-2xl flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-tight">Module Path</span>
                        <span className="text-sm text-zinc-400">{(selectedLog as any).module}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {selectedLog.metadata && (
                  <div className="space-y-6">
                    <div className="flex items-center justify-between border-b border-zinc-800/80 pb-3">
                      <h4 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Data Change Tracking</h4>
                      <div className="flex bg-zinc-950 p-1 rounded-xl border border-zinc-800">
                        <button
                          type="button"
                          onClick={() => setMetadataTab('visual')}
                          className={cn(
                            "px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                            metadataTab === 'visual'
                              ? "bg-zinc-800 text-zinc-50 shadow-sm"
                              : "text-zinc-500 hover:text-zinc-400"
                          )}
                        >
                          Visual View
                        </button>
                        <button
                          type="button"
                          onClick={() => setMetadataTab('raw')}
                          className={cn(
                            "px-3 py-1 text-[10px] font-bold uppercase rounded-lg transition-all",
                            metadataTab === 'raw'
                              ? "bg-zinc-800 text-zinc-50 shadow-sm"
                              : "text-zinc-500 hover:text-zinc-400"
                          )}
                        >
                          Raw JSON
                        </button>
                      </div>
                    </div>
                    
                    {metadataTab === 'visual' ? (
                      <div className="space-y-6">
                        {/* 1. Differences array (e.g. operational settings or taxes) */}
                        {selectedLog.metadata.differences && Array.isArray(selectedLog.metadata.differences) && selectedLog.metadata.differences.length > 0 && (
                          <div className="grid grid-cols-1 gap-4">
                            {selectedLog.metadata.differences.map((diff: any, idx: number) => (
                              <div key={idx} className="bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-sm">
                                <div className="bg-zinc-900/50 px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">{diff.path || 'Configuration'}</span>
                                  <span className="text-[8px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded uppercase">Modified</span>
                                </div>
                                <div className="px-6 pt-4 text-xs font-semibold text-zinc-300">
                                  {diff.description}
                                </div>
                                <div className="p-6 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-6">
                                  <div className="flex flex-col gap-2">
                                    <span className="text-[9px] text-red-500 font-bold uppercase tracking-tight">Previous Value</span>
                                    <div className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl text-xs text-red-400 font-mono break-all max-h-72 overflow-y-auto custom-scrollbar">
                                      {renderPrettyValue(diff.from)}
                                    </div>
                                  </div>
                                  <ArrowRight className="text-zinc-750 hidden md:block rotate-90 md:rotate-0" />
                                  <div className="flex flex-col gap-2">
                                    <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-tight">New Value</span>
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl text-xs text-emerald-400 font-mono break-all max-h-72 overflow-y-auto custom-scrollbar">
                                      {renderPrettyValue(diff.to)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 2. Standard changes object */}
                        {selectedLog.metadata.changes && typeof selectedLog.metadata.changes === 'object' && Object.keys(selectedLog.metadata.changes).length > 0 && (
                          <div className="grid grid-cols-1 gap-4">
                            {Object.entries(selectedLog.metadata.changes).map(([key, value]: [string, any]) => (
                              <div key={key} className="bg-zinc-950 border border-zinc-800 rounded-3xl overflow-hidden shadow-sm">
                                <div className="bg-zinc-900/50 px-6 py-3 border-b border-zinc-800 flex items-center justify-between">
                                  <span className="text-[10px] font-bold text-zinc-300 uppercase tracking-wider">{key}</span>
                                  <span className="text-[8px] bg-zinc-800 text-zinc-500 px-2 py-0.5 rounded uppercase">Modified</span>
                                </div>
                                <div className="p-6 grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] items-center gap-6">
                                  <div className="flex flex-col gap-2">
                                    <span className="text-[9px] text-red-500 font-bold uppercase tracking-tight">Previous Value</span>
                                    <div className="bg-red-500/5 border border-red-500/10 p-4 rounded-2xl text-xs text-red-400 font-mono break-all max-h-72 overflow-y-auto custom-scrollbar">
                                      {renderPrettyValue(value?.from)}
                                    </div>
                                  </div>
                                  <ArrowRight className="text-zinc-750 hidden md:block rotate-90 md:rotate-0" />
                                  <div className="flex flex-col gap-2">
                                    <span className="text-[9px] text-emerald-500 font-bold uppercase tracking-tight">New Value</span>
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 p-4 rounded-2xl text-xs text-emerald-400 font-mono break-all max-h-72 overflow-y-auto custom-scrollbar">
                                      {renderPrettyValue(value?.to)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 3. OldData and/or NewData objects directly */}
                        {!selectedLog.metadata.changes && !selectedLog.metadata.differences && (selectedLog.metadata.oldData || selectedLog.metadata.newData) && (
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            {selectedLog.metadata.oldData && (
                              <div className="space-y-2">
                                <span className="text-[10px] text-red-500 font-bold uppercase tracking-tight">Original Data</span>
                                <div className="bg-zinc-950 p-6 rounded-3xl border border-zinc-800 max-h-96 overflow-y-auto custom-scrollbar">
                                  {renderPrettyValue(selectedLog.metadata.oldData)}
                                </div>
                              </div>
                            )}
                            {selectedLog.metadata.newData && (
                              <div className="space-y-2">
                                <span className="text-[10px] text-emerald-500 font-bold uppercase tracking-tight">Replacement Data</span>
                                <div className="bg-zinc-950 p-6 rounded-3xl border border-zinc-800 max-h-96 overflow-y-auto custom-scrollbar">
                                  {renderPrettyValue(selectedLog.metadata.newData)}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        {/* 4. Catch-all for basic metadata object properties that don't fit above */}
                        {!selectedLog.metadata.changes && !selectedLog.metadata.differences && !selectedLog.metadata.oldData && !selectedLog.metadata.newData && (
                          <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl">
                            {renderPrettyValue(selectedLog.metadata)}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="bg-zinc-950 border border-zinc-800 p-6 rounded-3xl">
                        <pre className="text-[10px] text-zinc-400 font-mono overflow-auto max-h-[450px] custom-scrollbar">
                          {safeStringify(selectedLog.metadata)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-emerald-500/5 border border-emerald-500/10 p-6 rounded-3xl flex items-start gap-4">
                  <div className="p-2 rounded-2xl bg-emerald-500/10 text-emerald-500">
                    <Tag size={18} />
                  </div>
                  <div>
                    <h5 className="text-zinc-50 font-bold text-sm">Action Description</h5>
                    <p className="text-sm text-zinc-400 italic">"{selectedLog.details}"</p>
                  </div>
                </div>
              </div>

              <div className="p-6 border-t border-zinc-800 bg-zinc-900/50 flex justify-end">
                <button 
                  onClick={() => setSelectedLog(null)}
                  className="px-8 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 rounded-2xl font-bold transition-all active:scale-95 shadow-lg"
                >
                  Close Details
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
