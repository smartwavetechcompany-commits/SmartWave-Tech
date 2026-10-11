import React, { useState } from 'react';
import { UserProfile, Room } from '../../types';
import { db } from '../../firebase';
import { database } from '../../utils/database';
import { doc } from 'firebase/firestore';
import { useAuth } from '../../contexts/AuthContext';
import { 
  Users, 
  User as UserIcon, 
  MapPin, 
  Phone, 
  Bed, 
  CheckCircle2, 
  Search, 
  Edit3, 
  X, 
  Plus, 
  ArrowRight,
  Shield,
  Layers
} from 'lucide-react';
import { cn } from '../../utils';
import { toast } from 'sonner';

interface HousekeepingStaffManagementProps {
  staff: UserProfile[];
  rooms: Room[];
  onAssignRoom: (roomId: string, staffId: string) => Promise<void>;
  onBulkAssignRooms?: (roomIds: string[], staffId: string) => Promise<void>;
}

export function HousekeepingStaffManagement({
  staff,
  rooms,
  onAssignRoom,
  onBulkAssignRooms
}: HousekeepingStaffManagementProps) {
  const { hotel, profile } = useAuth();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStaff, setSelectedStaff] = useState<UserProfile | null>(null);
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [selectedRoomIds, setSelectedRoomIds] = useState<string[]>([]);
  const [editingStaffId, setEditingStaffId] = useState<string | null>(null);
  const [areaInput, setAreaInput] = useState('');

  // Housekeeper staff filter
  const housekeepingTeam = staff.filter(s => {
    const role = (s.staffRole || s.role || '').toLowerCase();
    const dept = (s.department || '').toLowerCase();
    return true; // Show all hotel team members that can be assigned
  });

  const filteredTeam = housekeepingTeam.filter(s => {
    const name = (s.displayName || s.name || s.email || '').toLowerCase();
    const phone = (s.phoneNumber || '').toLowerCase();
    const empId = (s.employeeId || '').toLowerCase();
    const dept = (s.department || '').toLowerCase();
    const q = searchQuery.toLowerCase();
    return name.includes(q) || phone.includes(q) || empId.includes(q) || dept.includes(q);
  });

  // Open Room Assignment Modal for specific staff
  const handleOpenAssignModal = (member: UserProfile) => {
    setSelectedStaff(member);
    const currentlyAssigned = rooms.filter(r => r.assignedTo === member.uid).map(r => r.id);
    setSelectedRoomIds(currentlyAssigned);
    setShowAssignModal(true);
  };

  // Submit Room Assignments
  const handleSaveRoomAssignments = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStaff || !hotel?.id) return;

    try {
      // 1. Assign selected rooms to this staff
      for (const roomId of selectedRoomIds) {
        await onAssignRoom(roomId, selectedStaff.uid);
      }
      
      // 2. Unassign rooms that were previously assigned to this staff but unselected
      const previouslyAssigned = rooms.filter(r => r.assignedTo === selectedStaff.uid);
      for (const r of previouslyAssigned) {
        if (!selectedRoomIds.includes(r.id)) {
          await onAssignRoom(r.id, '');
        }
      }

      toast.success(`Assigned ${selectedRoomIds.length} rooms to ${selectedStaff.displayName || selectedStaff.email}`);
      setShowAssignModal(false);
      setSelectedStaff(null);
    } catch {
      toast.error('Failed to update assignments');
    }
  };

  // Update staff assigned area/floor
  const handleSaveStaffArea = async (uid: string) => {
    if (!hotel?.id) return;
    try {
      await database.safeSet(doc(db, 'users', uid), {
        department: areaInput.trim() || 'Floor Housekeeping'
      }, {
        hotelId: hotel.id,
        module: 'Housekeeping',
        action: 'UPDATE_STAFF_AREA',
        details: `Updated assigned area to ${areaInput}`
      });
      toast.success('Assigned area updated!');
      setEditingStaffId(null);
    } catch {
      toast.error('Failed to update staff area');
    }
  };

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-4 sm:p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <Users size={20} />
          </div>
          <div>
            <h2 className="text-lg font-black text-white">Housekeeping Team & Shift Workload</h2>
            <p className="text-xs text-zinc-400">
              Staff profiles, assigned floors/areas, daily room allocations, and shift statuses
            </p>
          </div>
        </div>

        <div className="relative w-full sm:w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <input
            type="text"
            placeholder="Search staff by name, ID, phone..."
            className="w-full bg-zinc-950 border border-zinc-800 rounded-xl pl-9 pr-3 py-1.5 text-xs text-white placeholder-zinc-500 outline-none focus:border-emerald-500"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      {/* Staff Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTeam.map(member => {
          const assignedRooms = rooms.filter(r => r.assignedTo === member.uid);
          const dirtyAssigned = assignedRooms.filter(r => r.status === 'dirty').length;
          const cleanAssigned = assignedRooms.filter(r => r.status === 'clean' || r.housekeepingStatus === 'ready').length;
          const cleaningAssigned = assignedRooms.filter(r => r.status === 'cleaning').length;

          return (
            <div key={member.uid} className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5 space-y-4 flex flex-col justify-between">
              <div className="space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 border border-zinc-700 flex items-center justify-center text-emerald-400 font-bold text-sm">
                      {(member.displayName || member.name || member.email || 'H')[0].toUpperCase()}
                    </div>
                    <div>
                      <h3 className="font-bold text-white text-base leading-tight">
                        {member.displayName || member.name || 'Team Member'}
                      </h3>
                      <p className="text-xs text-zinc-400">
                        {member.employeeId ? `ID: ${member.employeeId} • ` : ''}
                        <span className="capitalize">{member.staffRole || member.role || 'Housekeeper'}</span>
                      </p>
                    </div>
                  </div>

                  <span className={cn(
                    "px-2 py-0.5 rounded-full text-[10px] font-bold uppercase",
                    member.status === 'active' || !member.status
                      ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                      : "bg-zinc-800 text-zinc-400"
                  )}>
                    {member.status || 'Active'}
                  </span>
                </div>

                {/* Contact and Area info */}
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/80 text-xs space-y-1.5">
                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <MapPin size={12} className="text-purple-400 shrink-0" />
                      Assigned Floor / Area:
                    </span>
                    {editingStaffId === member.uid ? (
                      <div className="flex items-center gap-1">
                        <input
                          type="text"
                          className="bg-zinc-900 border border-zinc-700 rounded px-1.5 py-0.5 text-[11px] text-white w-28"
                          value={areaInput}
                          onChange={(e) => setAreaInput(e.target.value)}
                        />
                        <button
                          onClick={() => handleSaveStaffArea(member.uid)}
                          className="text-emerald-400 text-[10px] font-bold underline"
                        >
                          Save
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          setEditingStaffId(member.uid);
                          setAreaInput(member.department || 'Floor 2 & 3');
                        }}
                        className="text-zinc-200 hover:text-emerald-400 font-medium flex items-center gap-1 text-[11px]"
                      >
                        <span>{member.department || 'Floor 2 & 3'}</span>
                        <Edit3 size={10} className="text-zinc-500" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between text-zinc-400">
                    <span className="flex items-center gap-1.5">
                      <Phone size={12} className="text-emerald-400 shrink-0" />
                      Phone Contact:
                    </span>
                    <span className="text-zinc-200 font-mono text-[11px]">{member.phoneNumber || member.email}</span>
                  </div>
                </div>

                {/* Shift Workload Box */}
                <div className="bg-zinc-950 p-3 rounded-xl border border-zinc-800/80">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] font-bold text-zinc-400 uppercase tracking-wider">
                      Today's Assigned Rooms
                    </span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {assignedRooms.length} Total
                    </span>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    {assignedRooms.map(r => (
                      <span key={r.id} className={cn(
                        "px-2 py-0.5 rounded text-[11px] font-bold font-mono",
                        r.status === 'clean' ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30" :
                        r.status === 'cleaning' ? "bg-purple-500/20 text-purple-400 border border-purple-500/30" :
                        "bg-red-500/20 text-red-400 border border-red-500/30"
                      )}>
                        #{r.roomNumber}
                      </span>
                    ))}
                    {assignedRooms.length === 0 && (
                      <span className="text-[11px] text-zinc-500 italic">No rooms assigned for today's shift</span>
                    )}
                  </div>

                  {assignedRooms.length > 0 && (
                    <div className="flex items-center gap-3 text-[10px] font-mono text-zinc-400 pt-2 mt-2 border-t border-zinc-900">
                      <span className="text-emerald-400">{cleanAssigned} Clean</span>
                      <span>•</span>
                      <span className="text-purple-400">{cleaningAssigned} Cleaning</span>
                      <span>•</span>
                      <span className="text-red-400">{dirtyAssigned} Dirty</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Action Button */}
              <div className="pt-2 border-t border-zinc-800">
                <button
                  onClick={() => handleOpenAssignModal(member)}
                  className="w-full py-2 bg-emerald-500 hover:bg-emerald-400 text-black text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/10"
                >
                  <Bed size={14} />
                  <span>Assign Rooms to {member.displayName?.split(' ')[0] || 'Staff'}</span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* --- MODAL: ASSIGN ROOMS TO STAFF --- */}
      {showAssignModal && selectedStaff && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
          <form onSubmit={handleSaveRoomAssignments} className="bg-zinc-900 border border-zinc-800 rounded-2xl max-w-lg w-full p-5 sm:p-6 space-y-4 my-auto shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">
                  Assign Rooms to {selectedStaff.displayName || selectedStaff.email}
                </h3>
                <p className="text-xs text-zinc-400">Select rooms to allocate to this housekeeper for today's shift</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="p-1 text-zinc-500 hover:text-white rounded-lg"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              <div className="flex items-center justify-between text-xs text-zinc-400 bg-zinc-950 p-2.5 rounded-xl border border-zinc-800">
                <span>Selected: <strong className="text-white">{selectedRoomIds.length} rooms</strong></span>
                <button
                  type="button"
                  onClick={() => {
                    if (selectedRoomIds.length === rooms.length) setSelectedRoomIds([]);
                    else setSelectedRoomIds(rooms.map(r => r.id));
                  }}
                  className="text-emerald-400 hover:text-emerald-300 font-bold"
                >
                  {selectedRoomIds.length === rooms.length ? 'Deselect All' : 'Select All'}
                </button>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {rooms.map(room => {
                  const isSelected = selectedRoomIds.includes(room.id);
                  const isAssignedToOther = room.assignedTo && room.assignedTo !== selectedStaff.uid;
                  const otherCleaner = staff.find(s => s.uid === room.assignedTo);

                  return (
                    <label
                      key={room.id}
                      className={cn(
                        "p-3 rounded-xl border cursor-pointer select-none transition-all flex flex-col justify-between space-y-1.5",
                        isSelected
                          ? "bg-emerald-500/10 border-emerald-500 text-white"
                          : "bg-zinc-950 border-zinc-800 hover:border-zinc-700 text-zinc-300"
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">Room {room.roomNumber}</span>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedRoomIds(prev => [...prev, room.id]);
                            else setSelectedRoomIds(prev => prev.filter(id => id !== room.id));
                          }}
                          className="rounded border-zinc-700 text-emerald-500 focus:ring-emerald-500 w-4 h-4 bg-zinc-900"
                        />
                      </div>
                      <div className="text-[10px] text-zinc-400 flex items-center justify-between">
                        <span>Floor {room.floor}</span>
                        <span className={cn(
                          "uppercase font-bold",
                          room.status === 'clean' ? "text-emerald-400" :
                          room.status === 'cleaning' ? "text-purple-400" : "text-red-400"
                        )}>
                          {room.status}
                        </span>
                      </div>
                      {isAssignedToOther && (
                        <p className="text-[9px] text-amber-400 truncate">
                          Currently: {otherCleaner?.displayName?.split(' ')[0] || 'Other'}
                        </p>
                      )}
                    </label>
                  );
                })}
              </div>
            </div>

            <div className="pt-3 border-t border-zinc-800 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAssignModal(false)}
                className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 rounded-xl text-xs font-bold hover:bg-zinc-700"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black rounded-xl text-xs font-bold shadow-md shadow-emerald-500/20"
              >
                Confirm Allocation ({selectedRoomIds.length})
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
