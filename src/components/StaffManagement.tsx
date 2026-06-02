import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, setDoc, deleteDoc, addDoc, onSnapshot } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth, handleFirestoreError } from '../firebase';
import { database } from '../utils/database';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, StaffRole, OperationType } from '../types';
import { hasPermission } from '../utils/permissions';
import { 
  UserPlus, 
  Search, 
  Shield, 
  Trash2, 
  Mail,
  User as UserIcon,
  CheckCircle2,
  XCircle,
  Lock,
  ChevronRight,
  RefreshCw,
  Download
} from 'lucide-react';
import { cn, exportToCSV, safeStringify } from '../utils';
import { toast } from 'sonner';

const AVAILABLE_ROLES = [
  { id: 'view_reports', label: 'View Reports' },
  { id: 'export_reports', label: 'Export Reports' },
  { id: 'manage_staff', label: 'Manage Staff' },
  { id: 'manage_rooms', label: 'Manage Rooms' },
  { id: 'create_room_blocks', label: 'Block Rooms' },
  { id: 'remove_room_blocks', label: 'Unblock Rooms' },
  { id: 'edit_guest_profiles', label: 'Guest Profiles' },
  { id: 'process_payments', label: 'Payments' },
  { id: 'view_financial_records', label: 'Finance Records' },
  { id: 'view_activity_logs', label: 'Activity Logs' },
  { id: 'manage_roles', label: 'Roles/Permissions' },
  { id: 'edit_hotel_settings', label: 'Hotel Settings' },
  { id: 'nightly_audit', label: 'Nightly Audit' },
];

const BASE_ROLES = [
  { id: 'hotelAdmin', label: 'Admin (Full Access)' },
  { id: 'manager', label: 'Manager' },
  { id: 'frontDesk', label: 'Front Desk' },
  { id: 'housekeeper', label: 'Housekeeper' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'accountant', label: 'Accountant' },
];

