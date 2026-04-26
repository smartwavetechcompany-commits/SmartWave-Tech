import React, { useEffect, useState } from 'react';
import { collection, query, where, doc, deleteDoc, onSnapshot } from 'firebase/firestore';
import { sendPasswordResetEmail } from 'firebase/auth';
import { db, auth, handleFirestoreError, serverTimestamp, safeWrite, safeAdd, safeDelete } from '../firebase';
import { ConfirmModal } from './ConfirmModal';
import { useAuth } from '../contexts/AuthContext';
import { UserProfile, StaffRole, OperationType } from '../types';
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
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'frontDesk', label: 'Front Desk' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'housekeeping', label: 'Housekeeping' },
  { id: 'kitchen', label: 'F & B' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'maintenance', label: 'Maintenance' },
  { id: 'guests', label: 'Guests' },
  { id: 'corporate', label: 'Corporate' },
  { id: 'finance', label: 'Finance' },
  { id: 'reports', label: 'Reports' },
  { id: 'staff', label: 'Staff Management' },
  { id: 'settings', label: 'Settings' },
  { id: 'manager', label: 'Manager' },
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
    role: 'staff' as const,
    roles: ['frontDesk'] as StaffRole[],
  });

  const [hasPermissionError, setHasPermissionError] = useState(false);
  const [isResetting, setIsResetting] = useState<string | null>(null);

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

    const tempUid = `staff_${Math.random().toString(36).substr(2, 9)}`;
    const timestamp = serverTimestamp();
    const staffProfile: any = {
      uid: tempUid,
      email: newStaff.email.toLowerCase(),
      hotelId: hotelId,
      role: 'staff',
      createdAt: timestamp,
      updatedAt: timestamp,
      roles: newStaff.roles,
      permissions: newStaff.roles, // Keep for backward compatibility
      status: 'active',
      displayName: newStaff.displayName,
      initialPassword: newStaff.password, // Store temporarily for first login
    };

    try {
      await safeWrite(doc(db, 'users', tempUid), staffProfile, hotelId, 'CREATE_STAFF');
      
      // Log the action
      await safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
        timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        userId: profile?.uid || 'system',
        userEmail: profile?.email || 'system',
        userRole: profile?.role || 'staff',
        action: 'CREATE_STAFF',
        resource: `Staff: ${newStaff.email} (${newStaff.roles.join(', ')})`,
        hotelId: hotelId,
        module: 'Staff',
        details: `Initial password set by admin: ${newStaff.password}`
      }, hotelId, 'LOG_CREATE_STAFF');

      setIsAddingStaff(false);
      setNewStaff({ email: '', displayName: '', password: '', role: 'staff', roles: ['frontDesk'] });
      toast.success('Staff member added successfully. They can now login with the password you provided.');
    } catch (err: any) {
      handleFirestoreError(err, OperationType.WRITE, `users/${tempUid}`);
      console.error("Add staff error:", err.message || safeStringify(err));
      toast.error('Failed to add staff member');
    }
  };

  const removeStaff = async (staffUid: string, staffEmail: string) => {
    if (!hotelId) return;

    try {
      await safeDelete(doc(db, 'users', staffUid), hotelId, 'DELETE_STAFF');
      
      // Log the action
      await safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
        timestamp: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'DELETE_STAFF',
        resource: `Staff: ${staffEmail}`,
        hotelId: hotelId,
        module: 'Staff'
      }, hotelId, 'LOG_DELETE_STAFF');
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
      
      // Log the action
      if (hotelId) {
        await safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
          timestamp: serverTimestamp(),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          userId: profile?.uid,
          userEmail: profile?.email,
          userRole: profile?.role,
          action: 'STAFF_PASSWORD_RESET_SENT',
          resource: `Staff: ${email}`,
          hotelId: hotelId,
          module: 'Staff'
        }, hotelId, 'LOG_STAFF_PASSWORD_RESET');
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
    
    const currentRoles: StaffRole[] = (member.roles || member.permissions || []) as StaffRole[];
    const newRoles = currentRoles.includes(roleId)
      ? currentRoles.filter(r => r !== roleId)
      : [...currentRoles, roleId];
      
    try {
      const timestamp = serverTimestamp();
      await safeWrite(doc(db, 'users', member.uid), { 
        roles: newRoles,
        permissions: newRoles, // Keep sync
        updatedAt: timestamp
      }, hotelId, 'UPDATE_STAFF_ROLES');
      
      // Update local state for immediate feedback
      if (editingPermissions) {
        setEditingPermissions({ ...editingPermissions, roles: newRoles, permissions: newRoles });
      }
      
      // Log the action (Audit Trail)
      await safeAdd(collection(db, 'hotels', hotelId, 'activityLogs'), {
        timestamp: timestamp,
        createdAt: timestamp,
        updatedAt: timestamp,
        userId: profile?.uid,
        userEmail: profile?.email,
        userRole: profile?.role,
        action: 'UPDATE_STAFF_ROLES',
        resource: `Staff: ${member.email}, Roles: ${newRoles.join(', ')}`,
        hotelId: hotelId,
        module: 'Staff'
      }, hotelId, 'LOG_UPDATE_STAFF_ROLES');
      toast.success('Permissions updated');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${member.uid}`);
      toast.error('Failed to update permissions');
    }
  };

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
    return (member.displayName?.toLowerCase() || '').includes(search) || 
           (member.email?.toLowerCase() || '').includes(search);
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
                <label className="block text-xs font-semibold text-zinc-500 uppercase mb-1">Primary Roles</label>
                <div className="grid grid-cols-2 gap-2 max-h-[150px] overflow-y-auto p-2 bg-zinc-950 border border-zinc-800 rounded-lg">
                  {AVAILABLE_ROLES.map(role => (
                    <button
                      key={role.id}
                      type="button"
                      onClick={() => {
                        const roles = newStaff.roles.includes(role.id as StaffRole)
                          ? newStaff.roles.filter(r => r !== role.id)
                          : [...newStaff.roles, role.id as StaffRole];
                        setNewStaff({ ...newStaff, roles });
                      }}
                      className={cn(
                        "px-2 py-1.5 rounded text-[10px] font-bold uppercase transition-all",
                        newStaff.roles.includes(role.id as StaffRole)
                          ? "bg-emerald-500 text-black"
                          : "bg-zinc-800 text-zinc-500 hover:text-zinc-50"
                      )}
                    >
                      {role.label}
                    </button>
                  ))}
                </div>
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

      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl overflow-hidden">
        <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
          <h3 className="font-bold text-zinc-50">Team Members</h3>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" size={16} />
            <input 
              type="text" 
              placeholder="Search staff..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="bg-zinc-950 border border-zinc-800 rounded-lg pl-10 pr-4 py-1.5 text-sm text-zinc-50 focus:outline-none focus:border-emerald-500"
            />
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
                      {member.role !== 'hotelAdmin' && member.uid !== profile?.uid && (
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
                    onClick={() => toggleRole(editingPermissions, role.id as StaffRole)}
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
