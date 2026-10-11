import React, { useState, useEffect } from 'react';
import { 
  HousekeepingDailyLog, 
  Room, 
  HousekeepingInspectionRecord, 
  MaintenanceRequest, 
  UserProfile 
} from '../../types';
import { 
  collection, 
  query, 
  onSnapshot, 
  orderBy, 
  limit 
} from 'firebase/firestore';
import { db, handleFirestoreError } from '../../firebase';
import { database } from '../../utils/database';
import { useAuth } from '../../contexts/AuthContext';
import { 
  FileText, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Plus, 
  Download, 
  Calendar, 
  Users, 
  Wrench, 
  Package, 
  Sparkles,
  Save,
  History,
  X
} from 'lucide-react';
import { cn, exportToCSV } from '../../utils';
import { format, parseISO, isToday } from 'date-fns';
import { toast } from 'sonner';

interface HousekeepingDailyLogProps {
  rooms: Room[];
  inspections: HousekeepingInspectionRecord[];
  maintenanceRequests: MaintenanceRequest[];
  staff: UserProfile[];
}

export function HousekeepingDailyLogView({
  rooms,
  inspections,
  maintenanceRequests,
  staff
}: HousekeepingDailyLogProps) {
  const { hotel, profile } = useAuth();

  const [logs, setLogs] = useState<HousekeepingDailyLog[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showLogModal, setShowLogModal] = useState(false);

  // Computations for today's live summary
  const todayDateStr = format(new Date(), 'yyyy-MM-dd');
  
  // Cleaned today: rooms with lastCleanedAt today
  const roomsCleanedToday = rooms.filter(r => {
    if (!r.lastCleanedAt) return false;
    try {
      return isToday(parseISO(r.lastCleanedAt));
    } catch {
      return false;
    }
  }).length;

  // Inspected today
  const roomsInspectedToday = inspections.filter(ins => {
    if (!ins.timestamp) return false;
    try {
      return isToday(parseISO(ins.timestamp));
    } catch {
      return false;
    }
  }).length;

  // Maintenance reported today
  const maintenanceReportedToday = maintenanceRequests.filter(m => {
    if (!m.timestamp) return false;
    try {
      return isToday(parseISO(m.timestamp));
    } catch {
      return false;
    }
  }).length;

  // Pending / unresolved issues
  const pendingDirty = rooms.filter(r => r.status === 'dirty' || r.housekeepingStatus === 'dirty').length;
  const pendingAwaitingInspection = rooms.filter(r => r.status === 'inspected' || r.housekeepingStatus === 'awaiting_inspection').length;
  const pendingDefects = maintenanceRequests.filter(m => m.status !== 'completed').length;

  // Modal Form
  const [form, setForm] = useState({
    stockUsedSummary: 'Toiletries: 85 bars soap, 90 shampoo, 120 water bottles, 70 tea packs replenished across floors.',
    staffAttendanceCount: staff.length,
    staffPresentNames: staff.map(s => s.displayName || s.email),
    pendingIssues: `${pendingDirty} dirty rooms deferred to morning shift, ${pendingDefects} active maintenance tickets awaiting technician parts.`,
    notes: 'Shift completed safely. All trolleys restocked and locked in floor pantries.'
  });

  // 1. Live Snapshot for Daily Logs
  useEffect(() => {
    if (!hotel?.id) return;
    setIsLoading(true);

    const q = query(
      collection(db, 'hotels', hotel.id, 'housekeeping_daily_logs'),
      orderBy('timestamp', 'desc'),
      limit(60)
    );

    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(doc => ({ id: doc.id, ...doc.data() } as HousekeepingDailyLog));
      setLogs(docs);
      setIsLoading(false);
    }, (err) => {
      handleFirestoreError(err, 'list' as any, `hotels/${hotel.id}/housekeeping_daily_logs`);
      setIsLoading(false);
    });

    return () => unsub();
  }, [hotel?.id]);

  // Save Daily Log Handover
  const handleSaveDailyLog = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotel?.id || !profile) return;

    const now = new Date().toISOString();
    try {
      await database.safeAdd(collection(db, 'hotels', hotel.id, 'housekeeping_daily_logs'), {
        date: todayDateStr,
        roomsCleaned: roomsCleanedToday,
        roomsInspected: roomsInspectedToday,
        maintenanceReported: maintenanceReportedToday,
        stockUsedSummary: form.stockUsedSummary.trim(),
        staffAttendanceCount: form.staffAttendanceCount,
        staffPresentNames: form.staffPresentNames,
        pendingIssues: form.pendingIssues.trim(),
        notes: form.notes.trim(),
        supervisorName: profile.displayName || profile.email,
        timestamp: now
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'SUBMIT_DAILY_LOG',
        details: `Saved housekeeping daily log for ${todayDateStr}`
      });

      toast.success(`Housekeeping Daily Log for ${todayDateStr} successfully sealed!`);
      setShowLogModal(false);
    } catch {
      toast.error('Failed to save daily log');
    }
  };

  // Export
  const handleExportCSV = () => {
    const data = logs.map(l => ({
      Date: l.date,
      Supervisor: l.supervisorName,
      RoomsCleaned: l.roomsCleaned,
      RoomsInspected: l.roomsInspected,
      MaintenanceReported: l.maintenanceReported,
      StaffAttendance: l.staffAttendanceCount,
      PendingIssues: l.pendingIssues,
      Notes: l.notes || '-'
    }));
    exportToCSV(data, `housekeeping-daily-logs-${todayDateStr}`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
            <FileText size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Daily Housekeeping Handover Log</h2>
            <p className="text-xs text-zinc-400">
              End-of-day summary of cleaning operations, inspections, maintenance, attendance, and pending issues
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLogModal(true)}
            className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 shadow-md shadow-emerald-500/10"
          >
            <Save size={14} />
            <span>Seal Today's Log</span>
          </button>

          <button
            onClick={handleExportCSV}
            className="px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-bold rounded-xl transition-all"
            title="Export CSV"
          >
            <Download size={14} />
          </button>
        </div>
      </div>

      {/* Today's Live Dashboard Card */}
      <div className="bg-zinc-900 border border-emerald-500/30 rounded-3xl p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-4">
          <div>
            <span className="text-[10px] font-black uppercase tracking-widest text-emerald-400">
              Live Operations Today
            </span>
            <h3 className="text-xl font-black text-white">{format(new Date(), 'EEEE, MMMM d, yyyy')}</h3>
          </div>
          <span className="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 self-start sm:self-auto">
            Shift in Progress
          </span>
        </div>

        {/* 6 Key End-of-Day Summary Counters (Section 16) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Rooms Cleaned</span>
            <div className="text-2xl font-black text-emerald-400 mt-1 flex items-center gap-1.5">
              <Sparkles size={16} />
              <span>{roomsCleanedToday}</span>
            </div>
          </div>

          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Inspections</span>
            <div className="text-2xl font-black text-amber-400 mt-1 flex items-center gap-1.5">
              <CheckCircle2 size={16} />
              <span>{roomsInspectedToday}</span>
            </div>
          </div>

          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Defects Logged</span>
            <div className="text-2xl font-black text-rose-400 mt-1 flex items-center gap-1.5">
              <Wrench size={16} />
              <span>{maintenanceReportedToday}</span>
            </div>
          </div>

          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Staff on Duty</span>
            <div className="text-2xl font-black text-blue-400 mt-1 flex items-center gap-1.5">
              <Users size={16} />
              <span>{staff.length}</span>
            </div>
          </div>

          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Dirty Pending</span>
            <div className="text-2xl font-black text-yellow-400 mt-1 flex items-center gap-1.5">
              <Clock size={16} />
              <span>{pendingDirty}</span>
            </div>
          </div>

          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800">
            <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block">Awaiting Sign-off</span>
            <div className="text-2xl font-black text-purple-400 mt-1 flex items-center gap-1.5">
              <AlertCircle size={16} />
              <span>{pendingAwaitingInspection}</span>
            </div>
          </div>
        </div>

        <div className="bg-zinc-950/70 p-4 rounded-2xl border border-zinc-800/80 text-xs text-zinc-300 space-y-2">
          <div className="flex items-center gap-2 font-bold text-zinc-100">
            <Package size={14} className="text-emerald-400" />
            <span>Today's Estimated Supplies Consumption</span>
          </div>
          <p className="text-zinc-400">{form.stockUsedSummary}</p>
        </div>
      </div>

      {/* Historical Daily Logs (Shift Handover Archive) */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2">
          <History size={16} className="text-emerald-400" />
          Shift Handover & Daily Log Archive
        </h3>

        <div className="space-y-3">
          {logs.map((log) => (
            <div key={log.id} className="bg-zinc-950 border border-zinc-800 rounded-2xl p-4 sm:p-5 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800/80 pb-3">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-zinc-800 flex items-center justify-center text-white font-mono font-bold text-xs">
                    {log.date?.slice(5)}
                  </div>
                  <div>
                    <h4 className="font-bold text-white text-sm">
                      Daily Summary — {log.date ? format(parseISO(log.date), 'MMMM d, yyyy') : log.date}
                    </h4>
                    <p className="text-[11px] text-zinc-400">Supervisor: {log.supervisorName}</p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-xs font-mono font-bold">
                  <span className="text-emerald-400">{log.roomsCleaned} Cleaned</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-amber-400">{log.roomsInspected} Inspected</span>
                  <span className="text-zinc-600">•</span>
                  <span className="text-rose-400">{log.maintenanceReported} Defects</span>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-zinc-300">
                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                    Supplies Used
                  </span>
                  <p>{log.stockUsedSummary || 'Standard room turnover supplies'}</p>
                </div>

                <div className="bg-zinc-900/60 p-3 rounded-xl border border-zinc-800">
                  <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block mb-1">
                    Pending Issues for Incoming Shift
                  </span>
                  <p>{log.pendingIssues || 'None recorded'}</p>
                </div>
              </div>

              {log.notes && (
                <p className="text-xs text-zinc-400 italic bg-zinc-900/40 p-2.5 rounded-xl border border-zinc-800/50">
                  "{log.notes}"
                </p>
              )}
            </div>
          ))}

          {logs.length === 0 && !isLoading && (
            <div className="py-12 text-center text-zinc-500 text-xs italic">
              No daily logs recorded yet. Click "Seal Today's Log" to save today's shift handover summary.
            </div>
          )}
        </div>
      </div>

      {/* --- MODAL: SEAL TODAY'S LOG --- */}
      {showLogModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveDailyLog} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div className="flex items-center gap-2 text-emerald-400">
                <FileText size={18} />
                <h3 className="text-lg font-bold text-white">Seal Daily Housekeeping Log</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-2 bg-zinc-950 p-3 rounded-xl border border-zinc-800 text-xs text-center font-mono">
              <div>
                <span className="text-zinc-500 block text-[10px]">Cleaned</span>
                <span className="text-emerald-400 font-bold text-base">{roomsCleanedToday}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Inspected</span>
                <span className="text-amber-400 font-bold text-base">{roomsInspectedToday}</span>
              </div>
              <div>
                <span className="text-zinc-500 block text-[10px]">Defects</span>
                <span className="text-rose-400 font-bold text-base">{maintenanceReportedToday}</span>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Stock & Supplies Used Summary
              </label>
              <textarea
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-18"
                value={form.stockUsedSummary}
                onChange={(e) => setForm(prev => ({ ...prev, stockUsedSummary: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Pending Issues / Handover to Next Shift
              </label>
              <textarea
                required
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-18"
                value={form.pendingIssues}
                onChange={(e) => setForm(prev => ({ ...prev, pendingIssues: e.target.value }))}
              />
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Supervisor Closing Remarks
              </label>
              <input
                type="text"
                className="w-full bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                placeholder="Overall shift performance and feedback"
                value={form.notes}
                onChange={(e) => setForm(prev => ({ ...prev, notes: e.target.value }))}
              />
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowLogModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20"
              >
                Archive & Seal Handover
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
