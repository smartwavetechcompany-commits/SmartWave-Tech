import React, { useState } from 'react';
import { Room, UserProfile, Reservation, MaintenanceRequest } from '../../types';
import { 
  X, 
  Bed, 
  Sparkles, 
  CheckCircle2, 
  AlertCircle, 
  Clock, 
  Wrench, 
  User as UserIcon, 
  Calendar, 
  ShieldAlert, 
  ArrowRight,
  Eye,
  Edit3,
  Check,
  Send,
  XCircle
} from 'lucide-react';
import { cn } from '../../utils';
import { format, parseISO } from 'date-fns';

interface RoomProfileModalProps {
  room: Room;
  staff: UserProfile[];
  reservations: Reservation[];
  maintenanceRequests: MaintenanceRequest[];
  onClose: () => void;
  onUpdateStatus: (
    roomId: string, 
    status: Room['status'], 
    options?: {
      assignedTo?: string;
      priority?: Room['cleaningPriority'];
      housekeepingStatus?: Room['housekeepingStatus'];
      notes?: string;
    }
  ) => Promise<void>;
  onStartCleaning: (room: Room) => void;
  onStartInspection: (room: Room) => void;
  onReportMaintenance: (roomNumber: string) => void;
}

export function RoomProfileModal({
  room,
  staff,
  reservations,
  maintenanceRequests,
  onClose,
  onUpdateStatus,
  onStartCleaning,
  onStartInspection,
  onReportMaintenance
}: RoomProfileModalProps) {
  const [selectedStaff, setSelectedStaff] = useState(room.assignedTo || '');
  const [selectedPriority, setSelectedPriority] = useState<Room['cleaningPriority']>(room.cleaningPriority || 'normal');
  const [remarks, setRemarks] = useState(room.notes || '');
  const [isSaving, setIsSaving] = useState(false);

  // In-house or expected reservation
  const currentReservation = reservations.find(r => r.roomId === room.id || r.roomNumber === room.roomNumber);
  
  // Active maintenance issues for this room
  const activeDefects = maintenanceRequests.filter(
    m => m.roomNumber === room.roomNumber && m.status !== 'completed'
  );

  // Assigned cleaner details
  const cleaner = staff.find(s => s.uid === (room.assignedTo || selectedStaff));

  // Determine Occupancy Status
  let occupancyStatus: 'Vacant' | 'Occupied' | 'Expected Arrival' | 'Expected Departure' = 'Vacant';
  if (currentReservation) {
    if (currentReservation.status === 'checked_in') {
      occupancyStatus = 'Occupied';
    } else if (currentReservation.status === 'confirmed' || currentReservation.status === 'pending') {
      occupancyStatus = 'Expected Arrival';
    }
  }

  // Determine Housekeeping Display Status
  const getHousekeepingDisplay = () => {
    if (room.housekeepingStatus === 'do_not_disturb') return { label: 'Do Not Disturb', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' };
    if (room.status === 'out_of_order' || room.status === 'out_of_service' || room.status === 'maintenance') {
      return { label: 'Out of Order', color: 'bg-red-500/20 text-red-400 border-red-500/30' };
    }
    if (room.status === 'cleaning' || room.housekeepingStatus === 'cleaning') {
      return { label: 'Cleaning', color: 'bg-purple-500/20 text-purple-400 border-purple-500/30' };
    }
    if (room.status === 'inspected' || room.housekeepingStatus === 'awaiting_inspection') {
      return { label: 'Awaiting Inspection', color: 'bg-amber-500/20 text-amber-400 border-amber-500/30' };
    }
    if (room.housekeepingStatus === 'ready' || room.status === 'clean') {
      return { label: 'Clean & Ready', color: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30' };
    }
    if (room.housekeepingStatus === 'failed') {
      return { label: 'Correction Required', color: 'bg-rose-500/20 text-rose-400 border-rose-500/30' };
    }
    return { label: 'Dirty', color: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30' };
  };

  const hkDisplay = getHousekeepingDisplay();

  const handleSaveDetails = async () => {
    setIsSaving(true);
    try {
      await onUpdateStatus(room.id, room.status, {
        assignedTo: selectedStaff || undefined,
        priority: selectedPriority,
        notes: remarks
      });
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const handleSetDND = () => {
    onUpdateStatus(room.id, room.status, {
      housekeepingStatus: room.housekeepingStatus === 'do_not_disturb' ? 'ready' : 'do_not_disturb'
    });
  };

  const handleSetOutOfOrder = () => {
    const isOOO = room.status === 'out_of_order' || room.status === 'maintenance';
    onUpdateStatus(room.id, isOOO ? 'dirty' : 'out_of_order', {
      housekeepingStatus: isOOO ? 'dirty' : undefined
    });
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
      <div className="bg-zinc-900 border border-zinc-800 rounded-3xl max-w-xl w-full p-5 sm:p-6 space-y-5 my-auto max-h-[92vh] flex flex-col shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-zinc-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Bed size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xl font-black text-white">Room {room.roomNumber}</h3>
                <span className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase border",
                  hkDisplay.color
                )}>
                  {hkDisplay.label}
                </span>
              </div>
              <p className="text-xs text-zinc-400">
                Floor {room.floor} • {room.type} • Capacity {room.capacity || 2} Guests
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-zinc-400 hover:text-white rounded-xl bg-zinc-800/60 hover:bg-zinc-800 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1">
          {/* Status Matrix Cards */}
          <div className="grid grid-cols-2 gap-2.5">
            <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-800/80">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Occupancy Status</span>
              <div className="flex items-center gap-2 mt-1">
                <span className={cn(
                  "w-2 h-2 rounded-full",
                  occupancyStatus === 'Occupied' ? "bg-blue-400" :
                  occupancyStatus === 'Expected Arrival' ? "bg-amber-400" : "bg-emerald-400"
                )} />
                <span className="text-xs font-bold text-white">{occupancyStatus}</span>
              </div>
              {currentReservation && (
                <p className="text-[11px] text-zinc-400 mt-1 truncate">
                  Guest: <strong className="text-zinc-200">{currentReservation.guestName}</strong>
                </p>
              )}
            </div>

            <div className="bg-zinc-950 p-3 rounded-2xl border border-zinc-800/80">
              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-wider block">Housekeeping Status</span>
              <div className="flex items-center gap-2 mt-1">
                <span className="text-xs font-bold text-white capitalize">{room.status}</span>
                {room.cleaningPriority && (
                  <span className={cn(
                    "px-1.5 py-0.2 text-[9px] rounded font-bold uppercase",
                    room.cleaningPriority === 'urgent' ? "bg-red-500/20 text-red-400" :
                    room.cleaningPriority === 'high' ? "bg-orange-500/20 text-orange-400" :
                    "bg-zinc-800 text-zinc-300"
                  )}>
                    {room.cleaningPriority}
                  </span>
                )}
              </div>
              <p className="text-[11px] text-zinc-400 mt-1">
                Workflow: {room.housekeepingStatus || room.status}
              </p>
            </div>
          </div>

          {/* Timestamps & Audit */}
          <div className="bg-zinc-950 p-3.5 rounded-2xl border border-zinc-800/80 text-xs space-y-2">
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Sparkles size={13} className="text-emerald-400" />
                Last Cleaned:
              </span>
              <span className="font-mono text-zinc-200">
                {room.lastCleanedAt ? format(parseISO(room.lastCleanedAt), 'MMM d, yyyy HH:mm') : 'Never recorded'}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5">
                <Eye size={13} className="text-amber-400" />
                Last Inspected:
              </span>
              <span className="font-mono text-zinc-200">
                {room.lastInspectedAt ? format(parseISO(room.lastInspectedAt), 'MMM d, yyyy HH:mm') : 'Pending inspection'}
              </span>
            </div>
            <div className="flex items-center justify-between text-zinc-400">
              <span className="flex items-center gap-1.5">
                <UserIcon size={13} className="text-purple-400" />
                Assigned Cleaner:
              </span>
              <span className="font-bold text-zinc-200">
                {cleaner?.displayName || cleaner?.email || 'Unassigned'}
              </span>
            </div>
          </div>

          {/* Active Defects Notification if any */}
          {activeDefects.length > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-2xl p-3 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                <Wrench size={14} />
                <span>Active Defect Reported ({activeDefects.length})</span>
              </div>
              {activeDefects.map(d => (
                <p key={d.id} className="text-zinc-300 text-[11px] pl-5">
                  • {d.issue} ({d.priority || 'high'})
                </p>
              ))}
            </div>
          )}

          {/* Edit Assignment & Priority */}
          <div className="space-y-3 bg-zinc-950/60 p-3.5 rounded-2xl border border-zinc-800">
            <h4 className="text-[10px] font-black uppercase tracking-wider text-zinc-400 flex items-center gap-1.5">
              <Edit3 size={12} />
              Shift Assignment & Priority
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Assign Housekeeper
                </label>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={selectedStaff}
                  onChange={(e) => setSelectedStaff(e.target.value)}
                >
                  <option value="">Unassigned</option>
                  {staff.map(s => (
                    <option key={s.uid} value={s.uid}>{s.displayName || s.email}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                  Cleaning Priority
                </label>
                <select
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-emerald-500"
                  value={selectedPriority}
                  onChange={(e) => setSelectedPriority(e.target.value as any)}
                >
                  <option value="low">🟢 Low</option>
                  <option value="normal">🟡 Normal</option>
                  <option value="high">🟠 High</option>
                  <option value="urgent">🔴 Urgent</option>
                </select>
              </div>
            </div>

            <div>
              <label className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider block mb-1">
                Room Remarks / Special Instructions
              </label>
              <textarea
                className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-2.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500 resize-none h-16"
                placeholder="e.g. VIP guest arrival, extra feathered pillows requested..."
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
              />
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div className="space-y-2">
            <span className="text-[10px] font-black uppercase tracking-wider text-zinc-400 block">
              Quick Turnaround Actions
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {room.status === 'cleaning' || room.housekeepingStatus === 'cleaning' ? (
                <button
                  type="button"
                  onClick={() => {
                    onUpdateStatus(room.id, 'dirty', { housekeepingStatus: 'dirty' });
                    onClose();
                  }}
                  className="p-2.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
                  title="Cancel cleaning in progress and revert room to Dirty"
                >
                  <XCircle size={14} />
                  <span>Cancel Cleaning</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onStartCleaning(room);
                  }}
                  className="p-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                >
                  <Sparkles size={14} />
                  <span>Start Cleaning</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onStartInspection(room);
                }}
                className="p-2.5 bg-amber-500 hover:bg-amber-400 text-black rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md shadow-amber-500/10"
              >
                <Eye size={14} />
                <span>Inspect Room</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onReportMaintenance(room.roomNumber);
                }}
                className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-amber-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border border-amber-500/20"
              >
                <Wrench size={14} />
                <span>Report Defect</span>
              </button>

              <button
                type="button"
                onClick={handleSetDND}
                className={cn(
                  "p-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border",
                  room.housekeepingStatus === 'do_not_disturb'
                    ? "bg-rose-500 text-white border-rose-500"
                    : "bg-zinc-950 text-rose-400 border-rose-500/30 hover:bg-rose-500/10"
                )}
              >
                <ShieldAlert size={14} />
                <span>{room.housekeepingStatus === 'do_not_disturb' ? 'Clear DND' : 'Set DND'}</span>
              </button>

              <button
                type="button"
                onClick={handleSetOutOfOrder}
                className={cn(
                  "p-2.5 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5 border",
                  room.status === 'out_of_order' || room.status === 'maintenance'
                    ? "bg-red-500 text-white border-red-500"
                    : "bg-zinc-950 text-red-400 border-red-500/30 hover:bg-red-500/10"
                )}
              >
                <AlertCircle size={14} />
                <span>{room.status === 'out_of_order' ? 'Return to Service' : 'Out of Order'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  onUpdateStatus(room.id, 'clean', { housekeepingStatus: 'ready' });
                  onClose();
                }}
                className="p-2.5 bg-zinc-950 hover:bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-1.5"
              >
                <CheckCircle2 size={14} />
                <span>Mark Ready</span>
              </button>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700 transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSaveDetails}
            disabled={isSaving}
            className="flex-[2] py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-black transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 disabled:opacity-50"
          >
            <Check size={14} />
            <span>{isSaving ? 'Saving...' : 'Save Changes'}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