export function StaffManagement({ hotelId: propHotelId }: { hotelId?: string }) {
  const { hotel: authHotel, profile } = useAuth();
  const hotelId = propHotelId || authHotel?.id;
  const [staff, setStaff] = useState<UserProfile[]>([]);
  const [isAddingStaff, setIsAddingStaff] = useState(false);
  const [editingPermissions, setEditingPermissions] = useState<UserProfile | null>(null);
  const [newStaff, setNewStaff] = useState({
    email: '',
    displayName: '',
    password: '',
    role: 'frontDesk' as any,
    roles: [] as string[],
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [isResetting, setIsResetting] = useState<string | null>(null);
  const [pendingRoleChange, setPendingRoleChange] = useState<{
    member: UserProfile;
    roleId: StaffRole;
    roleLabel: string;
    isAdding: boolean;
  } | null>(null);

  useEffect(() => {
    setHasPermissionError(false);
  }, [profile?.uid, hotelId]);

  useEffect(() => {
    if (!hotelId || !profile || hasPermissionError) return;
    
    const q = query(collection(db, 'users'), where('hotelId', '==', hotelId));
    const unsub = onSnapshot(q, (snap) => {
      setStaff(snap.docs.map(doc => ({ uid: doc.id, ...doc.data() } as UserProfile)));
    }, (err: any) => {
      handleFirestoreError(err, OperationType.LIST, 'users');
      if (err.code === 'permission-denied') {
        setHasPermissionError(true);
      }
    });

    return () => unsub();
  }, [hotelId, profile?.uid, hasPermissionError]);

  const addStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hotelId) return;

    // Check user permissions before submitting
    if (!hasPermission(profile, 'manage_staff') && !hasPermission(profile, 'manage_roles')) {
      toast.error("You do not have the required permissions to add staff members.");
      return;
    }

    const tempUid = `staff_${Math.random().toString(36).substr(2, 9)}`;
    const staffProfile: any = {
      uid: tempUid,
      email: newStaff.email.toLowerCase(),
      hotelId: hotelId,
      role: newStaff.role,
      createdAt: new Date().toISOString(),
      roles: newStaff.roles,
      permissions: newStaff.roles, // Keep for backward compatibility
      status: 'active',
      displayName: newStaff.displayName,
      initialPassword: newStaff.password, // Store temporarily for first login
    };

    try {
      await database.safeSet(doc(db, 'users', tempUid), staffProfile, {
        hotelId: hotelId,
        module: 'Staff',
        action: 'CREATE_STAFF',
        details: `Created staff profile for ${newStaff.email} with roles: ${newStaff.roles.join(', ')}. Initial password: ${newStaff.password}`,
        userContext: profile ? { uid: profile.uid, email: profile.email, role: profile.role } : undefined
      });

      // Role compliance logging to GlobalAuditLog
      try {
        await database.safeAdd(collection(db, 'GlobalAuditLog'), {
          timestamp: new Date().toISOString(),
          actorId: profile?.uid || 'unknown',
          actorEmail: profile?.email || 'unknown',
          actorRole: profile?.role || 'unknown',
          targetUserId: tempUid,
          targetUserEmail: staffProfile.email,
          targetUserName: staffProfile.displayName,
          assignedRoles: [staffProfile.role, ...staffProfile.roles],
          hotelId: hotelId,
          action: 'ROLE_ASSIGNMENT',
          details: `Teammate status created with base access role '${staffProfile.role}' and override permissions: ${staffProfile.roles.join(', ')}`
        }, {
          hotelId: hotelId,
          module: 'Staff',
          action: 'CREATE_STAFF_GLOBAL_AUDIT',
          details: 'Staff creation role compliance log'
        });
      } catch (logErr) {
        console.error("Failed to write to GlobalAuditLog:", logErr);
      }

      setIsAddingStaff(false);
      setNewStaff({ email: '', displayName: '', password: '', role: 'staff', roles: ['frontDesk'] });
      toast.success('Staff member added successfully. They can now login with the password you provided.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, `users/${tempUid}`);
      console.error("Add staff error:", err.message || safeStringify(err));
      if (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission'))) {
        toast.error('Insufficient Firestore permissions. You do not have the authorization required to create staff.');
      } else {
        toast.error('Failed to add staff member');
      }
    }
  };

  const removeStaff = async (staffUid: string, staffEmail: string) => {
    if (!hotelId) return;
    if (profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
      toast.error('Only administrators can remove staff members');
      return;
    }

    try {
      await database.safeDelete(doc(db, 'users', staffUid), {
        hotelId: hotelId,
        module: 'Staff',
        action: 'DELETE_STAFF',
        details: `Deleted staff member ${staffEmail}`,
        userContext: profile ? { uid: profile.uid, email: profile.email, role: profile.role } : undefined
      });
      toast.success('Staff member removed');
      setShowConfirmRemove(null);
    } catch (err: any) {
      handleFirestoreError(err, OperationType.DELETE, `users/${staffUid}`);
      console.error("Remove staff error:", err.message || safeStringify(err));
      toast.error('Failed to remove staff member');
    }
  };

  const handleResetPassword = async (email: string, uid: string) => {
    if (!email) return;
    setIsResetting(uid);
    try {
      await sendPasswordResetEmail(auth, email);
      
      // Log the action for UI visibility
      if (hotelId) {
        await database.safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
          timestamp: new Date().toISOString(),
          userId: profile?.uid,
          userEmail: profile?.email,
          userRole: profile?.role,
          action: 'STAFF_PASSWORD_RESET_SENT',
          resource: `Staff: ${email}`,
          hotelId: hotelId,
          module: 'Staff'
        }, {
          hotelId: hotelId,
          module: 'Staff',
          action: 'ACTIVITY_LOG_CREATE',
          details: 'Staff password reset activity'
        });
      }
      
      toast.success(`Password reset email sent to ${email}`);
    } catch (err: any) {
      console.error("Reset password error:", err.message || safeStringify(err));
      toast.error('Failed to send reset email: ' + err.message);
    } finally {
      setIsResetting(null);
    }
  };

  const toggleRole = async (member: UserProfile, roleId: StaffRole) => {
    if (!hotelId) return;
    
    // Check user permissions before submitting
    if (!hasPermission(profile, 'manage_staff')) {
      toast.error("You do not have the required 'manage_staff' permission to assign or modify roles.");
      return;
    }
    
    const currentRoles: StaffRole[] = (member.roles || member.permissions || []) as StaffRole[];
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter(r => r !== roleId)
      : [...currentRoles, roleId];
      
    try {
      await database.safeUpdate(doc(db, 'users', member.uid), { 
        roles: newRoles,
        permissions: newRoles // Keep sync
      }, {
        hotelId: hotelId,
        module: 'Staff',
        action: 'UPDATE_STAFF_ROLES',
        details: `Updated roles for ${member.email} to: ${newRoles.join(', ')}`
      });
      
      // Update local state for immediate feedback
      if (editingPermissions) {
        setEditingPermissions({ ...editingPermissions, roles: newRoles, permissions: newRoles });
      }

      // Create an automated log entry in the 'GlobalAuditLog' collection for compliance
      try {
        await database.safeAdd(collection(db, 'GlobalAuditLog'), {
          timestamp: new Date().toISOString(),
          actorId: profile?.uid || 'unknown',
          actorEmail: profile?.email || 'unknown',
          actorRole: profile?.role || 'unknown',
          targetUserId: member.uid,
          targetUserEmail: member.email,
          targetUserName: member.displayName || 'Unnamed Staff',
          assignedRoles: newRoles,
          hotelId: hotelId,
          action: 'ROLE_ASSIGNMENT',
          details: `Assigned roles/permissions updated for ${member.email} to: [${newRoles.join(', ')}]`
        }, {
          hotelId: hotelId,
          module: 'Staff',
          action: 'UPDATE_STAFF_ROLES_GLOBAL_AUDIT',
          details: 'Staff role assignment compliance log'
        });
      } catch (logErr) {
        console.error("Failed to write to GlobalAuditLog:", logErr);
      }
      
      // Log the action for UI visibility (Audit Trail)
      await database.safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
        timestamp: new Date().toISOString(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'UPDATE_STAFF_ROLES',
        resource: `Staff: ${member.email}, Roles: ${newRoles.join(', ')}`,
        hotelId: hotelId,
        module: 'Staff'
      }, {
        hotelId: hotelId,
        module: 'Staff',
        action: 'ACTIVITY_LOG_CREATE',
        details: 'Staff roles update activity'
      });
      toast.success('Permissions updated');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${member.uid}`);
      if (err.code === 'permission-denied' || (err.message && err.message.toLowerCase().includes('permission'))) {
        toast.error('Insufficient Firestore permissions. You do not have the authorization required to update user roles.');
      } else {
        toast.error('Failed to update permissions');
      }
    }
  };

  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [showConfirmRemove, setShowConfirmRemove] = useState<{ uid: string; email: string } | null>(null);

  if (profile?.role !== 'hotelAdmin' && profile?.role !== 'superAdmin') {
    return (
      <div className="p-8 flex flex-col items-center justify-center h-[60vh] text-center">
        <Lock size={48} className="text-zinc-700 mb-4" />
        <h2 className="text-xl font-bold text-zinc-50 mb-2">Access Restricted</h2>
        <p className="text-zinc-400">Only administrators can manage staff members.</p>
      </div>
    );
  }

  const filteredStaff = staff.filter(member => {
    const search = searchTerm.toLowerCase();
    const matchesSearch = (member.displayName?.toLowerCase() || '').includes(search) || 
                          (member.email?.toLowerCase() || '').includes(search);
    
    const status = member.status || 'active';
    const matchesStatus = statusFilter === 'all' || status === statusFilter;

    return matchesSearch && matchesStatus;
  });

  const handleExport = () => {
    const dataToExport = filteredStaff.map(s => ({
      Name: s.displayName || 'N/A',
      Email: s.email,
      Role: s.role,
      Permissions: (s.roles || []).join(', '),
      Status: s.status || 'active',
      CreatedAt: s.createdAt ? new Date(s.createdAt).toLocaleDateString() : 'N/A'
    }));
    exportToCSV(dataToExport, `staff_list_${new Date().toISOString().split('T')[0]}.csv`);
    toast.success('Staff list exported successfully');
  };

  return (
    <div className="p-8 space-y-8 relative">
      <ConfirmModal
        isOpen={!!showConfirmRemove}
        title="Remove Staff Member"
        message={`Are you sure you want to remove ${showConfirmRemove?.email}? This action cannot be undone.`}
        onConfirm={() => showConfirmRemove && removeStaff(showConfirmRemove.uid, showConfirmRemove.email)}
        onCancel={() => setShowConfirmRemove(null)}
        type="danger"
        confirmText="Remove Staff"
      />

      <ConfirmModal
        isOpen={!!pendingRoleChange}
        title="Confirm Permission Override"
        message={pendingRoleChange ? `Are you sure you want to ${pendingRoleChange.isAdding ? 'grant' : 'revoke'} the "${pendingRoleChange.roleLabel}" override permission for ${pendingRoleChange.member.displayName || pendingRoleChange.member.email}?` : ''}
        onConfirm={async () => {
          if (pendingRoleChange) {
            const { member, roleId } = pendingRoleChange;
            setPendingRoleChange(null);
            await toggleRole(member, roleId);
          }
        }}
        onCancel={() => setPendingRoleChange(null)}
        type="warning"
        confirmText={pendingRoleChange ? (pendingRoleChange.isAdding ? 'Confirm Grant' : 'Confirm Revoke') : 'Confirm'}
      />

      <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-zinc-50 tracking-tight">Staff Management</h1>
          <p className="text-zinc-400">Manage your hotel's team and roles</p>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleExport}
            className="flex items-center gap-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-50 px-4 py-2 rounded-xl font-medium transition-all active:scale-95"
          >
            <Download size={18} />
            Export CSV
          </button>
          <button 
            onClick={() => setIsAddingStaff(true)}
            className="w-full sm:w-auto bg-emerald-500 text-black px-4 py-2 rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-emerald-400 transition-all active:scale-95"
          >
            <UserPlus size={18} />
            Add Staff Member
          </button>
        </div>
      </header>

      {isAddingStaff && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-6">Add Staff Member</h3>
            <form onSubmit={addStaff} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Full Name</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={newStaff.displayName}
                  onChange={(e) => setNewStaff({ ...newStaff, displayName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Email Address</label>
                <input 
                  required
                  type="email" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={newStaff.email}
                  onChange={(e) => setNewStaff({ ...newStaff, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Initial Password</label>
                <input 
                  required
                  type="text" 
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={newStaff.password}
                  onChange={(e) => setNewStaff({ ...newStaff, password: e.target.value })}
                  placeholder="Set a password for them"
                />
                <p className="text-[10px] text-zinc-500 mt-1 italic">Tell the staff member this password so they can login.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Base Access Role</label>
                <select
                  required
                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-4 py-2 text-zinc-50 focus:border-emerald-500 outline-none"
                  value={newStaff.role}
                  onChange={(e) => setNewStaff({ ...newStaff, role: e.target.value })}
                >
                  {BASE_ROLES.map(role => (
                    <option key={role.id} value={role.id}>{role.label}</option>
                  ))}
                </select>
                <p className="text-[10px] text-zinc-500 mt-1 italic">Determines base permissions. Use "Additional Overrides" for fine-tuning.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Additional Overrides</label>
                <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto p-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                  {AVAILABLE_ROLES.map(role => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => {
                        const roles = newStaff.roles.includes(role.id)
                          ? newStaff.roles.filter(r => r !== role.id)
                          : [...newStaff.roles, role.id];
                        setNewStaff({ ...newStaff, roles });
                      }}
                      className={cn(
                        "px-2 py-1.5 rounded text-[10px] font-bold uppercase transition-all",
                        newStaff.roles.includes(role.id)
                          ? "bg-emerald-500 text-black"
                          : "bg-zinc-800 text-zinc-500 hover:text-zinc-50"
                      )}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-zinc-500 mt-1 italic italic">Permissions added on top of the base role.</p>
              </div>
              <div className="flex gap-4 mt-8">
                <button 
                  type="button"
                  onClick={() => setIsAddingStaff(false)}
                  className="flex-1 px-4 py-2 rounded-lg border border-zinc-800 text-zinc-400 hover:text-zinc-50 transition-all active:scale-95"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  className="flex-1 bg-emerald-500 text-black font-bold py-2 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
                >
                  Add Member
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Summary Panel */}
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
        <h4 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-4">Team Composition</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
          {BASE_ROLES.map(role => {
            const count = staff.filter(m => m.role === role.id).length;
            const getRoleDisplayName = (id: string, qty: number) => {
              switch (id) {
                case 'hotelAdmin':
                  return qty === 1 ? 'Admin' : 'Admins';
                case 'manager':
                  return qty === 1 ? 'Manager' : 'Managers';
                case 'frontDesk':
                  return qty === 1 ? 'Front Desk Agent' : 'Front Desk Agents';
                case 'housekeeper':
                  return qty === 1 ? 'Housekeeper' : 'Housekeepers';
                case 'maintenance':
                  return qty === 1 ? 'Maintenance Personnel' : 'Maintenance Staff';
                case 'accountant':
                  return qty === 1 ? 'Accountant' : 'Accountants';
                default:
                  return qty === 1 ? 'Staff' : 'Staff Members';
              }
            };
            return (
              <div 
                key={role.id} 
                className="bg-zinc-950 border border-zinc-900 p-4 rounded-xl flex flex-col items-center justify-center text-center hover:border-zinc-700 transition duration-200 cursor-default"
              >
                <div className="text-2xl font-bold text-zinc-50 font-mono mb-1">{count}</div>
                <div className="text-xs text-zinc-400 capitalize font-medium">
                  {getRoleDisplayName(role.id, count)}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h3 className="font-bold text-zinc-50">Team Members</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Showing {filteredStaff.length} of {staff.length} staff members</p>
          </div>
          <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto">
            {/* Status Dropdown Filter */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as any)}
              className="bg-zinc-950 border border-zinc-850 rounded-lg px-3 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500 cursor-pointer w-full sm:w-auto font-medium"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="inactive">Inactive Only</option>
            </select>

            {/* Export To CSV Button */}
            <button
              type="button"
              onClick={handleExport}
              className="flex items-center justify-center gap-2 bg-zinc-950 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-zinc-50 px-3 py-1.5 rounded-lg text-sm font-medium transition-all active:scale-95 w-full sm:w-auto cursor-pointer"
              title="Export currently filtered list to CSV"
            >
              <Download size={14} />
              <span>Export CSV</span>
            </button>

            {/* Search Input */}
            <div className="relative w-full sm:w-auto">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
              <input 
                type="text" 
                placeholder="Search staff..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full sm:w-auto bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider border-b border-zinc-800">
                <th className="px-6 py-4">Member</th>
                <th className="px-6 py-4">Role</th>
                <th className="px-6 py-4">Permissions</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-800">
              {filteredStaff.map(member => (
                <tr key={member.uid} className="hover:bg-zinc-800/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-zinc-800 rounded-full flex items-center justify-center text-zinc-400">
                        <UserIcon size={20} />
                      </div>
                      <div>
                        <div className="text-sm font-medium text-zinc-50">{member.displayName || 'Unnamed Staff'}</div>
                        <div className="text-xs text-zinc-500 flex items-center gap-1">
                          <Mail size={12} />
                          {member.email}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2 text-xs text-zinc-400">
                      <Shield size={14} className="text-emerald-500" />
                      <div className="flex flex-wrap gap-1">
                        {member.role === 'hotelAdmin' ? (
                          <span className="capitalize">Hotel Admin</span>
                        ) : (
                          (member.roles || member.permissions || ['Staff']).map(r => (
                            <span key={r} className="capitalize">{r}</span>
                          )).reduce((prev, curr) => [prev, ', ', curr] as any)
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex flex-wrap gap-1">
                      {(member.permissions || []).slice(0, 2).map(p => (
                        <span key={p} className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded text-[10px] uppercase font-bold">
                          {p}
                        </span>
                      ))}
                      {(member.permissions || []).length > 2 && (
                        <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-500 rounded text-[10px] font-bold">
                          +{(member.permissions || []).length - 2}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={cn(
                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider",
                      member.status === 'active' ? "bg-emerald-500/10 text-emerald-500" : "bg-red-500/10 text-red-500"
                    )}>
                      {member.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-2">
                      {member.role !== 'hotelAdmin' && (
                        <button 
                          onClick={() => handleResetPassword(member.email, member.uid)}
                          disabled={isResetting === member.uid}
                          className={cn(
                            "p-2 transition-colors",
                            isResetting === member.uid ? "text-zinc-700 animate-spin" : "text-zinc-500 hover:text-emerald-500"
                          )}
                          title="Send Password Reset Email"
                        >
                          <RefreshCw size={18} />
                        </button>
                      )}
                      {member.role !== 'hotelAdmin' && (
                        <button 
                          onClick={() => setEditingPermissions(member)}
                          disabled={member.uid === profile?.uid}
                          className={cn(
                            "p-2 transition-colors",
                            member.uid === profile?.uid ? "text-zinc-700 cursor-not-allowed" : "text-zinc-500 hover:text-emerald-500"
                          )}
                          title={member.uid === profile?.uid ? "You cannot edit your own permissions" : "Manage Permissions"}
                        >
                          <Lock size={18} />
                        </button>
                      )}
                      {member.role !== 'hotelAdmin' && member.uid !== profile?.uid && (profile?.role === 'hotelAdmin' || profile?.role === 'superAdmin') && (
                        <button 
                          onClick={() => setShowConfirmRemove({ uid: member.uid, email: member.email })}
                          className="p-2 text-zinc-500 hover:text-red-500 transition-colors"
                          title="Remove Staff"
                        >
                          <Trash2 size={18} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {editingPermissions && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl w-full max-w-md">
            <h3 className="text-xl font-bold text-zinc-50 mb-2">Manage Permissions</h3>
            <p className="text-zinc-400 text-sm mb-6">Setting permissions for {editingPermissions.displayName || editingPermissions.email}</p>
            
            <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2">
              {AVAILABLE_ROLES.map(role => {
                const isGranted = (editingPermissions.roles || editingPermissions.permissions || []).includes(role.id);
                return (
                  <button
                    key={role.id}
                    onClick={() => {
                      const isGranted = (editingPermissions.roles || editingPermissions.permissions || []).includes(role.id);
                      setPendingRoleChange({
                        member: editingPermissions,
                        roleId: role.id as StaffRole,
                        roleLabel: role.label,
                        isAdding: !isGranted
                      });
                    }}
                    className={cn(
                      "w-full flex items-center justify-between p-3 rounded-xl border transition-all active:scale-[0.98]",
                      isGranted 
                        ? "bg-emerald-500/10 border-emerald-500/50 text-emerald-500" 
                        : "bg-zinc-950 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                    )}
                  >
                    <span className="text-sm font-medium">{role.label}</span>
                    {isGranted ? <CheckCircle2 size={18} /> : <XCircle size={18} />}
                  </button>
                );
              })}
            </div>

            <button 
              onClick={() => setEditingPermissions(null)}
              className="w-full mt-8 bg-emerald-500 text-black font-bold py-3 rounded-lg hover:bg-emerald-400 transition-all active:scale-95"
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
